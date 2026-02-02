// WebEdit AI - FeatureSpec Executor + Undo/Redo + Persistence (no-build safe)
// Loaded as a classic script; exposes FeatureSpecExecutor on window.

const FEATURE_SPEC_STORAGE_KEY = "webeditFeatureSpecs";
const INSERT_MARKER_ATTR = "data-webedit-ai-insert-id";
const HIDE_MARKER_ATTR = "data-webedit-ai-hidden-id";
const STYLE_MARKER_ATTR = "data-webedit-ai-style-id";
const BOUND_MARKER_ATTR = "data-webedit-ai-bound";
const TOGGLE_STATE_PREFIX = "webeditAiToggleState::";
const behaviorRegistry = new Map(); // markerId -> behavior
let delegatedBehaviorHandlerInstalled = false;

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

function safeQueryAll(selector) {
  if (!selector) return [];
  try {
    return Array.from(document.querySelectorAll(selector));
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

function injectCss(cssText, markerId) {
  const css = typeof cssText === "string" ? cssText : "";
  if (!css.trim()) return null;

  const head = document.head || document.documentElement;
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

function insertNodes(target, nodes, position) {
  const pos = position || "inside";
  if (pos === "inside") {
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

function bindBehaviorForMarker(spec, markerId) {
  const behavior = spec && spec.behavior ? spec.behavior : null;
  if (!behavior || !markerId) return;

  // Register behavior for delegated handlers (survives trigger remounts).
  behaviorRegistry.set(String(markerId), behavior);
  ensureDelegatedBehaviorHandlers();

  const triggerAttr = behavior.triggerAttr || "data-webedit-ai-action";
  const triggerValue = behavior.triggerValue || "toggle";
  const scopeKey = getScopeKey();
  const stateKey = getToggleStateKey(scopeKey, markerId);

  // Find triggers inside inserted nodes only.
  const containers = safeQueryAll(`[${INSERT_MARKER_ATTR}="${CSS.escape(markerId)}"]`);
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
    const headerish = safeQueryAll("header, nav, [role='banner'], [role='navigation']");
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

function ensureDelegatedBehaviorHandlers() {
  if (delegatedBehaviorHandlerInstalled) return;
  delegatedBehaviorHandlerInstalled = true;

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
      const nodes = safeQueryAll(behavior.targetSelector);
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

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('[data-webedit-ai-action="toggle"]');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    handleTrigger(trigger);
  }, true);

  document.addEventListener("keydown", (e) => {
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
  const skipPersist = !!options.skipPersist;
  const id = options.id || spec._webeditId || spec.id || uuid();
  const timestamp = Date.now();

  try {
    if (spec.action === "hide") {
      const nodes = safeQueryAll(spec.selector);
      const el = pickBestElement(nodes);
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
      const nodes = safeQueryAll(spec.selector);
      const el = pickBestElement(nodes);
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
      const nodes = safeQueryAll(spec.selector);
      const el = pickBestElement(nodes);
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
      const nodes = safeQueryAll(targetSel);
      const el = pickBestElement(nodes);
      if (!el) return { ok: false, error: `Could not find target for selector: ${targetSel}` };

      // Idempotency: if this spec has already inserted nodes for this id, do not insert again.
      const already = safeQueryAll(`[${INSERT_MARKER_ATTR}="${CSS.escape(id)}"]`);
      if (already.length > 0) {
        try { bindBehaviorForMarker(spec, id); } catch (_) {}
        return { ok: true, applied: { id, spec, timestamp, replayed: true } };
      }

      const position = spec.position || "inside";
      const html = (spec.html || "").trim();
      const content = (spec.content || "").trim();
      const css = typeof spec.css === "string" ? spec.css : "";

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

      // Inject CSS (if present) before insertion so initial paint has styles.
      const injectedStyle = injectCss(css, id);
      insertNodes(el, nodesToInsert, position);

      // Bind safe behavior triggers inside inserted content (click handlers implemented by the extension).
      try {
        bindBehaviorForMarker(spec, id);
      } catch (e) {
        console.warn("[WebEdit AI] Failed to bind behavior:", e?.message || e);
      }

      const applied = {
        id,
        spec,
        timestamp,
        undo: {
          action: "add",
          markerId: id,
          replacedOuterHTML,
          targetSelector: targetSel,
          position,
          hadStyle: !!injectedStyle,
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
          await persistAppend(spec);
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

async function persistAppend(spec) {
  const scopeKey = getScopeKey();
  const list = await loadPersistedSpecs(scopeKey);
  const entryId = spec._webeditId || spec.id || uuid();
  list.push({ id: entryId, spec: { ...spec, _webeditId: entryId }, timestamp: Date.now() });
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


