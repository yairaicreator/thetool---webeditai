// WebEdit AI Content Script - In-page Chat Panel

// Mode flags
let isPickMode = false;
let isRemoveMode = false;
let isAddFeatureMode = false; // Track if we're in Add feature flow

// UI state
let currentTool = "remove";
let hoverEl = null;
let selectedEl = null;
let floatingLabel = null;
let exitModeButton = null;
let exitModeLabel = null;
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

    <!-- Add Feature Panel (collapsible) -->
    <div class="webedit-add-panel" id="webedit-add-panel">
      <div class="webedit-panel-section-header">
        <h3>Add Feature</h3>
        <button class="webedit-panel-close-btn" id="webedit-add-close-btn">×</button>
      </div>
      
      <!-- Step indicator -->
      <div class="webedit-steps">
        <div class="webedit-step" id="webedit-step-1">
          <span class="webedit-step-number">1</span>
          <span class="webedit-step-label">Pick location</span>
        </div>
        <div class="webedit-step" id="webedit-step-2">
          <span class="webedit-step-number">2</span>
          <span class="webedit-step-label">Create feature</span>
        </div>
      </div>
      
      <!-- Step 1: Pick location -->
      <div class="webedit-add-step" id="webedit-add-step-1">
        <p class="webedit-section-info">Choose where to add your feature</p>
        <button class="webedit-btn webedit-btn-secondary" id="webedit-pick-location-btn">
          📍 Pick section on page
        </button>
        <div class="webedit-selected-target" id="webedit-selected-target" style="display: none;">
          <div class="webedit-target-label">Target:</div>
          <div class="webedit-target-preview" id="webedit-target-preview"></div>
        </div>
      </div>
      
      <!-- Step 2: Feature form -->
      <div class="webedit-add-step" id="webedit-add-step-2" style="display: none;">
        <div class="webedit-field-row">
          <label>Feature name:</label>
          <input type="text" id="webedit-feature-name" placeholder="e.g., Important Note" />
        </div>
        
        <div class="webedit-field-row">
          <label>Feature type:</label>
          <select id="webedit-feature-type">
            <option value="note">Note / Text Box</option>
            <option value="button">Button</option>
            <option value="badge">Badge / Label</option>
          </select>
        </div>
        
        <div class="webedit-field-row">
          <label>Position:</label>
          <select id="webedit-feature-position">
            <option value="before">Before target</option>
            <option value="after">After target</option>
            <option value="inside">Inside target</option>
          </select>
        </div>
        
        <div class="webedit-field-row">
          <label>Purpose / Content:</label>
          <textarea id="webedit-feature-purpose" placeholder="Describe what this feature does or contains..." rows="3"></textarea>
        </div>
        
        <div class="webedit-add-actions">
          <button class="webedit-btn webedit-btn-primary" id="webedit-create-feature-btn">✨ Create Feature</button>
          <button class="webedit-btn webedit-btn-secondary" id="webedit-add-back-btn">← Back</button>
        </div>
      </div>
    </div>

    <!-- Manage Features Panel -->
    <div class="webedit-manage-panel" id="webedit-manage-panel">
      <div class="webedit-panel-section-header">
        <h3>Features on this site</h3>
        <div style="display: flex; gap: 8px;">
          <button class="webedit-btn-icon" id="webedit-refresh-features-btn" title="Refresh">↻</button>
          <button class="webedit-panel-close-btn" id="webedit-manage-close-btn">×</button>
        </div>
      </div>
      <div class="webedit-features-list" id="webedit-features-list">
        <p class="webedit-empty-message">No features added yet</p>
      </div>
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
    
    // Render features management list
    await renderFeaturesManagementList();
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
    btn.addEventListener("click", async (e) => {
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
        // Show Add Feature panel
        console.log("➕ Opening Add feature panel");
        stopRemoveMode();
        stopPickMode();
        customizePanel.classList.remove("visible");
        
        // Show Add panel
        const addPanel = document.getElementById("webedit-add-panel");
        if (addPanel) {
          addPanel.classList.add("visible");
          
          // Reset to step 1
          showAddFeatureStep(1);
          
          // Show and render features management list
          const managePanel = document.getElementById("webedit-manage-panel");
          if (managePanel) {
            managePanel.classList.add("visible");
          }
          await renderFeaturesManagementList();
        }
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

  chatInput.addEventListener("keypress", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Chat input functionality reserved for future AI integration
      // Add Feature now uses the dedicated form panel
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

  // Add Feature panel buttons
  const addCloseBtn = document.getElementById("webedit-add-close-btn");
  const pickLocationBtn = document.getElementById("webedit-pick-location-btn");
  const createFeatureBtn = document.getElementById("webedit-create-feature-btn");
  const addBackBtn = document.getElementById("webedit-add-back-btn");
  const refreshFeaturesBtn = document.getElementById("webedit-refresh-features-btn");

  if (addCloseBtn) {
    addCloseBtn.addEventListener("click", () => {
      const addPanel = document.getElementById("webedit-add-panel");
      const managePanel = document.getElementById("webedit-manage-panel");
      
      if (addPanel) {
        addPanel.classList.remove("visible");
      }
      
      // Also hide the Manage Features panel when closing Add panel
      if (managePanel) {
        managePanel.classList.remove("visible");
      }
      
      // Reset Add feature mode and clean up listeners
      isAddFeatureMode = false;
      
      // Reset current edit target
      currentEditTarget = {
        element: null,
        selector: null,
        description: null,
        pageKey: null
      };
      
      // Clear selected target display
      const targetDisplay = document.getElementById("webedit-selected-target");
      if (targetDisplay) {
        targetDisplay.style.display = "none";
      }
      
      // If Pick Mode is active (user clicked "Pick location" but didn't select yet), stop it
      if (isPickMode) {
        console.log("🔄 Stopping Pick Mode when closing Add Feature panel");
        stopPickMode();
      } else {
        // Only remove ESC listener and hide exit button if Pick Mode wasn't active
        // (stopPickMode() already handles this cleanup)
        document.removeEventListener("keydown", handleModeEscapeKey, true);
        hideExitModeButton();
      }
    });
  }

  if (pickLocationBtn) {
    pickLocationBtn.addEventListener("click", () => {
      console.log("📍 Pick location clicked");
      isAddFeatureMode = true;
      
      // Hide the Manage Features panel when picking location
      const managePanel = document.getElementById("webedit-manage-panel");
      if (managePanel) {
        managePanel.classList.remove("visible");
      }
      
      startPickMode();
    });
  }

  if (addBackBtn) {
    addBackBtn.addEventListener("click", () => {
      showAddFeatureStep(1);
    });
  }

  if (createFeatureBtn) {
    createFeatureBtn.addEventListener("click", async () => {
      console.log("✨ Create feature clicked");
      
      // Get form values
      const name = document.getElementById("webedit-feature-name").value.trim();
      const type = document.getElementById("webedit-feature-type").value;
      const position = document.getElementById("webedit-feature-position").value;
      const purpose = document.getElementById("webedit-feature-purpose").value.trim();
      
      // Validate
      if (!name) {
        showNotification("Please enter a feature name", "error");
        return;
      }
      
      if (!purpose) {
        showNotification("Please describe the feature purpose", "error");
        return;
      }
      
      if (!currentEditTarget.selector) {
        showNotification("Please pick a location first", "error");
        showAddFeatureStep(1);
        return;
      }
      
      try {
        // Generate feature spec
        const spec = await generateFeatureSpec({
          name: name,
          type: type,
          purpose: purpose,
          selector: currentEditTarget.selector,
          position: position
        });
        
        console.log("➕ Generated feature spec:", spec);
        
        // Inject the feature
        const success = await injectFeature(spec);
        
        if (!success) {
          showNotification("Failed to inject feature", "error");
          return;
        }
        
        // Save to local storage
        await saveAddedFeature(spec);
        
        // Save to Supabase (non-blocking - don't wait for it)
        if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
          window.SaveEdit.saveAddFeature(spec).catch(err => {
            console.error('[Add Feature] Failed to save to Supabase:', err);
            // Don't show error to user - local save succeeded
          });
        }
        
        // Show success
        showNotification("Feature created successfully!", "success");
        
        // Reset form
        document.getElementById("webedit-feature-name").value = "";
        document.getElementById("webedit-feature-purpose").value = "";
        document.getElementById("webedit-feature-type").value = "note";
        document.getElementById("webedit-feature-position").value = "after";
        
        // Reset target
        currentEditTarget = {
          element: null,
          selector: null,
          description: null,
        pageKey: null
        };
        
        // Reset to step 1
        showAddFeatureStep(1);
        
        // Reset Add feature mode and clean up listeners
        isAddFeatureMode = false;
        document.removeEventListener("keydown", handleModeEscapeKey, true);
        hideExitModeButton();
        
        // Hide Add panel but show updated Manage panel
        const addPanel = document.getElementById("webedit-add-panel");
        if (addPanel) {
          addPanel.classList.remove("visible");
        }
        
        // Update and show features list
        const managePanel = document.getElementById("webedit-manage-panel");
        if (managePanel) {
          managePanel.classList.add("visible");
        }
        await renderFeaturesManagementList();
        
        // Clear selected target display
        const targetDisplay = document.getElementById("webedit-selected-target");
        if (targetDisplay) {
          targetDisplay.style.display = "none";
        }
        
      } catch (error) {
        console.error("➕ Error creating feature:", error);
        showNotification("Error creating feature: " + error.message, "error");
      }
    });
  }

  if (refreshFeaturesBtn) {
    refreshFeaturesBtn.addEventListener("click", async () => {
      await renderFeaturesManagementList();
      showNotification("Features list refreshed", "info");
    });
  }

  // Manage panel close button
  const manageCloseBtn = document.getElementById("webedit-manage-close-btn");
  if (manageCloseBtn) {
    manageCloseBtn.addEventListener("click", () => {
      const managePanel = document.getElementById("webedit-manage-panel");
      if (managePanel) {
        managePanel.classList.remove("visible");
      }
    });
  }

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
            // Don't show error to user - local save succeeded
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
// Add Feature Panel Helpers
// ============================================

/**
 * Show specific step in Add Feature panel
 * @param {number} step - Step number (1 or 2)
 */
function showAddFeatureStep(step) {
  const step1 = document.getElementById("webedit-add-step-1");
  const step2 = document.getElementById("webedit-add-step-2");
  const stepIndicator1 = document.getElementById("webedit-step-1");
  const stepIndicator2 = document.getElementById("webedit-step-2");
  
  if (!step1 || !step2) return;
  
  // Check if step indicators exist before accessing their classList
  if (step === 1) {
    step1.style.display = "flex";
    step2.style.display = "none";
    if (stepIndicator1) {
      stepIndicator1.classList.add("active");
      stepIndicator1.classList.remove("completed");
    }
    if (stepIndicator2) {
      stepIndicator2.classList.remove("active");
    }
  } else if (step === 2) {
    step1.style.display = "none";
    step2.style.display = "flex";
    if (stepIndicator1) {
      stepIndicator1.classList.remove("active");
      stepIndicator1.classList.add("completed");
    }
    if (stepIndicator2) {
      stepIndicator2.classList.add("active");
    }
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
  if (window.EditRules && !window.EditRules._error) {
    console.log('✅ EditRules available immediately');
    return window.EditRules;
  }
  
  // Check if EditRules was exported with an error
  if (window.EditRules && window.EditRules._error) {
    console.error('❌ EditRules failed to load with error:', window.EditRules._errorMessage);
    if (window.EditRules._errorStack) {
      console.error('   Stack trace:', window.EditRules._errorStack);
    }
    return null;
  }

  console.log('⏳ Waiting for EditRules to load...');
  
  // Wait in 100ms increments
  const checkInterval = 100;
  const maxChecks = Math.floor(maxWaitMs / checkInterval);

  for (let i = 0; i < maxChecks; i++) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    
    // Check if EditRules is now available
    if (window.EditRules) {
      // Check if it's an error object
      if (window.EditRules._error) {
        console.error('❌ EditRules failed to load with error:', window.EditRules._errorMessage);
        if (window.EditRules._errorStack) {
          console.error('   Stack trace:', window.EditRules._errorStack);
        }
        return null;
      }
      
      // Valid EditRules object
      console.log(`✅ EditRules available after ${(i + 1) * checkInterval}ms`);
      return window.EditRules;
    }
    
    // Also check the flag
    if (window.__webeditEditRulesLoaded) {
      // Flag is set but EditRules might not be on window yet, wait a bit more
      await new Promise(resolve => setTimeout(resolve, 50));
      if (window.EditRules && !window.EditRules._error) {
        console.log(`✅ EditRules available after ${(i + 1) * checkInterval}ms (via flag)`);
        return window.EditRules;
      }
    }
  }

  // Final check
  if (window.EditRules && window.EditRules._error) {
    console.error('❌ EditRules failed to load with error:', window.EditRules._errorMessage);
    if (window.EditRules._errorStack) {
      console.error('   Stack trace:', window.EditRules._errorStack);
    }
    return null;
  }

  console.error('❌ EditRules not available after waiting', maxWaitMs, 'ms');
  console.error('   This might indicate an error in editRules.js');
  console.error('   Check the console for errors in editRules.js');
  console.error('   Looking for initial log: "📦 editRules.js: Starting to load..."');
  console.error('   Looking for export log: "✅ EditRules initialized and exported to window.EditRules"');
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

/**
 * Handle ESC key to exit active modes
 * @param {KeyboardEvent} event 
 */
function handleModeEscapeKey(event) {
  if (event.key === "Escape" || event.keyCode === 27) {
    event.preventDefault();
    event.stopPropagation();
    
    console.log("⌨️ ESC key pressed - exiting active mode");
    
    // Exit all active modes
    if (isPickMode) {
      stopPickMode();
      showNotification("Pick mode cancelled", "info");
    }
    if (isRemoveMode) {
      stopRemoveMode();
      showNotification("Remove mode cancelled", "info");
    }
    if (isAddFeatureMode) {
      // Reset Add feature mode
      isAddFeatureMode = false;
      currentEditTarget = {
        element: null,
        selector: null,
        description: null,
        pageKey: null
      };
      
      // Hide Add and Manage panels
      const addPanel = document.getElementById("webedit-add-panel");
      const managePanel = document.getElementById("webedit-manage-panel");
      if (addPanel) {
        addPanel.classList.remove("visible");
      }
      if (managePanel) {
        managePanel.classList.remove("visible");
      }
      
      // Clear selected target display
      const targetDisplay = document.getElementById("webedit-selected-target");
      if (targetDisplay) {
        targetDisplay.style.display = "none";
      }
      
      // Reset chat input placeholder
      const chatInput = document.getElementById("webedit-chat-input");
      if (chatInput) {
        chatInput.placeholder = "What do you want to change?";
      }
      
      // If Pick mode was active (for Add feature), stop it
      if (isPickMode) {
        stopPickMode();
      }
      
      showNotification("Add feature mode cancelled", "info");
    }
  }
}

/**
 * Show the floating exit button with a label
 * @param {string} modeLabel - Label text to show (e.g., "Pick Mode", "Remove Mode")
 */
function showExitModeButton(modeLabel) {
  // Remove existing button if any
  hideExitModeButton();
  
  // Create exit button
  exitModeButton = document.createElement("div");
  exitModeButton.className = "webedit-exit-mode-btn";
  exitModeButton.innerHTML = "×";
  exitModeButton.title = "Exit " + modeLabel;
  
  // Create label
  exitModeLabel = document.createElement("div");
  exitModeLabel.className = "webedit-exit-mode-label";
  exitModeLabel.textContent = "ESC or click × to exit " + modeLabel;
  
  // Add click handler to exit button
  exitModeButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("🔘 Exit button clicked");
    
    // Exit all active modes
    if (isPickMode) {
      stopPickMode();
    }
    if (isRemoveMode) {
      stopRemoveMode();
    }
    if (isAddFeatureMode) {
      // Reset Add feature mode
      isAddFeatureMode = false;
      currentEditTarget = {
        element: null,
        selector: null,
        description: null,
        pageKey: null
      };
      
      // Reset chat input placeholder
      const chatInput = document.getElementById("webedit-chat-input");
      if (chatInput) {
        chatInput.placeholder = "What do you want to change?";
      }
      
      // If Pick mode was active (for Add feature), stop it
      if (isPickMode) {
        stopPickMode();
      } else {
        // If Pick mode is not active (element was already selected), hide exit button
        // since stopPickMode() would have handled it otherwise
        hideExitModeButton();
      }
    }
    
    showNotification("Mode cancelled", "info");
  });
  
  document.body.appendChild(exitModeButton);
  document.body.appendChild(exitModeLabel);
  
  console.log("✅ Exit button shown for:", modeLabel);
}

/**
 * Hide and remove the exit button
 */
function hideExitModeButton() {
  if (exitModeButton) {
    exitModeButton.remove();
    exitModeButton = null;
  }
  if (exitModeLabel) {
    exitModeLabel.remove();
    exitModeLabel = null;
  }
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
  document.addEventListener("keydown", handleModeEscapeKey, true);
  
  // Show exit button
  showExitModeButton("Remove Mode");

  showNotification("Remove mode active - Click an element to remove it", "info");
}

function stopRemoveMode() {
  console.log("🗑️ Stopping Remove mode");
  isRemoveMode = false;
  clearHover();
  document.removeEventListener("mousemove", handleRemoveMouseMove, true);
  document.removeEventListener("click", handleRemoveClick, true);
  document.removeEventListener("keydown", handleModeEscapeKey, true);
  
  // Hide exit button
  hideExitModeButton();
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

      // Save to Supabase (non-blocking)
      if (window.SaveEdit && window.SaveEdit.saveRemoveEdit) {
        window.SaveEdit.saveRemoveEdit(el, rule).catch(err => {
          console.error('[Remove] Failed to save to Supabase:', err);
          // Don't show error to user - local save succeeded
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

  // Remove any existing listeners first to prevent duplicates
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handlePickClick, true);
  document.removeEventListener("keydown", handleModeEscapeKey, true);

  document.addEventListener("mousemove", handlePickMouseMove, true);
  document.addEventListener("click", handlePickClick, true);
  document.addEventListener("keydown", handleModeEscapeKey, true);
  
  // Show exit button
  showExitModeButton("Pick Mode");

  showNotification("Pick mode active - Click an element to select it", "info");
}

function stopPickMode() {
  console.log("👆 Stopping Pick mode");
  isPickMode = false;
  clearHover();
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handlePickClick, true);
  document.removeEventListener("keydown", handleModeEscapeKey, true);
  
  // Hide exit button
  hideExitModeButton();
  
  // Reset chat input placeholder if we were in Add feature mode
  if (isAddFeatureMode) {
    const chatInput = document.getElementById("webedit-chat-input");
    if (chatInput) {
      chatInput.placeholder = "What do you want to change?";
    }
  }
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

async function handlePickClick(event) {
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

    // Check if we're in Add feature mode
    const wasInAddFeatureMode = isAddFeatureMode;
    
    if (isAddFeatureMode) {
      // Update Add Feature panel with selected target
      const targetDisplay = document.getElementById("webedit-selected-target");
      const targetPreview = document.getElementById("webedit-target-preview");
      
      if (targetDisplay && targetPreview) {
        targetDisplay.style.display = "block";
        targetPreview.textContent = `${selector} (${description})`;
      }
      
      // Move to step 2
      showAddFeatureStep(2);
      
      showNotification("Location selected! Now create your feature", "success");
      
      // Keep isAddFeatureMode = true so ESC can still cancel the flow
      // It will be reset when the feature is created or cancelled
    } else {
      showNotification("Element selected for editing", "success");
    }
  } else {
    console.error("❌ EditRules not available after waiting");
    showNotification("Element selected, but some features may not work. Please refresh the page.", "error");
  }

  stopPickMode();
  
  // If we were in Add feature mode, re-add the ESC key listener
  // so users can cancel the Add feature flow during the form input phase
  if (wasInAddFeatureMode) {
    console.log("➕ Re-adding ESC key listener for Add feature mode");
    // Remove any existing listener first to prevent duplicates
    document.removeEventListener("keydown", handleModeEscapeKey, true);
    document.addEventListener("keydown", handleModeEscapeKey, true);
    
    // Also show the exit button again for Add feature mode
    showExitModeButton("Add Feature Mode");
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
      referenceMessages.forEach((msg, index) => {
        const msgEl = document.createElement("div");
        msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;
        msgEl.style.position = "relative";

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

        // Create close button for reference
        const closeBtn = document.createElement("button");
        closeBtn.className = "webedit-reference-close-btn";
        closeBtn.innerHTML = "×";
        closeBtn.title = "Remove reference";
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          // Find the index in chatMessages array
          const msgIndex = chatMessages.findIndex(m => m.timestamp === msg.timestamp && m.type === 'reference');
          if (msgIndex !== -1) {
            chatMessages.splice(msgIndex, 1);
            renderChatMessages();
          }
        });

        msgEl.appendChild(labelEl);
        msgEl.appendChild(textEl);
        msgEl.appendChild(closeBtn);
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

// Storage key for added features
const ADDED_FEATURES_STORAGE_KEY = 'webedit-added-features';

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
  const { hostname, pathname } = window.location;
  return `webedit-features::${hostname}::${pathname}`;
}

/**
 * Wait for injector to be available
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds
 * @returns {Promise<Object|null>} WebEditInjector instance or null if not available
 */
async function waitForInjector(maxWaitMs = 5000) {
  // Check immediately first
  if (window.WebEditInjector) {
    console.log('✅ WebEditInjector available immediately');
    return window.WebEditInjector;
  }

  console.log('⏳ Waiting for WebEditInjector to load...');
  
  // Wait in 100ms increments
  const checkInterval = 100;
  const maxChecks = Math.floor(maxWaitMs / checkInterval);

  for (let i = 0; i < maxChecks; i++) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    if (window.WebEditInjector) {
      console.log(`✅ WebEditInjector available after ${(i + 1) * checkInterval}ms`);
      return window.WebEditInjector;
    }
  }

  console.error('❌ WebEditInjector not available after waiting', maxWaitMs, 'ms');
  return null;
}

/**
 * Inject a feature into the page using the Shadow DOM injector
 * @param {Object} spec - FeatureSpec specification
 * @param {string} spec.id - Unique feature identifier
 * @param {string} spec.selector - CSS selector for target element
 * @param {string} spec.position - Position: "before" | "after" | "inside"
 * @param {string} spec.html - HTML content for the feature
 * @param {string} [spec.css] - Optional CSS styles
 * @returns {Promise<boolean>} True if successfully injected
 */
async function injectFeature(spec) {
  console.log("[WebEdit Add] Injecting feature", spec);
  
  try {
    // Wait for injector to be available
    const injector = await waitForInjector();
    
    if (!injector) {
      console.error("[WebEdit Add] ❌ Injector not available");
      showNotification("Failed to inject feature: Injector not loaded", "error");
      return false;
    }
    
    // Check if already mounted (deduplication)
    if (injector.isFeatureMounted(spec.id)) {
      console.log(`[WebEdit Add] Feature ${spec.id} already mounted, skipping`);
      return true;
    }
    
    // Use mountFeatureWithRetry for automatic retry logic
    const handle = injector.mountFeatureWithRetry(spec, { timeoutMs: 10000 });
    
    // Note: mountFeatureWithRetry may return null and mount asynchronously
    // We'll check if it mounted immediately or will mount later
    if (handle) {
      console.log(`[WebEdit Add] ✅ Feature injected successfully: ${spec.id}`);
      return true;
    } else {
      // Feature will be mounted asynchronously when selector appears
      console.log(`[WebEdit Add] Feature queued for async injection: ${spec.id}`);
      return true; // Still return true as it's queued
    }
    
  } catch (error) {
    console.error("[WebEdit Add] ❌ Error injecting feature:", error);
    showNotification(`Failed to inject feature: ${error.message}`, "error");
    return false;
  }
}

/**
 * Save a feature to chrome.storage
 * @param {Object} feature - FeatureSpec object
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
    
    try {
      const storageKey = getFeatureStorageKey();
      
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
 * Get all features for current page
 * @returns {Promise<Array>} Array of FeatureSpec objects
 */
async function getAddedFeatures() {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve([]);
      return;
    }
    
    try {
      const storageKey = getFeatureStorageKey();
      chrome.storage.local.get([storageKey], (result) => {
        if (chrome.runtime.lastError) {
          console.error("[WebEdit Add] Error loading features:", chrome.runtime.lastError);
          resolve([]);
          return;
        }
        
        resolve(result[storageKey] || []);
      });
    } catch (error) {
      console.error("[WebEdit Add] Error getting features:", error);
      resolve([]);
    }
  });
}

