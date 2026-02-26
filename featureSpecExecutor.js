// WebEdit AI - FeatureSpec Executor + Undo/Redo + Persistence (no-build safe)
// Loaded as a classic script; exposes FeatureSpecExecutor on window.

const FEATURE_SPEC_STORAGE_KEY = "webeditFeatureSpecs";
const INSERT_MARKER_ATTR = "data-webedit-ai-insert-id";
const HIDE_MARKER_ATTR = "data-webedit-ai-hidden-id";
const STYLE_MARKER_ATTR = "data-webedit-ai-style-id";
const BOUND_MARKER_ATTR = "data-webedit-ai-bound";
const TOGGLE_STATE_PREFIX = "webeditAiToggleState::";
const CONTROLLER_STATE_PREFIX = "webeditAiControllerState::";
const behaviorRegistry = new Map(); // markerId -> behavior
const controllerInstanceRegistry = new Map(); // controller+scope+marker -> host
let delegatedBehaviorHandlerInstalled = false;
const delegatedBehaviorRoots = new WeakSet();
const FEATURE_SPEC_SCHEMA_VERSION = "2";

function isExtensionContextValid() {
  try {
    if (typeof chrome === "undefined") return false;
    if (!chrome.runtime || typeof chrome.runtime.id === "undefined") return false;
    if (!chrome.storage || !chrome.storage.local) return false;
    return true;
  } catch {
    return false;
  }
}

function getPageKey() {
  const { hostname, pathname } = window.location;
  return `${hostname}${pathname}`;
}

