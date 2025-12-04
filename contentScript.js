// WebEdit AI Content Script - In-page Chat Panel

// Mode flags
let isPickMode = false;
let isRemoveMode = false;
let isAddFeatureMode = false; // Track if we're in Add feature flow

const addFeaturePrompt = {
  step: 'idle', // 'idle' | 'name' | 'description'
  name: '',
  description: '',
  targetSelector: null,
  targetDescription: '',
  type: 'note'
};
const MAX_SAVED_CHAT_MESSAGES = 50;

const PANEL_STATE_KEY = 'webedit-panel-state';

// UI state
let currentTool = "remove";
let hoverEl = null;
let selectedEl = null;
let floatingLabel = null;

// Shadow DOM Host and Root
let panelHost = null;
let panelShadow = null;
let chatPanel = null; // Still keeps ref to the inner panel div

let isPanelOpen = false;
let currentUser = null; // Store current authenticated user
let activeInteractionMode = null; // Track which manual mode is currently active (pick/remove)
const WEBEDIT_HISTORY_URL = "https://www.webeditai.com/#/history";
let authUiUpdatePending = false;
let authUiRetryTimeout = null;
let panelCreationScheduled = false;
let panelStateSaveTimeout = null;
let isRestoringPanelState = false;
let currentUserAudit = null;
let lastAuthorizedUserId = null;
let hasRestoredStateForUser = false;
let authGuardElement = null;

// Auth sync state
let authSyncInterval = null;
const AUTH_SYNC_INTERVAL_MS = 3000; // Check every 3 seconds
const WEBEDIT_DOMAIN = "webeditai.com";

// Selected element for editing (used by Pick mode)
let currentEditTarget = {
  element: null,
  selector: null,
  description: null,
  pageKey: null
};

// Chat messages
let chatMessages = [];
let referenceDismissTimeout = null;

const WEBEDIT_ATTR = "data-webedit-id";
const AUTH_ACTIVITY_KEY = "webeditAuthAudit";

// ============================================
// DOM Helpers for Shadow DOM
// ============================================

function getPanelElement(id) {
  if (!panelShadow) return null;
  return panelShadow.getElementById(id);
}

function queryPanel(selector) {
  if (!panelShadow) return [];
  return panelShadow.querySelectorAll(selector);
}

// ============================================
// Page Shift Helpers
// ============================================

const PANEL_WIDTH_FALLBACK = 400;
let pageShiftResizeHandler = null;

function getPanelWidthForShift() {
  if (!chatPanel) {
    return PANEL_WIDTH_FALLBACK;
  }
  const rect = chatPanel.getBoundingClientRect();
  const measured = Math.round(rect.width || chatPanel.offsetWidth || PANEL_WIDTH_FALLBACK);
  return measured > 0 ? measured : PANEL_WIDTH_FALLBACK;
}

function applyPageShiftWidth() {
  if (!document.documentElement || !document.body) {
    return;
  }
  const width = getPanelWidthForShift();
  const widthValue = `${width}px`;
  document.documentElement.style.setProperty('--webedit-panel-width', widthValue);
  document.body.style.setProperty('--webedit-panel-width', widthValue);
}

function clearPageShiftWidth() {
  if (!document.documentElement || !document.body) {
    return;
  }
  document.documentElement.style.removeProperty('--webedit-panel-width');
  document.body.style.removeProperty('--webedit-panel-width');
}

function startPageShiftTracking() {
  if (pageShiftResizeHandler) {
    return;
  }
  pageShiftResizeHandler = () => {
    if (!isPanelOpen) {
      return;
    }
    applyPageShiftWidth();
  };
  window.addEventListener('resize', pageShiftResizeHandler);
}

function stopPageShiftTracking() {
  if (!pageShiftResizeHandler) {
    return;
  }
  window.removeEventListener('resize', pageShiftResizeHandler);
  pageShiftResizeHandler = null;
}

// ============================================
// Supabase Authentication Integration
// ============================================

/**
 * Check if extension context is valid
 * In content scripts, chrome.runtime.id should always exist if we're in extension context
 * @returns {boolean} True if extension context is available and valid
 */
function isExtensionContextValid() {
  try {
    // In content scripts, chrome should always be defined
    if (typeof chrome === 'undefined') {
      return false; // Running in page world, not extension context
    }

    // chrome.runtime.id is the definitive check - it only exists in extension context
    if (!chrome.runtime || typeof chrome.runtime.id === 'undefined') {
      return false; // Not in extension context
    }

    return true; // All checks passed - we're in valid extension context
  } catch (error) {
    // Any error accessing chrome APIs means context is invalidated
    return false;
  }
}

async function readAuthAuditForUser(userId) {
  if (!userId || !isExtensionContextValid()) {
    return null;
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([AUTH_ACTIVITY_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error("❌ Error reading auth activity:", chrome.runtime.lastError);
        resolve(null);
        return;
      }
      const all = result[AUTH_ACTIVITY_KEY] || {};
      resolve(all[userId] || null);
    });
  });
}

async function updateAuthAudit(userId, updates = {}) {
  if (!userId || !isExtensionContextValid()) {
    return null;
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([AUTH_ACTIVITY_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error("❌ Error reading auth activity for update:", chrome.runtime.lastError);
        resolve(null);
        return;
      }

      const all = result[AUTH_ACTIVITY_KEY] || {};
      const existing = all[userId] || {};
      const next = { ...existing, ...updates };

      chrome.storage.local.set({ [AUTH_ACTIVITY_KEY]: { ...all, [userId]: next } }, () => {
        if (chrome.runtime.lastError) {
          console.error("❌ Error saving auth activity:", chrome.runtime.lastError);
          resolve(null);
          return;
        }
        resolve(next);
      });
    });
  });
}

function formatAuditTimestamp(timestamp) {
  if (!timestamp) return "Not available";
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return "Not available";
  }
}

/**
 * Check the current authentication status
 * Retrieves the stored Supabase session from extension storage
 */
async function checkAuthStatus(options = {}) {
  const suppressStateUpdate = options.suppressStateUpdate || false;
  // Early bailout if extension context is invalid
  if (!isExtensionContextValid()) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "WEBEDIT_GET_SESSION" }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
          // Only log non-connection errors (connection errors are expected if background is unloaded)
          if (!errorMsg.includes('Could not establish connection') &&
            !errorMsg.includes('Receiving end does not exist') &&
            !errorMsg.includes('Extension context invalidated')) {
            console.error("❌ Error checking auth status:", chrome.runtime.lastError);
          }
          resolve(null);
          return;
        }

        const session = response?.session || null;
        const nextUser = session?.user || null;

        if (!suppressStateUpdate) {
          handleAuthStateChange(nextUser, { reason: "explicit-check" }).then(() => {
            resolve(currentUser);
          });
          return;
        }

        currentUser = nextUser;
        resolve(currentUser);
      });
    } catch (error) {
      // Silently handle errors (background might be unloaded)
      resolve(null);
    }
  });
}

/**
 * Check if user is authorized to perform edits
 * Returns true if authorized, false otherwise
 * Shows notification if unauthorized
 */
function requireAuth(actionName = "perform this action") {
  if (!currentUser) {
    console.log(`🔒 Auth required for: ${actionName}`);
    showNotification(`Please sign in to ${actionName}`, "error");

    // Highlight the sign-in button briefly
    const signinBtn = getPanelElement("webedit-signin-btn");
    if (signinBtn) {
      signinBtn.style.animation = "pulse 0.5s ease-in-out 3";
      setTimeout(() => {
        signinBtn.style.animation = "";
      }, 1500);
    }

    return false;
  }
  return true;
}

function ensureAuthGuardElements() {
  if (authGuardElement) {
    return authGuardElement;
  }
  authGuardElement = getPanelElement("webedit-auth-guard");
  if (authGuardElement) {
    const guardBtn = authGuardElement.querySelector("#webedit-auth-guard-signin");
    if (guardBtn) {
      guardBtn.addEventListener("click", () => handleSignInClick());
    }
  }
  return authGuardElement;
}

function setFeatureControlsEnabled(isEnabled) {
  const toolButtons = queryPanel(".webedit-tool-btn");
  const pickBtn = getPanelElement("webedit-pick-btn");
  const chatInput = getPanelElement("webedit-chat-input");
  const customizePanel = getPanelElement("webedit-customize-panel");
  const customizeInputs = customizePanel ? customizePanel.querySelectorAll("input,button") : [];
  const historyBtn = getPanelElement("webedit-history-btn");
  const newChatBtn = getPanelElement("webedit-new-chat-btn");

  toolButtons.forEach((btn) => {
    btn.disabled = !isEnabled;
    btn.setAttribute("aria-disabled", String(!isEnabled));
  });

  if (pickBtn) {
    pickBtn.disabled = !isEnabled;
    pickBtn.setAttribute("aria-disabled", String(!isEnabled));
  }

  if (chatInput) {
    if (!chatInput.dataset.defaultPlaceholder) {
      chatInput.dataset.defaultPlaceholder = chatInput.getAttribute("placeholder") || "What do you want to change?";
    }
    chatInput.disabled = !isEnabled;
    chatInput.placeholder = isEnabled ? chatInput.dataset.defaultPlaceholder : "Sign in to start editing";
  }

  customizeInputs.forEach((input) => {
    input.disabled = !isEnabled;
    input.setAttribute("aria-disabled", String(!isEnabled));
  });

  if (historyBtn) {
    historyBtn.disabled = !isEnabled;
    historyBtn.setAttribute("aria-disabled", String(!isEnabled));
  }

  if (newChatBtn) {
    newChatBtn.disabled = !isEnabled;
    newChatBtn.setAttribute("aria-disabled", String(!isEnabled));
  }
}

function updateAuthGuardUI() {
  setFeatureControlsEnabled(!!currentUser);
  const guard = ensureAuthGuardElements();
  if (!guard) return;

  if (currentUser) {
    guard.classList.add("hidden");
  } else {
    guard.classList.remove("hidden");
  }
}

async function handleAuthStateChange(nextUser, options = {}) {
  const nextUserId = nextUser?.id || null;
  const previousUserId = lastAuthorizedUserId;
  const userChanged = nextUserId !== previousUserId;

  currentUser = nextUser || null;

  if (window.EditRules && window.EditRules.setActiveUser) {
    try {
      window.EditRules.setActiveUser(currentUser);
    } catch (error) {
      console.warn("⚠️ Failed to set active user in EditRules:", error);
    }
  }

  if (currentUser && userChanged) {
    const timestamp = Date.now();
    const existingAudit = await readAuthAuditForUser(currentUser.id);
    currentUserAudit = await updateAuthAudit(currentUser.id, {
      firstSignedInAt: existingAudit?.firstSignedInAt || timestamp,
      lastSignedInAt: timestamp
    });
    lastAuthorizedUserId = currentUser.id;
    hasRestoredStateForUser = false;
  } else if (!currentUser && previousUserId && userChanged) {
    await updateAuthAudit(previousUserId, {
      lastSignedOutAt: Date.now()
    });
    currentUserAudit = null;
    lastAuthorizedUserId = null;
    hasRestoredStateForUser = false;
  }

  if (currentUser && !currentUserAudit) {
    currentUserAudit = await readAuthAuditForUser(currentUser.id);
  }

  updateAuthUI();
  updateAuthGuardUI();

  if (!userChanged && !options.forceRefresh) {
    return;
  }

  if (currentUser) {
    try {
      await loadAuthorizedExperience();
    } catch (error) {
      console.error("❌ Failed to load authorized experience:", error);
    }
  } else {
    await enforceUnauthorizedExperience();
  }
}