/**
 * Delete a feature from storage
 * @param {string} featureId - Feature ID to delete
 * @returns {Promise<boolean>} Success status
 */
async function deleteAddedFeature(featureId) {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve(false);
      return;
    }
    
    try {
      const storageKey = getFeatureStorageKey();
      chrome.storage.local.get([storageKey], (result) => {
        if (chrome.runtime.lastError) {
          console.error("[WebEdit Add] Error loading features:", chrome.runtime.lastError);
          resolve(false);
          return;
        }
        
        const features = result[storageKey] || [];
        const updatedFeatures = features.filter(f => f.id !== featureId);
        
        chrome.storage.local.set({ [storageKey]: updatedFeatures }, () => {
          if (chrome.runtime.lastError) {
            console.error("[WebEdit Add] Error deleting feature:", chrome.runtime.lastError);
            resolve(false);
            return;
          }
          
          console.log(`[WebEdit Add] ✅ Feature deleted: ${featureId}`);
          resolve(true);
        });
      });
    } catch (error) {
      console.error("[WebEdit Add] Error deleting feature:", error);
      resolve(false);
    }
  });
}

/**
 * Toggle feature enabled/disabled state
 * @param {string} featureId - Feature ID
 * @param {boolean} enabled - New enabled state
 * @returns {Promise<boolean>} Success status
 */