function uuid() {
  return `chg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getToggleStateKey(scopeKey, markerId) {
  return `${TOGGLE_STATE_PREFIX}${scopeKey}::${markerId}`;
}

function getControllerStateKey(scopeKey, markerId) {
  return `${CONTROLLER_STATE_PREFIX}${scopeKey}::${markerId}`;
}

function safeQueryAll(selector, root = document) {
  if (!selector) return [];
  try {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    return Array.from(scope.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function isVisibleElement(el) {
  if (!(el instanceof Element)) return false;
  const rect = el.getBoundingClientRect();
  if (!rect || rect.width <= 1 || rect.height <= 1) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  return true;
}

function area(el) {
  const r = el.getBoundingClientRect();
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function pickBestElement(nodeList) {
  const candidates = Array.from(nodeList || []).filter(isVisibleElement);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => area(b) - area(a));
  return candidates[0] || null;
}

function sanitizeHtml(html) {
  const source = typeof html === "string" ? html : "";
  const template = document.createElement("template");
  template.innerHTML = source;

  const blockedTags = new Set(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "LINK", "META"]);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null);

  /** @type {Element[]} */
  const toRemove = [];

  while (walker.nextNode()) {
    const el = /** @type {Element} */ (walker.currentNode);
    if (blockedTags.has(el.tagName)) {
      toRemove.push(el);
      continue;
    }

    // Strip inline handlers + javascript: URLs
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = (attr.value || "").trim();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src" || name === "xlink:href" || name === "formaction") &&
          /^javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
      if (name === "srcdoc") {
        el.removeAttribute(attr.name);
      }
    }
  }

  toRemove.forEach((el) => el.remove());
  return template.innerHTML;
}

function injectCss(cssText, markerId, root = document) {
  const css = typeof cssText === "string" ? cssText : "";
  if (!css.trim()) return null;

  let head = null;
  if (root instanceof ShadowRoot) {
    head = root;
  } else if (root && typeof root.appendChild === "function" && !root.head) {
    head = root;
  } else {
    head = root.head || root.documentElement || document.head || document.documentElement;
  }
  if (!head) return null;

  const style = document.createElement("style");
  style.setAttribute(STYLE_MARKER_ATTR, markerId);
  style.textContent = css;
  head.appendChild(style);
  return style;
}

function createNodesFromHtml(html, markerId) {
  const clean = sanitizeHtml(html);
  const template = document.createElement("template");
  template.innerHTML = clean;

  const nodes = Array.from(template.content.childNodes);
  // Mark inserted element nodes so undo can find them deterministically.
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      /** @type {Element} */ (node).setAttribute(INSERT_MARKER_ATTR, markerId);
    }
  }
  return nodes;
}

function collectValidationFailures(spec, root = document) {
  const validation = spec?.validation || null;
  const tests = Array.isArray(validation?.tests) ? validation.tests : [];
  const failures = [];
  tests.forEach((test, index) => {
    if (!test || typeof test !== "object") return;
    const type = String(test.type || "").trim();
    if (!type) return;
    if (type === "selectorExists") {
      const selector = String(test.selector || "").trim();
      if (!selector) return;
      const nodes = safeQueryAll(selector, root);
      if (!nodes.length) {
        failures.push({
          code: "selector_missing",
          message: `Validation failed: selector not found (${selector})`,
          testIndex: index
        });
      }
      return;
    }
    if (type === "attributeEquals") {
      const selector = String(test.selector || "").trim();
      const attribute = String(test.attribute || "").trim();
      const expected = String(test.value || "");
      if (!selector || !attribute) return;
      const el = safeQueryAll(selector, root)[0] || null;
      const actual = el ? String(el.getAttribute(attribute) || "") : "";
      if (!el || actual !== expected) {
        failures.push({
          code: "attribute_mismatch",
          message: `Validation failed: ${selector}[${attribute}] mismatch`,
          testIndex: index
        });
      }
    }
  });
  return failures;
}

function runScopedScript(js, root = document) {
  const code = typeof js === "string" ? js.trim() : "";
  if (!code) return;
  // Avoid runtime eval to remain compatible with strict CSP pages (e.g. Gemini).
  console.info("[WebEdit AI] Skipped inline script execution due to CSP-safe mode.");
}

function bindControllerForMarker(spec, markerId, root = document, options = {}) {
  const controller = spec?.generated_module?.controller || "";
  if (!controller || !markerId) return;

  const scopeKey = getScopeKey();
  const stateKey = getControllerStateKey(scopeKey, markerId);
  const containers = safeQueryAll(`[${INSERT_MARKER_ATTR}="${CSS.escape(markerId)}"]`, root);
  const host = containers[0] || null;
  if (!host) return;
  const controllerKey = `${controller}::${scopeKey}::${markerId}`;
  const existingHost = controllerInstanceRegistry.get(controllerKey);
  if (existingHost && existingHost !== host && existingHost.isConnected) {
    // If another live host already owns this controller instance, drop duplicate mount.
    const duplicateContainer = host.closest(`[${INSERT_MARKER_ATTR}]`) || host;
    if (duplicateContainer && duplicateContainer.parentNode) {
      try { duplicateContainer.parentNode.removeChild(duplicateContainer); } catch (_) {}
    }
    return;
  }
  controllerInstanceRegistry.set(controllerKey, host);

  if (controller === "themeToggleController") {
    const triggers = [];
    if (host.matches?.('[data-webedit-ai-action="toggle"]')) triggers.push(host);
    triggers.push(...safeQueryAll('[data-webedit-ai-action="toggle"]', host));

    triggers.forEach((trigger) => {
      if (!(trigger instanceof Element)) return;
      if (trigger.getAttribute(BOUND_MARKER_ATTR) === "1") return;
      trigger.setAttribute(BOUND_MARKER_ATTR, "1");
      trigger.setAttribute("role", trigger.getAttribute("role") || "button");
      if (!trigger.hasAttribute("tabindex")) trigger.setAttribute("tabindex", "0");

      const applyState = (enabled) => {
        const targets = safeQueryAll("body, [data-webedit-preview-target='1']", root);
        targets.forEach((target) => {
          try { target.classList.toggle("webedit-theme-dark", !!enabled); } catch (_) {}
        });
        trigger.setAttribute("aria-pressed", enabled ? "true" : "false");
      };

      let enabled = false;
      try {
        const stored = localStorage.getItem(stateKey);
        enabled = stored === "1";
      } catch (_) {}
      applyState(enabled);

      const onToggle = () => {
        enabled = !enabled;
        applyState(enabled);
        try { localStorage.setItem(stateKey, enabled ? "1" : "0"); } catch (_) {}
      };

      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }, true);
      trigger.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }, true);
    });
    return;
  }

  if (controller === "folderGeminiController") {
    const newButton = safeQueryAll("[data-webedit-folder-module='1'] button[class$='__new']", host)[0]
      || safeQueryAll("[data-webedit-folder-module='1'] button", host)[0]
      || null;
    const source = safeQueryAll("[data-webedit-folder-source='1']", host)[0] || null;
    const folderList = safeQueryAll("[data-webedit-folder-list='1']", host)[0] || null;
    if (!(source instanceof Element) || !(folderList instanceof Element) || !(newButton instanceof Element)) return;

    if (host.getAttribute(BOUND_MARKER_ATTR) === "1") return;
    host.setAttribute(BOUND_MARKER_ATTR, "1");

    const loadState = () => {
      try {
        const raw = localStorage.getItem(stateKey);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : { folders: [], assignments: {}, selectedChat: "" };
      } catch (_) {
        return { folders: [], assignments: {}, selectedChat: "" };
      }
    };
    const saveState = (state) => {
      try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch (_) {}
    };

    const escapeForSelector = (value) => {
      try {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(String(value));
      } catch (_) {}
      return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    };
    const getHostState = () => {
      if (!host.__webeditFolderState) host.__webeditFolderState = {
        original: {},
        signatureToId: {},
        lastCreateAt: 0
      };
      return host.__webeditFolderState;
    };
    const state = loadState();
    const hostState = getHostState();
    const hashString = (value) => {
      const input = String(value || "");
      let hash = 2166136261;
      for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return Math.abs(hash >>> 0).toString(36);
    };

    const assignChatId = (el, index, text = "") => {
      if (!(el instanceof Element)) return "";
      const existing = el.getAttribute("data-webedit-folder-chat-id");
      if (existing) return existing;
      const href = el.getAttribute("href") || "";
      const aria = el.getAttribute("aria-label") || "";
      const signature = `${String(text || "").trim().toLowerCase()}|${String(href).trim().toLowerCase()}|${String(aria).trim().toLowerCase()}`;
      let nextId = hostState.signatureToId[signature];
      if (!nextId) {
        nextId = `chat-${hashString(signature || `index-${index}`)}`;
        hostState.signatureToId[signature] = nextId;
      }
      el.setAttribute("data-webedit-folder-chat-id", nextId);
      return nextId;
    };

    const collectChatCandidates = () => {
      const hostExclusion = `[${INSERT_MARKER_ATTR}="${escapeForSelector(markerId)}"]`;
      const selectors = [
        "nav a, nav button, nav [role='button']",
        "aside a, aside button, aside [role='button']",
        "[aria-label*='chat' i] a, [aria-label*='chat' i] button, [aria-label*='chat' i] [role='button']",
        "a, button, [role='button']"
      ];
      const map = new Map();
      selectors.forEach((sel) => {
        safeQueryAll(sel, document).forEach((node) => {
          if (!(node instanceof Element)) return;
          if (!isVisibleElement(node)) return;
          if (node.closest(hostExclusion)) return;
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (!text || text.length < 2) return;
          if (/new folder\+|rename|delete|undo|apply|refine/i.test(text)) return;
          const id = assignChatId(node, map.size + 1, text);
          if (!id) return;
          if (!map.has(id)) {
            map.set(id, { id, text, node });
          }
        });
      });
      return Array.from(map.values()).slice(0, 30);
    };

    const rememberOriginalPlacement = (chatId, node) => {
      if (!chatId || !(node instanceof Element) || hostState.original[chatId]) return;
      hostState.original[chatId] = {
        parent: node.parentNode || null,
        nextSibling: node.nextSibling || null
      };
    };

    const restoreToOriginal = (chatId, node) => {
      const placement = hostState.original[chatId];
      if (!placement || !(node instanceof Element)) return;
      const parent = placement.parent;
      if (!parent) return;
      try {
        if (placement.nextSibling && placement.nextSibling.parentNode === parent) {
          parent.insertBefore(node, placement.nextSibling);
        } else {
          parent.appendChild(node);
        }
      } catch (_) {}
    };

    const renderSourceList = (candidates) => {
      source.innerHTML = "";
      const assignedSet = new Set(Object.keys(state.assignments || {}));
      const unassigned = candidates.filter((c) => !assignedSet.has(c.id));
      if (unassigned.length === 0) {
        const empty = document.createElement("li");
        empty.className = "webedit-folder-drop-empty";
        empty.textContent = "No unassigned chats";
        source.appendChild(empty);
        return;
      }
      unassigned.forEach((chat) => {
        const item = document.createElement("li");
        item.className = "webedit-folder-source-item";
        item.textContent = chat.text;
        item.setAttribute("data-chat-id", chat.id);
        item.style.outline = state.selectedChat === chat.id ? "2px solid #2563eb" : "";
        source.appendChild(item);
      });
    };

    const moveAssignedNode = (chatId, targetContainer, candidates) => {
      const chat = candidates.find((c) => c.id === chatId);
      const node = chat?.node || document.querySelector(`[data-webedit-folder-chat-id="${escapeForSelector(chatId)}"]`);
      if (!(node instanceof Element) || !(targetContainer instanceof Element)) return false;
      rememberOriginalPlacement(chatId, node);
      try {
        targetContainer.appendChild(node);
        return true;
      } catch (_) {
        return false;
      }
    };

    const unassignChat = (chatId, candidates) => {
      if (!chatId) return;
      delete state.assignments[chatId];
      const chat = candidates.find((c) => c.id === chatId);
      const node = chat?.node || document.querySelector(`[data-webedit-folder-chat-id="${escapeForSelector(chatId)}"]`);
      if (node instanceof Element) {
        restoreToOriginal(chatId, node);
      }
      saveState(state);
      renderAll();
    };

    const renderFolders = (candidates) => {
      folderList.innerHTML = "";
      const folders = Array.isArray(state.folders) ? state.folders : [];
      if (folders.length === 0) {
        const empty = document.createElement("div");
        empty.className = "webedit-folder-drop-empty";
        empty.textContent = "No folders yet";
        folderList.appendChild(empty);
        return;
      }
      folders.forEach((folder) => {
        const wrap = document.createElement("section");
        wrap.className = "webedit-folder";
        wrap.setAttribute("data-folder-id", folder.id);

        const head = document.createElement("div");
        head.className = "webedit-folder-head";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "webedit-folder-toggle";
        toggle.textContent = folder.name || "Folder";
        toggle.setAttribute("aria-expanded", folder.expanded ? "true" : "false");

        const actions = document.createElement("div");
        actions.style.display = "inline-flex";
        actions.style.gap = "6px";
        const rename = document.createElement("button");
        rename.type = "button";
        rename.className = "webedit-folder-rename";
        rename.textContent = "Rename";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "webedit-folder-delete";
        remove.textContent = "Delete";
        actions.appendChild(rename);
        actions.appendChild(remove);
        head.appendChild(toggle);
        head.appendChild(actions);

        const drop = document.createElement("div");
        drop.className = "webedit-folder-drop";
        if (!folder.expanded) drop.style.display = "none";

        const chips = document.createElement("div");
        chips.style.display = "flex";
        chips.style.flexWrap = "wrap";
        chips.style.gap = "6px";
        const movedNodes = document.createElement("div");
        movedNodes.setAttribute("data-webedit-folder-real-list", folder.id);
        movedNodes.style.display = "flex";
        movedNodes.style.flexDirection = "column";
        movedNodes.style.gap = "4px";

        const assigned = Object.entries(state.assignments || {})
          .filter(([, folderId]) => folderId === folder.id)
          .map(([chatId]) => chatId);
        if (!assigned.length) {
          const empty = document.createElement("div");
          empty.className = "webedit-folder-drop-empty";
          empty.textContent = "Select a chat and click here to assign";
          drop.appendChild(empty);
        } else {
          assigned.forEach((chatId) => {
            const chat = candidates.find((c) => c.id === chatId);
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "webedit-folder-chip";
            chip.textContent = `${chat?.text || chatId} ×`;
            chip.title = "Remove from folder";
            chip.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              unassignChat(chatId, candidates);
            });
            chips.appendChild(chip);
            moveAssignedNode(chatId, movedNodes, candidates);
          });
          const unassignHint = document.createElement("div");
          unassignHint.className = "webedit-folder-drop-empty";
          unassignHint.textContent = "Tip: click a chip to unassign.";
          unassignHint.style.marginTop = "4px";
          drop.appendChild(chips);
          drop.appendChild(unassignHint);
          drop.appendChild(movedNodes);
        }

        toggle.addEventListener("click", () => {
          folder.expanded = !folder.expanded;
          saveState(state);
          renderAll();
        });
        rename.addEventListener("click", () => {
          const nextName = prompt("Folder name", folder.name || "Folder");
          if (!nextName) return;
          const trimmed = nextName.trim();
          if (!trimmed) return;
          folder.name = trimmed;
          saveState(state);
          renderAll();
        });
        remove.addEventListener("click", () => {
          const removingId = folder.id;
          Object.entries(state.assignments || {}).forEach(([chatId, folderId]) => {
            if (folderId === removingId) {
              unassignChat(chatId, candidates);
            }
          });
          state.folders = state.folders.filter((f) => f.id !== removingId);
          saveState(state);
          renderAll();
        });
        drop.addEventListener("click", () => {
          const assignedIds = new Set(Object.keys(state.assignments || {}));
          const unassigned = candidates.filter((c) => !assignedIds.has(c.id));
          const chatIdToAssign = state.selectedChat || unassigned[0]?.id || "";
          if (!chatIdToAssign) return;
          state.assignments[chatIdToAssign] = folder.id;
          state.selectedChat = "";
          saveState(state);
          renderAll();
        });

        wrap.appendChild(head);
        wrap.appendChild(drop);
        folderList.appendChild(wrap);
      });
    };

    const renderAll = () => {
      const candidates = collectChatCandidates();
      if (state.selectedChat && !candidates.some((c) => c.id === state.selectedChat)) {
        state.selectedChat = "";
      }
      const validChatIds = new Set(candidates.map((c) => c.id));
      Object.keys(state.assignments || {}).forEach((chatId) => {
        if (!validChatIds.has(chatId)) {
          delete state.assignments[chatId];
        }
      });
      renderSourceList(candidates);
      renderFolders(candidates);
      saveState(state);
    };

    source.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-chat-id]");
      if (!item) return;
      const selected = item.getAttribute("data-chat-id") || "";
      state.selectedChat = state.selectedChat === selected ? "" : selected;
      saveState(state);
      renderAll();
    });
    newButton.addEventListener("click", () => {
      const now = Date.now();
      if (now - Number(hostState.lastCreateAt || 0) < 250) return;
      hostState.lastCreateAt = now;
      const defaultName = `Folder ${state.folders.length + 1}`;
      state.folders.push({
        id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: defaultName,
        expanded: true
      });
      saveState(state);
      renderAll();
    });
    renderAll();
  }
}

function insertNodes(target, nodes, position) {
  const pos = position || "inside";
  if (pos === "inside") {
    // Keep "inside" behavior intuitive: append within the selected section.
    nodes.forEach((n) => target.appendChild(n));
    return;
  }

  if (pos === "before") {
    nodes.forEach((n) => target.parentNode?.insertBefore(n, target));
    return;
  }

  if (pos === "after") {
    let ref = target;
    nodes.forEach((n) => {
      ref.parentNode?.insertBefore(n, ref.nextSibling);
      ref = n.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (n) : ref;
    });
    return;
  }

  if (pos === "replace") {
    const parent = target.parentNode;
    if (!parent) return;
    nodes.forEach((n) => parent.insertBefore(n, target));
    parent.removeChild(target);
  }
}

function bindBehaviorForMarker(spec, markerId, root = document) {
  const behavior = spec && spec.behavior ? spec.behavior : null;
  if (!behavior || !markerId) return;

  // Register behavior for delegated handlers (survives trigger remounts).
  behaviorRegistry.set(String(markerId), behavior);
  ensureDelegatedBehaviorHandlers(root);

  const triggerAttr = behavior.triggerAttr || "data-webedit-ai-action";
  const triggerValue = behavior.triggerValue || "toggle";
  const scopeKey = getScopeKey();
  const stateKey = getToggleStateKey(scopeKey, markerId);

  // Find triggers inside inserted nodes only.
  const containers = safeQueryAll(`[${INSERT_MARKER_ATTR}="${CSS.escape(markerId)}"]`, root);
  const triggers = [];
  containers.forEach((root) => {
    if (!(root instanceof Element)) return;
    // Use strict equality to match CSS selector behavior below (no trimming)
    if (root.hasAttribute(triggerAttr) && (root.getAttribute(triggerAttr) || "") === triggerValue) {
      triggers.push(root);
    }
    triggers.push(...Array.from(root.querySelectorAll(`[${CSS.escape(triggerAttr)}="${CSS.escape(triggerValue)}"]`)));
  });

  if (triggers.length === 0) return;

  // Basic layout constraint: if we inserted into a header/nav, pin the trigger to top-right.
  // This avoids overlap with chat inputs on some SPAs where the header is a flex row.
  try {
    const headerish = safeQueryAll("header, nav, [role='banner'], [role='navigation']", root);
    const isInHeader = containers.some((c) => headerish.some((h) => h.contains && h.contains(c)));
    if (isInHeader) {
      triggers.forEach((t) => {
        if (!(t instanceof Element)) return;
        // Only apply if not already positioned by AI CSS.
        const cs = window.getComputedStyle(t);
        if (cs.position === "static") {
          t.style.setProperty("position", "absolute", "important");
          t.style.setProperty("top", "8px", "important");
          t.style.setProperty("right", "8px", "important");
          t.style.setProperty("z-index", "2147483647", "important");
        }
      });
      // Ensure a positioning context exists.
      containers.forEach((c) => {
        if (!(c instanceof Element)) return;
        const parent = c.parentElement;
        if (!parent) return;
        const ps = window.getComputedStyle(parent);
        if (ps.position === "static") {
          parent.style.setProperty("position", "relative", "important");
        }
      });
      console.log("[WebEdit AI] Applied header layout constraints for behavior trigger", { markerId });
    }
  } catch (_) {}

  const updateTriggerLabel = (trigger, isExpanded) => {
    const expandedLabel = (behavior.expandedLabel || "").trim();
    const collapsedLabel = (behavior.collapsedLabel || "").trim();
    const label = isExpanded ? expandedLabel : collapsedLabel;
    if (label) {
      trigger.setAttribute("title", label);
      trigger.setAttribute("aria-label", label);
    }
    trigger.setAttribute("aria-pressed", String(!!isExpanded));
  };

  const resolveTarget = () => {
    const nodes = safeQueryAll(behavior.targetSelector);
    return pickBestElement(nodes);
  };

  triggers.forEach((trigger) => {
    if (!(trigger instanceof Element)) return;
    if (trigger.getAttribute(BOUND_MARKER_ATTR) === "1") return;
    trigger.setAttribute(BOUND_MARKER_ATTR, "1");

    if (!trigger.hasAttribute("tabindex")) {
      trigger.setAttribute("tabindex", "0");
    }
    if (!trigger.hasAttribute("role")) {
      trigger.setAttribute("role", "button");
    }

    // Restore state on reload (best-effort)
    let stored = null;
    try { stored = localStorage.getItem(stateKey); } catch (_) {}
    const wantExpanded = stored === "1";

    if (wantExpanded) {
      try {
        if (behavior.type === "toggleClass" && behavior.className) {
          const target = resolveTarget();
          if (target) target.classList.add(behavior.className);
        } else if (behavior.type === "toggleStyles") {
          const target = resolveTarget();
          if (target) {
            target.setAttribute("data-webedit-ai-style-state", "on");
            const stylesOn = behavior.stylesOn || {};
            for (const [k, v] of Object.entries(stylesOn)) {
              const prop = String(k || "").trim();
              if (!prop) continue;
              if (v) target.style.setProperty(prop, String(v), "important");
            }
          }
        }
      } catch (_) {}
    }

    updateTriggerLabel(trigger, wantExpanded);
  });
}

function ensureDelegatedBehaviorHandlers(root = document) {
  const targetRoot = root instanceof ShadowRoot ? root : document;
  if (delegatedBehaviorRoots.has(targetRoot)) return;
  delegatedBehaviorRoots.add(targetRoot);
  if (targetRoot === document) {
    delegatedBehaviorHandlerInstalled = true;
  }

  const handleTrigger = (triggerEl) => {
    const container = triggerEl.closest(`[${INSERT_MARKER_ATTR}]`);
    const markerId = container ? container.getAttribute(INSERT_MARKER_ATTR) : null;
    if (!markerId) return;
    const behavior = behaviorRegistry.get(String(markerId));
    if (!behavior) return;

    const scopeKey = getScopeKey();
    const stateKey = getToggleStateKey(scopeKey, markerId);
    const expandedLabel = (behavior.expandedLabel || "").trim();
    const collapsedLabel = (behavior.collapsedLabel || "").trim();

    const updateLabel = (isExpanded) => {
      const label = isExpanded ? expandedLabel : collapsedLabel;
      if (label) {
        triggerEl.setAttribute("title", label);
        triggerEl.setAttribute("aria-label", label);
      }
      triggerEl.setAttribute("aria-pressed", String(!!isExpanded));
    };

    const resolveTarget = () => {
      const nodes = safeQueryAll(behavior.targetSelector, targetRoot);
      return pickBestElement(nodes);
    };

    if (behavior.type === "toggleClass") {
      const target = resolveTarget();
      if (!target) return;
      const className = behavior.className;
      if (!className) return;
      const next = !target.classList.contains(className);
      target.classList.toggle(className, next);
      updateLabel(next);
      try { localStorage.setItem(stateKey, next ? "1" : "0"); } catch (_) {}
      return;
    }

    if (behavior.type === "toggleStyles") {
      const target = resolveTarget();
      if (!target) return;
      const stylesOn = behavior.stylesOn || {};
      const stylesOff = behavior.stylesOff || {};
      const isOn = target.getAttribute("data-webedit-ai-style-state") === "on";
      const nextOn = !isOn;
      const chosen = nextOn ? stylesOn : stylesOff;
      for (const [k, v] of Object.entries(chosen)) {
        const prop = String(k || "").trim();
        if (!prop) continue;
        if (v) {
          target.style.setProperty(prop, String(v), "important");
        } else {
          target.style.removeProperty(prop);
        }
      }
      target.setAttribute("data-webedit-ai-style-state", nextOn ? "on" : "off");
      updateLabel(nextOn);
      try { localStorage.setItem(stateKey, nextOn ? "1" : "0"); } catch (_) {}
    }
  };

  targetRoot.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('[data-webedit-ai-action="toggle"]');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    handleTrigger(trigger);
  }, true);

  targetRoot.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('[data-webedit-ai-action="toggle"]');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    handleTrigger(trigger);
  }, true);
}

function summarizeSpec(spec) {
  const selector = spec.selector || spec.targetSelector || "";
  if (spec.action === "hide") return `Hide ${selector}`;
  if (spec.action === "customize") return `Customize ${selector}`;
  if (spec.action === "text") return `Text ${selector}`;
  if (spec.action === "add") return `Add to ${selector}`;
  return "Applied edit";
}

async function loadPersistedSpecs(scopeKey) {
  if (!isExtensionContextValid()) return [];
  return new Promise((resolve) => {
    chrome.storage.local.get([FEATURE_SPEC_STORAGE_KEY], (result) => {
      const store = result?.[FEATURE_SPEC_STORAGE_KEY] || {};
      const list = Array.isArray(store?.[scopeKey]) ? store[scopeKey] : [];
      resolve(list);
    });
  });
}

async function savePersistedSpecs(scopeKey, list) {
  if (!isExtensionContextValid()) return false;
  return new Promise((resolve) => {
    chrome.storage.local.get([FEATURE_SPEC_STORAGE_KEY], (result) => {
      const store = result?.[FEATURE_SPEC_STORAGE_KEY] || {};
      store[scopeKey] = Array.isArray(list) ? list : [];
      chrome.storage.local.set({ [FEATURE_SPEC_STORAGE_KEY]: store }, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  });
}

function getScopeKey() {
  // Keep simple and consistent with existing approach (hostname + pathname)
  return getPageKey();
}

// In-memory stacks (per tab/page instance)
const undoStack = [];
const redoStack = [];

async function applyFeatureSpec(spec, options = {}) {
  const replay = !!options.replay;
  const preview = !!options.preview;
  const skipPersist = !!options.skipPersist || preview;
  const id = options.id || spec._webeditId || spec.id || uuid();
  const timestamp = Date.now();
  const root = options.root || document;
  const targetOverride = options.targetOverride || null;

  try {
    if (spec.action === "hide") {
      const nodes = targetOverride ? [targetOverride] : safeQueryAll(spec.selector, root);
      const el = targetOverride || pickBestElement(nodes);
      if (!el) return { ok: false, error: `Could not find element for selector: ${spec.selector}` };

      const previousDisplay = el.style.getPropertyValue("display");
      const previousPriority = el.style.getPropertyPriority("display");
      const previousAttr = el.getAttribute(HIDE_MARKER_ATTR);

      el.style.setProperty("display", "none", "important");
      el.setAttribute(HIDE_MARKER_ATTR, id);

      const applied = { id, spec, timestamp, undo: { action: "hide", selector: spec.selector, previousDisplay, previousPriority, previousAttr } };
      if (!replay && !skipPersist) {
        undoStack.push(applied);
        redoStack.length = 0;
        await persistAppend(spec);
      }
      return { ok: true, applied };
    }

    if (spec.action === "customize") {
      const nodes = targetOverride ? [targetOverride] : safeQueryAll(spec.selector, root);
      const el = targetOverride || pickBestElement(nodes);
      if (!el) return { ok: false, error: `Could not find element for selector: ${spec.selector}` };

      const styles = spec.styles || {};
      const previous = {};
      const previousPriority = {};

      for (const [k, v] of Object.entries(styles)) {
        const prop = k.trim();
        if (!prop) continue;
        previous[prop] = el.style.getPropertyValue(prop);
        previousPriority[prop] = el.style.getPropertyPriority(prop);
        el.style.setProperty(prop, String(v), "important");
      }

      const applied = { id, spec, timestamp, undo: { action: "customize", selector: spec.selector, previous, previousPriority } };
      if (!replay && !skipPersist) {
        undoStack.push(applied);
        redoStack.length = 0;
        await persistAppend(spec);
      }
      return { ok: true, applied };
    }

    if (spec.action === "text") {
      const nodes = targetOverride ? [targetOverride] : safeQueryAll(spec.selector, root);
      const el = targetOverride || pickBestElement(nodes);
      if (!el) return { ok: false, error: `Could not find element for selector: ${spec.selector}` };

      const position = spec.position || "replace";
      const content = spec.content || "";
      if (!content) return { ok: false, error: "Invalid spec: missing content" };

      if (position === "replace") {
        const previousText = el.textContent;
        el.textContent = content;
        const applied = { id, spec, timestamp, undo: { action: "text-replace", selector: spec.selector, previousText } };
        if (!replay && !skipPersist) {
          undoStack.push(applied);
          redoStack.length = 0;
          await persistAppend(spec);
        }
        return { ok: true, applied };
      }

      const node = document.createTextNode(content);
      const markerSpan = document.createElement("span");
      markerSpan.setAttribute(INSERT_MARKER_ATTR, id);
      markerSpan.appendChild(node);

      if (position === "inside") {
        el.appendChild(markerSpan);
      } else if (position === "before") {
        el.parentNode?.insertBefore(markerSpan, el);
      } else if (position === "after") {
        el.parentNode?.insertBefore(markerSpan, el.nextSibling);
      } else {
        return { ok: false, error: `Invalid text position: ${position}` };
      }

      const applied = { id, spec, timestamp, undo: { action: "text-insert", markerId: id } };
      if (!replay && !skipPersist) {
        undoStack.push(applied);
        redoStack.length = 0;
        await persistAppend(spec);
      }
      return { ok: true, applied };
    }

    if (spec.action === "add") {
      const targetSel = spec.targetSelector || spec.selector;
      const nodes = targetOverride ? [targetOverride] : safeQueryAll(targetSel, root);
      const el = targetOverride || pickBestElement(nodes);
      if (!el) return { ok: false, error: `Could not find target for selector: ${targetSel}` };

      // If this spec already rendered for this id, remove stale nodes/styles first.
      // This is required for preview placement changes (before/inside/after/replace).
      const already = safeQueryAll(`[${INSERT_MARKER_ATTR}="${CSS.escape(id)}"]`, root);
      if (already.length > 0) {
        already.forEach((node) => {
          try {
            if (node && node.parentNode) node.parentNode.removeChild(node);
          } catch (_) {}
        });
        const styleEls = safeQueryAll(`style[${STYLE_MARKER_ATTR}="${CSS.escape(id)}"]`, root);
        styleEls.forEach((elStyle) => {
          try {
            if (elStyle && elStyle.parentNode) elStyle.parentNode.removeChild(elStyle);
          } catch (_) {}
        });
      }

      const position = spec.position || "inside";
      const generatedModule = spec.generated_module || null;
      const controllerName = generatedModule?.controller || "";
      const html = ((spec.html || generatedModule?.html || "") + "").trim();
      const content = (spec.content || "").trim();
      const css = typeof spec.css === "string" ? spec.css : (typeof generatedModule?.css === "string" ? generatedModule.css : "");
      const js = typeof spec.js === "string" ? spec.js : (typeof generatedModule?.js === "string" ? generatedModule.js : "");

      let nodesToInsert = [];
      if (html) {
        nodesToInsert = createNodesFromHtml(html, id);
      } else {
        const wrapper = document.createElement("div");
        wrapper.setAttribute(INSERT_MARKER_ATTR, id);
        wrapper.textContent = content;
        nodesToInsert = [wrapper];
      }

      // For replace, store a snapshot for undo (best-effort).
      const replacedOuterHTML = position === "replace" ? el.outerHTML : null;

      // Keep a single live Gemini folder module to avoid accidental duplicate mounts.
      if (!preview && controllerName === "folderGeminiController") {
        const existingModules = safeQueryAll("[data-webedit-folder-module='1']", root);
        existingModules.forEach((moduleNode) => {
          const container = moduleNode.closest(`[${INSERT_MARKER_ATTR}]`) || moduleNode;
          const containerMarker = container?.getAttribute?.(INSERT_MARKER_ATTR) || "";
          if (containerMarker === String(id)) return;
          try {
            if (container && container.parentNode) container.parentNode.removeChild(container);
          } catch (_) {}
        });
      }

      // Inject CSS (if present) before insertion so initial paint has styles.
      const injectedStyle = injectCss(css, id, root);
      insertNodes(el, nodesToInsert, position);

      // Bind safe behavior triggers inside inserted content (click handlers implemented by the extension).
      try {
        bindBehaviorForMarker(spec, id, root);
      } catch (e) {
        console.warn("[WebEdit AI] Failed to bind behavior:", e?.message || e);
      }
      try {
        bindControllerForMarker(spec, id, root, { preview });
      } catch (e) {
        console.warn("[WebEdit AI] Failed to bind controller:", e?.message || e);
      }
      if (js) {
        runScopedScript(js, root);
      }

      const validationFailures = collectValidationFailures(spec, root);
      if (preview && validationFailures.length > 0) {
        return {
          ok: false,
          stage: "validation",
          error: validationFailures[0].message,
          failures: validationFailures
        };
      }

      const applied = {
        id,
        spec,
        timestamp,
        migration: {
          schemaVersion: spec?.metadata?.schemaVersion || FEATURE_SPEC_SCHEMA_VERSION,
          strategy: spec?.undo_strategy?.mode || "dom-revert"
        },
        undo: {
          action: "add",
          markerId: id,
          replacedOuterHTML,
          targetSelector: targetSel,
          position,
          hadStyle: !!injectedStyle,
          controllerCleanup: spec?.generated_module?.controller
            ? { controller: spec.generated_module.controller }
            : null,
          behaviorCleanup: spec.behavior ? (
            spec.behavior.type === "toggleClass"
              ? { type: "toggleClass", targetSelector: spec.behavior.targetSelector, className: spec.behavior.className }
              : spec.behavior.type === "toggleStyles"
                ? { type: "toggleStyles", targetSelector: spec.behavior.targetSelector, stylesOn: spec.behavior.stylesOn, stylesOff: spec.behavior.stylesOff }
                : null
          ) : null
        }
      };
      if (!replay) {
        if (!skipPersist) {
          undoStack.push(applied);
          redoStack.length = 0;
          await persistAppend(spec, applied.migration);
        }
      }
      return { ok: true, applied };
    }

    return { ok: false, error: `Unsupported action: ${spec.action}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to apply spec" };
  }
}

