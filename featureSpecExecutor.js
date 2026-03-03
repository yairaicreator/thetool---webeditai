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

function bindControllerForMarker(spec, markerId, root = document, options = {}) { return; }

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

      if (previousDisplay !== "none" || previousPriority !== "important") {
        el.style.setProperty("display", "none", "important");
      }
      if (previousAttr !== String(id)) {
        el.setAttribute(HIDE_MARKER_ATTR, id);
      }

      const applied = { id, spec, timestamp, undo: { action: "hide", selector: spec.selector, previousDisplay, previousPriority, previousAttr } };
      if (!replay) {
        undoStack.push(applied);
        redoStack.length = 0;
        if (!skipPersist) {
          await persistAppend(spec);
        }
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
        const strV = String(v);
        if (previous[prop] !== strV || previousPriority[prop] !== "important") {
          el.style.setProperty(prop, strV, "important");
        }
      }

      const applied = { id, spec, timestamp, undo: { action: "customize", selector: spec.selector, previous, previousPriority } };
      if (!replay) {
        undoStack.push(applied);
        redoStack.length = 0;
        if (!skipPersist) {
          await persistAppend(spec);
        }
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
        if (el.textContent !== content) {
          el.textContent = content;
        }
        const applied = { id, spec, timestamp, undo: { action: "text-replace", selector: spec.selector, previousText } };
        if (!replay) {
          undoStack.push(applied);
          redoStack.length = 0;
          if (!skipPersist) {
            await persistAppend(spec);
          }
        }
        return { ok: true, applied };
      }

      // Check if already injected
      const already = safeQueryAll(`[${INSERT_MARKER_ATTR}="${CSS.escape(id)}"]`, root);
      if (already.length > 0 && replay && skipPersist) {
        return { ok: true, applied: { id, spec, timestamp, undo: { action: "text-insert", markerId: id } } };
      }
      if (already.length > 0) {
        already.forEach((node) => {
          try {
            if (node && node.parentNode) node.parentNode.removeChild(node);
          } catch (_) {}
        });
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
      if (!replay) {
        undoStack.push(applied);
        redoStack.length = 0;
        if (!skipPersist) {
          await persistAppend(spec);
        }
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
      fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e76c3f'},body:JSON.stringify({sessionId:'e76c3f',hypothesisId:'H6',location:'featureSpecExecutor.js:applyFeatureSpec:already',message:'Checking existing nodes',data:{id, alreadyCount: already.length, replay, skipPersist},timestamp:Date.now()})}).catch(()=>{});

      // Prevent MutationObserver infinite loops during SPA remounts
      if (already.length > 0 && replay && skipPersist) {
         return { ok: true, applied: { id, spec, timestamp, skipped: true, undo: { action: "add", markerId: id } } };
      }

      if (already.length > 0) {
        if (!preview && !replay) {
          // If the injected nodes are already in the DOM, skip re-insertion to avoid MutationObserver infinite loops.
          return { ok: true, applied: { id, spec, timestamp, skipped: true, undo: { action: "add", markerId: id } } };
        }
        
        // When reapplying an element (either due to preview updating or some other valid re-insertion),
        // we must remove the existing nodes first to prevent duplication.
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
      
      try {
        const oldStyles = document.querySelectorAll(`style[data-webedit-ai-style-id="${cssEscapeSafe(id)}"]`);
        oldStyles.forEach(el => el.remove());
      } catch (e) {}

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

      const doInsertNodes = (target, nodes, pos) => {
        if (pos === "inside") {
          nodes.forEach((n) => target.appendChild(n));
        } else if (pos === "before") {
          nodes.forEach((n) => target.parentNode?.insertBefore(n, target));
        } else if (pos === "after") {
          nodes.reverse().forEach((n) => target.parentNode?.insertBefore(n, target.nextSibling));
        } else if (pos === "replace") {
          const parent = target.parentNode;
          if (parent) {
            nodes.forEach((n) => parent.insertBefore(n, target));
            parent.removeChild(target);
          }
        }
      };

      doInsertNodes(el, nodesToInsert, position);

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
        undoStack.push(applied);
        redoStack.length = 0;
        if (!skipPersist) {
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


