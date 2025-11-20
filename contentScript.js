// WebEdit AI Content Script - In-page Chat Panel

let isPicking = false;
let currentTool = "remove";
let hoverEl = null;
let selectedEl = null;
let floatingLabel = null;
let chatPanel = null;
let isPanelOpen = false;
let chatMessages = [];

const WEBEDIT_ATTR = "data-webedit-id";

// ============================================
// Panel Creation & Management
// ============================================

function createPanel() {
  if (chatPanel) return chatPanel;

  const panel = document.createElement("div");
  panel.id = "webedit-chat-panel";
  panel.className = "hidden";
  panel.innerHTML = `
    <!-- Header -->
    <div class="webedit-panel-header">
      <div class="webedit-logo-pill">
        <span class="webedit-logo-web">Web</span><span class="webedit-logo-edit">Edit</span>
        <span class="webedit-logo-ai"> AI</span>
      </div>
      <div class="webedit-nav-links">
        <button class="webedit-nav-link" id="webedit-history-btn">History</button>
        <button class="webedit-nav-link" id="webedit-signin-btn">Sign in</button>
      </div>
      <button class="webedit-close-btn" id="webedit-close-btn">×</button>
    </div>

    <!-- Controls -->
    <div class="webedit-controls-section">
      <div class="webedit-visual-edit">
        <span class="webedit-tool-label">Visual Edit</span>
        <button class="webedit-hamburger-btn" id="webedit-burger-btn">
          <span></span>
          <span></span>
          <span></span>
        </button>
        <!-- Tools dropdown menu -->
        <div class="webedit-tools-menu" id="webedit-tools-menu">
          <button class="webedit-tool-chip active" data-tool="remove">Remove / hide</button>
          <button class="webedit-tool-chip" data-tool="customize">Customize</button>
          <button class="webedit-tool-chip" data-tool="add">Add</button>
        </div>
      </div>
      <button class="webedit-pick-btn" id="webedit-pick-btn">Pick element</button>
    </div>

    <!-- Customization Panel (hidden by default) -->
    <div class="webedit-customize-panel" id="webedit-customize-panel">
      <div class="webedit-customize-header">
        <h3>Customize selection</h3>
      </div>
      <p class="webedit-customize-info" id="webedit-selected-info">
        No element selected yet. Click "Pick element" and choose something on the page.
      </p>
      <div class="webedit-field-row">
        <label for="webedit-bg-color">Background</label>
        <input type="color" id="webedit-bg-color" />
      </div>
      <div class="webedit-field-row">
        <label for="webedit-text-color">Text color</label>
        <input type="color" id="webedit-text-color" />
      </div>
      <div class="webedit-field-row">
        <label for="webedit-font-size">Font size (px)</label>
        <input type="number" id="webedit-font-size" placeholder="e.g. 16" min="8" max="72" />
      </div>
      <div class="webedit-customize-actions">
        <button class="webedit-btn-small webedit-btn-secondary" id="webedit-reset-btn">Reset</button>
        <button class="webedit-btn-small webedit-btn-primary" id="webedit-apply-btn">Apply</button>
      </div>
    </div>

    <!-- Chat Container -->
    <div class="webedit-chat-container" id="webedit-chat-container">
      <div class="webedit-welcome-message">
        <h2>Hi,</h2>
        <p>How can I assist you today?</p>
        <div class="webedit-welcome-actions">
          <button class="webedit-suggestion-chip" data-suggestion="hide">Hide an element</button>
          <button class="webedit-suggestion-chip" data-suggestion="customize">Customize styles</button>
          <button class="webedit-suggestion-chip" data-suggestion="add">Add content</button>
        </div>
      </div>
    </div>

    <!-- Chat Input -->
    <div class="webedit-input-container">
      <div class="webedit-input-wrapper">
        <svg class="webedit-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
        </svg>
        <input 
          type="text" 
          class="webedit-chat-input" 
          id="webedit-chat-input" 
          placeholder="What do you want to change?"
          autocomplete="off"
        />
        <button class="webedit-send-btn" id="webedit-send-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- Modal -->
    <div class="webedit-modal-backdrop" id="webedit-modal-backdrop">
      <div class="webedit-modal">
        <h2 id="webedit-modal-title"></h2>
        <p id="webedit-modal-body"></p>
        <button class="webedit-modal-close" id="webedit-modal-close">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  chatPanel = panel;

  attachPanelEventListeners();
  return panel;
}

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
    document.body.classList.add("webedit-panel-open");
  } else {
    chatPanel.classList.add("hidden");
    document.body.classList.remove("webedit-panel-open");
    // Close tools menu if open
    const toolsMenu = document.getElementById("webedit-tools-menu");
    if (toolsMenu) toolsMenu.classList.remove("visible");
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

  // Tool chips
  const toolChips = toolsMenu.querySelectorAll(".webedit-tool-chip");
  toolChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      toolChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentTool = chip.dataset.tool;
      toolsMenu.classList.remove("visible");

      // Show customize panel if customize tool is selected
      const customizePanel = document.getElementById("webedit-customize-panel");
      if (currentTool === "customize") {
        customizePanel.classList.add("visible");
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
  const sendBtn = document.getElementById("webedit-send-btn");

  sendBtn.addEventListener("click", () => {
    sendMessage();
  });

  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Suggestion chips
  const suggestionChips = document.querySelectorAll(".webedit-suggestion-chip");
  suggestionChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const suggestion = chip.dataset.suggestion;
      let message = "";
      if (suggestion === "hide") {
        message = "I want to hide an element on the page";
      } else if (suggestion === "customize") {
        message = "I want to customize the style of an element";
      } else if (suggestion === "add") {
        message = "I want to add new content to the page";
      }
      chatInput.value = message;
      sendMessage();
    });
  });

  // Customization controls
  const applyBtn = document.getElementById("webedit-apply-btn");
  const resetBtn = document.getElementById("webedit-reset-btn");
  const bgColorInput = document.getElementById("webedit-bg-color");
  const textColorInput = document.getElementById("webedit-text-color");
  const fontSizeInput = document.getElementById("webedit-font-size");

  applyBtn.addEventListener("click", () => {
    if (!selectedEl) return;

    const elementId = selectedEl.getAttribute(WEBEDIT_ATTR);
    if (!elementId) return;

    const styles = {};
    if (bgColorInput.value) styles.backgroundColor = bgColorInput.value;
    if (textColorInput.value) styles.color = textColorInput.value;
    if (fontSizeInput.value) styles.fontSize = fontSizeInput.value + "px";

    Object.entries(styles).forEach(([prop, value]) => {
      selectedEl.style[prop] = value;
    });

    addAIChatMessage("✓ Styles applied successfully!");
  });

  resetBtn.addEventListener("click", () => {
    if (!selectedEl) return;

    selectedEl.removeAttribute("style");
    bgColorInput.value = "";
    textColorInput.value = "";
    fontSizeInput.value = "";

    addAIChatMessage("✓ Styles reset to default.");
  });

  // History and Sign in buttons
  const historyBtn = document.getElementById("webedit-history-btn");
  const signinBtn = document.getElementById("webedit-signin-btn");

  historyBtn.addEventListener("click", () => {
    openModal(
      "History (coming soon)",
      "Your edit history will appear here once WebEdit AI is connected to your account and database."
    );
  });

  signinBtn.addEventListener("click", () => {
    openModal(
      "Sign in (coming soon)",
      "Authentication will be handled via OAuth later. For now, you can use all local editing features without signing in."
    );
  });

  // Modal
  const modalBackdrop = document.getElementById("webedit-modal-backdrop");
  const modalClose = document.getElementById("webedit-modal-close");

  modalClose.addEventListener("click", () => {
    modalBackdrop.classList.remove("visible");
  });

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) {
      modalBackdrop.classList.remove("visible");
    }
  });
}

// ============================================
// Chat Functions
// ============================================

function sendMessage() {
  const chatInput = document.getElementById("webedit-chat-input");
  const message = chatInput.value.trim();

  if (!message) return;

  // Add user message
  addUserChatMessage(message);
  chatInput.value = "";

  // Generate AI response
  setTimeout(() => {
    generateAIResponse(message);
  }, 500);
}

function addUserChatMessage(text) {
  chatMessages.push({ type: "user", text });
  renderChatMessage("user", text);
}

function addAIChatMessage(text) {
  chatMessages.push({ type: "ai", text });
  renderChatMessage("ai", text);
}

function renderChatMessage(type, text) {
  const chatContainer = document.getElementById("webedit-chat-container");

  // Remove welcome message if it exists
  const welcomeMsg = chatContainer.querySelector(".webedit-welcome-message");
  if (welcomeMsg) {
    welcomeMsg.remove();
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = `webedit-chat-message ${type}`;

  const avatar = document.createElement("div");
  avatar.className = `webedit-message-avatar ${type}`;
  avatar.textContent = type === "user" ? "👤" : "🤖";

  const bubble = document.createElement("div");
  bubble.className = "webedit-message-bubble";
  bubble.textContent = text;

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(bubble);
  chatContainer.appendChild(messageDiv);

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function generateAIResponse(userMessage) {
  const lowerMessage = userMessage.toLowerCase();
  let response = "";

  // Simple command parsing
  if (lowerMessage.includes("hide") || lowerMessage.includes("remove")) {
    response = `Got it! I'll help you hide an element.\n\n1. Make sure "Remove / hide" is selected in the Visual Edit menu\n2. Click the "Pick element" button\n3. Hover and click the element you want to hide`;
    
    // Auto-select remove tool
    const toolChips = document.querySelectorAll(".webedit-tool-chip");
    toolChips.forEach((chip) => {
      chip.classList.remove("active");
      if (chip.dataset.tool === "remove") {
        chip.classList.add("active");
        currentTool = "remove";
      }
    });
  } else if (lowerMessage.includes("customize") || lowerMessage.includes("style") || lowerMessage.includes("color") || lowerMessage.includes("font")) {
    response = `Perfect! Let's customize an element.\n\n1. Select "Customize" from the Visual Edit menu\n2. Click "Pick element"\n3. Choose the element you want to style\n4. Use the customization panel to adjust colors and font size`;
    
    // Auto-select customize tool and show panel
    const toolChips = document.querySelectorAll(".webedit-tool-chip");
    toolChips.forEach((chip) => {
      chip.classList.remove("active");
      if (chip.dataset.tool === "customize") {
        chip.classList.add("active");
        currentTool = "customize";
      }
    });
    
    const customizePanel = document.getElementById("webedit-customize-panel");
    customizePanel.classList.add("visible");
  } else if (lowerMessage.includes("add") || lowerMessage.includes("insert") || lowerMessage.includes("new")) {
    response = `Great! I can help you add new content.\n\n1. Select "Add" from the Visual Edit menu\n2. Click "Pick element" to choose where to insert\n3. The new element will appear after your selection\n\nTip: You can customize the new element afterwards!`;
    
    // Auto-select add tool
    const toolChips = document.querySelectorAll(".webedit-tool-chip");
    toolChips.forEach((chip) => {
      chip.classList.remove("active");
      if (chip.dataset.tool === "add") {
        chip.classList.add("active");
        currentTool = "add";
      }
    });
  } else {
    response = `I understand you want to: "${userMessage}"\n\nI can help you with:\n• Hiding/removing elements\n• Customizing colors and fonts\n• Adding new content\n\nWhat would you like to do? Pick an option from the Visual Edit menu and use "Pick element" to select something on the page.`;
  }

  addAIChatMessage(response);
}

function openModal(title, body) {
  const modalBackdrop = document.getElementById("webedit-modal-backdrop");
  const modalTitle = document.getElementById("webedit-modal-title");
  const modalBody = document.getElementById("webedit-modal-body");

  modalTitle.textContent = title;
  modalBody.textContent = body;
  modalBackdrop.classList.add("visible");
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

  addAIChatMessage(`🎯 Element picker activated! Hover and click an element on the page.`);
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
    addAIChatMessage(`✓ Element hidden successfully!`);
  } else if (currentTool === "customize") {
    const customizePanel = document.getElementById("webedit-customize-panel");
    const selectedInfo = document.getElementById("webedit-selected-info");
    
    customizePanel.classList.add("visible");
    selectedInfo.textContent = `Element selected. Use the controls to customize it, then click Apply.`;
    
    addAIChatMessage(`✓ Element selected! Use the customization panel above to change its appearance.`);
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

  addAIChatMessage(`✓ New element added! You can now customize it if needed.`);
}

// ============================================
// Message Listener (for popup toggle)
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WEBEDIT_TOGGLE_PANEL") {
    togglePanel();
    sendResponse({ success: true });
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