async function persistAppend(spec, migration = null) {
  const scopeKey = getScopeKey();
  const list = await loadPersistedSpecs(scopeKey);
  const entryId = spec._webeditId || spec.id || uuid();
  list.push({
    id: entryId,
    spec: { ...spec, _webeditId: entryId },
    timestamp: Date.now(),
    migration: migration || {
      schemaVersion: spec?.metadata?.schemaVersion || FEATURE_SPEC_SCHEMA_VERSION,
      strategy: "dom-revert"
    }
  });
  await savePersistedSpecs(scopeKey, list);
}

async function persistPopLast() {
  const scopeKey = getScopeKey();
  const list = await loadPersistedSpecs(scopeKey);
  if (list.length === 0) return;
  list.pop();
  await savePersistedSpecs(scopeKey, list);
}

async function undoLast() {
  const change = undoStack.pop();
  if (!change) return { ok: false, error: "Nothing to undo" };
  return undoEntry(change);
}

async function undoById(id) {
  const index = undoStack.findIndex((c) => c.id === id);
  if (index === -1) return { ok: false, error: `Change not found: ${id}` };
  const [change] = undoStack.splice(index, 1);
  return undoEntry(change);
}

async function undoEntry(change) {
  try {
    const u = change.undo || {};
    if (u.action === "hide") {
      const nodes = safeQueryAll(u.selector);
      const el = pickBestElement(nodes);
      if (el) {
        if (u.previousDisplay) {
          el.style.setProperty("display", u.previousDisplay, u.previousPriority || "");
        } else {
          el.style.removeProperty("display");
        }
        if (u.previousAttr === null || typeof u.previousAttr === "undefined") {
          el.removeAttribute(HIDE_MARKER_ATTR);
        } else {
          el.setAttribute(HIDE_MARKER_ATTR, u.previousAttr);
        }
      }
    } else if (u.action === "customize") {
      const nodes = safeQueryAll(u.selector);
      const el = pickBestElement(nodes);
      if (el) {
        for (const [prop, prevVal] of Object.entries(u.previous || {})) {
          const prevPrio = (u.previousPriority || {})[prop] || "";
          if (prevVal) {
            el.style.setProperty(prop, prevVal, prevPrio);
          } else {
            el.style.removeProperty(prop);
          }
        }
      }
    } else if (u.action === "text-replace") {
      const nodes = safeQueryAll(u.selector);
      const el = pickBestElement(nodes);
      if (el) el.textContent = u.previousText ?? "";
    } else if (u.action === "text-insert" || u.action === "add") {
      const markerId = u.markerId;
      if (markerId) {
        const toRemove = safeQueryAll(`[${INSERT_MARKER_ATTR}="${CSS.escape(markerId)}"]`);
        toRemove.forEach((el) => el.remove());

        const styleEls = safeQueryAll(`style[${STYLE_MARKER_ATTR}="${CSS.escape(markerId)}"]`);
        styleEls.forEach((el) => el.remove());
      }

      if (u.action === "add" && u.behaviorCleanup) {
        if (u.behaviorCleanup.type === "toggleClass") {
          const sel = u.behaviorCleanup.targetSelector;
          const cls = u.behaviorCleanup.className;
          if (sel && cls) {
            const targets = safeQueryAll(sel);
            targets.forEach((t) => {
              try { t.classList.remove(cls); } catch (_) {}
            });
          }
        } else if (u.behaviorCleanup.type === "toggleStyles") {
          const sel = u.behaviorCleanup.targetSelector;
          const keys = new Set([
            ...Object.keys(u.behaviorCleanup.stylesOn || {}),
            ...Object.keys(u.behaviorCleanup.stylesOff || {})
          ]);
          if (sel && keys.size > 0) {
            const targets = safeQueryAll(sel);
            targets.forEach((t) => {
              try {
                keys.forEach(k => t.style.removeProperty(k));
                t.removeAttribute("data-webedit-ai-style-state");
              } catch (_) {}
            });
          }
        }
      }

      if (u.action === "add" && u.controllerCleanup && u.markerId) {
        try { localStorage.removeItem(getControllerStateKey(getScopeKey(), u.markerId)); } catch (_) {}
      }

      if (u.action === "add" && u.position === "replace" && typeof u.replacedOuterHTML === "string") {
        const targets = safeQueryAll(u.targetSelector);
        const target = pickBestElement(targets);
        // Best-effort restore if target still exists in DOM; if not, skip.
        if (target && target.parentNode) {
          const template = document.createElement("template");
          template.innerHTML = u.replacedOuterHTML;
          const restored = template.content.firstChild;
          if (restored) {
            target.parentNode.insertBefore(restored, target);
          }
        }
      }
    }

    redoStack.push(change);
    // Remove from persistent storage too
    const scopeKey = getScopeKey();
    const list = await loadPersistedSpecs(scopeKey);
    const newList = list.filter((item) => item.spec?.id !== change.spec?.id && item.id !== change.id);
    await savePersistedSpecs(scopeKey, newList);

    return { ok: true, undone: change };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Undo failed" };
  }
}

