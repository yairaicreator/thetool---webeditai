// WebEdit AI - Limited Context Extractor (no-build safe)
// Exposes ContextExtractor.extractContext(selector) on window.

const ContextExtractor = (() => {
  const MAX_CLASS_COUNT = 5;

  function safeQuery(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function pickStyles(style) {
    if (!style) return {};
    return {
      fontFamily: style.fontFamily || "",
      fontSize: style.fontSize || "",
      fontWeight: style.fontWeight || "",
      lineHeight: style.lineHeight || "",
      color: style.color || "",
      backgroundColor: style.backgroundColor || "",
      padding: style.padding || "",
      margin: style.margin || "",
      borderRadius: style.borderRadius || "",
      display: style.display || "",
      position: style.position || "",
      width: style.width || "",
      height: style.height || ""
    };
  }

  function summarizeElement(el) {
    if (!el || !(el instanceof Element)) return null;
    const rect = el.getBoundingClientRect();
    const classList = Array.from(el.classList || []).slice(0, MAX_CLASS_COUNT);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: classList,
      role: el.getAttribute("role") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      box: {
        x: Math.round(rect.x || 0),
        y: Math.round(rect.y || 0),
        w: Math.round(rect.width || 0),
        h: Math.round(rect.height || 0)
      }
    };
  }

  function extractContext(selector) {
    const el = safeQuery(selector);
    if (!el) {
      return { ok: false, error: "Target element not found" };
    }
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const parent = el.parentElement || null;
    const grandParent = parent?.parentElement || null;

    const context = {
      selector,
      boundingBox: {
        x: Math.round(rect.x || 0),
        y: Math.round(rect.y || 0),
        w: Math.round(rect.width || 0),
        h: Math.round(rect.height || 0)
      },
      computedStyles: pickStyles(style),
      parentInfo: {
        level1: summarizeElement(parent),
        level2: summarizeElement(grandParent)
      }
    };

    return { ok: true, context };
  }

  return { extractContext };
})();

if (typeof window !== "undefined") {
  window.ContextExtractor = ContextExtractor;
  console.log("✅ ContextExtractor loaded");
}