async function toggleFeatureEnabled(featureId, enabled) {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve(false);
      return;
    }
    
    try {
      const storageKey = getFeatureStorageKey();
      chrome.storage.local.get([storageKey], (result) => {
        if (chrome.runtime.lastError) {
          console.error("[WebEdit Add] Error loading features:", chrome.runtime.lastError);
          resolve(false);
          return;
        }
        
        const features = result[storageKey] || [];
        const feature = features.find(f => f.id === featureId);
        
        if (!feature) {
          console.warn("[WebEdit Add] Feature not found:", featureId);
          resolve(false);
          return;
        }
        
        feature.enabled = enabled;
        
        chrome.storage.local.set({ [storageKey]: features }, () => {
          if (chrome.runtime.lastError) {
            console.error("[WebEdit Add] Error toggling feature:", chrome.runtime.lastError);
            resolve(false);
            return;
          }
          
          console.log(`[WebEdit Add] ✅ Feature ${enabled ? 'enabled' : 'disabled'}: ${featureId}`);
          resolve(true);
        });
      });
    } catch (error) {
      console.error("[WebEdit Add] Error toggling feature:", error);
      resolve(false);
    }
  });
}

/**
 * Convert old feature format to new FeatureSpec format
 * @param {Object} feature - Old or new format feature
 * @returns {Object} FeatureSpec format
 */
