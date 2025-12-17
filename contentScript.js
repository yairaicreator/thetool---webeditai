// WebEdit AI Content Script (side panel controlled)
// Handles DOM interactions (pick/remove/customize/apply/add) on the active page.

console.log("[WebEdit] contentScript loaded on", location.href);

let isPickMode = false;
let isRemoveMode = false;
let hoverEl = null;
let selectedEl = null;

let lastPicked = null; // { selector, description }

function clearHover() {
  if (hoverEl) {
    hoverEl.classList.remove("webedit-hover-highlight");
    hoverEl = null;
  }
}

function clearSelected() {
  if (selectedEl) {
    selectedEl.classList.remove("webedit-selected");
    selectedEl = null;
  }
}

function setHover(el) {
  clearHover();
  hoverEl = el;
  hoverEl.classList.add("webedit-hover-highlight");
}

function cssEscape(value) {
  if (!value) return "";
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => {
    const hex = char.codePointAt(0).toString(16).padStart(2, "0");
    return `\\${hex} `;
  });
}

function generateSelectorForElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  if (el.id) return `#${cssEscape(el.id)}`;

  if (el.className && typeof el.className === "string") {
    const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith("webedit-"));
    if (classes.length > 0) {
      const safeClasses = classes.map(cssEscape);
      const classSelector = el.tagName.toLowerCase() + "." + safeClasses.join(".");
      if (document.querySelectorAll(classSelector).length === 1) return classSelector;
    }
  }

  const path = [];
  let current = el;
  let depth = 0;
  const maxDepth = 5;
  while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${cssEscape(current.id)}`;
      path.unshift(selector);
      break;
    }
    if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith("webedit-"));
      if (classes.length > 0) {
        const safeClasses = classes.slice(0, 2).map(cssEscape);
        selector += "." + safeClasses.join(".");
      }
    }
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current);
      if (siblings.length > 1) selector += `:nth-child(${index + 1})`;
    }
    path.unshift(selector);
    current = current.parentElement;
    depth++;
  }
  if (path.length > 0) {
    const pathSelector = path.join(" > ");
    const matches = document.querySelectorAll(pathSelector);
    if (matches.length <= 3 && matches.length > 0) return pathSelector;
  }

  const uniqueId = `webedit-rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  el.setAttribute("data-webedit-rule-id", uniqueId);
  return `[data-webedit-rule-id="${cssEscape(uniqueId)}"]`;
}

function generateDescriptionForElement(el) {
  const tag = el.tagName.toLowerCase();
  const map = {
    a: "Link",
    button: "Button",
    img: "Image",
    input: "Input field",
    textarea: "Text area",
    select: "Dropdown",
    p: "Paragraph",
    span: "Text",
    div: "Container",
    h1: "Heading",
    h2: "Heading",
    h3: "Heading"
  };
  const humanType = map[tag] || (tag.charAt(0).toUpperCase() + tag.slice(1));
  let text = "";
  if (tag === "img") text = el.alt || el.title || "";
  else if (tag === "input" || tag === "textarea") {
    text = el.placeholder || el.name || "";
    if (!text && el.id) {
      const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label) text = label.textContent || "";
    }
  } else {
    text = (el.textContent || "").trim();
  }
  if (text.length > 30) text = text.substring(0, 27) + "...";
  if (text) return `${humanType} "${text}"`;
  if (el.id) return `${humanType} (#${el.id})`;
  return humanType;
}

function isEventInsideExtensionUI(target) {
  if (!target || target === document.body || target === document.documentElement) return true;
  // Side panel UI is separate; we only exclude injected WebEdit nodes from selection/removal.
  return !!(target.closest && target.closest('[data-webedit-feature-id]'));
}

function startPickMode() {
  if (isPickMode) return;
  stopRemoveMode();
  isPickMode = true;
  document.addEventListener("mousemove", handlePickMouseMove, true);
  document.addEventListener("click", handlePickClick, true);
}

function stopPickMode() {
  if (!isPickMode) return;
  isPickMode = false;
  clearHover();
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handlePickClick, true);
}

function startRemoveMode() {
  if (isRemoveMode) return;
  stopPickMode();
  isRemoveMode = true;
  document.addEventListener("mousemove", handleRemoveMouseMove, true);
  document.addEventListener("click", handleRemoveClick, true);
}

function stopRemoveMode() {
  if (!isRemoveMode) return;
  isRemoveMode = false;
  clearHover();
  document.removeEventListener("mousemove", handleRemoveMouseMove, true);
  document.removeEventListener("click", handleRemoveClick, true);
}

