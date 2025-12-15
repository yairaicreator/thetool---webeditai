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
const PANEL_VISIBILITY_MESSAGE_TYPES = {
  get: "WEBEDIT_GET_PANEL_OPEN_STATE",
  set: "WEBEDIT_SET_PANEL_OPEN_STATE",
  sync: "WEBEDIT_APPLY_PANEL_VISIBILITY"
};
const PANEL_WIDTH_STORAGE_KEY = 'webeditPanelWidth';
const PANEL_WIDTH_OPTIONS = [320, 400, 520];
const PANEL_WIDTH_LABELS = {
  320: 'Narrow',
  400: 'Default',
  520: 'Wide'
};
const PANEL_WIDTH_DEFAULT = PANEL_WIDTH_OPTIONS[1];

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
let hasAppliedInitialPanelPreference = false;
let panelWidthPx = PANEL_WIDTH_DEFAULT;
let panelLauncher = null;

// Auth sync state

// Selected element for editing (used by Pick mode)
let currentEditTarget = {
  element: null,
  selector: null,
  description: null,
  pageKey: null
};

function resetCurrentEditTarget() {
  currentEditTarget = {
    element: null,
    selector: null,
    description: null,
    pageKey: null
  };
  updateCustomizeUiForTarget();
}

// Chat messages
let chatMessages = [];
let referenceDismissTimeout = null;
let activeHistoryRenameForm = null;
let pendingAttachments = [];
let currentAlignmentChoice = null;
let isComposerBusy = false;

const MAX_PENDING_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per attachment
const SUPABASE_ATTACHMENT_BUCKET = 'chat-attachments';

const WEBEDIT_ATTR = "data-webedit-id";
const AUTH_ACTIVITY_KEY = "webeditAuthAudit";

/**
 * Trusted Types safe helper to set rich HTML content without relying on element.innerHTML.
 * Parses the markup in an isolated document and moves the nodes over.
 */
function createHtmlFragment(html) {
  const fragment = document.createDocumentFragment();
  if (!html || typeof html !== "string") {
    return fragment;
  }
  try {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(html, "text/html");
    const { body } = parsedDoc;
    while (body.firstChild) {
      fragment.appendChild(body.firstChild);
    }
  } catch (error) {
    console.error("[WebEdit] Failed to parse HTML fragment:", error);
  }
  return fragment;
}

function setElementHTML(target, html) {
  if (!target) return;
  if (typeof target.replaceChildren === "function") {
    target.replaceChildren();
  } else {
    while (target.firstChild) {
      target.removeChild(target.firstChild);
    }
  }
  if (!html) return;
  target.appendChild(createHtmlFragment(html));
}

function cssEscape(value) {
  if (!value) {
    return '';
  }
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => {
    const hex = char.codePointAt(0).toString(16).padStart(2, '0');
    return `\\${hex} `;
  });
}

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
const PANEL_GAP_PX = 0;
let pageShiftResizeHandler = null;
let globalShiftStyleEl = null;
let lastAppliedShiftWidth = null;

function getPanelWidthForShift() {
  if (panelWidthPx && panelWidthPx > 0) {
    return panelWidthPx;
  }
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
  const baseWidth = getPanelWidthForShift();
  const shiftWidth = baseWidth + PANEL_GAP_PX;
  const shiftValue = `${shiftWidth}px`;
  const panelWidthValue = `${baseWidth}px`;
  document.documentElement.style.setProperty('--webedit-panel-width', shiftValue);
  document.body.style.setProperty('--webedit-panel-width', shiftValue);
  if (panelHost) {
    panelHost.style.width = panelWidthValue;
    panelHost.style.height = "100vh";
    panelHost.style.right = "0";
    panelHost.style.left = "auto";
  }
  if (chatPanel) {
    chatPanel.style.setProperty('--webedit-panel-width', panelWidthValue);
    chatPanel.style.width = panelWidthValue;
  }
  ensureGlobalShiftStyle(shiftValue);
}

function clearPageShiftWidth() {
  if (!document.documentElement || !document.body) {
    return;
  }
  document.documentElement.style.removeProperty('--webedit-panel-width');
  document.body.style.removeProperty('--webedit-panel-width');
  if (panelHost) {
    panelHost.style.width = "";
    panelHost.style.height = "";
  }
  if (chatPanel) {
    chatPanel.style.removeProperty('--webedit-panel-width');
  }
  clearGlobalShiftStyle();
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

function ensureGlobalShiftStyle(widthValue) {
  if (!widthValue) {
    return;
  }
  if (globalShiftStyleEl && lastAppliedShiftWidth === widthValue && globalShiftStyleEl.isConnected) {
    return;
  }
  lastAppliedShiftWidth = widthValue;
  if (!globalShiftStyleEl) {
    globalShiftStyleEl = document.createElement("style");
    globalShiftStyleEl.id = "webedit-global-shift-style";
    globalShiftStyleEl.setAttribute("data-webedit", "layout");
  }
  const host = document.head || document.documentElement;
  if (host && !globalShiftStyleEl.isConnected) {
    host.appendChild(globalShiftStyleEl);
  }
  if (!globalShiftStyleEl.isConnected) {
    return;
  }
  globalShiftStyleEl.textContent = `
    html.webedit-panel-open,
    body.webedit-panel-open {
      overflow-x: hidden !important;
      box-sizing: border-box !important;
    }
    html.webedit-panel-open {
      margin-right: ${widthValue} !important;
      transition: margin-right 0.3s ease-in-out !important;
    }
    body.webedit-panel-open {
      margin-right: 0 !important;
      padding-right: ${widthValue} !important;
      transition: padding-right 0.3s ease-in-out !important;
    }
    @media (max-width: 480px) {
      html.webedit-panel-open,
      body.webedit-panel-open {
        margin-right: 0 !important;
        padding-right: 0 !important;
      }
    }
  `;
}

function clearGlobalShiftStyle() {
  lastAppliedShiftWidth = null;
  if (globalShiftStyleEl) {
    globalShiftStyleEl.textContent = "";
  }
}

function forceGlobalLeftShift() {
  if (document.documentElement) {
    document.documentElement.classList.add("webedit-panel-open");
  }
  if (document.body) {
    document.body.classList.add("webedit-panel-open");
  }
  applyPageShiftWidth();
}

if (typeof window !== "undefined") {
  window.WebEditForceGlobalLeftShift = forceGlobalLeftShift;
}

function sanitizePanelWidth(value) {
  const numeric = Number(value);
  if (PANEL_WIDTH_OPTIONS.includes(numeric)) {
    return numeric;
  }
  return PANEL_WIDTH_DEFAULT;
}

function getNextPanelWidthValue(currentWidth) {
  const currentIndex = PANEL_WIDTH_OPTIONS.indexOf(currentWidth);
  if (currentIndex === -1) {
    return PANEL_WIDTH_OPTIONS[0];
  }
  const nextIndex = (currentIndex + 1) % PANEL_WIDTH_OPTIONS.length;
  return PANEL_WIDTH_OPTIONS[nextIndex];
}

async function loadPanelWidthPreference() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    panelWidthPx = PANEL_WIDTH_DEFAULT;
    return panelWidthPx;
  }
  return new Promise((resolve) => {
    chrome.storage.local.get([PANEL_WIDTH_STORAGE_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        resolve(PANEL_WIDTH_DEFAULT);
        return;
      }
      const stored = result ? Number(result[PANEL_WIDTH_STORAGE_KEY]) : NaN;
      resolve(sanitizePanelWidth(stored));
    });
  }).then((width) => {
    panelWidthPx = sanitizePanelWidth(width);
    return panelWidthPx;
  }).catch(() => {
    panelWidthPx = PANEL_WIDTH_DEFAULT;
    return panelWidthPx;
  });
}

function savePanelWidthPreference(width) {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return;
  }
  try {
    chrome.storage.local.set({ [PANEL_WIDTH_STORAGE_KEY]: width });
  } catch (error) {
    console.debug("[WebEdit] Failed to persist panel width:", error?.message || error);
  }
}

function setPanelWidth(width, options = {}) {
  const { skipPersist = false } = options;
  const sanitized = sanitizePanelWidth(width);
  panelWidthPx = sanitized;
  const widthValue = `${sanitized}px`;

  if (chatPanel) {
    chatPanel.style.width = widthValue;
    chatPanel.style.setProperty('--webedit-panel-width', widthValue);
  }
  if (panelHost) {
    panelHost.style.setProperty('--webedit-panel-width', widthValue);
  }

  const shiftWidthValue = `${sanitized + PANEL_GAP_PX}px`;
  ensureGlobalShiftStyle(shiftWidthValue);

  if (isPanelOpen) {
    applyPageShiftWidth();
  }

  updateResizeButtonState();

  if (!skipPersist) {
    savePanelWidthPreference(sanitized);
  }
}