function migrateFeatureSpec(feature) {
  // If already has html property, it's new format
  if (feature.html) {
    return feature;
  }
  
  // Old format has 'content' property - migrate to new format
  if (feature.content) {
    console.log(`[WebEdit Add] Migrating old feature format: ${feature.id}`);
    
    const html = `
      <div class="feature-content">
        <div class="feature-icon">✨</div>
        <div class="feature-text">${escapeHtml(feature.content)}</div>
      </div>
    `;
    
    const css = `
      .feature-content {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        margin: 8px 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        border-left: 4px solid rgba(255, 255, 255, 0.3);
      }
      .feature-icon {
        font-size: 18px;
        flex-shrink: 0;
      }
      .feature-text {
        flex: 1;
        word-wrap: break-word;
      }
    `;
    
    return {
      ...feature,
      html: html,
      css: css,
      // Set default fields for migrated features
      type: feature.type || 'note',
      name: feature.name || 'Imported Feature',
      purpose: feature.purpose || feature.content || 'Migrated from old format'
    };
  }
  
  // Unknown format
  console.warn(`[WebEdit Add] Unknown feature format: ${feature.id}`);
  return feature;
}

/**
 * Restore all saved features for the current page on page load
 * Only restores enabled features
 * @returns {Promise<number>} Number of features restored
 */
