let isPicking = false;
let currentTool = "remove";
let hoverEl = null;
let selectedEl = null;
let floatingLabel = null;

const WEBEDIT_ATTR = "data-webedit-id";

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
  // do not clear selectedEl — the popup may still be customizing it
  document.removeEventListener("mousemove", handleMouseMove, true);
  document.removeEventListener("click", handleClick, true);

  chrome.runtime.sendMessage({ type: "WEBEDIT_PICKING_DONE" });
}

function handleMouseMove(event) {
  if (!isPicking) return;
  const el = event.target;
  if (!el || el === document.documentElement || el === document.body) return;
  setHover(el, event);
}

function handleClick(event) {
  if (!isPicking) return;

  event.preventDefault();
  event.stopPropagation();

  const el = event.target;
  if (!el || el === document.documentElement || el === document.body) {
    pickModeOff();
    return;
  }

  clearSelected();
  selectedEl = el;
  selectedEl.classList.add("webedit-selected");

  if (currentTool === "remove") {
    selectedEl.style.display = "none";
    // We don't need to send an elementId back for pure remove,
    // but we still mark it for consistency.
  }

  // Assign a stable id for customization / add
  let elementId = selectedEl.getAttribute(WEBEDIT_ATTR);
  if (!elementId) {
    elementId = "webedit-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    selectedEl.setAttribute(WEBEDIT_ATTR, elementId);
  }

  chrome.runtime.sendMessage({
    type: "WEBEDIT_ELEMENT_SELECTED",
    elementId,
    tool: currentTool
  });

  // For now, exit picking mode after one click.
  pickModeOff();
}

// Listen to messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WEBEDIT_START_PICK") {
    pickModeOn(message.tool);
  }

  if (message.type === "WEBEDIT_APPLY_STYLES") {
    const { elementId, styles } = message;
    if (!elementId) return;
    const el = document.querySelector(`[${WEBEDIT_ATTR}="${elementId}"]`);
    if (!el) return;

    Object.entries(styles).forEach(([prop, value]) => {
      el.style[prop] = value;
    });
  }

  if (message.type === "WEBEDIT_RESET_STYLES") {
    const { elementId } = message;
    if (!elementId) return;
    const el = document.querySelector(`[${WEBEDIT_ATTR}="${elementId}"]`);
    if (!el) return;

    el.removeAttribute("style");
  }

  if (message.type === "WEBEDIT_ADD_ELEMENT") {
    const { elementId, content } = message;
    const referenceEl = elementId
      ? document.querySelector(`[${WEBEDIT_ATTR}="${elementId}"]`)
      : null;

    const newNode = document.createElement("div");
    newNode.textContent = content || "New element from WebEdit AI";
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
  }
});