async function loadAuthorizedExperience() {
  if (!currentUser?.id || hasRestoredStateForUser) {
    return;
  }

  await restorePanelState();
  await loadChatHistory();

  if (window.EditRules) {
    try {
      await window.EditRules.applyAllRulesForCurrentPage(true);
      const remoteRules = await window.EditRules.fetchRules(currentUser, getPageKey());
      console.log(`🔐 Loaded ${remoteRules.length} remote rule(s) for ${currentUser.email}`);
    } catch (error) {
      console.error("❌ Failed to apply persisted rules:", error);
    }
  }

  await restoreAddedFeatures();
  hasRestoredStateForUser = true;
}

async function enforceUnauthorizedExperience() {
  stopRemoveMode();
  stopPickMode();
  isAddFeatureMode = false;
  resetAddFeaturePromptState();
  chatMessages = [];
  renderChatMessages();
  currentSessionId = null;
  currentEditTarget = {
    element: null,
    selector: null,
    description: null,
    pageKey: null
  };
  updateChatInputPrompt("Sign in to start editing");
  setActiveToolButton("remove");
  updateAuthGuardUI();
}

/**
 * Sync authentication state from extension to website
 * Updates website localStorage if extension is signed in
 */
async function syncAuthToWebsite() {
  // Only sync if we're on the WebEdit AI website
  if (!window.location.hostname.includes(WEBEDIT_DOMAIN)) {
    return;
  }

  try {
    const extensionSession = await new Promise((resolve) => {
      chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
        resolve(result.webeditSupabaseSession);
      });
    });

    if (extensionSession) {
      const exactKey = 'sb-eqfjkvjwsswjxkmomxax-auth-token';
      let websiteSession = localStorage.getItem(exactKey);
      let websiteSessionKey = websiteSession ? exactKey : null;

      // Check for other keys if exact not found
      if (!websiteSession) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            websiteSession = localStorage.getItem(key);
            websiteSessionKey = key;
            break;
          }
        }
      }

      // If website doesn't have session but extension does, sync to website
      // Default to exact key for writing
      if (!websiteSession) {
        console.log("🔄 Syncing auth from extension to website...");
        localStorage.setItem(exactKey, JSON.stringify(extensionSession));
        websiteSessionKey = exactKey;
        console.log("✅ Auth synced to website");
      }

      window.postMessage({
        source: "webedit-extension",
        type: "WEBEDIT_SUPABASE_SESSION",
        payload: extensionSession
      }, window.origin);
    } else {
      // Extension signed out - ensure website clears session and is notified
      const keysToCheck = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
          keysToCheck.push(key);
        }
      }

      if (keysToCheck.length > 0) {
        keysToCheck.forEach((key) => localStorage.removeItem(key));
        console.log("🔄 Cleared website auth tokens due to extension sign-out");
      }

      window.postMessage({
        source: "webedit-extension",
        type: "WEBEDIT_SUPABASE_SESSION",
        payload: null
      }, window.origin);
    }
  } catch (error) {
    console.error("❌ Error syncing auth to website:", error);
  }
}

/**
 * Start periodic auth sync between website and extension
 */
function startAuthSync() {
  // Only run on WebEdit AI website
  if (!window.location.hostname.includes(WEBEDIT_DOMAIN)) {
    return;
  }

  // Stop any existing sync
  if (authSyncInterval) {
    clearInterval(authSyncInterval);
  }

  console.log("🔄 Starting auth sync between website and extension...");

  // Initial sync
  syncAuthToWebsite();

  // Periodic sync every 3 seconds
  authSyncInterval = setInterval(() => {
    syncAuthToWebsite();
  }, AUTH_SYNC_INTERVAL_MS);
}

/**
 * Stop auth sync
 */
function stopAuthSync() {
  if (authSyncInterval) {
    clearInterval(authSyncInterval);
    authSyncInterval = null;
    console.log("⏹️ Stopped auth sync");
  }
}

/**
 * Update the UI based on authentication state
 * Shows avatar with menu or "Sign in" button
 */
function updateAuthUI() {
  console.log("🔄 updateAuthUI called, currentUser:", currentUser ? currentUser.email : "null");

  if (!chatPanel) {
    console.log("⏳ Chat panel not ready yet, creating hidden panel for auth UI sync");
    authUiUpdatePending = true;
    const panelReady = ensureChatPanelExists();
    if (!panelReady) {
      return;
    }
    // ensureChatPanelExists -> createPanel -> updateAuthUI will rerun via pending flag.
    return;
  }

  const signinBtn = getPanelElement("webedit-signin-btn");
  if (!signinBtn) {
    console.warn("⚠️ Sign-in button element not available yet, scheduling retry");
    authUiUpdatePending = true;
    if (!authUiRetryTimeout) {
      authUiRetryTimeout = setTimeout(() => {
        authUiRetryTimeout = null;
        updateAuthUI();
      }, 100);
    }
    return;
  }

  if (authUiRetryTimeout) {
    clearTimeout(authUiRetryTimeout);
    authUiRetryTimeout = null;
  }

  authUiUpdatePending = false;
  console.log("✅ Found sign-in button element, ID:", signinBtn.id);

  if (currentUser) {
    // User is signed in - show avatar
    console.log("👤 User is signed in, rendering avatar");
    renderAvatar(signinBtn, currentUser, currentUserAudit);
  } else {
    // User is not signed in - show sign in button
    console.log("🔓 User not signed in, rendering sign-in button");
    renderSignInButton(signinBtn);
  }
}

/**
 * Render the avatar UI for signed-in user
 * CRITICAL: Do NOT replace the DOM element - just update its contents
 * Otherwise we break event listeners set up in attachPanelEventListeners()
 */
