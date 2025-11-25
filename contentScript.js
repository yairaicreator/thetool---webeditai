// WebEdit AI Content Script - In-page Chat Panel

// Mode flags
let isPickMode = false;
let isRemoveMode = false;

// UI state
let currentTool = "remove";
let hoverEl = null;
let selectedEl = null;
let floatingLabel = null;
let chatPanel = null;
let isPanelOpen = false;
let currentUser = null; // Store current authenticated user

// Selected element for editing (used by Pick mode)
let currentEditTarget = {
  element: null,
  selector: null,
  description: null,
  pageKey: null
};

// Chat messages
let chatMessages = [];

const WEBEDIT_ATTR = "data-webedit-id";

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

/**
 * Check the current authentication status
 * Retrieves the stored Supabase session from extension storage
 */
async function checkAuthStatus() {
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
        currentUser = session?.user || null;

        console.log("🔐 Auth status:", currentUser ? `Signed in as ${currentUser.email}` : "Not signed in");
        resolve(currentUser);
      });
    } catch (error) {
      // Silently handle errors (background might be unloaded)
      resolve(null);
    }
  });
}

/**
 * Update the UI based on authentication state
 * Shows avatar with menu or "Sign in" button
 */
function updateAuthUI() {
  console.log("🔄 updateAuthUI called, currentUser:", currentUser ? currentUser.email : "null");

  const signinBtn = document.getElementById("webedit-signin-btn");
  if (!signinBtn) {
    console.error("❌ Sign-in button element not found!");
    return;
  }

  console.log("✅ Found sign-in button element, ID:", signinBtn.id);

  if (currentUser) {
    // User is signed in - show avatar
    console.log("👤 User is signed in, rendering avatar");
    renderAvatar(signinBtn, currentUser);
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
function renderAvatar(container, user) {
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
  const closeMenuHandler = (e) => {
    if (!container.contains(e.target)) {
      menu.classList.remove('visible');
    }
  };

  // Store reference to handler for cleanup on the container
  container._closeMenuHandler = closeMenuHandler;

  // Add the listener with a small delay to avoid immediate closure
  const timeoutId = setTimeout(() => {
    document.addEventListener('click', closeMenuHandler);
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
    }

    function stopRemoveMode() {
      console.log("🗑️ Stopping Remove mode");
      isRemoveMode = false;
      clearHover();
      document.removeEventListener("mousemove", handleRemoveMouseMove, true);
      document.removeEventListener("click", handleRemoveClick, true);
    }

    function handleRemoveMouseMove(event) {
      if (!isRemoveMode) return;
      const el = event.target;

      // Don't pick the panel itself or its children
      if (!el || el === document.documentElement || el === document.body ||
        el.closest("#webedit-chat-panel")) {
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
        el.closest("#webedit-chat-panel")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      console.log("🗑️ Removing element:", el);

      // Hide the element immediately
      el.style.display = "none";

      // Create and save a persistent rule
      if (window.EditRules) {
        try {
          const rule = await window.EditRules.createRule(el, "remove", {}, currentUser);
          console.log("✅ Rule created:", rule);

          showNotification("You successfully removed this element.", "success");
        } catch (error) {
          console.error("❌ Error creating rule:", error);
          showNotification("Element removed, but couldn't save rule", "error");
        }
      } else {
        console.error("❌ EditRules not available");
        showNotification("Element removed (not persistent)", "error");
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
    }

    function stopPickMode() {
      console.log("👆 Stopping Pick mode");
      isPickMode = false;
      clearHover();
      document.removeEventListener("mousemove", handlePickMouseMove, true);
      document.removeEventListener("click", handlePickClick, true);
    }

    function handlePickMouseMove(event) {
      if (!isPickMode) return;
      const el = event.target;

      // Don't pick the panel itself or its children
      if (!el || el === document.documentElement || el === document.body ||
        el.closest("#webedit-chat-panel")) {
        clearHover();
        return;
      }

      setHover(el, event, "Click to Select");
    }

    function handlePickClick(event) {
      if (!isPickMode) return;

      const el = event.target;

      // Don't pick the panel itself or its children
      if (!el || el === document.documentElement || el === document.body ||
        el.closest("#webedit-chat-panel")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      console.log("👆 Picked element:", el);

      clearSelected();
      selectedEl = el;
      selectedEl.classList.add("webedit-selected");

      // Generate selector and description
      if (window.EditRules) {
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

        showNotification("Element selected for editing", "success");
      } else {
        console.error("❌ EditRules not available");
        showNotification("Element selected (limited functionality)", "error");
      }

      stopPickMode();
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
      const id = el.id ? `#${el.id}` : '';
      const classes = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-')).join('.').substring(0, 30)
        : '';

      let description = tagName + id + classes;

      // Add text content if short enough
      const text = el.textContent?.trim() || '';
      if (text && text.length < 40) {
        description += ` "${text}"`;
      } else if (text && text.length >= 40) {
        description += ` "${text.substring(0, 37)}..."`;
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
      const message = {
        type: type, // "user", "system", "reference"
        content: content,
        timestamp: Date.now()
      };
      // ============================================
      // Chat Message Management
      // ============================================

      function addChatMessage(type, content) {
        const message = {
          type: type, // "user", "system", "reference"
          content: content,
          timestamp: Date.now()
        };

        chatMessages.push(message);
        renderChatMessages();
      }

      function renderChatMessages() {
        const chatContainer = document.getElementById("webedit-chat-messages");
        const referencesContainer = document.getElementById("webedit-references-container");

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

        // Handle session updates from background script
        if (message.type === "WEBEDIT_SESSION_UPDATED") {
          const wasSignedIn = !!currentUser;
          const isNowSignedIn = !!message.session;

          console.log("🔄 Session updated:",
            message.session ? `User signed in as ${message.session.user?.email}` : "User signed out",
            "| Was signed in:", wasSignedIn, "| Now signed in:", isNowSignedIn
          );

          currentUser = message.session?.user || null;

          // Force UI update
          console.log("🔄 Updating auth UI...");
          updateAuthUI();

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
       * Initialize the extension on page load
       * - Create panel
       * - Apply saved rules
       * - Setup mutation observer
       */
      async function initializeExtension() {
        // Prevent duplicate initialization
        if (isInitialized) {
          return;
        }

        isInitialized = true;
        console.log("🚀 WebEdit AI initializing...");

        // Create panel
        createPanel();

        // Apply saved rules for this page
        if (window.EditRules) {
          try {
            const affectedCount = await window.EditRules.applyRules();
            if (affectedCount > 0) {
              console.log(`✅ Applied rules to ${affectedCount} element(s)`);
            }

            // Setup mutation observer to reapply rules on DOM changes
            // Only setup if extension context is valid
            if (isExtensionContextValid()) {
              window.EditRules.setupMutationObserver();
            }
          } catch (error) {
            // Silently handle context invalidated errors
            const errorMsg = error.message || String(error);
            if (!errorMsg.includes('Extension context invalidated') && !errorMsg.includes('context invalidated')) {
              console.error("❌ Error applying rules:", error);
            }
          }
        }

        console.log("✅ WebEdit AI initialized");
      }

      // Initialize when DOM is ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeExtension);
      } else {
        initializeExtension();
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