async function redoLast() {
  const change = redoStack.pop();
  if (!change) return { ok: false, error: "Nothing to redo" };
  const result = await applyFeatureSpec(change.spec, { replay: false });
  if (!result.ok) return result;
  return { ok: true, redone: result.applied };
}

async function restoreAndReplay() {
  const scopeKey = getScopeKey();
  const entries = await loadPersistedSpecs(scopeKey);
  let applied = 0;
  for (const entry of entries) {
    const spec = entry?.spec;
    if (!spec) continue;
    const persistenceMode = String(spec?.metadata?.persistenceMode || "").toLowerCase();
    const featureClass = String(spec?.metadata?.featureClass || "").toLowerCase();
    if (persistenceMode === "cloud_only" || featureClass === "gemini-folder") {
      // Cloud-authoritative features are restored by cloud replay path only.
      continue;
    }
    // Replay mode: do not push onto stacks or persist again.
    // Validation happens in contentScript before persistence, but keep guard here.
    const parsed = typeof window.parseFeatureSpec === "function" ? window.parseFeatureSpec(spec) : { ok: true, spec };
    if (!parsed.ok) continue;
    const result = await applyFeatureSpec(parsed.spec, { replay: true });
    if (result.ok) applied += 1;
  }
  return { ok: true, applied };
}