function renderAvatar(container, user, auditMeta = null) {
  console.log("🔧 Rendering avatar for", user.email);

  // CRITICAL: Clean up old event listeners AND pending timeouts
  if (container._closeMenuHandler) {
    document.removeEventListener('click', container._closeMenuHandler);
    delete container._closeMenuHandler;
  }

  // Cancel any pending timeout from previous render
  if (container._closeMenuTimeoutId) {
    clearTimeout(container._closeMenuTimeoutId);
    delete container._closeMenuTimeoutId;
  }

  // CRITICAL: Remove the sign-in button click handler before rendering avatar
  // This prevents clicks on the gray area around the avatar from triggering sign-in
  container.removeEventListener('click', handleSignInClick);

  // Add a handler to prevent clicks on the gray area (container) from doing anything
  // Only clicks on the avatar itself should toggle the menu
  const containerClickHandler = (e) => {
    // If clicking directly on container (not on avatar or menu), prevent default
    if (e.target === container) {
      e.preventDefault();
      e.stopPropagation();
      console.log("🔘 Clicked gray area around avatar, ignoring");
    }
  };

  // Remove old handler if exists, then add new one
  if (container._containerClickHandler) {
    container.removeEventListener('click', container._containerClickHandler);
  }
  container._containerClickHandler = containerClickHandler;
  container.addEventListener('click', containerClickHandler);

  // Update container classes and title WITHOUT replacing the element
  container.className = 'webedit-nav-btn signin-btn webedit-avatar-container';
  container.title = user.email || 'Account';

  // Clear existing content
  container.innerHTML = '';

  // Create avatar element
  const avatar = document.createElement('div');
  avatar.className = 'webedit-avatar';

  // Check if user has an avatar URL
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;

  if (avatarUrl) {
    avatar.style.backgroundImage = `url(${avatarUrl})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
  } else {
    // Show first letter of email
    const initial = (user.email || '?')[0].toUpperCase();
    avatar.textContent = initial;
    avatar.classList.add('webedit-avatar-letter');
  }

  container.appendChild(avatar);

  // Create dropdown menu (hidden by default)
  const menu = document.createElement('div');
  menu.className = 'webedit-avatar-menu';
  menu.innerHTML = `
    <div class="webedit-avatar-menu-header">
      <div class="webedit-avatar-menu-email">${user.email || 'User'}</div>
    </div>
    <div class="webedit-avatar-menu-meta">
      <div><strong>Last signed in:</strong> ${formatAuditTimestamp(auditMeta?.lastSignedInAt)}</div>
      <div><strong>Last signed out:</strong> ${formatAuditTimestamp(auditMeta?.lastSignedOutAt)}</div>
    </div>
    <div class="webedit-avatar-menu-item" data-action="history">
      <span class="webedit-avatar-menu-icon">📚</span>
      <span>View History</span>
    </div>
    <div class="webedit-avatar-menu-divider"></div>
    <div class="webedit-avatar-menu-item" data-action="signout">
      <span class="webedit-avatar-menu-icon">👋</span>
      <span>Sign Out</span>
    </div>
  `;

  container.appendChild(menu);

  // Toggle menu on avatar click
  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const isVisible = menu.classList.contains('visible');
    console.log("🔘 Avatar clicked, toggling menu. Currently visible:", isVisible);
    menu.classList.toggle('visible');
    console.log("🔘 Menu is now:", menu.classList.contains('visible') ? 'visible' : 'hidden');
  });

  // Handle menu item clicks
  menu.querySelectorAll('.webedit-avatar-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const action = item.dataset.action;
      console.log("🔘 Menu action:", action);
      menu.classList.remove('visible');

      if (action === 'history') {
        handleViewHistory();
      } else if (action === 'signout') {
        handleSignOut();
      }
    });
  });

  // Close menu when clicking outside
  // For Shadow DOM, clicking outside means checking composedPath or event.target
  const closeMenuHandler = (e) => {
    // e.composedPath() is needed for shadow DOM events
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(container) && !container.contains(e.target)) {
      menu.classList.remove('visible');
    }
  };

  // Store reference to handler for cleanup on the container
  container._closeMenuHandler = closeMenuHandler;

  // Add the listener with a small delay to avoid immediate closure
  const timeoutId = setTimeout(() => {
    document.addEventListener('click', closeMenuHandler);
    // Also listen on shadow root if possible
    if (panelShadow) panelShadow.addEventListener('click', closeMenuHandler);
    delete container._closeMenuTimeoutId;
  }, 100);

  container._closeMenuTimeoutId = timeoutId;

  console.log("✅ Avatar rendered successfully");
}

/**
 * Render the sign in button for non-authenticated users
 * CRITICAL: Do NOT replace the DOM element - just update its contents
 * Otherwise we break event listeners set up in attachPanelEventListeners()
 */
function renderSignInButton(container) {
  console.log("🔧 Rendering sign-in button");

  // CRITICAL: Clean up document-level click listener AND pending timeout from avatar
  if (container._closeMenuHandler) {
    document.removeEventListener('click', container._closeMenuHandler);
    if (panelShadow) panelShadow.removeEventListener('click', container._closeMenuHandler);
    delete container._closeMenuHandler;
  }

  // Cancel any pending timeout from avatar render
  if (container._closeMenuTimeoutId) {
    clearTimeout(container._closeMenuTimeoutId);
    delete container._closeMenuTimeoutId;
  }

  // Remove the container click handler from avatar if it exists
  if (container._containerClickHandler) {
    container.removeEventListener('click', container._containerClickHandler);
    delete container._containerClickHandler;
  }

  // Update container WITHOUT replacing it
  container.innerHTML = 'Sign in';
  container.className = 'webedit-nav-btn signin-btn';
  container.title = 'Sign in with Google';

  // Remove any existing sign-in click listeners by removing and re-adding
  // This ensures only one listener is active
  container.removeEventListener('click', handleSignInClick);
  container.addEventListener('click', handleSignInClick);

  console.log("✅ Sign-in button rendered successfully");
}

/**
 * Handle sign in button click - opens production login page
 */
function handleSignInClick() {
  console.log("🔐 Opening production login page");

  // Check if extension context is valid
  if (!isExtensionContextValid()) {
    showNotification("Extension context invalidated. Please reload the page.", "error");
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: "WEBEDIT_OPEN_LOGIN_TAB" }, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
        if (errorMsg.includes('Could not establish connection') || errorMsg.includes('Receiving end does not exist')) {
          showNotification("Extension background not available. Please reload the page.", "error");
        } else {
          console.error("❌ Error opening login:", chrome.runtime.lastError);
          showNotification("Failed to open login page. Please try again.", "error");
        }
        return;
      }

      console.log("✅ Login page opened");
      showNotification("Opening sign-in page...", "info");
    });
  } catch (error) {
    showNotification("Failed to open login page. Please reload the page.", "error");
  }
}

/**
 * Handle view history action
 */
function handleViewHistory() {
  console.log("📚 Opening history page");

  const historyUrl = `${WEBEDIT_HISTORY_URL}?from=extension-panel`;

  // Try immediate open to avoid waiting on the background service worker to spin up.
  if (tryOpenHistoryDirect(historyUrl)) {
    console.log("✅ History page opened directly via window.open");
    showNotification("Opening EditHistory...", "info");
    return;
  }

  // Check if extension context is valid
  if (!isExtensionContextValid()) {
    showNotification("Extension context invalidated. Please reload the page.", "error");
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: "WEBEDIT_OPEN_HISTORY" }, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
        if (errorMsg.includes('Could not establish connection') || errorMsg.includes('Receiving end does not exist')) {
          showNotification("Extension background not available. Please reload the page.", "error");
        } else {
          console.error("❌ Error opening history:", chrome.runtime.lastError);
          showNotification("Failed to open history page.", "error");
        }
        return;
      }

      console.log("✅ History page opened");
    });
  } catch (error) {
    showNotification("Failed to open history page. Please reload the page.", "error");
  }
}

/**
 * Attempt to open the history page directly via window.open for faster load
 * @param {string} url
 * @returns {boolean} whether the window was opened
 */
function tryOpenHistoryDirect(url) {
  try {
    const newTab = window.open(url, "_blank", "noopener");
    if (newTab) {
      // Ensure no reference to the opener for safety
      newTab.opener = null;
      return true;
    }
  } catch (error) {
    console.warn("⚠️ Direct history open blocked, falling back to background script:", error);
  }
  return false;
}

/**
 * Handle sign out action
 * Signs user out from both extension and website
 */
function handleSignOut() {
  console.log("👋 Signing out from extension and website");

  // Check if extension context is valid
  if (!isExtensionContextValid()) {
    showNotification("Extension context invalidated. Please reload the page.", "error");
    return;
  }

  // Show immediate feedback
  showNotification("Signing you out...", "info");

  try {
    chrome.runtime.sendMessage({ type: "WEBEDIT_SIGN_OUT" }, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
        if (errorMsg.includes('Could not establish connection') || errorMsg.includes('Receiving end does not exist')) {
          showNotification("Extension background not available. Please reload the page.", "error");
        } else {
          console.error("❌ Error signing out:", chrome.runtime.lastError);
          showNotification("Failed to sign out. Please try again.", "error");
        }
        return;
      }

      console.log("✅ Signed out successfully from extension");
      console.log("🌐 Opening website to complete sign out...");

      // Update local state immediately
      handleAuthStateChange(null, { reason: "manual-signout", forceRefresh: true });

      // Note: Background script will open the website with logout param
      // The website will handle the actual Supabase sign out
    });
  } catch (error) {
    showNotification("Failed to sign out. Please reload the page.", "error");
  }
}

/**
 * Show a temporary notification in the panel
 */
function showNotification(message, type = "info") {
  // Notification should be inside panel if possible
  const mainContent = queryPanel(".webedit-main-content")[0];
  if (!mainContent) return;

  // Remove any existing notification first
  const existingNotification = mainContent.querySelector(".webedit-notification");
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement("div");
  notification.className = `webedit-notification webedit-notification-${type}`;
  notification.innerHTML = `
    <div class="webedit-notification-content">
      <span class="webedit-notification-icon">${type === "success" ? "✓" : type === "error" ? "⚠" : "ℹ"}</span>
      <span class="webedit-notification-message">${message}</span>
    </div>
  `;

  // Append to mainContent (positioned absolutely, so it overlays)
  mainContent.appendChild(notification);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function showModeIndicator(mode) {
  const indicator = getPanelElement("webedit-mode-indicator");
  const textEl = getPanelElement("webedit-mode-text");
  const closeBtn = getPanelElement("webedit-mode-close-btn");

  if (!indicator || !textEl || !closeBtn) {
    return;
  }

  activeInteractionMode = mode;

  const messages = {
    remove: "Remove mode active - Click an element to hide it",
    pick: "Pick mode active - Click an element to select it"
  };

  textEl.textContent = messages[mode] || "Mode active";
  indicator.classList.remove("hidden");
  indicator.setAttribute("aria-hidden", "false");
  indicator.dataset.mode = mode;
  closeBtn.setAttribute("aria-label", `Exit ${mode === "remove" ? "Remove" : "Pick"} mode`);
}

function hideModeIndicator(mode) {
  const indicator = getPanelElement("webedit-mode-indicator");
  if (!indicator) {
    return;
  }

  if (mode && activeInteractionMode !== mode) {
    return;
  }

  activeInteractionMode = null;
  indicator.classList.add("hidden");
  indicator.setAttribute("aria-hidden", "true");
  indicator.removeAttribute("data-mode");
}

// ============================================
// Panel Creation & Management
// ============================================

function ensureChatPanelExists() {
  if (chatPanel) {
    return true;
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    createPanel();
    return true;
  }

  if (!panelCreationScheduled) {
    panelCreationScheduled = true;
    document.addEventListener("DOMContentLoaded", () => {
      panelCreationScheduled = false;
      createPanel();
    }, { once: true });
  }

  return false;
}

function setActiveToolButton(tool) {
  currentTool = tool;
  const toolButtons = queryPanel(".webedit-tool-btn");
  toolButtons.forEach((btn) => {
    if (btn.dataset.tool === tool) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  schedulePanelStateSave();
}

/**
 * Creates and injects the AI chat panel into the page
 * The panel is a centered, mobile-like interface that floats over the page
 * Returns the created panel element
 */
function createPanel() {
  if (chatPanel) return chatPanel;

  // Create Host Element for Shadow DOM
  panelHost = document.createElement("div");
  panelHost.id = "webedit-host";
  // Reset styles and position fixed on top
  panelHost.style.all = "initial";
  panelHost.style.position = "fixed";
  panelHost.style.top = "0";
  panelHost.style.left = "0";
  panelHost.style.width = "0";
  panelHost.style.height = "0";
  panelHost.style.zIndex = "2147483647";

  // Create Shadow Root
  panelShadow = panelHost.attachShadow({ mode: "open" });

  // Inject Stylesheet into Shadow Root
  const linkEl = document.createElement("link");
  linkEl.rel = "stylesheet";
  linkEl.href = chrome.runtime.getURL("panel.css");
  panelShadow.appendChild(linkEl);

  const panel = document.createElement("div");
  panel.id = "webedit-chat-panel";
  panel.className = "hidden";
  panel.innerHTML = `
    <!-- Header Navigation Bar -->
    <div class="webedit-panel-header">
      <button class="webedit-header-hamburger" id="webedit-header-hamburger">☰</button>
      <button class="webedit-nav-btn logo-btn" id="webedit-logo-btn">WebEdit</button>
      <button class="webedit-nav-btn history-btn" id="webedit-history-btn" style="display:none">History</button>
      <button class="webedit-nav-btn signin-btn" id="webedit-signin-btn">Sign in</button>
      <button class="webedit-close-btn" id="webedit-close-btn">×</button>
    </div>

    <div class="webedit-auth-guard hidden" id="webedit-auth-guard" aria-live="polite">
      <div class="webedit-auth-guard-card">
        <h3>Sign in required</h3>
        <p>Sign in for getting access to the features.</p>
        <button class="webedit-auth-guard-btn" id="webedit-auth-guard-signin">Sign in</button>
      </div>
    </div>

    <!-- History Sidebar -->
    <div class="webedit-history-sidebar" id="webedit-history-sidebar">
      <div class="webedit-history-header">
        <span>Chat History</span>
        <button class="webedit-new-chat-btn" id="webedit-new-chat-btn">New Chat</button>
      </div>
      <div class="webedit-history-list" id="webedit-history-list"></div>
    </div>

    <!-- Main Content Area -->
    <div class="webedit-main-content">
      <div class="webedit-chat-messages" id="webedit-chat-messages">
      <div class="webedit-chat-placeholder">
        <p>Select a tool from Visual Edit menu below to get started</p>
        </div>
      </div>
      <div class="webedit-references-container" id="webedit-references-container"></div>
    </div>

    <!-- Customize Panel (collapsible) -->
    <div class="webedit-customize-panel" id="webedit-customize-panel">
      <div class="webedit-customize-header">
        <h3>Customize Element</h3>
        <button class="webedit-customize-close-btn" id="webedit-customize-close-btn">×</button>
      </div>
      <p class="webedit-customize-info">Pick an element to customize its appearance</p>
      
      <div class="webedit-field-row">
        <label>Background:</label>
        <input type="color" id="webedit-bg-color" value="#ffffff" />
      </div>
      
      <div class="webedit-field-row">
        <label>Text Color:</label>
        <input type="color" id="webedit-text-color" value="#000000" />
      </div>
      
      <div class="webedit-field-row">
        <label>Font Size:</label>
        <input type="number" id="webedit-font-size" value="16" min="8" max="72" />
      </div>
      
      <div class="webedit-customize-actions">
        <button class="webedit-btn-small webedit-btn-primary" id="webedit-apply-btn">Apply</button>
        <button class="webedit-btn-small webedit-btn-secondary" id="webedit-reset-btn">Reset</button>
      </div>
    </div>

    <!-- Bottom Controls -->
    <div class="webedit-bottom-controls">
      <div class="webedit-visual-edit">
        <span class="webedit-tool-label">Visual Edit</span>
        <button class="webedit-hamburger-btn" id="webedit-burger-btn">
          <span></span>
          <span></span>
          <span></span>
        </button>
        <!-- Tools dropdown menu -->
        <div class="webedit-tools-menu" id="webedit-tools-menu">
          <button class="webedit-tool-btn" data-tool="add" id="webedit-add-btn">Add</button>
          <button class="webedit-tool-btn active" data-tool="remove" id="webedit-remove-btn">Remove/hide</button>
          <button class="webedit-tool-btn" data-tool="customize" id="webedit-customize-btn">Customize</button>
        </div>
      </div>
      <button class="webedit-pick-btn-bottom" id="webedit-pick-btn">Pick element</button>
    </div>

    <div class="webedit-mode-indicator hidden" id="webedit-mode-indicator" aria-live="polite" aria-hidden="true">
      <span class="webedit-mode-text" id="webedit-mode-text">Mode active</span>
      <button class="webedit-mode-close-btn" id="webedit-mode-close-btn" type="button" aria-label="Exit mode">×</button>
    </div>

    <!-- Chat Input Bar (at bottom) -->
    <div class="webedit-input-container">
      <input 
        type="text" 
        class="webedit-chat-input" 
        id="webedit-chat-input" 
        placeholder="What to do you want to change?"
        autocomplete="off"
      />
    </div>

  `;

  panelShadow.appendChild(panel);
  document.body.appendChild(panelHost);
  chatPanel = panel;

  attachPanelEventListeners();

  if (authUiUpdatePending) {
    console.log("🔁 Running deferred auth UI update now that panel is ready");
    updateAuthUI();
  }

  updateAuthGuardUI();

  return panel;
}

/**
 * Toggle the panel visibility on/off
 * If panel doesn't exist yet, creates it first
 * @param {boolean} show - Optional: true to show, false to hide, undefined to toggle
 */
async function togglePanel(show, options = {}) {
  const skipSave = options.skipSave || false;
  if (!chatPanel) {
    createPanel();
  }

  if (show === undefined) {
    show = !isPanelOpen;
  }

  isPanelOpen = show;

  if (show) {
    chatPanel.classList.remove("hidden");
    document.documentElement.classList.add("webedit-panel-open");
    document.body.classList.add("webedit-panel-open");
    applyPageShiftWidth();
    startPageShiftTracking();

    // Check auth status when opening the panel
    console.log("🔍 Checking auth status...");
    const user = await checkAuthStatus();
    console.log("🔍 Auth check result:", user ? user.email : "Not signed in");
  } else {
    chatPanel.classList.add("hidden");
    document.documentElement.classList.remove("webedit-panel-open");
    document.body.classList.remove("webedit-panel-open");
    stopPageShiftTracking();
    clearPageShiftWidth();
  }
  if (!skipSave) {
    schedulePanelStateSave();
  }
}

// ============================================
// Event Listeners for Panel UI
// ============================================

function attachPanelEventListeners() {
  // Close button
  const closeBtn = getPanelElement("webedit-close-btn");
  closeBtn.addEventListener("click", () => togglePanel(false));

  // History Sidebar Toggle
  const headerHamburger = getPanelElement("webedit-header-hamburger");
  const historySidebar = getPanelElement("webedit-history-sidebar");

  if (headerHamburger && historySidebar) {
    headerHamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      historySidebar.classList.toggle("visible");
    });

    // Close sidebar when clicking outside
    document.addEventListener("click", (e) => {
      if (historySidebar.classList.contains("visible") &&
        !historySidebar.contains(e.target) &&
        !headerHamburger.contains(e.target)) {
        historySidebar.classList.remove("visible");
      }
    });
  }

  // New Chat Button
  const newChatBtn = getPanelElement("webedit-new-chat-btn");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
      if (!requireAuth("create a chat history")) {
        return;
      }
      startNewChat();
      if (historySidebar) historySidebar.classList.remove("visible");
    });
  }

  // Burger menu toggle
  const burgerBtn = getPanelElement("webedit-burger-btn");
  const toolsMenu = getPanelElement("webedit-tools-menu");

  if (!burgerBtn) {
    console.error("❌ Burger button not found!");
    return;
  }

  if (!toolsMenu) {
    console.error("❌ Tools menu not found!");
    return;
  }

  console.log("✅ Burger button and tools menu found, attaching listener");

  burgerBtn.addEventListener("click", (e) => {
    console.log("🔘 Hamburger button clicked!");
    e.stopPropagation();
    e.preventDefault();
    const wasVisible = toolsMenu.classList.contains("visible");
    toolsMenu.classList.toggle("visible");
    console.log(`🔘 Tools menu toggled: ${wasVisible ? 'visible' : 'hidden'} → ${toolsMenu.classList.contains("visible") ? 'visible' : 'hidden'}`);
  });

  // Close tools menu when clicking outside
  // Need to listen on shadow root/panel for clicks inside panel
  panelShadow.addEventListener("click", (e) => {
    if (toolsMenu && !burgerBtn.contains(e.target) && !toolsMenu.contains(e.target)) {
      toolsMenu.classList.remove("visible");
    }
  });

  // Tool buttons
  const toolButtons = queryPanel(".webedit-tool-btn");
  const customizePanel = getPanelElement("webedit-customize-panel");

  toolButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      console.log("🔘 Tool button clicked:", btn.dataset.tool);

      const tool = btn.dataset.tool;

      // Check authorization for all editing tools
      if (tool === "remove" && !requireAuth("remove elements")) {
        return;
      }
      if (tool === "customize" && !requireAuth("customize elements")) {
        return;
      }
      if (tool === "add" && !requireAuth("add features")) {
        return;
      }

      // Update active state
      setActiveToolButton(tool);
      toolsMenu.classList.remove("visible"); // Close menu after selection

      // Handle different tools
      if (currentTool === "remove") {
        // Start Remove mode immediately (it will stop Pick mode if needed)
        console.log("🗑️ Starting Remove mode from menu");
        isAddFeatureMode = false;
        resetAddFeaturePromptState();
        updateChatInputPrompt("What do you want to change?");
        startRemoveMode();
        customizePanel.classList.remove("visible");
      } else if (currentTool === "customize") {
        // Stop any active modes for customize tool
        isAddFeatureMode = false;
        resetAddFeaturePromptState();
        updateChatInputPrompt("What do you want to change?");
        stopRemoveMode();
        stopPickMode();
        customizePanel.classList.add("visible");
        showNotification("Pick an element to customize, or use 'Pick element' button", "info");
      } else if (currentTool === "add") {
        // Start Add feature flow
        console.log("➕ Starting Add feature flow");
        resetAddFeaturePromptState();
        stopRemoveMode();
        stopPickMode();
        isAddFeatureMode = true;
        customizePanel.classList.remove("visible");

        // Show instruction and start Pick mode
        showNotification("Pick an element to add content near it", "info");
        updateChatInputPrompt("Pick an element to name your edit...");
        startPickMode();
      } else {
        // For any other tool, stop active modes
        isAddFeatureMode = false;
        resetAddFeaturePromptState();
        updateChatInputPrompt("What do you want to change?");
        stopRemoveMode();
        stopPickMode();
        customizePanel.classList.remove("visible");
      }
    });
  });

  // Pick element button - starts Pick mode for element selection (not removal)
  const pickBtn = getPanelElement("webedit-pick-btn");
  if (pickBtn) {
    pickBtn.addEventListener("click", () => {
      console.log("🔘 Pick Element button clicked");

      // Check authorization
      if (!requireAuth("pick elements")) {
        return;
      }

      // Stop all active modes before starting Pick mode
      stopRemoveMode();
      stopPickMode();
      startPickMode();
    });
  } else {
    console.error("❌ Pick element button not found!");
  }

  const modeCloseBtn = getPanelElement("webedit-mode-close-btn");
  if (modeCloseBtn) {
    modeCloseBtn.addEventListener("click", () => {
      if (activeInteractionMode === "pick") {
        stopPickMode();
      } else if (activeInteractionMode === "remove") {
        stopRemoveMode();
      }
    });
  }

  // Chat input
  const chatInput = getPanelElement("webedit-chat-input");

  chatInput.addEventListener("keypress", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();

      const userText = chatInput.value.trim();
      if (!userText) {
        chatInput.value = "";
        return;
      }

      // Clear input immediately
      chatInput.value = "";

      if (isAddFeatureMode) {
        console.log("➕ Processing Add feature prompt input:", userText);
        await handleAddFeatureChatEntry(userText);
        return;
      }
    }
  });

  chatInput.addEventListener("focus", () => {
    chatInput.parentElement.classList.add("focused");
  });

  chatInput.addEventListener("blur", () => {
    chatInput.parentElement.classList.remove("focused");
  });

  // Navigation buttons
  const logoBtn = getPanelElement("webedit-logo-btn");
  const historyBtn = getPanelElement("webedit-history-btn");

  logoBtn.addEventListener("click", () => {
    window.open("https://www.webeditai.com", "_blank");
  });

  historyBtn.addEventListener("click", () => {
    handleViewHistory();
  });

  // Sign in button handled by renderSignInButton() or renderAvatar()

  // Customize panel buttons
  const customizeCloseBtn = getPanelElement("webedit-customize-close-btn");
  const applyBtn = getPanelElement("webedit-apply-btn");
  const resetBtn = getPanelElement("webedit-reset-btn");
  const bgColorInput = getPanelElement("webedit-bg-color");
  const textColorInput = getPanelElement("webedit-text-color");
  const fontSizeInput = getPanelElement("webedit-font-size");

  customizeCloseBtn.addEventListener("click", () => {
    customizePanel.classList.remove("visible");
  });

  applyBtn.addEventListener("click", async () => {
    // Check authorization first
    if (!requireAuth("apply customizations")) {
      return;
    }

    // Use current edit target if available, otherwise use selectedEl
    const targetEl = currentEditTarget.element || selectedEl;

    if (!targetEl) {
      showNotification("Please pick an element first using the 'Pick element' button", "error");
      return;
    }

    const styles = {
      backgroundColor: bgColorInput.value,
      color: textColorInput.value,
      fontSize: fontSizeInput.value + "px"
    };

    console.log("🎨 Applying styles:", styles, "to element:", targetEl);

    // Apply styles immediately with !important to override existing styles
    // Use setProperty with 'important' priority to ensure styles are applied
    targetEl.style.setProperty('background-color', styles.backgroundColor, 'important');
    targetEl.style.setProperty('color', styles.color, 'important');
    targetEl.style.setProperty('font-size', styles.fontSize, 'important');

    console.log("✅ Styles applied to element. Current fontSize:", window.getComputedStyle(targetEl).fontSize);

    // Save as a persistent rule
    const editRules = await waitForEditRules();

    if (editRules) {
      try {
        const rule = await editRules.createRule(targetEl, "style", { styles }, currentUser);

        // Save to Supabase (non-blocking)
        if (window.SaveEdit && window.SaveEdit.saveCustomizeEdit) {
          window.SaveEdit.saveCustomizeEdit(targetEl, rule).catch(err => {
            console.error('[Customize] Failed to save to Supabase:', err);
          });
        }

        showNotification("Styles applied successfully!", "success");
      } catch (error) {
        console.error("❌ Error saving style rule:", error);
        showNotification("Styles applied, but couldn't save rule. Please try again.", "error");
      }
    } else {
      showNotification("Styles applied, but couldn't save rule. Please refresh the page.", "error");
    }
  });

  resetBtn.addEventListener("click", () => {
    // Reset input fields to defaults
    bgColorInput.value = "#ffffff";
    textColorInput.value = "#000000";
    fontSizeInput.value = "16";

    // Remove applied styles from the selected element
    const targetEl = currentEditTarget.element || selectedEl;
    if (targetEl) {
      // Use removeProperty to properly remove styles including those with !important
      targetEl.style.removeProperty('background-color');
      targetEl.style.removeProperty('color');
      targetEl.style.removeProperty('font-size');

      console.log("🔄 Styles reset for element:", targetEl);
      showNotification("Styles reset - element restored to original appearance!", "success");
    } else {
      showNotification("No element selected", "error");
    }
  });
}


// ============================================
// Element Picking - Separate Remove and Pick Modes
// ============================================

/**
 * Wait for EditRules to be available (in case it's still loading)
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds
 * @returns {Promise<Object|null>} EditRules instance or null if not available
 */
async function waitForEditRules(maxWaitMs = 5000) {
  // Check immediately first
  if (window.EditRules) {
    console.log('✅ EditRules available immediately');
    return window.EditRules;
  }

  console.log('⏳ Waiting for EditRules to load...');

  // Wait in 100ms increments
  const checkInterval = 100;
  const maxChecks = Math.floor(maxWaitMs / checkInterval);

  for (let i = 0; i < maxChecks; i++) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    if (window.EditRules) {
      console.log(`✅ EditRules available after ${(i + 1) * checkInterval}ms`);
      return window.EditRules;
    }
  }

  console.error('❌ EditRules not available after waiting', maxWaitMs, 'ms');
  console.error('   This might indicate an error in editRules.js');
  console.error('   Check the console for errors in editRules.js');
  return null;
}

function ensureFloatingLabel() {
  if (floatingLabel) return floatingLabel;
  floatingLabel = document.createElement("div");
  floatingLabel.className = "webedit-floating-label";
  floatingLabel.textContent = "WebEdit AI";
  document.body.appendChild(floatingLabel);
  return floatingLabel;
}

function clearHover() {
  if (hoverEl) {
    hoverEl.classList.remove("webedit-hover-highlight");
    hoverEl = null;
  }
  if (floatingLabel) {
    floatingLabel.style.display = "none";
  }
}

function setHover(el, event, labelText = "WebEdit AI") {
  clearHover();
  hoverEl = el;
  hoverEl.classList.add("webedit-hover-highlight");

  const label = ensureFloatingLabel();
  label.textContent = labelText;
  label.style.display = "block";
  label.style.left = event.pageX + 8 + "px";
  label.style.top = event.pageY + 8 + "px";
}

function clearSelected() {
  if (selectedEl) {
    selectedEl.classList.remove("webedit-selected");
    selectedEl = null;
  }
}

// ============================================
// REMOVE MODE - Permanently removes/hides elements
// ============================================

function startRemoveMode() {
  // If already in Remove mode, just return
  if (isRemoveMode) {
    console.log("⚠️ Already in Remove mode");
    return;
  }

  // Stop Pick mode if active
  if (isPickMode) {
    console.log("🔄 Stopping Pick mode before starting Remove mode");
    stopPickMode();
  }

  console.log("🗑️ Starting Remove mode");
  isRemoveMode = true;
  isPickMode = false;

  document.addEventListener("mousemove", handleRemoveMouseMove, true);
  document.addEventListener("click", handleRemoveClick, true);

  showNotification("Remove mode active - Click an element to remove it", "info");
  showModeIndicator("remove");
}

function stopRemoveMode() {
  console.log("🗑️ Stopping Remove mode");
  isRemoveMode = false;
  clearHover();
  document.removeEventListener("mousemove", handleRemoveMouseMove, true);
  document.removeEventListener("click", handleRemoveClick, true);
  hideModeIndicator("remove");
}

function handleRemoveMouseMove(event) {
  if (!isRemoveMode) return;
  const el = event.target;

  // Don't pick the panel itself or its children
  // Check if element is the panel host or inside it
  if (!el || el === document.documentElement || el === document.body ||
    el === panelHost || (panelHost && panelHost.contains(el))) {
    clearHover();
    return;
  }

  setHover(el, event, "Click to Remove");
}

async function handleRemoveClick(event) {
  if (!isRemoveMode) return;

  const el = event.target;

  // Don't pick the panel itself or its children
  if (!el || el === document.documentElement || el === document.body ||
    el === panelHost || (panelHost && panelHost.contains(el))) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  console.log("🗑️ Removing element:", el);

  // Hide the element immediately
  el.style.display = "none";

  // Wait for EditRules to be available (in case it's still loading)
  const editRules = await waitForEditRules();

  // Create and save a persistent rule
  if (editRules) {
    try {
      const rule = await editRules.createRule(el, "remove", {}, currentUser);
      console.log("✅ Rule created and saved:", rule);

      // Save to Supabase (non-blocking)
      if (window.SaveEdit && window.SaveEdit.saveRemoveEdit) {
        window.SaveEdit.saveRemoveEdit(el, rule).catch(err => {
          console.error('[Remove] Failed to save to Supabase:', err);
        });
      }

      showNotification("You successfully removed this element.", "success");
    } catch (error) {
      console.error("❌ Error creating rule:", error);
      showNotification("Element removed, but couldn't save rule. Please try again.", "error");
    }
  } else {
    console.error("❌ EditRules not available after waiting");
    showNotification("Element removed, but couldn't save rule. Please refresh the page.", "error");
  }

  stopRemoveMode();
}

// ============================================
// PICK MODE - Selects element for editing (no removal)
// ============================================

function startPickMode() {
  // If already in Pick mode, just return
  if (isPickMode) {
    console.log("⚠️ Already in Pick mode");
    return;
  }

  // Stop Remove mode if active
  if (isRemoveMode) {
    console.log("🔄 Stopping Remove mode before starting Pick mode");
    stopRemoveMode();
  }

  console.log("👆 Starting Pick mode");
  isPickMode = true;
  isRemoveMode = false;

  document.addEventListener("mousemove", handlePickMouseMove, true);
  document.addEventListener("click", handlePickClick, true);

  showNotification("Pick mode active - Click an element to select it", "info");
  showModeIndicator("pick");
}

function stopPickMode() {
  console.log("👆 Stopping Pick mode");
  isPickMode = false;
  clearHover();
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handlePickClick, true);
  hideModeIndicator("pick");

  // Reset chat input placeholder only when not in Add feature flow
  if (!isAddFeatureMode) {
    updateChatInputPrompt("What do you want to change?");
  }
}

function handlePickMouseMove(event) {
  if (!isPickMode) return;
  const el = event.target;

  // Don't pick the panel itself or its children
  if (!el || el === document.documentElement || el === document.body ||
    el === panelHost || (panelHost && panelHost.contains(el))) {
    clearHover();
    return;
  }

  setHover(el, event, "Click to Select");
}

async function handlePickClick(event) {
  if (!isPickMode) return;

  const el = event.target;

  // Don't pick the panel itself or its children
  if (!el || el === document.documentElement || el === document.body ||
    el === panelHost || (panelHost && panelHost.contains(el))) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  console.log("👆 Picked element:", el);

  clearSelected();
  selectedEl = el;
  selectedEl.classList.add("webedit-selected");

  // Generate selector and description
  const editRules = await waitForEditRules();

  const wasInAddFeatureMode = isAddFeatureMode;

  if (editRules) {
    const selector = generateSelectorForElement(el);
    const description = generateDescriptionForElement(el);
    const pageKey = getPageKey();

    // Store as current edit target
    currentEditTarget = {
      element: el,
      selector: selector,
      description: description,
      pageKey: pageKey
    };

    console.log("📋 Edit target set:", currentEditTarget);

    // Add reference message to chat
    addChatMessage("reference", `Reference: ${description}`);

    // Check if we're in Add feature mode
    if (isAddFeatureMode) {
      startAddFeatureNamingPrompt();
    } else {
      showNotification("Element selected for editing", "success");
    }
  } else {
    console.error("❌ EditRules not available after waiting");
    showNotification("Element selected, but some features may not work. Please refresh the page.", "error");
  }

  stopPickMode();

  // If pick mode was triggered as part of the Add Feature flow, keep the UX
  // state consistent by ensuring the chat input stays focused and guidance
  // remains visible after pick mode exits.
  if (wasInAddFeatureMode) {
    if (addFeaturePrompt.step === 'name') {
      updateChatInputPrompt("Name of edit...", true);
    } else if (addFeaturePrompt.step === 'description') {
      updateChatInputPrompt("Describe the edit...", true);
    }
    console.log("✨ Add feature mode remains active after element selection");
  }
}

// Helper functions for Pick mode
function generateSelectorForElement(el) {
  // Try ID first (most specific)
  if (el.id) {
    return `#${el.id}`;
  }

  // Try unique class combination
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-'));
    if (classes.length > 0) {
      const classSelector = el.tagName.toLowerCase() + '.' + classes.join('.');
      if (document.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }
    }
  }

  // Try to build a path-based selector using parent context
  const path = [];
  let current = el;
  let depth = 0;
  const maxDepth = 5; // Limit depth to avoid overly long selectors

  while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();

    // Add ID if available
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break; // ID is unique, we can stop here
    }

    // Add classes if available
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-'));
      if (classes.length > 0) {
        selector += '.' + classes.slice(0, 2).join('.'); // Limit to first 2 classes
      }
    }

    // Add nth-child if there are siblings
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current);
      if (siblings.length > 1) {
        selector += `:nth-child(${index + 1})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
    depth++;
  }

  // If we built a path, use it
  if (path.length > 0) {
    const pathSelector = path.join(' > ');
    // Verify it's reasonably specific (matches 1-3 elements max)
    const matches = document.querySelectorAll(pathSelector);
    if (matches.length <= 3 && matches.length > 0) {
      return pathSelector;
    }
  }

  // Last resort: generate a unique data attribute and use that
  // This ensures we always have a unique selector
  const uniqueId = `webedit-rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  el.setAttribute('data-webedit-rule-id', uniqueId);
  return `[data-webedit-rule-id="${uniqueId}"]`;
}