function updateResizeButtonState() {
  const resizeBtn = getPanelElement("webedit-resize-btn");
  if (!resizeBtn) {
    return;
  }
  const label = PANEL_WIDTH_LABELS[panelWidthPx] || `${panelWidthPx}px`;
  resizeBtn.textContent = "⇔";
  resizeBtn.title = `Switch panel width (current: ${label})`;
  resizeBtn.setAttribute("aria-label", `Switch panel width (current: ${label})`);
  resizeBtn.setAttribute("data-size", label.toLowerCase());
}

function cyclePanelWidth() {
  const next = getNextPanelWidthValue(panelWidthPx);
  setPanelWidth(next);
}

// ============================================
// Global Panel State Sync
// ============================================

function notifyBackgroundOfPanelState(isOpen) {
  if (!isExtensionContextValid()) {
    return;
  }
  try {
    chrome.runtime.sendMessage(
      { type: PANEL_VISIBILITY_MESSAGE_TYPES.set, isOpen: !!isOpen },
      () => {
        // Swallow errors when the background service worker is asleep
        if (chrome.runtime.lastError) {
          console.debug('[WebEdit] Panel state sync skipped:', chrome.runtime.lastError.message);
        }
      }
    );
  } catch (error) {
    console.debug('[WebEdit] Panel state sync failed:', error?.message || error);
  }
}

function requestGlobalPanelPreference() {
  if (!isExtensionContextValid()) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let isResolved = false;
    const finish = (value) => {
      if (isResolved) {
        return;
      }
      isResolved = true;
      resolve(value);
    };
    try {
      chrome.runtime.sendMessage(
        { type: PANEL_VISIBILITY_MESSAGE_TYPES.get },
        (response) => {
          if (chrome.runtime.lastError) {
            finish(false);
            return;
          }
          finish(!!response?.isOpen);
        }
      );
    } catch (error) {
      finish(false);
    }
    setTimeout(() => finish(false), 1000);
  });
}