function getPageContext() {
  const getPagePlainText = () => {
    const text = document.body?.innerText || "";
    return text.slice(0, 5000).trim();
  };
  const summarizeEl = (el) => {
    const rect = el.getBoundingClientRect();
    const classList = Array.from(el.classList || [])
      .filter(c => c.length < 50) // Filter out massive Tailwind/utility chains
      .slice(0, 5);
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const role = el.getAttribute ? (el.getAttribute("role") || "") : "";
    const ariaLabel = el.getAttribute ? (el.getAttribute("aria-label") || "") : "";
    const testId = el.getAttribute ? (el.getAttribute("data-testid") || el.getAttribute("data-test") || "") : "";
    const name = el.getAttribute ? (el.getAttribute("name") || "") : "";
    const placeholder = el.getAttribute ? (el.getAttribute("placeholder") || "") : "";
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: classList,
      role,
      ariaLabel,
      testId,
      name,
      placeholder,
      text,
      box: { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) }
    };
  };

  const regions = [];
  const regionSelectors = [
    "header",
    "nav",
    "aside",
    "main",
    "footer",
    "[role='banner']",
    "[role='navigation']",
    "[role='complementary']",
    "[role='main']",
    "[role='contentinfo']"
  ];

  const seen = new Set();
  for (const sel of regionSelectors) {
    const el = document.querySelector(sel);
    if (el && !seen.has(el)) {
      seen.add(el);
      regions.push({ selector: sel, ...summarizeEl(el) });
    }
  }

  const notable = [];
  const notableEls = Array.from(document.querySelectorAll("button, a, input, textarea, select, [role='button'], aside, nav"))
    .slice(0, 150);

  for (const el of notableEls) {
    if (!isVisibleElement(el)) continue;
    const info = summarizeEl(el);
    // Add a tiny hint for links/buttons
    if (el.tagName === "A") info.href = el.getAttribute("href") || "";
    if (el.tagName === "INPUT") info.type = el.getAttribute("type") || "";
    notable.push(info);
    if (notable.length >= 30) break;
  }

  return {
    url: window.location.href,
    title: document.title || "",
    text: getPagePlainText(),
    activeSpecs: undoStack.map(c => ({
      id: c.id,
      spec: c.spec,
      timestamp: c.timestamp
    })),
    outline: {
      regions,
      notable
    }
  };
}

if (typeof window !== "undefined") {
  window.FeatureSpecExecutor = {
    applyFeatureSpec,
    undoLast,
    undoById,
    redoLast,
    restoreAndReplay,
    getPageContext,
    summarizeSpec
  };
  console.log("✅ FeatureSpec executor loaded");
}