function generateDescriptionForElement(el) {
  const tagName = el.tagName.toLowerCase();
  let humanType = tagName;
  
  // Map common tags to human-readable names
  const typeMap = {
    'a': 'Link',
    'button': 'Button',
    'img': 'Image',
    'input': 'Input field',
    'textarea': 'Text area',
    'select': 'Dropdown',
    'h1': 'Heading 1',
    'h2': 'Heading 2',
    'h3': 'Heading 3',
    'h4': 'Heading 4',
    'h5': 'Heading 5',
    'h6': 'Heading 6',
    'p': 'Paragraph',
    'span': 'Text',
    'div': 'Container',
    'ul': 'List',
    'ol': 'List',
    'li': 'List item',
    'form': 'Form',
    'table': 'Table',
    'nav': 'Navigation'
  };
  
  if (typeMap[tagName]) {
    humanType = typeMap[tagName];
  } else {
    // Capitalize first letter for others
    humanType = tagName.charAt(0).toUpperCase() + tagName.slice(1);
  }

  let text = '';
  
  // Try to find meaningful text/label
  if (tagName === 'img') {
    text = el.alt || el.title || '';
  } else if (tagName === 'input' || tagName === 'textarea') {
    text = el.placeholder || el.value || el.name || '';
    // If type is submit/button, checking value is good. If text input, value might be user data.
    // Maybe prefer placeholder or associated label?
    if (!text && el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) text = label.textContent;
    }
  } else {
    // For other elements, use text content but clean it up
    // Clone and remove children to get direct text if needed, or just use textContent
    // Using textContent is usually fine but might be too much for containers
    // Let's try to get the first non-empty text node or just trim
    text = el.textContent?.trim() || '';
  }
  
  // Truncate long text
  if (text.length > 30) {
    text = text.substring(0, 27) + "...";
  }
  
  let description = humanType;
  if (text) {
    description += ` "${text}"`;
  } else if (el.id) {
     // Fallback to ID if no text
     description += ` (#${el.id})`;
  } else if (el.className && typeof el.className === 'string') {
      // Fallback to class if no ID and no text
     const firstClass = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-'))[0];
     if (firstClass) description += ` (.${firstClass})`;
  }

  return description;
}