async function restoreAddedFeatures() {
  return new Promise((resolve) => {
    // Early bailout if extension context is invalid
    if (!isExtensionContextValid()) {
      resolve(0);
      return;
    }
    
    try {
      const storageKey = getFeatureStorageKey();
      
      chrome.storage.local.get([storageKey], async (result) => {
        if (chrome.runtime.lastError) {
          console.error("[WebEdit Add] Error loading features:", chrome.runtime.lastError);
          resolve(0);
          return;
        }
        
        const features = result[storageKey] || [];
        
        // Filter only enabled features
        const enabledFeatures = features.filter(f => f.enabled !== false);
        
        if (enabledFeatures.length === 0) {
          resolve(0);
          return;
        }
        
        console.log(`[WebEdit Add] Restoring ${enabledFeatures.length} enabled feature(s) from storage`);
        
        // Wait for injector to be available
        const injector = await waitForInjector();
        
        if (!injector) {
          console.error("[WebEdit Add] ❌ Injector not available, cannot restore features");
          resolve(0);
          return;
        }
        
        // Inject each enabled feature with migration
        let successCount = 0;
        for (const feature of enabledFeatures) {
          // Migrate old format to new format if needed
          const migratedFeature = migrateFeatureSpec(feature);
          
          // Use injector with retry - this handles cases where target doesn't exist yet
          const success = await injectFeature(migratedFeature);
          if (success) {
            successCount++;
          }
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
 * Render the features management list UI
 */
async function renderFeaturesManagementList() {
  const featuresList = document.getElementById('webedit-features-list');
  if (!featuresList) return;
  
  // Get all features for current page
  const features = await getAddedFeatures();
  
  if (features.length === 0) {
    featuresList.innerHTML = '<p class="webedit-empty-message">No features added yet</p>';
    return;
  }
  
  // Clear list
  featuresList.innerHTML = '';
  
  // Render each feature
  features.forEach(feature => {
    const item = document.createElement('div');
    item.className = `webedit-feature-item ${feature.enabled === false ? 'disabled' : ''}`;
    item.innerHTML = `
      <div class="webedit-feature-header">
        <div class="webedit-feature-info">
          <div class="webedit-feature-name">${escapeHtml(feature.name || 'Unnamed Feature')}</div>
          <span class="webedit-feature-type ${feature.type}">${feature.type || 'note'}</span>
        </div>
        <div class="webedit-feature-actions">
          <div class="webedit-toggle ${feature.enabled !== false ? 'enabled' : ''}" data-feature-id="${feature.id}">
            <div class="webedit-toggle-slider"></div>
          </div>
          <button class="webedit-feature-delete-btn" data-feature-id="${feature.id}">Delete</button>
        </div>
      </div>
    `;
    
    featuresList.appendChild(item);
  });
  
  // Attach event listeners to toggles and delete buttons
  featuresList.querySelectorAll('.webedit-toggle').forEach(toggle => {
    toggle.addEventListener('click', async (e) => {
      const featureId = toggle.dataset.featureId;
      const currentlyEnabled = toggle.classList.contains('enabled');
      const newEnabled = !currentlyEnabled;
      
      // Update UI immediately
      toggle.classList.toggle('enabled');
      toggle.closest('.webedit-feature-item').classList.toggle('disabled');
      
      // Get the feature
      const features = await getAddedFeatures();
      const feature = features.find(f => f.id === featureId);
      
      if (!feature) return;
      
      // Toggle in storage
      await toggleFeatureEnabled(featureId, newEnabled);
      
      // Get injector
      const injector = await waitForInjector();
      if (!injector) return;
      
      if (newEnabled) {
        // Migrate old format to new format if needed (consistent with restoreAddedFeatures)
        const migratedFeature = migrateFeatureSpec(feature);
        
        // Mount the feature
        await injectFeature(migratedFeature);
        showNotification('Feature enabled', 'success');
      } else {
        // Unmount the feature
        injector.unmountFeature(featureId);
        showNotification('Feature disabled', 'info');
      }
    });
  });
  
  featuresList.querySelectorAll('.webedit-feature-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const featureId = btn.dataset.featureId;
      
      if (!confirm('Delete this feature?')) return;
      
      // Get injector and unmount
      const injector = await waitForInjector();
      if (injector) {
        injector.unmountFeature(featureId);
      }
      
      // Delete from storage
      await deleteAddedFeature(featureId);
      
      // Re-render list
      await renderFeaturesManagementList();
      
      showNotification('Feature deleted', 'success');
    });
  });
}

/**
 * Hard-coded feature templates (no AI)
 * @param {string} type - Feature type: 'note', 'button', 'badge'
 * @param {string} content - User content/purpose
 * @param {string} name - Feature name
 * @returns {Object} HTML and CSS for the feature
 */
function getFeatureTemplate(type, content, name) {
  const templates = {
    note: {
      html: `
        <div class="webedit-feature-note">
          <div class="note-header">
            <span class="note-icon">📝</span>
            <strong class="note-title">${escapeHtml(name)}</strong>
          </div>
          <div class="note-content">${escapeHtml(content)}</div>
        </div>
      `,
      css: `
        .webedit-feature-note {
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          border-left: 4px solid #f59e0b;
          padding: 12px 16px;
          border-radius: 8px;
          margin: 12px 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);
        }
        .note-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .note-icon {
          font-size: 18px;
        }
        .note-title {
          color: #92400e;
          font-size: 14px;
          font-weight: 600;
        }
        .note-content {
          color: #78350f;
          font-size: 13px;
          line-height: 1.6;
        }
      `
    },
    button: {
      html: `
        <button class="webedit-feature-button" data-feature-name="${escapeHtml(name)}" data-feature-content="${escapeHtml(content)}">
          <span class="button-icon">🔘</span>
          <span class="button-text">${escapeHtml(name)}</span>
        </button>
      `,
      css: `
        .webedit-feature-button {
          background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
          transition: all 0.2s;
          margin: 8px 0;
        }
        .webedit-feature-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(139, 92, 246, 0.4);
        }
        .webedit-feature-button:active {
          transform: translateY(0);
        }
        .button-icon {
          font-size: 16px;
        }
        .button-text {
          font-size: 14px;
        }
      `
    },
    badge: {
      html: `
        <span class="webedit-feature-badge" title="${escapeHtml(content)}">
          <span class="badge-icon">🏷️</span>
          <span class="badge-text">${escapeHtml(name)}</span>
        </span>
      `,
      css: `
        .webedit-feature-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: linear-gradient(135deg, #ec4899 0%, #ef4444 100%);
          color: white;
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 2px 6px rgba(236, 72, 153, 0.3);
          margin: 4px;
          cursor: default;
        }
        .badge-icon {
          font-size: 14px;
        }
        .badge-text {
          font-size: 12px;
          letter-spacing: 0.02em;
        }
      `
    }
  };
  
  return templates[type] || templates.note;
}

/**
 * Generate feature spec from form inputs (Add Feature MVP - no AI)
 * @param {Object} input - Input data
 * @param {string} input.name - Feature name
 * @param {string} input.type - Feature type: 'note', 'button', 'badge'
 * @param {string} input.purpose - Feature purpose/content
 * @param {string} input.selector - CSS selector for target element
 * @param {string} input.position - Position: 'before', 'after', 'inside'
 * @returns {Promise<Object>} FeatureSpec object
 */
async function generateFeatureSpec(input) {
  console.log("[WebEdit Add] Generating feature spec (no AI yet)");
  
  // Get template based on type
  const template = getFeatureTemplate(input.type, input.purpose, input.name);
  
  return {
    id: generateFeatureId(),
    domain: window.location.hostname,
    selector: input.selector,
    position: input.position || "after",
    name: input.name,
    purpose: input.purpose,
    type: input.type,
    html: template.html,
    css: template.css,
    pageKey: getPageKey(),
    createdAt: Date.now(),
    enabled: true // New features are enabled by default
  };
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape JavaScript string to prevent injection in onclick attributes
 * @param {string} text - Text to escape
 * @returns {string} Escaped JavaScript string
 */
function escapeJs(text) {
  if (typeof text !== 'string') {
    text = String(text);
  }
  return text
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/'/g, "\\'")     // Escape single quotes
    .replace(/"/g, '\\"')     // Escape double quotes
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r')    // Escape carriage returns
    .replace(/\t/g, '\\t')    // Escape tabs
    .replace(/\u2028/g, '\\u2028')  // Escape line separator
    .replace(/\u2029/g, '\\u2029'); // Escape paragraph separator
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
      } else {
        console.log('ℹ️ No rules to apply for this page');
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
    console.error("❌ EditRules not available during initialization - features will not work");
    console.error("   Please check the console for errors in editRules.js");
    console.error("   Try refreshing the page or reloading the extension");
    
    // Show a user-friendly notification
    setTimeout(() => {
      if (chatPanel && !chatPanel.classList.contains('hidden')) {
        showNotification("Extension not fully loaded. Please refresh the page.", "error");
      }
    }, 1000);
  }

  // Restore added features from storage
  try {
    const restoredCount = await restoreAddedFeatures();
    if (restoredCount > 0) {
      console.log(`✅ Restored ${restoredCount} added feature(s)`);
    }
  } catch (error) {
    console.error("❌ Error restoring added features:", error);
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