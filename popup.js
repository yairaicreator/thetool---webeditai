let currentTool = "remove"; // "remove" | "customize" | "add"
let currentElementId = null; // data-webedit-id on page

const toolButtons = document.querySelectorAll(".tool-chip");
const pickElementBtn = document.getElementById("pickElementBtn");
const historyBtn = document.getElementById("historyBtn");
const signInBtn = document.getElementById("signInBtn");
const questionBtn = document.getElementById("questionBtn");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const closeModalBtn = document.getElementById("closeModalBtn");
const customizationPanel = document.getElementById("customizationPanel");
const selectedInfo = document.getElementById("selectedInfo");

const bgColorInput = document.getElementById("bgColorInput");
const textColorInput = document.getElementById("textColorInput");
const fontSizeInput = document.getElementById("fontSizeInput");
const applyStylesBtn = document.getElementById("applyStylesBtn");
const resetStylesBtn = document.getElementById("resetStylesBtn");

// Switch active tool
toolButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toolButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTool = btn.dataset.tool;

    if (currentTool === "customize") {
      customizationPanel.style.display = "block";
    } else {
      customizationPanel.style.display = "block"; // keep visible, but we rely on selected element
    }
  });
});

// Ask content script to start element picking
pickElementBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, {
    type: "WEBEDIT_START_PICK",
    tool: currentTool
  });
});

// Receive messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WEBEDIT_ELEMENT_SELECTED") {
    currentElementId = message.elementId;
    selectedInfo.textContent = `Element selected. Tool: ${message.tool}.`;
  }

  if (message.type === "WEBEDIT_PICKING_DONE") {
    // Could update UI if you want to reflect that picking mode ended
  }
});

// Apply customization styles
applyStylesBtn.addEventListener("click", async () => {
  if (!currentElementId) {
    selectedInfo.textContent = "Pick an element first.";
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const styles = {};
  if (bgColorInput.value) styles.backgroundColor = bgColorInput.value;
  if (textColorInput.value) styles.color = textColorInput.value;
  if (fontSizeInput.value) styles.fontSize = fontSizeInput.value + "px";

  chrome.tabs.sendMessage(tab.id, {
    type: "WEBEDIT_APPLY_STYLES",
    elementId: currentElementId,
    styles
  });
});

// Reset styles
resetStylesBtn.addEventListener("click", async () => {
  if (!currentElementId) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, {
    type: "WEBEDIT_RESET_STYLES",
    elementId: currentElementId
  });

  bgColorInput.value = "";
  textColorInput.value = "";
  fontSizeInput.value = "";
});

// Simple modal helpers
function openModal(title, body) {
  modalTitle.textContent = title;
  modalBody.textContent = body;
  modalBackdrop.classList.add("visible");
}

function closeModal() {
  modalBackdrop.classList.remove("visible");
}

closeModalBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

historyBtn.addEventListener("click", () => {
  openModal(
    "History (coming soon)",
    "Your edit history will appear here once WebEdit AI is connected to your account and database."
  );
});

signInBtn.addEventListener("click", () => {
  openModal(
    "Sign in (coming soon)",
    "Authentication will be handled via OAuth later. For now, you can use all local editing features without signing in."
  );
});

questionBtn.addEventListener("click", () => {
  openModal(
    "What do you want to change?",
    "1) Choose a tool: Remove / Customize / Add.\n2) Click "Pick element".\n3) Hover and click an element on the page to edit it."
  );
});

// Example: when current tool is "add" and user double-clicks the question bar, add a pill after last selected element
questionBtn.addEventListener("dblclick", async () => {
  if (currentTool !== "add") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, {
    type: "WEBEDIT_ADD_ELEMENT",
    elementId: currentElementId,
    content: "Added with WebEdit AI"
  });
});