function getPageKey() {
  const { hostname, pathname } = window.location;
  return `${hostname}${pathname}`;
}

// ============================================
// Chat Message Management
// ============================================

function addChatMessage(type, content) {
  // If adding a reference, remove any existing ones first (one at a time)
  if (type === 'reference') {
    chatMessages = chatMessages.filter(msg => msg.type !== 'reference');
    
    // Clear any pending timeout
    if (referenceDismissTimeout) {
      clearTimeout(referenceDismissTimeout);
      referenceDismissTimeout = null;
    }
  }

  const message = {
    type: type, // "user", "system", "reference"
    content: content,
    timestamp: Date.now()
  };

  chatMessages.push(message);
  renderChatMessages();
  schedulePanelStateSave();
  saveChatHistory(); // Save to persistent storage
  
  // Auto-dismiss reference after 10 seconds
  if (type === 'reference') {
    referenceDismissTimeout = setTimeout(() => {
      // Remove this reference message
      chatMessages = chatMessages.filter(msg => msg !== message);
      renderChatMessages();
      schedulePanelStateSave();
      saveChatHistory();
      referenceDismissTimeout = null;
    }, 10000);
  }
}

// ============================================
// Chat History Persistence
// ============================================

const CHAT_HISTORY_KEY = 'webedit-chat-history-v2';
const CURRENT_SESSION_KEY = 'webedit-current-session-id';

