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

  function assessCapabilities(selector = "") {
    const anchor = selector ? safeQuery(selector) : null;
    const body = document.body || document.documentElement;
    const visibleButtons = Array.from(document.querySelectorAll("button,[role='button'],a,input,textarea,select"))
      .filter((el) => {
        if (!(el instanceof Element)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      });
    const hasStableAnchor = !!anchor;
    const supportsStorage = typeof chrome !== "undefined" && !!chrome.storage?.local;
    const supportsObserver = typeof MutationObserver !== "undefined";
    const supportsPointerEvents = typeof window.PointerEvent !== "undefined";
    // Folder flows support click-based assignment fallback, so hard DnD support is not required.
    const supportsDnDPrimitives = true;
    const hasInteractiveDensity = visibleButtons.length >= 2;

    const checks = [
      { key: "stableAnchor", ok: hasStableAnchor, reason: hasStableAnchor ? "" : "No stable anchor selected." },
      { key: "storage", ok: supportsStorage, reason: supportsStorage ? "" : "Extension storage is unavailable." },
      { key: "observer", ok: supportsObserver, reason: supportsObserver ? "" : "DOM observer support missing." },
      { key: "dragDrop", ok: supportsDnDPrimitives, reason: supportsDnDPrimitives ? "" : "Drag/drop primitives are unavailable." },
      { key: "interactiveDensity", ok: hasInteractiveDensity, reason: hasInteractiveDensity ? "" : "Page has very low interactive density." }
    ];

    const failed = checks.filter((c) => !c.ok);
    const capabilityScore = Math.max(0, Math.round(((checks.length - failed.length) / checks.length) * 100));
    const recommendation = capabilityScore >= 75
      ? "full_feature_generation"
      : capabilityScore >= 45
        ? "guided_decomposition"
        : "simplified_ui_only";

    return {
      ok: true,
      capability: {
        capabilityScore,
        recommendation,
        checks,
        warnings: failed.map((c) => c.reason),
        environment: {
          url: location.href,
          title: document.title || "",
          bodyTag: body?.tagName?.toLowerCase() || "unknown",
          anchorSelector: selector || null
        }
      }
    };
  }

  return { extractContext, assessCapabilities };
})();

if (typeof window !== "undefined") {
  window.ContextExtractor = ContextExtractor;
  console.log("✅ ContextExtractor loaded");
}