async function applyInitialPanelPreference() {
  if (hasAppliedInitialPanelPreference) {
    return;
  }
  hasAppliedInitialPanelPreference = true;
  try {
    const shouldOpen = await requestGlobalPanelPreference();
    if (shouldOpen) {
      await togglePanel(true, { skipGlobalSync: true, skipAuthRefresh: true });
    }
  } catch (error) {
    console.debug('[WebEdit] Failed to apply initial panel preference:', error?.message || error);
  }
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
  const reason = options.reason || "explicit-check";
  const forceRefresh = options.forceRefresh || false;
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
          handleAuthStateChange(nextUser, { reason, forceRefresh }).then(() => {
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
  const attachBtn = getPanelElement("webedit-attach-btn");
  const sendBtn = getPanelElement("webedit-send-btn");
  const fileInput = getPanelElement("webedit-file-input");

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

  if (attachBtn) {
    attachBtn.disabled = !isEnabled;
  }
  if (sendBtn) {
    sendBtn.disabled = !isEnabled;
  }
  if (fileInput) {
    fileInput.disabled = !isEnabled;
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
  const reasonText = options.reason || "unspecified";
  const isLogout = !nextUserId;

  console.log(`[Auth] Session update (${reasonText}) | previous=${previousUserId || "none"} | next=${nextUserId || "none"} | logout=${isLogout}`);

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
    clearInMemoryUserState(`user-change:${reasonText}`);
  } else if (!currentUser && previousUserId && userChanged) {
    await updateAuthAudit(previousUserId, {
      lastSignedOutAt: Date.now()
    });
    currentUserAudit = null;
    lastAuthorizedUserId = null;
    hasRestoredStateForUser = false;
    console.log(`[Auth] Recorded sign-out for user ${previousUserId}`);
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
    await enforceUnauthorizedExperience(reasonText);
  }
}

async function loadAuthorizedExperience() {
  const userSnapshot = currentUser;
  if (!userSnapshot?.id || hasRestoredStateForUser) {
    return;
  }

  const email = userSnapshot.email || userSnapshot.id;
  console.log(`[Auth] Restoring panel state for ${email}`);

  removeInjectedFeaturesFromDom();
  await restorePanelState();
  await loadChatHistory();
  console.log(`[Auth] Chat history refreshed for ${email}`);

  if (window.EditRules) {
    try {
      await window.EditRules.applyAllRulesForCurrentPage(true);
      const remoteRules = await window.EditRules.fetchRules(userSnapshot, getPageKey());
      console.log(`🔐 Loaded ${remoteRules.length} remote rule(s) for ${email}`);
    } catch (error) {
      console.error("❌ Failed to apply persisted rules:", error);
    }
  }

  await restoreAddedFeatures();
  console.log(`[Auth] Finished restoring user-specific features for ${email}`);
  hasRestoredStateForUser = true;
}

async function enforceUnauthorizedExperience(reason = "unauthorized") {
  stopRemoveMode();
  stopPickMode();
  clearInMemoryUserState(reason);
  updateChatInputPrompt("Sign in to start editing");
  setActiveToolButton("remove");
  updateAuthGuardUI();
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
  if (typeof container.replaceChildren === "function") {
    container.replaceChildren();
  } else {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

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
  setElementHTML(menu, `
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
  `);

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
  container.textContent = 'Sign in';
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
  setElementHTML(notification, `
    <div class="webedit-notification-content">
      <span class="webedit-notification-icon">${type === "success" ? "✓" : type === "error" ? "⚠" : "ℹ"}</span>
      <span class="webedit-notification-message">${message}</span>
    </div>
  `);

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
  currentTool = tool || null;
  const toolButtons = queryPanel(".webedit-tool-btn");
  toolButtons.forEach((btn) => {
    if (tool && btn.dataset.tool === tool) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  schedulePanelStateSave();
}

function exitActiveFeatures(options = {}) {
  const keepToolSelection = options.keepToolSelection || false;
  console.log("🚪 Exiting all active WebEdit features");

  // Ensure placeholder resets if we were mid Add Feature flow
  isAddFeatureMode = false;
  stopPickMode();
  stopRemoveMode();
  clearHover();
  clearSelected();
  resetAddFeaturePromptState();
  resetCurrentEditTarget();

  const customizePanel = getPanelElement("webedit-customize-panel");
  if (customizePanel) {
    customizePanel.classList.remove("visible");
  }

  const toolsMenu = getPanelElement("webedit-tools-menu");
  if (toolsMenu) {
    toolsMenu.classList.remove("visible");
  }

  updateChatInputPrompt("What do you want to change?");

  if (!keepToolSelection) {
    setActiveToolButton(null);
  }
}

window.WebEditControls = window.WebEditControls || {};
window.WebEditControls.exitActiveFeatures = exitActiveFeatures;
window.exitActiveFeatures = exitActiveFeatures;

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
  panelHost.style.right = "0";
  panelHost.style.left = "auto";
  panelHost.style.width = "0";
  panelHost.style.height = "0";
  panelHost.style.zIndex = "2147483647";
  panelHost.style.display = "none"; // Start hidden to prevent FOUC (Flash of Unstyled Content)

  // Create Shadow Root
  panelShadow = panelHost.attachShadow({ mode: "open" });

  // Inject prevent-FOUC styles synchronously
  // This ensures the panel is hidden immediately before the external CSS file loads
  const foucStyle = document.createElement("style");
  foucStyle.textContent = `
    #webedit-chat-panel {
      display: none; 
      opacity: 0;
      transform: translateX(100%);
    }
  `;
  panelShadow.appendChild(foucStyle);

  // Inject Stylesheet into Shadow Root
  const linkEl = document.createElement("link");
  linkEl.rel = "stylesheet";
  linkEl.href = chrome.runtime.getURL("panel.css");
  const removeFoucStyle = () => {
    if (foucStyle && foucStyle.parentNode) {
      foucStyle.parentNode.removeChild(foucStyle);
    }
  };
  linkEl.addEventListener("load", removeFoucStyle, { once: true });
  linkEl.addEventListener("error", removeFoucStyle, { once: true });
  panelShadow.appendChild(linkEl);

  const panel = document.createElement("div");
  panel.id = "webedit-chat-panel";
  panel.className = "hidden";
  setElementHTML(panel, `
    <!-- Header Navigation Bar -->
    <div class="webedit-panel-header">
      <button class="webedit-header-hamburger" id="webedit-header-hamburger">☰</button>
      <button class="webedit-nav-btn logo-btn" id="webedit-logo-btn">WebEdit</button>
      <button class="webedit-nav-btn history-btn" id="webedit-history-btn" style="display:none">History</button>
      <button class="webedit-nav-btn signin-btn" id="webedit-signin-btn">Sign in</button>
      <button class="webedit-resize-btn" id="webedit-resize-btn" title="Resize panel" aria-label="Resize panel">⇔</button>
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
        <button class="webedit-customize-close-btn" id="webedit-customize-close-btn" type="button">×</button>
      </div>
      <p class="webedit-customize-info">Pick an element to customize its appearance</p>
      
      <div class="webedit-field-group">
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

        <div class="webedit-field-row">
          <label>Width:</label>
          <div class="webedit-size-input-group">
            <input type="number" id="webedit-width-value" min="0" placeholder="auto" />
            <select id="webedit-width-unit">
              <option value="px">px</option>
              <option value="%">%</option>
              <option value="rem">rem</option>
            </select>
          </div>
        </div>

        <div class="webedit-field-row">
          <label>Height:</label>
          <div class="webedit-size-input-group">
            <input type="number" id="webedit-height-value" min="0" placeholder="auto" />
            <select id="webedit-height-unit">
              <option value="px">px</option>
              <option value="%">%</option>
              <option value="rem">rem</option>
            </select>
          </div>
        </div>

        <div class="webedit-field-row">
          <label>Scale:</label>
          <div class="webedit-scale-input">
            <input type="range" id="webedit-scale-input" min="50" max="200" value="100" />
            <span class="webedit-scale-value" id="webedit-scale-value">100%</span>
          </div>
        </div>
      </div>

      <div class="webedit-panel-divider"></div>

      <div class="webedit-layout-section">
        <div class="webedit-section-label">Reposition</div>
        <div class="webedit-layout-actions">
          <button class="webedit-layout-btn" id="webedit-move-up-btn" type="button">Move up</button>
          <button class="webedit-layout-btn" id="webedit-move-down-btn" type="button">Move down</button>
        </div>
      </div>

      <div class="webedit-layout-section">
        <div class="webedit-section-label">Alignment</div>
        <div class="webedit-align-actions">
          <button class="webedit-align-btn" data-align="left" type="button">Left</button>
          <button class="webedit-align-btn" data-align="center" type="button">Center</button>
          <button class="webedit-align-btn" data-align="right" type="button">Right</button>
        </div>
      </div>
      
      <div class="webedit-customize-actions">
        <button class="webedit-btn-small webedit-btn-primary" id="webedit-apply-btn" type="button">Apply</button>
        <button class="webedit-btn-small webedit-btn-secondary" id="webedit-reset-btn" type="button">Reset</button>
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
    <div class="webedit-input-container" id="webedit-input-container">
      <div class="webedit-attachment-preview" id="webedit-attachment-preview"></div>
      <div class="webedit-input-row">
        <button class="webedit-attach-btn" id="webedit-attach-btn" type="button" aria-label="Attach files">📎</button>
        <textarea 
          class="webedit-chat-input" 
          id="webedit-chat-input" 
          placeholder="What to do you want to change?"
          rows="2"
          autocomplete="off"
          spellcheck="true"
        ></textarea>
        <button class="webedit-send-btn" id="webedit-send-btn" type="button" aria-label="Send message">➤</button>
      </div>
      <input class="webedit-file-input" id="webedit-file-input" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.json,.csv,.md" />
    </div>

  `);

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

// ============================================
// Launcher Button Helpers
// ============================================

function ensureLauncherExists() {
  if (panelLauncher && panelLauncher.isConnected) {
    return panelLauncher;
  }
  if (!document.body) {
    return null;
  }
  const launcher = document.createElement("button");
  launcher.id = "webedit-launcher-button";
  launcher.type = "button";
  launcher.className = "webedit-launcher-button";
  launcher.textContent = "WE";
  launcher.setAttribute("aria-label", "Open WebEdit panel");
  launcher.title = "Open WebEdit panel";
  applyLauncherStyles(launcher);
  launcher.addEventListener("click", () => togglePanel(true));
  document.body.appendChild(launcher);
  panelLauncher = launcher;
  return launcher;
}

function applyLauncherStyles(element) {
  if (!element) {
    return;
  }
  element.style.position = "fixed";
  element.style.top = "40%";
  element.style.right = "0";
  element.style.transform = "translateY(-50%)";
  element.style.width = "48px";
  element.style.height = "48px";
  element.style.borderRadius = "16px 0 0 16px";
  element.style.border = "none";
  element.style.background = "linear-gradient(180deg, #5b8def, #ec4899)";
  element.style.color = "#ffffff";
  element.style.fontWeight = "700";
  element.style.fontSize = "14px";
  element.style.letterSpacing = "0.04em";
  element.style.cursor = "pointer";
  element.style.zIndex = "2147483646";
  element.style.boxShadow = "0 8px 24px rgba(15, 23, 42, 0.25)";
  element.style.display = "flex";
  element.style.alignItems = "center";
  element.style.justifyContent = "center";
  element.style.padding = "0";
  element.style.userSelect = "none";
}

function updateLauncherVisibility() {
  const launcher = ensureLauncherExists();
  if (!launcher) {
    return;
  }
  launcher.style.display = isPanelOpen ? "none" : "flex";
}

/**
 * Toggle the panel visibility on/off
 * If panel doesn't exist yet, creates it first
 * @param {boolean} show - Optional: true to show, false to hide, undefined to toggle
 */
async function togglePanel(show, options = {}) {
  const skipSave = options.skipSave || false;
  const skipGlobalSync = options.skipGlobalSync || false;
  const skipAuthRefresh = options.skipAuthRefresh || false;
  if (!chatPanel) {
    createPanel();
  }
  ensureLauncherExists();

  if (show === undefined) {
    show = !isPanelOpen;
  }

  if (show === isPanelOpen) {
    if (!skipGlobalSync) {
      notifyBackgroundOfPanelState(isPanelOpen);
    }
    return;
  }

  isPanelOpen = show;

  if (show) {
    chatPanel.classList.remove("hidden");
    if (panelHost) {
      panelHost.style.display = "block";
    }
    forceGlobalLeftShift();
    startPageShiftTracking();

    if (!skipAuthRefresh) {
      // Check auth status when opening the panel
      console.log("🔍 Checking auth status...");
      const user = await checkAuthStatus();
      console.log("🔍 Auth check result:", user ? user.email : "Not signed in");
    }
  } else {
    chatPanel.classList.add("hidden");
    document.documentElement.classList.remove("webedit-panel-open");
    document.body.classList.remove("webedit-panel-open");
    stopPageShiftTracking();
    clearPageShiftWidth();
    if (panelHost) {
      panelHost.style.display = "none";
    }
  }
  updateLauncherVisibility();
  if (!skipSave) {
    schedulePanelStateSave();
  }
  if (!skipGlobalSync) {
    notifyBackgroundOfPanelState(isPanelOpen);
  }
}

// ============================================
// Event Listeners for Panel UI
// ============================================

function attachPanelEventListeners() {
  // Close button
  const closeBtn = getPanelElement("webedit-close-btn");
  closeBtn.addEventListener("click", () => {
    exitActiveFeatures();
    togglePanel(false);
  });

  const resizeBtn = getPanelElement("webedit-resize-btn");
  if (resizeBtn) {
    resizeBtn.addEventListener("click", () => {
      cyclePanelWidth();
    });
    updateResizeButtonState();
  }

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

      exitActiveFeatures({ keepToolSelection: true });

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
        updateCustomizeUiForTarget();
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
      exitActiveFeatures();
    });
  }

  // Chat input + attachments
  const chatInput = getPanelElement("webedit-chat-input");
  const sendBtn = getPanelElement("webedit-send-btn");
  const attachBtn = getPanelElement("webedit-attach-btn");
  const fileInput = getPanelElement("webedit-file-input");
  const attachmentsPreview = getPanelElement("webedit-attachment-preview");
  const inputContainer = getPanelElement("webedit-input-container");

  if (chatInput) {
    chatInput.addEventListener("keypress", async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        await submitChatMessage();
      }
    });

    chatInput.addEventListener("focus", () => {
      if (inputContainer) {
        inputContainer.classList.add("focused");
      }
    });

    chatInput.addEventListener("blur", () => {
      if (inputContainer) {
        inputContainer.classList.remove("focused");
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      await submitChatMessage();
    });
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => {
      if (!requireAuth("attach files")) {
        return;
      }
      fileInput.click();
    });

    fileInput.addEventListener("change", (event) => {
      const files = event.target?.files;
      if (files && files.length > 0) {
        handleAttachmentSelection(files);
      }
      fileInput.value = "";
    });
  }

  if (attachmentsPreview) {
    renderAttachmentPreview();
  }

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
  const widthInput = getPanelElement("webedit-width-value");
  const widthUnitSelect = getPanelElement("webedit-width-unit");
  const heightInput = getPanelElement("webedit-height-value");
  const heightUnitSelect = getPanelElement("webedit-height-unit");
  const scaleInput = getPanelElement("webedit-scale-input");
  const scaleValue = getPanelElement("webedit-scale-value");
  const moveUpBtn = getPanelElement("webedit-move-up-btn");
  const moveDownBtn = getPanelElement("webedit-move-down-btn");
  const alignButtons = Array.from(queryPanel(".webedit-align-btn") || []);

  customizeCloseBtn.addEventListener("click", () => {
    exitActiveFeatures();
  });

  if (widthInput && widthUnitSelect) {
    widthInput.addEventListener("input", previewSizingChanges);
    widthUnitSelect.addEventListener("change", previewSizingChanges);
  }
  if (heightInput && heightUnitSelect) {
    heightInput.addEventListener("input", previewSizingChanges);
    heightUnitSelect.addEventListener("change", previewSizingChanges);
  }
  if (scaleInput && scaleValue) {
    scaleInput.addEventListener("input", () => {
      scaleValue.textContent = `${scaleInput.value}%`;
      previewSizingChanges();
    });
  }
  if (moveUpBtn) {
    moveUpBtn.addEventListener("click", () => handleCustomizeReorder("up"));
  }
  if (moveDownBtn) {
    moveDownBtn.addEventListener("click", () => handleCustomizeReorder("down"));
  }
  alignButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.align || "left";
      setAlignmentChoice(value);
      applyAlignmentPreview(value);
    });
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

    const styles = buildStylePayload({
      backgroundColor: bgColorInput?.value,
      color: textColorInput?.value,
      fontSize: fontSizeInput?.value,
      widthValue: widthInput?.value,
      widthUnit: widthUnitSelect?.value,
      heightValue: heightInput?.value,
      heightUnit: heightUnitSelect?.value,
      scalePercent: scaleInput?.value,
      alignment: currentAlignmentChoice
    });

    if (!styles || Object.keys(styles).length === 0) {
      showNotification("Adjust a style before applying.", "error");
      return;
    }

    console.log("🎨 Applying styles:", styles, "to element:", targetEl);

    applyStylePreview(targetEl, styles);

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
    if (bgColorInput) bgColorInput.value = "#ffffff";
    if (textColorInput) textColorInput.value = "#000000";
    if (fontSizeInput) fontSizeInput.value = "16";
    if (widthInput) widthInput.value = "";
    if (heightInput) heightInput.value = "";
    if (scaleInput) scaleInput.value = "100";
    if (scaleValue) scaleValue.textContent = "100%";
    currentAlignmentChoice = null;
    updateAlignmentButtons();

    // Remove applied styles from the selected element
    const targetEl = currentEditTarget.element || selectedEl;
    if (targetEl) {
      // Use removeProperty to properly remove styles including those with !important
      targetEl.style.removeProperty('background-color');
      targetEl.style.removeProperty('color');
      targetEl.style.removeProperty('font-size');
      targetEl.style.removeProperty('width');
      targetEl.style.removeProperty('height');
      targetEl.style.removeProperty('transform');
      targetEl.style.removeProperty('transform-origin');
      targetEl.style.removeProperty('text-align');
      targetEl.style.removeProperty('align-self');
      targetEl.style.removeProperty('margin-left');
      targetEl.style.removeProperty('margin-right');

      console.log("🔄 Styles reset for element:", targetEl);
      showNotification("Styles reset - element restored to original appearance!", "success");
    } else {
      showNotification("No element selected", "error");
    }
  });

  updateCustomizeUiForTarget();

  function previewSizingChanges() {
    const targetEl = currentEditTarget.element || selectedEl;
    if (!targetEl) {
      return;
    }
    const sizingStyles = buildStylePayload({
      widthValue: widthInput?.value,
      widthUnit: widthUnitSelect?.value,
      heightValue: heightInput?.value,
      heightUnit: heightUnitSelect?.value,
      scalePercent: scaleInput?.value,
      alignment: currentAlignmentChoice
    });
    applyStylePreview(targetEl, sizingStyles);
    if (!widthInput?.value) {
      targetEl.style.removeProperty('width');
    }
    if (!heightInput?.value) {
      targetEl.style.removeProperty('height');
    }
    if (!scaleInput || Number(scaleInput.value) === 100) {
      targetEl.style.removeProperty('transform');
      targetEl.style.removeProperty('transform-origin');
    }
  }
}