let currentSessionId = null;

function getScopedStorageKey(baseKey, userId = null) {
  const resolvedId = userId || currentUser?.id || null;
  if (!resolvedId) {
    return null;
  }
  return `${baseKey}::${resolvedId}`;
}

function getPanelStateStorageKey(userId = null) {
  return getScopedStorageKey(PANEL_STATE_KEY, userId);
}

function getChatHistoryStorageKey(userId = null) {
  return getScopedStorageKey(CHAT_HISTORY_KEY, userId);
}

function getSessionStorageKey(userId = null) {
  return getScopedStorageKey(CURRENT_SESSION_KEY, userId);
}

function saveChatHistory() {
  if (!currentUser?.id) {
    return;
  }

  const sessionKey = getSessionStorageKey();
  const historyKey = getChatHistoryStorageKey();
  if (!sessionKey || !historyKey) return;

  if (!currentSessionId) {
    currentSessionId = Date.now().toString();
    localStorage.setItem(sessionKey, currentSessionId);
  }

  const session = {
    id: currentSessionId,
    timestamp: Date.now(),
    messages: chatMessages,
    preview: chatMessages.length > 0 ?
      (chatMessages.find(m => m.type === 'user')?.content || 'New Chat') : 'Empty Chat'
  };

  try {
    // Get existing history
    let history = [];
    const raw = localStorage.getItem(historyKey);
    if (raw) {
      history = JSON.parse(raw);
    }

    // Update or add current session
    const index = history.findIndex(s => s.id === currentSessionId);
    if (index >= 0) {
      history[index] = session;
    } else {
      history.unshift(session); // Add to top
    }

    // Limit history size (e.g., 50 sessions)
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    localStorage.setItem(historyKey, JSON.stringify(history));
    renderHistoryList();
  } catch (e) {
    console.warn('Failed to save chat history:', e);
  }
}

function loadChatHistory() {
  if (!currentUser?.id) {
    return;
  }

  const sessionKey = getSessionStorageKey();
  const historyKey = getChatHistoryStorageKey();
  if (!sessionKey || !historyKey) return;

  try {
    currentSessionId = localStorage.getItem(sessionKey);

    let raw = localStorage.getItem(historyKey);
    if (!raw) {
      const legacy = localStorage.getItem(CHAT_HISTORY_KEY);
      if (legacy) {
        localStorage.setItem(historyKey, legacy);
        localStorage.removeItem(CHAT_HISTORY_KEY);
        raw = legacy;
      }
    }

    if (raw) {
      const history = JSON.parse(raw);
      renderHistoryList(history);

      if (currentSessionId) {
        const session = history.find(s => s.id === currentSessionId);
        if (session && Array.isArray(session.messages)) {
          chatMessages = session.messages;
          renderChatMessages();
          console.log('✅ Chat history restored for session:', currentSessionId);
          return;
        }
      }
      startNewChat(false);
    }
  } catch (e) {
    console.warn('Failed to load chat history:', e);
  }
}

