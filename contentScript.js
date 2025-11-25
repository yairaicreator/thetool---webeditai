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
  } catch (error) {
    showNotification("Failed to open login page. Please reload the page.", "error");
  }
}

/**
 * Handle view history action
 */
function handleViewHistory() {
  console.log("📚 Opening history page");

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
      currentUser = null;
      updateAuthUI();

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
  const mainContent = document.querySelector(".webedit-main-content");
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

// ============================================
// Panel Creation & Management
// ============================================

/**
 * Creates and injects the AI chat panel into the page
 * The panel is a centered, mobile-like interface that floats over the page
 * Returns the created panel element
 */
function createPanel() {
  if (chatPanel) return chatPanel;

  const panel = document.createElement("div");
  panel.id = "webedit-chat-panel";
  panel.className = "hidden";
  panel.innerHTML = `
    <!-- Header Navigation Bar -->
    <div class="webedit-panel-header">
      <button class="webedit-nav-btn logo-btn" id="webedit-logo-btn">(Logo)</button>
      <button class="webedit-nav-btn history-btn" id="webedit-history-btn">History</button>
      <button class="webedit-nav-btn signin-btn" id="webedit-signin-btn">Sign in</button>
      <button class="webedit-close-btn" id="webedit-close-btn">×</button>
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

  document.body.appendChild(panel);
  chatPanel = panel;

  attachPanelEventListeners();
  return panel;
}

/**
 * Toggle the panel visibility on/off
 * If panel doesn't exist yet, creates it first
 * @param {boolean} show - Optional: true to show, false to hide, undefined to toggle
 */
async function togglePanel(show) {
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
    
    // Check auth status when opening the panel
    console.log("🔍 Checking auth status...");
    const user = await checkAuthStatus();
    console.log("🔍 Auth check result:", user ? user.email : "Not signed in");
    updateAuthUI();
  } else {
    chatPanel.classList.add("hidden");
    document.documentElement.classList.remove("webedit-panel-open");
    document.body.classList.remove("webedit-panel-open");
  }
}

// ============================================
// Event Listeners for Panel UI
// ============================================

function attachPanelEventListeners() {
  // Close button
  const closeBtn = document.getElementById("webedit-close-btn");
  closeBtn.addEventListener("click", () => togglePanel(false));

  // Burger menu toggle
  const burgerBtn = document.getElementById("webedit-burger-btn");
  const toolsMenu = document.getElementById("webedit-tools-menu");
  
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
  document.addEventListener("click", (e) => {
    if (toolsMenu && !burgerBtn.contains(e.target) && !toolsMenu.contains(e.target)) {
      toolsMenu.classList.remove("visible");
    }
  });

  // Tool buttons
  const toolButtons = document.querySelectorAll(".webedit-tool-btn");
  const customizePanel = document.getElementById("webedit-customize-panel");
  
  toolButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      console.log("🔘 Tool button clicked:", btn.dataset.tool);
      
      // Update active state
      toolButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.tool;
      toolsMenu.classList.remove("visible"); // Close menu after selection
      
      // Handle different tools
      if (currentTool === "remove") {
        // Start Remove mode immediately (it will stop Pick mode if needed)
        console.log("🗑️ Starting Remove mode from menu");
        startRemoveMode();
        customizePanel.classList.remove("visible");
      } else if (currentTool === "customize") {
        // Stop any active modes for customize tool
        stopRemoveMode();
        stopPickMode();
        customizePanel.classList.add("visible");
        showNotification("Pick an element to customize, or use 'Pick element' button", "info");
      } else if (currentTool === "add") {
        // Stop any active modes for add tool
        stopRemoveMode();
        stopPickMode();
        showNotification("Add tool - Pick an element to add content near it", "info");
        customizePanel.classList.remove("visible");
      } else {
        // For any other tool, stop active modes
        stopRemoveMode();
        stopPickMode();
        customizePanel.classList.remove("visible");
      }
    });
  });

  // Pick element button - starts Pick mode for element selection (not removal)
  const pickBtn = document.getElementById("webedit-pick-btn");
  if (pickBtn) {
    pickBtn.addEventListener("click", () => {
      console.log("🔘 Pick Element button clicked");
      // Stop all active modes before starting Pick mode
      stopRemoveMode();
      stopPickMode();
      startPickMode();
    });
  } else {
    console.error("❌ Pick element button not found!");
  }

  // Chat input
  const chatInput = document.getElementById("webedit-chat-input");

  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Input functionality can be added later
    }
  });

  chatInput.addEventListener("focus", () => {
    chatInput.parentElement.classList.add("focused");
  });

  chatInput.addEventListener("blur", () => {
    chatInput.parentElement.classList.remove("focused");
  });

  // Navigation buttons
  const logoBtn = document.getElementById("webedit-logo-btn");
  const historyBtn = document.getElementById("webedit-history-btn");

  logoBtn.addEventListener("click", () => {
    window.open("https://www.webeditai.com", "_blank");
  });

  historyBtn.addEventListener("click", () => {
    handleViewHistory();
  });

  // Sign in button handled by renderSignInButton() or renderAvatar()

  // Customize panel buttons
  const customizeCloseBtn = document.getElementById("webedit-customize-close-btn");
  const applyBtn = document.getElementById("webedit-apply-btn");
  const resetBtn = document.getElementById("webedit-reset-btn");
  const bgColorInput = document.getElementById("webedit-bg-color");
  const textColorInput = document.getElementById("webedit-text-color");
  const fontSizeInput = document.getElementById("webedit-font-size");

  customizeCloseBtn.addEventListener("click", () => {
    customizePanel.classList.remove("visible");
  });

  applyBtn.addEventListener("click", async () => {
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
    
    // Apply styles immediately
    targetEl.style.backgroundColor = styles.backgroundColor;
    targetEl.style.color = styles.color;
    targetEl.style.fontSize = styles.fontSize;
    
    // Save as a persistent rule
    const editRules = await waitForEditRules();

    if (editRules) {
      try {
        await editRules.createRule(targetEl, "style", { styles }, currentUser);
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
      targetEl.style.backgroundColor = "";
      targetEl.style.color = "";
      targetEl.style.fontSize = "";
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
async function waitForEditRules(maxWaitMs = 2000) {
  if (window.EditRules) {
    return window.EditRules;
  }

  // Wait in 100ms increments
  const checkInterval = 100;
  const maxChecks = Math.floor(maxWaitMs / checkInterval);

  for (let i = 0; i < maxChecks; i++) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    if (window.EditRules) {
      return window.EditRules;
    }
  }

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

  // Wait for EditRules to be available (in case it's still loading)
  const editRules = await waitForEditRules();

  // Create and save a persistent rule
  if (editRules) {
    try {
      const rule = await editRules.createRule(el, "remove", {}, currentUser);
      console.log("✅ Rule created and saved:", rule);

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
  const editRules = await waitForEditRules();
  
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

    showNotification("Element selected for editing", "success");
  } else {
    console.error("❌ EditRules not available after waiting");
    showNotification("Element selected, but some features may not work. Please refresh the page.", "error");
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

  // Wait for EditRules to be available, then apply saved rules for this page
  const editRules = await waitForEditRules();
  
  if (editRules) {
    try {
      const affectedCount = await editRules.applyRules();
      if (affectedCount > 0) {
        console.log(`✅ Applied rules to ${affectedCount} element(s)`);
      }

      // Setup mutation observer to reapply rules on DOM changes
      // Only setup if extension context is valid
      if (isExtensionContextValid()) {
        editRules.setupMutationObserver();
      }
    } catch (error) {
      // Silently handle context invalidated errors
      const errorMsg = error.message || String(error);
      if (!errorMsg.includes('Extension context invalidated') && !errorMsg.includes('context invalidated')) {
        console.error("❌ Error applying rules:", error);
      }
    }
  } else {
    console.warn("⚠️ EditRules not available during initialization - rules will not be applied");
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