// ============================================
// Customize Helpers
// ============================================

function getCustomizeTargetElement() {
  return currentEditTarget.element || selectedEl;
}

function buildStylePayload(options = {}) {
  const styles = {};
  const {
    backgroundColor,
    color,
    fontSize,
    widthValue,
    widthUnit = "px",
    heightValue,
    heightUnit = "px",
    scalePercent,
    alignment
  } = options;

  if (backgroundColor) {
    styles.backgroundColor = backgroundColor;
  }
  if (color) {
    styles.color = color;
  }
  if (fontSize && !Number.isNaN(Number(fontSize))) {
    styles.fontSize = `${fontSize}px`;
  }
  if (widthValue && !Number.isNaN(Number(widthValue))) {
    styles.width = formatMeasurement(widthValue, widthUnit);
  }
  if (heightValue && !Number.isNaN(Number(heightValue))) {
    styles.height = formatMeasurement(heightValue, heightUnit);
  }
  if (scalePercent && Number(scalePercent) !== 100) {
    const scale = Math.max(10, Number(scalePercent)) / 100;
    styles.transform = `scale(${scale})`;
    styles.transformOrigin = "center";
  }
  if (alignment) {
    Object.assign(styles, getAlignmentStyles(alignment));
  }
  return styles;
}

function formatMeasurement(value, unit = "px") {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return null;
  }
  const normalizedUnit = unit || "px";
  return `${numeric}${normalizedUnit}`;
}

function applyStylePreview(targetEl, styles = {}) {
  if (!targetEl || !styles) {
    return;
  }
  Object.entries(styles).forEach(([prop, value]) => {
    if (!value) {
      return;
    }
    const cssProperty = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    targetEl.style.setProperty(cssProperty, value, 'important');
  });
}

async function handleCustomizeReorder(direction = "up") {
  if (!requireAuth("reposition elements")) {
    return;
  }
  const targetEl = getCustomizeTargetElement();
  if (!targetEl || !targetEl.parentElement) {
    showNotification("Pick an element first to reposition it.", "error");
    return;
  }
  const parent = targetEl.parentElement;
  const sibling = direction === "up" ? targetEl.previousElementSibling : targetEl.nextElementSibling;
  if (!sibling) {
    showNotification(`Element already ${direction === "up" ? "at the top" : "at the bottom"} of its section.`, "info");
    return;
  }

  if (direction === "up") {
    parent.insertBefore(targetEl, sibling);
  } else {
    parent.insertBefore(targetEl, sibling.nextSibling);
  }

  updateLayoutButtonsState(targetEl);

  try {
    const rule = await saveLayoutRuleForElement(targetEl);
    if (rule) {
      showNotification(`Element moved ${direction === "up" ? "up" : "down"}`, "success");
    }
  } catch (error) {
    console.error("[Customize] Failed to persist layout change:", error);
    showNotification("Position changed, but couldn't save it. Please try again.", "error");
  }
}

async function saveLayoutRuleForElement(targetEl) {
  const editRules = await waitForEditRules();
  if (!editRules) {
    return null;
  }
  const layoutMetadata = buildLayoutMetadata(targetEl);
  if (!layoutMetadata) {
    return null;
  }
  const rule = await editRules.createRule(targetEl, "reorder", { layout: layoutMetadata }, currentUser);
  if (window.SaveEdit && window.SaveEdit.saveCustomizeEdit) {
    window.SaveEdit.saveCustomizeEdit(targetEl, rule).catch(err => {
      console.error('[Customize] Failed to save layout change to Supabase:', err);
    });
  }
  return rule;
}

function buildLayoutMetadata(targetEl) {
  if (!targetEl || !targetEl.parentElement) {
    return null;
  }
  const parent = targetEl.parentElement;
  const parentSelector = generateSelectorForElement(parent);
  const siblings = Array.from(parent.children);
  const targetIndex = siblings.indexOf(targetEl);
  const previousSibling = targetEl.previousElementSibling;
  return {
    type: "reorder",
    parentSelector,
    targetIndex,
    previousSiblingSelector: previousSibling ? generateSelectorForElement(previousSibling) : null,
    description: generateDescriptionForElement(targetEl)
  };
}