function renderHistoryList(historyData = null) {
  const listContainer = getPanelElement("webedit-history-list");
  if (!listContainer) return;

  if (!currentUser?.id) {
    listContainer.innerHTML = '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">Sign in to view history</div>';
    return;
  }

  if (!historyData) {
    try {
      const raw = localStorage.getItem(getChatHistoryStorageKey());
      if (raw) historyData = JSON.parse(raw);
    } catch (e) { }
  }

  if (!historyData || historyData.length === 0) {
    listContainer.innerHTML = '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">No history yet</div>';
    return;
  }

  listContainer.innerHTML = '';

  historyData.sort((a, b) => b.timestamp - a.timestamp).forEach(session => {
    const item = document.createElement('div');
    item.className = `webedit-history-item ${session.id === currentSessionId ? 'active' : ''}`;

    const date = new Date(session.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="webedit-history-date">${date}</div>
      <div class="webedit-history-preview">${escapeHtml(session.preview || 'New Chat')}</div>
    `;

    item.addEventListener('click', () => loadSession(session.id));
    listContainer.appendChild(item);
  });
}

function loadSession(sessionId) {
  if (!currentUser?.id) return;

  const historyKey = getChatHistoryStorageKey();
  const sessionKey = getSessionStorageKey();
  if (!historyKey || !sessionKey) return;

  try {
    const raw = localStorage.getItem(historyKey);
    if (raw) {
      const history = JSON.parse(raw);
      const session = history.find(s => s.id === sessionId);
      if (session) {
        currentSessionId = sessionId;
        localStorage.setItem(sessionKey, currentSessionId);
        chatMessages = session.messages || [];
        renderChatMessages();
        renderHistoryList(history); // Update active state

        // Close sidebar on mobile/small screens or just for UX
        const sidebar = getPanelElement("webedit-history-sidebar");
        if (sidebar && window.innerWidth < 768) {
          sidebar.classList.remove("visible");
        }
      }
    }
  } catch (e) {
    console.error('Failed to load session:', e);
  }
}

function startNewChat(saveOld = true) {
  if (!currentUser?.id) {
    chatMessages = [];
    renderChatMessages();
    return;
  }

  const sessionKey = getSessionStorageKey();
  const historyKey = getChatHistoryStorageKey();
  if (!sessionKey || !historyKey) return;

  if (saveOld && chatMessages.length > 0) {
    saveChatHistory();
  }

  currentSessionId = Date.now().toString();
  localStorage.setItem(sessionKey, currentSessionId);
  chatMessages = [];
  renderChatMessages();
  saveChatHistory(); // Create entry for new chat
}


function renderChatMessages() {
  const chatContainer = getPanelElement("webedit-chat-messages");
  const referencesContainer = getPanelElement("webedit-references-container");

  if (!chatContainer || !referencesContainer) return;

  // Always clear to ensure clean state
  chatContainer.innerHTML = '';
  referencesContainer.innerHTML = '';

  if (chatMessages.length === 0) {
    // Restore placeholder when no messages
    const placeholder = document.createElement("div");
    placeholder.className = "webedit-chat-placeholder";
    placeholder.innerHTML = '<p>Select a tool from Visual Edit menu below to get started</p>';
    chatContainer.appendChild(placeholder);
  } else {
    // Separate regular messages from references
    const regularMessages = chatMessages.filter(msg => msg.type !== 'reference');
    const referenceMessages = chatMessages.filter(msg => msg.type === 'reference');

    // Render regular messages
    regularMessages.forEach(msg => {
      const msgEl = document.createElement("div");
      msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;

      const contentEl = document.createElement("div");
      contentEl.className = "webedit-chat-message-content";
      contentEl.textContent = msg.content;

      msgEl.appendChild(contentEl);
      chatContainer.appendChild(msgEl);
    });

    // Render reference messages to their own container
    if (referenceMessages.length > 0) {
      referenceMessages.forEach(msg => {
        const msgEl = document.createElement("div");
        msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;

        // Split "Reference: description" into label and text
        const content = msg.content;
        let labelText = 'Reference:';
        let referenceText = content;

        if (content.startsWith('Reference:')) {
          referenceText = content.substring(10).trim(); // Remove "Reference:" prefix
        }

        // Create label
        const labelEl = document.createElement("span");
        labelEl.className = "webedit-reference-label";
        labelEl.textContent = labelText;

        // Create reference text
        const textEl = document.createElement("div");
        textEl.className = "webedit-reference-text";
        textEl.textContent = referenceText;

        msgEl.appendChild(labelEl);
        msgEl.appendChild(textEl);
        referencesContainer.appendChild(msgEl);
      });
    }

    // Scroll to bottom of chat
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// ============================================
// Legacy handlers for Customize and Add
// ============================================

function addNewElement(referenceEl) {
  const newNode = document.createElement("div");
  newNode.textContent = "New element from WebEdit AI";
  newNode.style.background = "#f97316";
  newNode.style.color = "white";
  newNode.style.padding = "8px 12px";
  newNode.style.borderRadius = "999px";
  newNode.style.display = "inline-block";
  newNode.style.margin = "4px 0";

  if (referenceEl && referenceEl.parentElement) {
    referenceEl.parentElement.insertBefore(newNode, referenceEl.nextSibling);
  } else {
    document.body.appendChild(newNode);
  }

  showNotification("New element added", "success");
}

// ============================================
// Add Feature - Inject Custom Elements
// ============================================

function resetAddFeaturePromptState() {
  addFeaturePrompt.step = 'idle';
  addFeaturePrompt.name = '';
  addFeaturePrompt.description = '';
  addFeaturePrompt.targetSelector = null;
  addFeaturePrompt.targetDescription = '';
  addFeaturePrompt.type = 'note';
  schedulePanelStateSave();
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFeatureTemplate({ name, description, type = 'note' }) {
  const safeName = escapeHtml(name || 'WebEdit note');
  const safeDescription = escapeHtml(description || '');

  switch (type) {
    case 'badge':
      return {
        html: `
          <div class="webedit-feature-badge">
            <span class="webedit-feature-badge-label">${safeName}</span>
            <span class="webedit-feature-badge-text">${safeDescription}</span>
          </div>
        `,
        css: `
          .webedit-feature-badge {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #1d4ed8;
            color: white;
            padding: 8px 12px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 500;
          }
          .webedit-feature-badge-label {
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-size: 11px;
            opacity: 0.85;
          }
          .webedit-feature-badge-text {
            font-weight: 600;
          }
        `
      };
    case 'button':
      return {
        html: `
          <button class="webedit-feature-button" data-feature-name="${safeName}" data-feature-content="${safeDescription}">
            <span class="webedit-feature-button-title">${safeName}</span>
            <span class="webedit-feature-button-caption">${safeDescription}</span>
          </button>
        `,
        css: `
          .webedit-feature-button {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            border: none;
            border-radius: 999px;
            padding: 12px 20px;
            background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
            color: white;
            cursor: pointer;
            display: inline-flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            box-shadow: 0 4px 12px rgba(249, 115, 22, 0.35);
          }
          .webedit-feature-button-title {
            font-weight: 600;
            font-size: 14px;
          }
          .webedit-feature-button-caption {
            font-size: 12px;
            opacity: 0.9;
          }
        `
      };
    case 'note':
    default:
      return {
        html: `
          <div class="webedit-feature-note">
            <div class="webedit-feature-note-title">${safeName}</div>
            <div class="webedit-feature-note-body">${safeDescription}</div>
          </div>
        `,
        css: `
          .webedit-feature-note {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: white;
            padding: 14px 16px;
            border-radius: 14px;
            box-shadow: 0 12px 30px rgba(99, 102, 241, 0.35);
            border-left: 4px solid rgba(255, 255, 255, 0.35);
            max-width: 360px;
          }
          .webedit-feature-note-title {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 6px;
          }
          .webedit-feature-note-body {
            font-size: 13px;
            line-height: 1.5;
            opacity: 0.95;
          }
        `
      };
  }
}

function ensureFeatureTemplate(spec) {
  if (spec.html && typeof spec.html === 'string') {
    return { html: spec.html, css: spec.css || '' };
  }
  const name = spec.name || spec.title || 'WebEdit note';
  const description = spec.purpose || spec.description || spec.content || '';
  return buildFeatureTemplate({ name, description, type: spec.type || 'note' });
}

function schedulePanelStateSave() {
  if (!currentUser?.id) {
    return;
  }
  if (panelStateSaveTimeout) {
    clearTimeout(panelStateSaveTimeout);
  }
  panelStateSaveTimeout = setTimeout(() => savePanelState(), 200);
}

function savePanelState(force = false) {
  if (!currentUser?.id) {
    return;
  }

  if (isRestoringPanelState && !force) {
    return;
  }
  const storageKey = getPanelStateStorageKey();
  if (!storageKey) return;
  try {
    const chatInput = getPanelElement("webedit-chat-input");
    const state = {
      isPanelOpen,
      currentTool,
      chatMessages: chatMessages.slice(-MAX_SAVED_CHAT_MESSAGES),
      isAddFeatureMode,
      addFeaturePrompt: { ...addFeaturePrompt },
      chatPlaceholder: chatInput ? chatInput.placeholder : ""
    };
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    console.warn('[WebEdit Panel] Failed to save panel state:', error);
  }
}

async function restorePanelState() {
  if (!currentUser?.id) {
    return;
  }

  const storageKey = getPanelStateStorageKey();
  if (!storageKey) {
    return;
  }

  let rawState = null;
  try {
    rawState = localStorage.getItem(storageKey);
    // Migrate legacy key if needed
    if (!rawState) {
      const legacy = localStorage.getItem(PANEL_STATE_KEY);
      if (legacy) {
        localStorage.setItem(storageKey, legacy);
        localStorage.removeItem(PANEL_STATE_KEY);
        rawState = legacy;
      }
    }
  } catch (error) {
    console.warn('[WebEdit Panel] Failed to read panel state:', error);
    return;
  }

  if (!rawState) {
    return;
  }

  let state;
  try {
    state = JSON.parse(rawState);
  } catch (error) {
    console.warn('[WebEdit Panel] Invalid panel state JSON:', error);
    return;
  }

  isRestoringPanelState = true;

  if (Array.isArray(state.chatMessages)) {
    chatMessages = state.chatMessages.slice(-MAX_SAVED_CHAT_MESSAGES);
    renderChatMessages();
  }

  if (typeof state.currentTool === 'string') {
    setActiveToolButton(state.currentTool);
  }

  if (typeof state.isAddFeatureMode === 'boolean') {
    isAddFeatureMode = state.isAddFeatureMode;
  }

  if (state.addFeaturePrompt && typeof state.addFeaturePrompt === 'object') {
    addFeaturePrompt.step = state.addFeaturePrompt.step || 'idle';
    addFeaturePrompt.name = state.addFeaturePrompt.name || '';
    addFeaturePrompt.description = state.addFeaturePrompt.description || '';
    addFeaturePrompt.targetDescription = state.addFeaturePrompt.targetDescription || '';
    addFeaturePrompt.type = state.addFeaturePrompt.type || 'note';
    addFeaturePrompt.targetSelector = null; // DOM references cannot survive reload
  }

  const chatInput = getPanelElement("webedit-chat-input");
  if (chatInput && state.chatPlaceholder) {
    chatInput.placeholder = state.chatPlaceholder;
  }

  if (state.isPanelOpen) {
    await togglePanel(true, { skipSave: true });
  }

  if (isAddFeatureMode) {
    addChatMessage("system", "Reminder: pick an element again to continue Add feature.");
    isAddFeatureMode = false;
    resetAddFeaturePromptState();
  }

  isRestoringPanelState = false;
  schedulePanelStateSave();
}

function updateChatInputPrompt(text, shouldFocus = false) {
  const chatInput = getPanelElement("webedit-chat-input");
  if (!chatInput) {
    return;
  }
  chatInput.placeholder = text;
  if (shouldFocus) {
    chatInput.focus();
  }
  schedulePanelStateSave();
}

function startAddFeatureNamingPrompt() {
  resetAddFeaturePromptState();
  addFeaturePrompt.step = 'name';
  addFeaturePrompt.targetSelector = currentEditTarget.selector;
  addFeaturePrompt.targetDescription = currentEditTarget.description;

  addChatMessage("system", "Name of edit:");
  showNotification("Element selected! Name your edit in the chat below.", "success");
  updateChatInputPrompt("Name of edit...", true);
  schedulePanelStateSave();
}

async function handleAddFeatureChatEntry(userText) {
  if (!currentEditTarget.selector) {
    addChatMessage("system", "Please pick an element before naming your edit.");
    showNotification("Pick an element to start Add feature.", "error");
    return;
  }

  addChatMessage("user", userText);

  if (addFeaturePrompt.step === 'name') {
    addFeaturePrompt.name = userText;
    addFeaturePrompt.step = 'description';
    addChatMessage("system", "Describe the edit:");
    updateChatInputPrompt("Describe the edit...", true);
    schedulePanelStateSave();
    return;
  }

  if (addFeaturePrompt.step === 'description') {
    addFeaturePrompt.description = userText;
    schedulePanelStateSave();
    await completeAddFeatureCreation();
    return;
  }

  // If step is idle or unknown, remind user to pick an element to start over
  addChatMessage("system", "Pick an element and provide the edit name first.");
  showNotification("Pick an element to start Add feature.", "error");
}

async function completeAddFeatureCreation() {
  const name = (addFeaturePrompt.name || "").trim();
  const description = (addFeaturePrompt.description || "").trim();
  const selector = addFeaturePrompt.targetSelector || currentEditTarget.selector;
  const type = addFeaturePrompt.type || 'note';

  if (!name) {
    addChatMessage("system", "Name of edit:");
    addFeaturePrompt.step = 'name';
    updateChatInputPrompt("Name of edit...", true);
    return;
  }

  if (!description) {
    addChatMessage("system", "Describe the edit:");
    addFeaturePrompt.step = 'description';
    updateChatInputPrompt("Describe the edit...", true);
    return;
  }

  if (!selector) {
    addChatMessage("system", "Please pick an element again to continue.");
    resetAddFeaturePromptState();
    showNotification("Pick an element to continue.", "error");
    return;
  }

  const { html, css } = buildFeatureTemplate({ name, description, type });

  const featureSpec = {
    id: generateFeatureId(),
    selector,
    position: "after",
    content: description,
    pageKey: getPageKey(),
    createdAt: Date.now(),
    name,
    purpose: description,
    type,
    html,
    css
  };

  try {
    console.log("➕ Creating feature with prompts:", featureSpec);
    await injectFeature(featureSpec);

    const saved = await saveAddedFeature(featureSpec);

    // Save to Supabase (non-blocking)
    if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
      window.SaveEdit.saveAddFeature(featureSpec).catch(err => {
        console.error('[Add Feature] Failed to save to Supabase:', err);
      });
    }

    if (saved) {
      addChatMessage("system", `✅ "${name}" added successfully! It will reappear when you reload the page.`);
      showNotification("Feature added successfully!", "success");
    } else {
      addChatMessage("system", "⚠️ Feature added, but couldn't save it. It will disappear on reload.");
      showNotification("Feature added, but not saved to storage", "error");
    }

    finalizeAddFeatureFlow();
    schedulePanelStateSave();
  } catch (error) {
    console.error("➕ Error adding feature:", error);
    addChatMessage("system", "❌ Error: Could not add feature. Please try again.");
    showNotification("Error adding feature", "error");
    schedulePanelStateSave();
  }
}

function finalizeAddFeatureFlow() {
  isAddFeatureMode = false;
  resetAddFeaturePromptState();
  clearSelected();
  currentEditTarget = {
    element: null,
    selector: null,
    description: null,
    pageKey: null
  };
  updateChatInputPrompt("What do you want to change?");
}

// Storage key for added features
/**
 * Generate a unique ID for a feature
 * @returns {string} Unique feature ID
 */
function generateFeatureId() {
  return `feature-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a feature storage key for current page
 * @returns {string} Storage key in format "webedit-features::hostname::pathname"
 */
function getFeatureStorageKey() {
  const userId = currentUser?.id;
  if (!userId) return null;
  const { hostname, pathname } = window.location;
  return `webedit-features::${userId}::${hostname}::${pathname}`;
}

/**
 * Inject a feature into the page
 * @param {Object} spec - AddFeatureRequest specification
 * @param {string} spec.id - Unique feature identifier
 * @param {string} spec.selector - CSS selector for target element
 * @param {string} spec.position - Position: "before" | "after" | "inside"
 * @param {string} spec.content - User content/description
 * @returns {Promise<void>}
 */
async function injectFeature(spec) {
  console.log("[WebEdit Add] Injecting feature", spec);

  try {
    const { html, css } = ensureFeatureTemplate(spec);
    const injectorSpec = {
      ...spec,
      html,
      css
    };

    if (window.WebEditInjector) {
      if (window.WebEditInjector.mountFeature) {
        const handle = window.WebEditInjector.mountFeature(injectorSpec);
        if (handle) {
          return;
        }
      }
      if (window.WebEditInjector.mountFeatureWithRetry) {
        window.WebEditInjector.mountFeatureWithRetry(injectorSpec);
        return;
      }
    }

    // Legacy fallback if injector is unavailable
    const targetEl = document.querySelector(spec.selector);
    if (!targetEl) {
      console.warn(`[WebEdit Add] Target element not found for selector: ${spec.selector}`);
      return;
    }

    const existingFeature = document.querySelector(`[data-webedit-feature-id="${spec.id}"]`);
    if (existingFeature) {
      console.log(`[WebEdit Add] Feature ${spec.id} already exists, skipping`);
      return;
    }

    const container = document.createElement("div");
    container.className = "webedit-added-feature";
    container.setAttribute("data-webedit-feature-id", spec.id);
    container.setAttribute("data-webedit-selector", spec.selector);
    container.style.cssText = `
      margin: 8px 0;
    `;

    if (css) {
      const styleEl = document.createElement("style");
      styleEl.textContent = css;
      container.appendChild(styleEl);
    }

    const contentHolder = document.createElement("div");
    contentHolder.innerHTML = html;
    container.appendChild(contentHolder);

    switch (spec.position) {
      case "before":
        targetEl.parentElement.insertBefore(container, targetEl);
        console.log(`[WebEdit Add] Inserted feature BEFORE target element (fallback)`);
        break;

      case "inside":
        targetEl.insertBefore(container, targetEl.firstChild);
        console.log(`[WebEdit Add] Inserted feature INSIDE target element (fallback)`);
        break;

      case "after":
      default:
        if (targetEl.nextSibling) {
          targetEl.parentElement.insertBefore(container, targetEl.nextSibling);
        } else {
          targetEl.parentElement.appendChild(container);
        }
        console.log(`[WebEdit Add] Inserted feature AFTER target element (fallback)`);
        break;
    }

    console.log(`[WebEdit Add] ✅ Feature injected successfully via fallback: ${spec.id}`);

  } catch (error) {
    console.error("[WebEdit Add] ❌ Error injecting feature:", error);
  }
}

/**
 * Save a feature to chrome.storage
 * @param {Object} feature - AddFeatureRequest object
 * @returns {Promise<boolean>} Success status
 */
async function saveAddedFeature(feature) {
  return new Promise((resolve) => {
    // Early bailout if extension context is invalid
    if (!isExtensionContextValid()) {
      console.warn("[WebEdit Add] Extension context invalid, cannot save feature");
      resolve(false);
      return;
    }

    if (!currentUser?.id) {
      console.warn("[WebEdit Add] No authenticated user, skipping feature save");
      resolve(false);
      return;
    }

    try {
      const storageKey = getFeatureStorageKey();
      if (!storageKey) {
        resolve(false);
        return;
      }

      // Get existing features for this page
      chrome.storage.local.get([storageKey], (result) => {
        if (chrome.runtime.lastError) {
          console.error("[WebEdit Add] Error loading features:", chrome.runtime.lastError);
          resolve(false);
          return;
        }

        const existingFeatures = result[storageKey] || [];

        // Check if feature already exists (by ID)
        const existingIndex = existingFeatures.findIndex(f => f.id === feature.id);

        if (existingIndex >= 0) {
          // Update existing feature
          existingFeatures[existingIndex] = feature;
        } else {
          // Add new feature
          existingFeatures.push(feature);
        }

        // Save back to storage
        chrome.storage.local.set({ [storageKey]: existingFeatures }, () => {
          if (chrome.runtime.lastError) {
            console.error("[WebEdit Add] Error saving feature:", chrome.runtime.lastError);
            resolve(false);
            return;
          }

          console.log(`[WebEdit Add] ✅ Feature saved to storage: ${feature.id}`);
          resolve(true);
        });
      });
    } catch (error) {
      console.error("[WebEdit Add] Error saving feature:", error);
      resolve(false);
    }
  });
}

/**
 * Restore all saved features for the current page on page load
 * @returns {Promise<number>} Number of features restored
 */
async function restoreAddedFeatures() {
  return new Promise((resolve) => {
    // Early bailout if extension context is invalid
    if (!isExtensionContextValid()) {
      resolve(0);
      return;
    }

    if (!currentUser?.id) {
      resolve(0);
      return;
    }

    try {
      const storageKey = getFeatureStorageKey();
      if (!storageKey) {
        resolve(0);
        return;
      }

      const legacyKey = `webedit-features::${window.location.hostname}::${window.location.pathname}`;

      chrome.storage.local.get([storageKey, legacyKey], async (result) => {
        if (chrome.runtime.lastError) {
          console.error("[WebEdit Add] Error loading features:", chrome.runtime.lastError);
          resolve(0);
          return;
        }

        let features = result[storageKey] || [];

        if (features.length === 0 && result[legacyKey]) {
          features = result[legacyKey];
          chrome.storage.local.set({ [storageKey]: features });
          chrome.storage.local.remove(legacyKey);
          console.log("🔄 Migrated legacy features to user-scoped storage");
        }

        if (features.length === 0) {
          resolve(0);
          return;
        }

        console.log(`[WebEdit Add] Restoring ${features.length} feature(s) from storage`);

        // Inject each feature
        let successCount = 0;
        for (const feature of features) {
          await injectFeature(feature);
          successCount++;
        }

        console.log(`[WebEdit Add] ✅ Restored ${successCount} feature(s)`);
        resolve(successCount);
      });
    } catch (error) {
      console.error("[WebEdit Add] Error restoring features:", error);
      resolve(0);
    }
  });
}

/**
 * Generate feature spec from chat (stub for future AI integration)
 * @param {Object} input - Input data
 * @param {string} input.userText - User's text description
 * @param {string} input.selector - CSS selector for target element
 * @returns {Promise<Object>} AddFeatureRequest object
 */
async function generateFeatureSpecFromChat(input) {
  console.log("[WebEdit Add] Generating feature spec from chat (no AI yet)");

  // TEMP: no AI yet - just wrap user text into a feature spec
  return {
    id: generateFeatureId(),
    selector: input.selector,
    position: "after", // Default position
    content: input.userText,
    pageKey: getPageKey(),
    createdAt: Date.now()
  };
}

// ============================================
// Message Listener (for icon click toggle)
// ============================================

/**
 * Listen for messages from background.js
 * When the extension icon is clicked, background.js sends WEBEDIT_TOGGLE_PANEL
 * and we toggle the panel open/closed directly on the page (no popup window)
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WEBEDIT_TOGGLE_PANEL") {
    togglePanel();
    sendResponse({ success: true });
    return true; // Keep message channel open for async response
  }

  // Handle Add Feature requests
  if (message.type === "WEBEDIT_ADD_FEATURE") {
    console.log("[WebEdit Add] Received ADD_FEATURE message", message.payload);

    (async () => {
      try {
        const spec = message.payload;

        // Inject the feature
        await injectFeature(spec);

        // Save to storage for persistence
        const saved = await saveAddedFeature(spec);

        if (saved) {
          sendResponse({ success: true, featureId: spec.id });
        } else {
          sendResponse({ success: false, error: "Failed to save feature" });
        }
      } catch (error) {
        console.error("[WebEdit Add] Error handling ADD_FEATURE:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  }

  // Handle session updates from background script
  if (message.type === "WEBEDIT_SESSION_UPDATED") {
    const wasSignedIn = !!currentUser;
    const isNowSignedIn = !!message.session;

    console.log("🔄 Session updated:",
      message.session ? `User signed in as ${message.session.user?.email}` : "User signed out",
      "| Was signed in:", wasSignedIn, "| Now signed in:", isNowSignedIn
    );

    handleAuthStateChange(message.session?.user || null, { reason: "background-broadcast" });

    // Show notification if panel is open
    if (isPanelOpen) {
      if (currentUser && !wasSignedIn) {
        showNotification(`Welcome back, ${currentUser.email}!`, "success");
      } else if (!currentUser && wasSignedIn) {
        showNotification("Signed out successfully", "info");
      }
    }

    sendResponse({ success: true });
    return true;
  }

  // Respond to PING messages (for connection testing)
  if (message.type === "PING") {
    sendResponse({ status: "ready" });
    return true;
  }
});

// ============================================
// Initialize
// ============================================

// Track if extension has been initialized to prevent duplicate logs
let isInitialized = false;

/**
 * - Create panel
 * - Apply saved rules
 * - Setup mutation observer
 */
async function initialize() {
  if (isInitialized) return;
  isInitialized = true;

  console.log("🚀 WebEdit AI: Initializing...");

  // 1. Create Panel (hidden)
  createPanel();
  await checkAuthStatus();

  // 2. Start Auth Sync
  startAuthSync();

  console.log("✅ WebEdit AI: Initialization complete");
}

// Run initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}



// Also reapply rules on SPA navigation (for single-page apps)
// Use proper URL change detection instead of MutationObserver to avoid infinite loops
let lastUrl = location.href;
let isApplyingRules = false; // Flag to prevent re-entry during rule application

// Listen for URL changes via popstate (back/forward) and pushstate/replacestate (SPA navigation)
function handleUrlChange() {
  const url = location.href;
  if (url !== lastUrl && !isApplyingRules) {
    lastUrl = url;
    console.log("📍 URL changed, reapplying rules");
    if (window.EditRules) {
      isApplyingRules = true;
      const result = window.EditRules.applyRules();

      // Handle both Promise and synchronous return
      if (result && typeof result.then === 'function') {
        result
          .catch((error) => {
            // Handle promise rejections (e.g., extension context invalidated)
            if (error.message?.includes('Extension context invalidated') || error.message?.includes('context invalidated')) {
              console.warn('⚠️ Extension context invalidated - cannot reapply rules');
            } else {
              console.error('❌ Error reapplying rules:', error);
            }
          })
          .finally(() => {
            // Reset flag after rules are applied (with small delay to avoid immediate re-trigger)
            setTimeout(() => {
              isApplyingRules = false;
            }, 100);
          });
      } else {
        // Synchronous execution - reset flag after a delay
        setTimeout(() => {
          isApplyingRules = false;
        }, 100);
      }
    }
  }
}

// Listen for browser navigation (back/forward)
window.addEventListener('popstate', handleUrlChange);

// Intercept pushState and replaceState for SPA navigation
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function (...args) {
  originalPushState.apply(history, args);
  handleUrlChange();
};

history.replaceState = function (...args) {
  originalReplaceState.apply(history, args);
  handleUrlChange();
};

window.addEventListener('beforeunload', () => savePanelState(true));