function handlePickMouseMove(event) {
  if (!isPickMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  setHover(el);
}

function handleRemoveMouseMove(event) {
  if (!isRemoveMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  setHover(el);
}

function handlePickClick(event) {
  if (!isPickMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  event.preventDefault();
  event.stopPropagation();

  clearSelected();
  selectedEl = el;
  selectedEl.classList.add("webedit-selected");

  const selector = generateSelectorForElement(el);
  const description = generateDescriptionForElement(el);
  lastPicked = { selector, description };

  chrome.runtime.sendMessage({
    type: "WEBEDIT_ELEMENT_PICKED",
    payload: lastPicked
  }).catch(() => {});

  stopPickMode();
}

function handleRemoveClick(event) {
  if (!isRemoveMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  event.preventDefault();
  event.stopPropagation();

  el.style.display = "none";
  stopRemoveMode();
  chrome.runtime.sendMessage({ type: "WEBEDIT_MODE_EXITED" }).catch(() => {});
}

function applyStylesToSelector(selector, styles) {
  if (!selector) return false;
  const el = document.querySelector(selector);
  if (!el) return false;
  Object.entries(styles || {}).forEach(([key, value]) => {
    if (!value) return;
    const cssKey = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    el.style.setProperty(cssKey, String(value), "important");
  });
  return true;
}

function resetStylesForSelector(selector) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return false;
  el.style.removeProperty("background-color");
  el.style.removeProperty("color");
  el.style.removeProperty("font-size");
  el.style.removeProperty("width");
  el.style.removeProperty("height");
  el.style.removeProperty("transform");
  el.style.removeProperty("transform-origin");
  el.style.removeProperty("display");
  el.style.removeProperty("margin-left");
  el.style.removeProperty("margin-right");
  return true;
}

function injectFeatureCard(payload = {}) {
  const selector = payload.selector || payload.targetSelector || null;
  const target = selector ? document.querySelector(selector) : null;
  if (!target || !target.parentElement) return false;

  const id = payload.featureId || payload.id || `feature-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const position = payload.position || "after";
  const name = payload.name || "WebEdit feature";
  const description = payload.description || payload.content || "";
  const html = typeof payload.html === "string" && payload.html.trim() ? payload.html : null;
  const css = typeof payload.css === "string" ? payload.css : null;

  const container = document.createElement("div");
  container.className = "webedit-added-feature";
  container.setAttribute("data-webedit-feature-id", id);
  container.setAttribute("data-webedit-selector", selector);

  if (css && css.trim()) {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    container.appendChild(styleEl);
  }

  const contentHolder = document.createElement("div");
  if (html) {
    contentHolder.innerHTML = html;
  } else {
    contentHolder.innerHTML = `
      <div style="font-weight:600; font-size:15px; margin-bottom:6px;">${escapeHtml(name)}</div>
      <div style="font-size:13px; line-height:1.5;">${escapeHtml(description)}</div>
    `;
  }
  container.appendChild(contentHolder);

  if (position === "before") {
    target.parentElement.insertBefore(container, target);
  } else if (position === "inside") {
    target.insertBefore(container, target.firstChild);
  } else {
    target.parentElement.insertBefore(container, target.nextSibling);
  }

  return true;
}

function moveElement(selector, direction) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el || !el.parentElement) return false;
  const parent = el.parentElement;
  if (direction === "up") {
    const prev = el.previousElementSibling;
    if (!prev) return false;
    parent.insertBefore(el, prev);
    return true;
  }
  if (direction === "down") {
    const next = el.nextElementSibling;
    if (!next) return false;
    parent.insertBefore(next, el);
    return true;
  }
  return false;
}

function alignElement(selector, align) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return false;
  el.style.setProperty("display", "block", "important");
  if (align === "left") {
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "auto", "important");
    return true;
  }
  if (align === "center") {
    el.style.setProperty("margin-left", "auto", "important");
    el.style.setProperty("margin-right", "auto", "important");
    return true;
  }
  if (align === "right") {
    el.style.setProperty("margin-left", "auto", "important");
    el.style.setProperty("margin-right", "0", "important");
    return true;
  }
  return false;
}

function getPagePlainText() {
  const text = document.body?.innerText || "";
  return text.slice(0, 5000).trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WEBEDIT_SIDEPANEL_COMMAND") {
    const payload = message.payload || {};
    const type = payload.type;

    if (type === "START_PICK_MODE") {
      startPickMode();
      sendResponse({ ok: true });
      return true;
    }
    if (type === "START_REMOVE_MODE") {
      startRemoveMode();
      sendResponse({ ok: true });
      return true;
    }
    if (type === "EXIT_FEATURES") {
      stopPickMode();
      stopRemoveMode();
      clearHover();
      clearSelected();
      sendResponse({ ok: true });
      chrome.runtime.sendMessage({ type: "WEBEDIT_MODE_EXITED" }).catch(() => {});
      return true;
    }
    if (type === "APPLY_STYLES") {
      const ok = applyStylesToSelector(payload.selector, payload.styles || {});
      sendResponse({ ok });
      return true;
    }
    if (type === "RESET_STYLES") {
      const ok = resetStylesForSelector(payload.selector);
      sendResponse({ ok });
      return true;
    }
    if (type === "ADD_FEATURE_CARD") {
      const ok = injectFeatureCard(payload);
      sendResponse({ ok });
      return true;
    }
    if (type === "MOVE_ELEMENT") {
      const ok = moveElement(payload.selector, payload.direction);
      sendResponse({ ok });
      return true;
    }
    if (type === "ALIGN_ELEMENT") {
      const ok = alignElement(payload.selector, payload.align);
      sendResponse({ ok });
      return true;
    }
    if (type === "GET_PAGE_CONTEXT") {
      sendResponse({
        ok: true,
        pageContext: {
          url: location.href,
          title: document.title || "",
          text: getPagePlainText()
        }
      });
      return true;
    }

    sendResponse({ ok: false, error: "Unknown command" });
    return true;
  }

  if (message?.type === "PING") {
    sendResponse({ ok: true, status: "ready" });
    return true;
  }

  if (message?.type === "WEBEDIT_FROM_SIDEPANEL") {
    sendResponse({ ok: true, received: true });
    return true;
  }

  return false;
});