function updateCustomizeUiForTarget() {
  const targetEl = getCustomizeTargetElement();
  hydrateSizingControlsFromTarget(targetEl);
  detectAlignmentChoice(targetEl);
  updateAlignmentButtons();
  updateLayoutButtonsState(targetEl);
}

function hydrateSizingControlsFromTarget(targetEl) {
  const widthInput = getPanelElement("webedit-width-value");
  const widthUnitSelect = getPanelElement("webedit-width-unit");
  const heightInput = getPanelElement("webedit-height-value");
  const heightUnitSelect = getPanelElement("webedit-height-unit");
  const scaleInput = getPanelElement("webedit-scale-input");
  const scaleValue = getPanelElement("webedit-scale-value");

  if (!targetEl) {
    if (widthInput) widthInput.value = "";
    if (heightInput) heightInput.value = "";
    if (scaleInput) scaleInput.value = "100";
    if (scaleValue) scaleValue.textContent = "100%";
    return;
  }

  const computed = window.getComputedStyle(targetEl);
  const widthParsed = parseCssMeasurement(computed.width);
  if (widthParsed && widthInput && widthUnitSelect) {
    widthInput.value = widthParsed.value;
    widthUnitSelect.value = widthParsed.unit;
  } else {
    if (widthInput) widthInput.value = "";
    if (widthUnitSelect) widthUnitSelect.value = "px";
  }
  const heightParsed = parseCssMeasurement(computed.height);
  if (heightParsed && heightInput && heightUnitSelect) {
    heightInput.value = heightParsed.value;
    heightUnitSelect.value = heightParsed.unit;
  } else {
    if (heightInput) heightInput.value = "";
    if (heightUnitSelect) heightUnitSelect.value = "px";
  }
  if (scaleInput && scaleValue) {
    scaleInput.value = "100";
    scaleValue.textContent = "100%";
  }
}

function parseCssMeasurement(value) {
  if (!value || value === "auto") {
    return null;
  }
  const match = value.trim().match(/^([0-9.]+)(px|%|rem)$/i);
  if (!match) {
    return null;
  }
  return {
    value: match[1],
    unit: match[2]
  };
}

function updateLayoutButtonsState(targetEl = getCustomizeTargetElement()) {
  const moveUpBtn = getPanelElement("webedit-move-up-btn");
  const moveDownBtn = getPanelElement("webedit-move-down-btn");
  if (!moveUpBtn || !moveDownBtn) {
    return;
  }
  if (!targetEl || !targetEl.parentElement) {
    moveUpBtn.disabled = true;
    moveDownBtn.disabled = true;
    return;
  }
  moveUpBtn.disabled = !targetEl.previousElementSibling;
  moveDownBtn.disabled = !targetEl.nextElementSibling;
}

function setAlignmentChoice(value) {
  currentAlignmentChoice = value;
  updateAlignmentButtons();
}

