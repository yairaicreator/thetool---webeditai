// WebEdit AI Content Script - In-page Chat Panel

let isPicking = false;
let currentTool = "remove";
let hoverEl = null;
let selectedEl = null;
let floatingLabel = null;
let chatPanel = null;
let isPanelOpen = false;

const WEBEDIT_ATTR = "data-webedit-id";

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
      <div class="webedit-chat-placeholder">
        <p>Select a tool from Visual Edit menu below to get started</p>
      </div>
    </div>

    <!-- Customize Panel (collapsible) -->
    <div class="webedit-customize-panel" id="webedit-customize-panel">
      <div class="webedit-customize-header">
        <h3>Customize Element</h3>
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
function togglePanel(show) {
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
  
  burgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toolsMenu.classList.toggle("visible");
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
    btn.addEventListener("click", () => {
      toolButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.tool;
      toolsMenu.classList.remove("visible"); // Close menu after selection
      
      // Show/hide customize panel based on selected tool
      if (currentTool === "customize") {
        customizePanel.classList.add("visible");
      } else {
        customizePanel.classList.remove("visible");
      }
    });
  });

  // Pick element button
  const pickBtn = document.getElementById("webedit-pick-btn");
  pickBtn.addEventListener("click", () => {
    pickModeOn(currentTool);
  });

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
  const signinBtn = document.getElementById("webedit-signin-btn");

  logoBtn.addEventListener("click", () => {
    alert("Logo clicked - can navigate to home");
  });

  historyBtn.addEventListener("click", () => {
    alert("History feature coming soon");
  });

  signinBtn.addEventListener("click", () => {
    alert("Sign in feature coming soon");
  });

  // Customize panel buttons
  const applyBtn = document.getElementById("webedit-apply-btn");
  const resetBtn = document.getElementById("webedit-reset-btn");
  const bgColorInput = document.getElementById("webedit-bg-color");
  const textColorInput = document.getElementById("webedit-text-color");
  const fontSizeInput = document.getElementById("webedit-font-size");

  applyBtn.addEventListener("click", () => {
    if (!selectedEl) {
      alert("Please pick an element first using the 'Pick element' button");
      return;
    }
    
    selectedEl.style.backgroundColor = bgColorInput.value;
    selectedEl.style.color = textColorInput.value;
    selectedEl.style.fontSize = fontSizeInput.value + "px";
    alert("✓ Styles applied successfully!");
  });

  resetBtn.addEventListener("click", () => {
    // Reset input fields to defaults
    bgColorInput.value = "#ffffff";
    textColorInput.value = "#000000";
    fontSizeInput.value = "16";
    
    // Remove applied styles from the selected element
    if (selectedEl) {
      selectedEl.removeAttribute("style");
      alert("✓ Styles reset - element restored to original appearance!");
    }
  });
}


// ============================================
// Element Picking (preserved from original)
// ============================================

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

function setHover(el, event) {
  clearHover();
  hoverEl = el;
  hoverEl.classList.add("webedit-hover-highlight");

  const label = ensureFloatingLabel();
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

function pickModeOn(tool) {
  if (isPicking) return;
  isPicking = true;
  currentTool = tool;

  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
}

function pickModeOff() {
  isPicking = false;
  clearHover();
  document.removeEventListener("mousemove", handleMouseMove, true);
  document.removeEventListener("click", handleClick, true);
}

function handleMouseMove(event) {
  if (!isPicking) return;
  const el = event.target;
  
  // Don't pick the panel itself or its children
  if (!el || el === document.documentElement || el === document.body || 
      el.closest("#webedit-chat-panel")) {
    return;
  }
  
  setHover(el, event);
}

function handleClick(event) {
  if (!isPicking) return;

  const el = event.target;
  
  // Don't pick the panel itself or its children
  if (!el || el === document.documentElement || el === document.body || 
      el.closest("#webedit-chat-panel")) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  clearSelected();
  selectedEl = el;
  selectedEl.classList.add("webedit-selected");

  // Assign a stable id
  let elementId = selectedEl.getAttribute(WEBEDIT_ATTR);
  if (!elementId) {
    elementId = "webedit-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    selectedEl.setAttribute(WEBEDIT_ATTR, elementId);
  }

  // Handle based on tool
  if (currentTool === "remove") {
    selectedEl.style.display = "none";
    alert("✓ Element hidden successfully!");
  } else if (currentTool === "customize") {
    // Element selected - user can now use the customize panel to adjust styles
    alert("✓ Element selected! Use the customize panel below to adjust colors and font size, then click 'Apply'.");
  } else if (currentTool === "add") {
    addNewElement(selectedEl);
  }

  pickModeOff();
}

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

  alert("✓ New element added! You can now customize it if needed.");
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
  
  // Respond to PING messages (for connection testing)
  if (message.type === "PING") {
    sendResponse({ status: "ready" });
    return true;
  }
});

// ============================================
// Initialize
// ============================================

// Create panel on load (hidden by default)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    createPanel();
  });
} else {
  createPanel();
}