function updateAlignmentButtons() {
  const buttons = queryPanel(".webedit-align-btn");
  buttons.forEach((btn) => {
    const align = btn.dataset.align;
    if (align === currentAlignmentChoice) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function detectAlignmentChoice(targetEl = getCustomizeTargetElement()) {
  if (!targetEl) {
    currentAlignmentChoice = null;
    return;
  }
  const computed = window.getComputedStyle(targetEl);
  const textAlign = computed.textAlign;
  if (textAlign === "center") {
    currentAlignmentChoice = "center";
  } else if (textAlign === "right") {
    currentAlignmentChoice = "right";
  } else {
    currentAlignmentChoice = "left";
  }
}

function applyAlignmentPreview(value) {
  const targetEl = getCustomizeTargetElement();
  if (!targetEl) {
    return;
  }
  applyStylePreview(targetEl, getAlignmentStyles(value));
}

function getAlignmentStyles(choice = "left") {
  switch (choice) {
    case "center":
      return {
        textAlign: "center",
        marginLeft: "auto",
        marginRight: "auto"
      };
    case "right":
      return {
        textAlign: "right",
        marginLeft: "auto",
        marginRight: "0"
      };
    case "left":
    default:
      return {
        textAlign: "left",
        marginLeft: "0",
        marginRight: "auto"
      };
  }
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
    updateCustomizeUiForTarget();
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
    updateCustomizeUiForTarget();

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
    return `#${cssEscape(el.id)}`;
  }

  // Try unique class combination
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-'));
    if (classes.length > 0) {
      const safeClasses = classes.map(cssEscape);
      const classSelector = el.tagName.toLowerCase() + '.' + safeClasses.join('.');
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
      selector += `#${cssEscape(current.id)}`;
      path.unshift(selector);
      break; // ID is unique, we can stop here
    }

    // Add classes if available
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-'));
      if (classes.length > 0) {
        const safeClasses = classes.slice(0, 2).map(cssEscape);
        selector += '.' + safeClasses.join('.'); // Limit to first 2 classes
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
  return `[data-webedit-rule-id="${cssEscape(uniqueId)}"]`;
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

function getPagePlainText() {
  const text = document.body?.innerText || "";
  return text.slice(0, 5000).trim();
}

// ============================================
// Chat Message Management
// ============================================

function addChatMessage(type, content, options = {}) {
  // If adding a reference, remove any existing ones first (one at a time)
  if (type === 'reference') {
    chatMessages = chatMessages.filter(msg => msg.type !== 'reference');
    
    // Clear any pending timeout
    if (referenceDismissTimeout) {
      clearTimeout(referenceDismissTimeout);
      referenceDismissTimeout = null;
    }
  }

  const attachments = Array.isArray(options.attachments) ? options.attachments : [];

  const message = {
    type: type, // "user", "system", "reference"
    content: content,
    timestamp: Date.now(),
    attachments
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

  return message;
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

function clearInMemoryUserState(reason = "unspecified") {
  if (referenceDismissTimeout) {
    clearTimeout(referenceDismissTimeout);
    referenceDismissTimeout = null;
  }
  isAddFeatureMode = false;
  resetAddFeaturePromptState();
  resetCurrentEditTarget();
  chatMessages = [];
  currentSessionId = null;
  clearPendingAttachments();
  renderChatMessages();
  updateChatInputPrompt("What do you want to change?");
  removeInjectedFeaturesFromDom();

  if (window.EditRules && typeof window.EditRules.resetAppliedRuleEffects === 'function') {
    window.EditRules.resetAppliedRuleEffects();
  }

  console.log(`[Auth] Cleared in-memory user-scoped state (${reason})`);
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

  try {
    // Get existing history
    let history = [];
    const raw = localStorage.getItem(historyKey);
    if (raw) {
      history = JSON.parse(raw);
    }

    const existingEntry = history.find(s => s.id === currentSessionId);
    const preservedTitle = existingEntry?.title || null;

    const session = {
      id: currentSessionId,
      timestamp: Date.now(),
      messages: chatMessages,
      preview: getSessionPreviewText(chatMessages),
      title: preservedTitle || getDefaultSessionTitle(chatMessages)
    };

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
    setElementHTML(listContainer, '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">Sign in to view history</div>');
    return;
  }

  if (!historyData) {
    try {
      const raw = localStorage.getItem(getChatHistoryStorageKey());
      if (raw) historyData = JSON.parse(raw);
    } catch (e) { }
  }

  if (!historyData || historyData.length === 0) {
    setElementHTML(listContainer, '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">No history yet</div>');
    return;
  }

  closeActiveHistoryRenameForm();
  setElementHTML(listContainer, '');

  historyData.sort((a, b) => b.timestamp - a.timestamp).forEach(session => {
    const item = document.createElement('div');
    item.className = `webedit-history-item ${session.id === currentSessionId ? 'active' : ''}`;

    const date = new Date(session.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const mainRow = document.createElement('div');
    mainRow.className = 'webedit-history-item-main';

    const titleEl = document.createElement('div');
    titleEl.className = 'webedit-history-title';
    titleEl.textContent = getSessionDisplayName(session);
    mainRow.appendChild(titleEl);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'webedit-history-rename-btn';
    renameBtn.type = 'button';
    renameBtn.setAttribute('aria-label', 'Rename chat');
    renameBtn.textContent = '✏︎';
    renameBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openHistoryRenameInput(session, item);
    });
    mainRow.appendChild(renameBtn);

    const dateEl = document.createElement('div');
    dateEl.className = 'webedit-history-date';
    dateEl.textContent = date;

    const previewEl = document.createElement('div');
    previewEl.className = 'webedit-history-preview';
    previewEl.textContent = session.preview || 'New Chat';

    item.appendChild(mainRow);
    item.appendChild(dateEl);
    item.appendChild(previewEl);

    item.addEventListener('click', () => loadSession(session.id));
    listContainer.appendChild(item);
  });
}

function getSessionPreviewText(messages = []) {
  const firstUserMessage = messages.find(m => m.type === 'user');
  if (firstUserMessage) {
    if (firstUserMessage.content && firstUserMessage.content.trim()) {
      return firstUserMessage.content.trim();
    }
    if (Array.isArray(firstUserMessage.attachments) && firstUserMessage.attachments.length > 0) {
      if (firstUserMessage.attachments.length === 1) {
        return `Attachment: ${firstUserMessage.attachments[0].name || 'file'}`;
      }
      return `${firstUserMessage.attachments.length} attachments`;
    }
  }
  if (messages.length > 0) {
    const fallback = messages[0];
    if (fallback.content && fallback.content.trim()) {
      return fallback.content.trim();
    }
  }
  return 'New Chat';
}

function getDefaultSessionTitle(messages = []) {
  const preview = getSessionPreviewText(messages);
  if (preview && preview !== 'New Chat' && preview !== 'Empty Chat') {
    return preview.length > 40 ? `${preview.substring(0, 37)}...` : preview;
  }
  const now = new Date();
  return `Chat ${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function getSessionDisplayName(session) {
  if (!session) return 'Untitled chat';
  const title = session.title && session.title.trim();
  if (title) return title;
  const preview = session.preview && session.preview.trim();
  if (preview) return preview.length > 60 ? `${preview.substring(0, 57)}...` : preview;
  return 'Untitled chat';
}

function closeActiveHistoryRenameForm() {
  if (activeHistoryRenameForm && activeHistoryRenameForm.parentNode) {
    activeHistoryRenameForm.parentNode.removeChild(activeHistoryRenameForm);
  }
  activeHistoryRenameForm = null;
}

function openHistoryRenameInput(session, hostElement) {
  closeActiveHistoryRenameForm();
  if (!hostElement) return;

  const form = document.createElement('form');
  form.className = 'webedit-history-rename-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = getSessionDisplayName(session);
  input.maxLength = 80;
  input.className = 'webedit-history-rename-input';
  form.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'webedit-history-rename-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'webedit-history-rename-save';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'webedit-history-rename-cancel';
  cancelBtn.textContent = 'Cancel';

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  const commit = (shouldSave) => {
    if (shouldSave) {
      renameChatSession(session.id, input.value);
    }
    closeActiveHistoryRenameForm();
    renderHistoryList();
  };

  form.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    commit(true);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      commit(false);
    }
  });

  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    commit(false);
  });

  input.addEventListener('blur', (event) => {
    if (event.relatedTarget === saveBtn || event.relatedTarget === cancelBtn) {
      return;
    }
    commit(true);
  });

  hostElement.appendChild(form);
  activeHistoryRenameForm = form;
  input.focus();
  input.select();
}

function renameChatSession(sessionId, newName) {
  const historyKey = getChatHistoryStorageKey();
  if (!historyKey) return false;

  try {
    const raw = localStorage.getItem(historyKey);
    if (!raw) return false;
    const history = JSON.parse(raw);
    const session = history.find(s => s.id === sessionId);
    if (!session) return false;

    const trimmed = (newName || '').trim();
    session.title = trimmed || getDefaultSessionTitle(session.messages || []);
    localStorage.setItem(historyKey, JSON.stringify(history));
    console.log(`[History] Renamed chat ${sessionId} -> ${session.title}`);
    return true;
  } catch (error) {
    console.error('[History] Failed to rename chat:', error);
    return false;
  }
}

function loadSession(sessionId) {
  if (!currentUser?.id) return;

  closeActiveHistoryRenameForm();

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
  clearPendingAttachments();
  renderChatMessages();
  saveChatHistory(); // Create entry for new chat
}


function renderChatMessages() {
  const chatContainer = getPanelElement("webedit-chat-messages");
  const referencesContainer = getPanelElement("webedit-references-container");

  if (!chatContainer || !referencesContainer) return;

  // Always clear to ensure clean state
  setElementHTML(chatContainer, '');
  setElementHTML(referencesContainer, '');

  if (chatMessages.length === 0) {
    // Restore placeholder when no messages
    const placeholder = document.createElement("div");
    placeholder.className = "webedit-chat-placeholder";
    setElementHTML(placeholder, '<p>Select a tool from Visual Edit menu below to get started</p>');
    chatContainer.appendChild(placeholder);
  } else {
    // Separate regular messages from references
    const regularMessages = chatMessages.filter(msg => msg.type !== 'reference');
    const referenceMessages = chatMessages.filter(msg => msg.type === 'reference');

    // Render regular messages
    regularMessages.forEach(msg => {
      const msgEl = document.createElement("div");
      msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;

      if (msg.content) {
        const contentEl = document.createElement("div");
        contentEl.className = "webedit-chat-message-content";
        contentEl.textContent = msg.content;
        msgEl.appendChild(contentEl);
      }

      if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
        const attachmentsEl = document.createElement("div");
        attachmentsEl.className = "webedit-chat-message-attachments";

        msg.attachments.forEach((attachment) => {
          const attachmentEl = document.createElement("div");
          attachmentEl.className = "webedit-chat-attachment";

          if (attachment.type === "image" && attachment.url) {
            const img = document.createElement("img");
            img.src = attachment.previewUrl || attachment.url;
            img.alt = attachment.name || "Image attachment";
            attachmentEl.appendChild(img);
          } else {
            const icon = document.createElement("span");
            icon.textContent = "📎";
            attachmentEl.appendChild(icon);
          }

          const nameEl = document.createElement("div");
          nameEl.className = "webedit-chat-attachment-name";
          nameEl.textContent = attachment.name || "Attachment";
          attachmentEl.appendChild(nameEl);

          if (attachment.url) {
            const link = document.createElement("a");
            link.href = attachment.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Open";
            attachmentEl.appendChild(link);
          }

          attachmentsEl.appendChild(attachmentEl);
        });

        msgEl.appendChild(attachmentsEl);
      }

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
// Chat Attachments + Composer Helpers
// ============================================

async function submitChatMessage() {
  if (isComposerBusy) {
    return;
  }

  const chatInput = getPanelElement("webedit-chat-input");
  if (!chatInput) {
    return;
  }

  let userText = (chatInput.value || "").trim();
  const hasAttachments = pendingAttachments.length > 0;

  if (!userText && !hasAttachments) {
    chatInput.value = "";
    return;
  }

  if (isAddFeatureMode) {
    if (hasAttachments) {
      showNotification("Attachments are not supported during Add feature prompts yet.", "error");
      return;
    }
    chatInput.value = "";
    await handleAddFeatureChatEntry(userText);
    return;
  }

  chatInput.value = "";
  isComposerBusy = true;
  setComposerBusy(true);

  try {
    const uploadedAttachments = hasAttachments ? await uploadPendingAttachments() : [];
    if (!userText && uploadedAttachments.length > 0) {
      userText = "Shared attachments";
    }
    await handleGeneralChatMessage(userText, uploadedAttachments);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Chat] Failed to send message:", message);
    showNotification(message || "Failed to send message. Please try again.", "error");
  } finally {
    isComposerBusy = false;
    setComposerBusy(false);
  }
}

function setComposerBusy(isBusy) {
  const sendBtn = getPanelElement("webedit-send-btn");
  const attachBtn = getPanelElement("webedit-attach-btn");
  const inputContainer = getPanelElement("webedit-input-container");
  const authEnabled = !!currentUser;
  if (sendBtn) sendBtn.disabled = isBusy || !authEnabled;
  if (attachBtn) attachBtn.disabled = isBusy || !authEnabled;
  if (inputContainer) {
    inputContainer.classList.toggle("busy", isBusy);
  }
}

function handleAttachmentSelection(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    return;
  }

  for (const file of files) {
    if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
      showNotification(`You can attach up to ${MAX_PENDING_ATTACHMENTS} files per message.`, "error");
      break;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showNotification(`${file.name} is too large. Max size is ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`, "error");
      continue;
    }

    const isImage = file.type.startsWith("image/");
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    pendingAttachments.push({
      id: generateAttachmentId(),
      file,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      type: isImage ? "image" : "file",
      previewUrl
    });
  }

  renderAttachmentPreview();
}

function renderAttachmentPreview() {
  const container = getPanelElement("webedit-attachment-preview");
  if (!container) {
    return;
  }
  setElementHTML(container, "");

  pendingAttachments.forEach((attachment) => {
    const chip = document.createElement("div");
    chip.className = "webedit-attachment-chip";

    if (attachment.type === "image" && attachment.previewUrl) {
      const thumb = document.createElement("img");
      thumb.className = "webedit-attachment-thumb";
      thumb.src = attachment.previewUrl;
      thumb.alt = attachment.name || "Attachment";
      chip.appendChild(thumb);
    }

    const label = document.createElement("span");
    label.textContent = attachment.name || "Attachment";
    chip.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.className = "webedit-attachment-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => removePendingAttachment(attachment.id));
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  });
}

function removePendingAttachment(attachmentId) {
  pendingAttachments = pendingAttachments.filter((attachment) => {
    if (attachment.id === attachmentId && attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    return attachment.id !== attachmentId;
  });
  renderAttachmentPreview();
}

function clearPendingAttachments() {
  pendingAttachments.forEach((attachment) => {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  });
  pendingAttachments = [];
  renderAttachmentPreview();
}

async function uploadPendingAttachments() {
  if (!pendingAttachments.length) {
    return [];
  }
  if (!currentUser?.id) {
    throw new Error("Please sign in to upload attachments.");
  }

  const uploads = [];
  for (const attachment of pendingAttachments) {
    const url = await uploadAttachmentFile(attachment);
    uploads.push({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType,
      type: attachment.type,
      url,
      previewUrl: attachment.previewUrl || null
    });
  }

  clearPendingAttachments();
  return uploads;
}

async function uploadAttachmentFile(attachment) {
  if (!window.SupabaseClient) {
    throw new Error("Supabase is not configured for file uploads.");
  }
  const file = attachment.file;
  const userId = currentUser?.id;
  if (!file || !userId) {
    throw new Error("Missing file information.");
  }

  const sanitizedName = sanitizeFileName(file.name);
  const objectPath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${sanitizedName}`;
  const encodedPath = encodeStoragePath(objectPath);
  const uploadUrl = `${window.SupabaseClient.url}/storage/v1/object/${SUPABASE_ATTACHMENT_BUCKET}/${encodedPath}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'apikey': window.SupabaseClient.anonKey,
      'Authorization': `Bearer ${window.SupabaseClient.anonKey}`,
      'x-upsert': 'true'
    },
    body: file
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Failed to upload ${file.name}`);
  }

  return `${window.SupabaseClient.url}/storage/v1/object/public/${SUPABASE_ATTACHMENT_BUCKET}/${encodedPath}`;
}

function sanitizeFileName(name = "") {
  return name.replace(/[^\w.\-]/g, "_");
}

function generateAttachmentId() {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function encodeStoragePath(path = "") {
  return path
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
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

function buildFeatureTemplate({ name, description, type = 'card' }) {
  const safeName = escapeHtml(name || 'WebEdit feature');
  const safeDescription = escapeHtml(description || '');
  const hasDescription = Boolean(safeDescription && safeDescription.trim());

  const baseCss = `
    .webedit-feature-card {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      color: #0f172a;
      border: 1px solid #dbe3f0;
      border-radius: 18px;
      padding: 18px 20px;
      min-width: 220px;
      max-width: 420px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.15);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .webedit-feature-card::before {
      content: '';
      width: 44px;
      height: 4px;
      border-radius: 999px;
      background: linear-gradient(90deg, #0ea5e9 0%, #6366f1 100%);
    }
    .webedit-feature-card-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #0ea5e9;
    }
    .webedit-feature-card-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      color: #0f172a;
    }
    .webedit-feature-card-text {
      font-size: 14px;
      line-height: 1.6;
      margin: 0;
      color: #1e293b;
    }
    .webedit-feature-card-placeholder {
      color: #64748b;
      font-style: italic;
    }
    .webedit-feature-card-button-wrapper {
      display: inline-flex;
      flex-direction: column;
      gap: 6px;
    }
    .webedit-feature-card-button {
      border: none;
      border-radius: 999px;
      padding: 12px 24px;
      background: linear-gradient(135deg, #2563eb 0%, #38bdf8 100%);
      color: #ffffff;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35);
    }
    .webedit-feature-card-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(99, 102, 241, 0.12);
      color: #4f46e5;
    }
  `;

  if (type === 'button') {
    return {
      html: `
        <div class="webedit-feature-card webedit-feature-card-button-wrapper">
          <span class="webedit-feature-card-label">Call to action</span>
          <button class="webedit-feature-card-button" type="button">
            ${safeName}
          </button>
          ${
            hasDescription
              ? `<p class="webedit-feature-card-text">${safeDescription}</p>`
              : ''
          }
        </div>
      `,
      css: baseCss
    };
  }

  const descriptionHtml = hasDescription
    ? `<p class="webedit-feature-card-text">${safeDescription}</p>`
    : `<p class="webedit-feature-card-text webedit-feature-card-placeholder">This feature is ready—add more details from EditHistory.</p>`;

  return {
    html: `
      <div class="webedit-feature-card">
        <span class="webedit-feature-card-label">WebEdit Feature</span>
        <h3 class="webedit-feature-card-title">${safeName}</h3>
        ${descriptionHtml}
      </div>
    `,
    css: baseCss
  };
}

function ensureFeatureTemplate(spec) {
  if (spec.html && typeof spec.html === 'string' && spec.html.trim()) {
    return { html: spec.html, css: spec.css || '' };
  }
  const name = spec.name || spec.title || 'WebEdit feature';
  const description = spec.purpose || spec.description || spec.content || '';
  return buildFeatureTemplate({ name, description, type: spec.type || 'card' });
}

function normalizeFeatureSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object') {
    return null;
  }

  const spec = { ...rawSpec };
  const payload = rawSpec.payload && typeof rawSpec.payload === 'object' ? rawSpec.payload : null;

  if (payload) {
    const fieldsToMerge = [
      'selector',
      'targetSelector',
      'position',
      'pageKey',
      'createdAt',
      'name',
      'purpose',
      'description',
      'content',
      'type',
      'html',
      'css'
    ];

    fieldsToMerge.forEach((key) => {
      if (spec[key] === undefined && payload[key] !== undefined) {
        spec[key] = payload[key];
      }
    });
  }

  if (!spec.selector && spec.targetSelector) {
    spec.selector = spec.targetSelector;
  }

  if (!spec.id && spec.featureId) {
    spec.id = spec.featureId;
  }

  const { html, css } = ensureFeatureTemplate(spec);
  spec.html = html;
  spec.css = css;

  spec.name = spec.name || spec.title || payload?.name || 'Add feature';
  spec.purpose = spec.purpose || spec.description || spec.content || payload?.purpose || '';
  spec.type = spec.type || payload?.type || 'note';

  spec.ownerUserId = spec.ownerUserId || spec.userId || payload?.ownerUserId || payload?.userId || null;
  spec.ownerEmail = spec.ownerEmail || payload?.ownerEmail || null;

  if (!spec.ownerUserId && currentUser?.id) {
    spec.ownerUserId = currentUser.id;
    spec.ownerEmail = currentUser.email || spec.ownerEmail || null;
    spec._needsOwnerPersist = true;
  }

  delete spec.element;
  delete spec.targetElement;

  return spec;
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

async function handleGeneralChatMessage(userText, attachments = []) {
  addChatMessage("user", userText, { attachments });

  const thinkingMessage = addChatMessage("assistant", "🤖 Assistant is thinking...");

  const callPageChatFn =
    (window.SupabaseClient && typeof window.SupabaseClient.callPageChat === "function"
      ? window.SupabaseClient.callPageChat
      : null) ||
    (typeof window.callPageChat === "function" ? window.callPageChat : null);

  if (!callPageChatFn) {
    thinkingMessage.content = "AI chat is not available right now.";
    renderChatMessages();
    schedulePanelStateSave();
    saveChatHistory();
    return;
  }

  const pageContext = {
    url: window.location.href,
    title: document.title || "",
    text: getPagePlainText()
  };

  try {
    const result = await callPageChatFn(userText, pageContext, attachments);

    if (result?.ok && typeof result.reply === "string" && result.reply.trim()) {
      thinkingMessage.content = result.reply.trim();
    } else if (result?.error) {
      const errorMessage = result.error;
      console.error("[WebEdit Chat] AI reply error:", errorMessage);
      thinkingMessage.content = `There was a problem talking to the AI: ${errorMessage}`;
    } else {
      thinkingMessage.content = "AI chat is not available right now.";
    }
  } catch (error) {
    console.error("[WebEdit Chat] Failed to call AI chat:", error);
    const message = error instanceof Error ? error.message : String(error);
    thinkingMessage.content = `There was a problem talking to the AI: ${message}`;
  }

  renderChatMessages();
  schedulePanelStateSave();
  saveChatHistory();
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
    css,
    ownerUserId: currentUser?.id || null,
    ownerEmail: currentUser?.email || null
  };

  const normalizedSpec = normalizeFeatureSpec(featureSpec);
  if (!normalizedSpec) {
    console.error("➕ Error: Failed to normalize feature spec");
    addChatMessage("system", "❌ Error: Could not add feature. Please try again.");
    showNotification("Error adding feature", "error");
    schedulePanelStateSave();
    return;
  }

  try {
    console.log("➕ Creating feature with prompts:", featureSpec);
    await injectFeature(normalizedSpec);

    const saved = await saveAddedFeature(normalizedSpec);

    // Save to Supabase (non-blocking)
    if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
      window.SaveEdit.saveAddFeature(normalizedSpec).catch(err => {
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
  resetCurrentEditTarget();
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

function removeInjectedFeaturesFromDom() {
  const nodes = document.querySelectorAll('[data-webedit-feature-id]');
  const removedCount = nodes.length;
  if (removedCount > 0) {
    nodes.forEach(node => node.remove());
    console.log(`[WebEdit Add] Removed ${removedCount} injected feature node(s) from DOM`);
  }
  return removedCount;
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
    const normalizedSpec = normalizeFeatureSpec(spec);
    if (!normalizedSpec) {
      console.warn("[WebEdit Add] Skipping inject - invalid spec");
      return;
    }

    if (!currentUser?.id) {
      console.warn("[WebEdit Add] Skipping feature inject - no authenticated user");
      return;
    }

    if (normalizedSpec.ownerUserId && normalizedSpec.ownerUserId !== currentUser.id) {
      console.warn(`[WebEdit Add] Skipping feature ${normalizedSpec.id} - owner mismatch`);
      return;
    }

    const { html, css } = ensureFeatureTemplate(normalizedSpec);
    const injectorSpec = {
      ...normalizedSpec,
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
    const targetEl = document.querySelector(normalizedSpec.selector);
    if (!targetEl) {
      console.warn(`[WebEdit Add] Target element not found for selector: ${normalizedSpec.selector}`);
      return;
    }

    const existingFeature = document.querySelector(`[data-webedit-feature-id="${normalizedSpec.id}"]`);
    if (existingFeature) {
      console.log(`[WebEdit Add] Feature ${normalizedSpec.id} already exists, skipping`);
      return;
    }

    const container = document.createElement("div");
    container.className = "webedit-added-feature";
    container.setAttribute("data-webedit-feature-id", normalizedSpec.id);
    container.setAttribute("data-webedit-selector", normalizedSpec.selector);
    if (normalizedSpec.ownerUserId) {
      container.setAttribute("data-webedit-owner", normalizedSpec.ownerUserId);
    }
    container.style.cssText = `
      margin: 8px 0;
    `;

    if (css) {
      const styleEl = document.createElement("style");
      styleEl.textContent = css;
      container.appendChild(styleEl);
    }

    const contentHolder = document.createElement("div");
    setElementHTML(contentHolder, html);
    container.appendChild(contentHolder);

    switch (normalizedSpec.position) {
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

        console.log(`[WebEdit Add] ✅ Feature injected successfully via fallback: ${normalizedSpec.id}`);

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
  const normalizedFeature = normalizeFeatureSpec(feature);
  if (!normalizedFeature) {
    return Promise.resolve(false);
  }

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

    if (normalizedFeature.ownerUserId && normalizedFeature.ownerUserId !== currentUser.id) {
      console.warn("[WebEdit Add] Feature owner mismatch, refusing to save");
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
        const existingIndex = existingFeatures.findIndex(f => f.id === normalizedFeature.id);

        if (existingIndex >= 0) {
          // Update existing feature
          existingFeatures[existingIndex] = normalizedFeature;
        } else {
          // Add new feature
          existingFeatures.push(normalizedFeature);
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

        let features = (result[storageKey] || []).slice();
        let migratedLegacy = false;

        if (features.length === 0 && result[legacyKey]) {
          features = result[legacyKey];
          migratedLegacy = true;
          console.log("🔄 Migrated legacy features to user-scoped storage");
        }

        if (features.length === 0) {
          if (migratedLegacy) {
            chrome.storage.local.remove(legacyKey);
          }
          resolve(0);
          return;
        }

        const activeUserId = currentUser.id;
        const updatedFeatures = [];
        let successCount = 0;
        let storageChanged = migratedLegacy;

        console.log(`[WebEdit Add] Restoring ${features.length} feature(s) from storage for user ${currentUser?.email || currentUser?.id || 'unknown'}`);

        for (const feature of features) {
          const normalized = normalizeFeatureSpec(feature);
          if (!normalized) {
            storageChanged = true;
            continue;
          }

          if (normalized.ownerUserId && normalized.ownerUserId !== activeUserId) {
            console.log(`[WebEdit Add] Skipping feature ${normalized.id} due to owner mismatch`);
            storageChanged = true;
            continue;
          }

          if (!normalized.ownerUserId) {
            normalized.ownerUserId = activeUserId;
            normalized.ownerEmail = currentUser.email || normalized.ownerEmail || null;
            storageChanged = true;
          }

          await injectFeature(normalized);
          updatedFeatures.push(normalized);
          successCount++;
        }

        if (storageChanged) {
          chrome.storage.local.set({ [storageKey]: updatedFeatures });
          chrome.storage.local.remove(legacyKey);
        }

        console.log(`[WebEdit Add] ✅ Restored ${successCount} feature(s) for user ${currentUser?.email || currentUser?.id || 'unknown'}`);
        resolve(successCount);
      });
    } catch (error) {
      console.error("[WebEdit Add] Error restoring features:", error);
      resolve(0);
    }
  });
}

/**
 * Generate feature spec via AI Edge Function
 */
async function generateFeatureSpecFromChat(input) {
  const promptText = (input.userText || "").trim();
  if (!promptText) {
    throw new Error("User prompt is empty");
  }

  const selector = input.selector;
  const targetDescription = input.targetDescription || currentEditTarget.description || "";
  const supabaseClient = window.SupabaseClient;

  if (!supabaseClient || !supabaseClient.url || !supabaseClient.anonKey) {
    throw new Error("Supabase client is not configured");
  }

  const endpoint = `${supabaseClient.url}/functions/v1/ai-generate-feature-spec`;
  const context = {
    pageTitle: document.title || "",
    pageUrl: window.location.href,
    targetSelector: selector,
    targetDescription,
    userName: input.name || "",
    requestedType: input.type || "card",
    pageExcerpt: getPagePlainText().slice(0, 2000)
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": supabaseClient.anonKey,
      "Authorization": `Bearer ${supabaseClient.anonKey}`
    },
    body: JSON.stringify({
      prompt: promptText,
      context
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("Failed to parse AI response");
  }

  if (!response.ok || !payload?.ok || !payload?.spec) {
    throw new Error(payload?.error || `AI spec request failed (${response.status})`);
  }

  const aiSpec = payload.spec;

  if (aiSpec.action && aiSpec.action !== "add") {
    throw new Error(`AI returned unsupported action: ${aiSpec.action}`);
  }

  const resolvedSelector = aiSpec.targetSelector || aiSpec.selector || selector;
  const resolvedPosition = aiSpec.position || "after";
  const html = typeof aiSpec.html === "string" ? aiSpec.html.trim() : "";
  const css = typeof aiSpec.css === "string" ? aiSpec.css.trim() : "";

  return {
    id: generateFeatureId(),
    selector: resolvedSelector || selector,
    position: resolvedPosition,
    content: aiSpec.content || promptText,
    html,
    css,
    pageKey: getPageKey(),
    createdAt: Date.now(),
    aiSpec
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

  if (message.type === PANEL_VISIBILITY_MESSAGE_TYPES.sync) {
    const nextState = !!message.isOpen;
    if (nextState === isPanelOpen) {
      sendResponse({ success: true, unchanged: true });
      return true;
    }
    (async () => {
      await togglePanel(nextState, { skipGlobalSync: true });
      sendResponse({ success: true, applied: true });
    })();
    return true;
  }

  // Handle Add Feature requests
  if (message.type === "WEBEDIT_ADD_FEATURE") {
    console.log("[WebEdit Add] Received ADD_FEATURE message", message.payload);

    (async () => {
      try {
        const spec = normalizeFeatureSpec(message.payload);
        if (!spec) {
          sendResponse({ success: false, error: "Invalid feature spec" });
          return;
        }

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

  await loadPanelWidthPreference();

  // 1. Create Panel (hidden)
  createPanel();
  setPanelWidth(panelWidthPx, { skipPersist: true });
  ensureLauncherExists();
  updateLauncherVisibility();
  await checkAuthStatus({ reason: "startup" });
  await applyInitialPanelPreference();

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