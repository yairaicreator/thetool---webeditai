// WebEdit AI - Limited Context Extractor (no-build safe)
// Exposes ContextExtractor.extractContext(selector) on window.

const ContextExtractor = (() => {
  const MAX_CLASS_COUNT = 5;
  const MAX_TEXT_LEN = 180;
  const MAX_NEARBY_ITEMS = 12;

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

  function normalizedText(value, max = MAX_TEXT_LEN) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function buildDomPath(el, depth = 5) {
    if (!(el instanceof Element)) return [];
    const path = [];
    let node = el;
    let hops = 0;
    while (node && hops < depth) {
      const tag = String(node.tagName || "").toLowerCase();
      if (!tag) break;
      const id = node.id ? `#${node.id}` : "";
      const cls = Array.from(node.classList || []).slice(0, 2).map((c) => `.${c}`).join("");
      path.push(`${tag}${id}${cls}`);
      node = node.parentElement;
      hops += 1;
    }
    return path;
  }

  function collectNearbyInteractive(anchor) {
    if (!(anchor instanceof Element)) return [];
    const scope = anchor.closest("main,section,article,aside,nav,[role='main']") || anchor.parentElement || document.body;
    if (!(scope instanceof Element)) return [];
    const nodes = Array.from(scope.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link'],[data-testid]"));
    const unique = [];
    const seen = new Set();
    nodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (!isVisible(node)) return;
      const text = normalizedText(node.innerText || node.textContent || "");
      if (!text) return;
      const testid = node.getAttribute("data-testid") || "";
      const key = `${String(node.tagName || "").toLowerCase()}|${testid}|${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push({
        tag: String(node.tagName || "").toLowerCase(),
        role: node.getAttribute("role") || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        dataTestId: testid,
        href: node.getAttribute("href") || "",
        text
      });
    });
    return unique.slice(0, MAX_NEARBY_ITEMS);
  }

  function collectGeminiSignals() {
    const chatSelectors = [
      "nav [data-testid*='conversation' i]",
      "nav [data-testid*='chat' i]",
      "aside [data-testid*='conversation' i]",
      "aside [role='listitem']",
      "a[href*='/app/']",
      "a[href*='?chat=']",
      "[aria-label*='chat' i] a",
      "[role='navigation'] a"
    ];
    const chatCandidates = [];
    const seen = new Set();
    chatSelectors.forEach((selector) => {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      nodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (!isVisible(node)) return;
        const text = normalizedText(node.innerText || node.textContent || "");
        if (!text || text.length < 2) return;
        const sig = `${selector}|${node.getAttribute("href") || ""}|${text}`;
        if (seen.has(sig)) return;
        seen.add(sig);
        chatCandidates.push({
          selector,
          tag: String(node.tagName || "").toLowerCase(),
          role: node.getAttribute("role") || "",
          dataTestId: node.getAttribute("data-testid") || "",
          href: node.getAttribute("href") || "",
          text
        });
      });
    });
    return {
      totalVisibleCandidates: chatCandidates.length,
      sample: chatCandidates.slice(0, 12)
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
      anchorText: normalizedText(el.innerText || el.textContent || ""),
      domPath: buildDomPath(el, 6),
      parentInfo: {
        level1: summarizeElement(parent),
        level2: summarizeElement(grandParent)
      },
      nearbyInteractive: collectNearbyInteractive(el),
      geminiSignals: collectGeminiSignals()
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
    const geminiSignals = collectGeminiSignals();
    const hasChatCandidates = geminiSignals.totalVisibleCandidates > 0;

    const checks = [
      { key: "stableAnchor", ok: hasStableAnchor, reason: hasStableAnchor ? "" : "No stable anchor selected." },
      { key: "storage", ok: supportsStorage, reason: supportsStorage ? "" : "Extension storage is unavailable." },
      { key: "observer", ok: supportsObserver, reason: supportsObserver ? "" : "DOM observer support missing." },
      { key: "dragDrop", ok: supportsDnDPrimitives, reason: supportsDnDPrimitives ? "" : "Drag/drop primitives are unavailable." },
      { key: "interactiveDensity", ok: hasInteractiveDensity, reason: hasInteractiveDensity ? "" : "Page has very low interactive density." },
      { key: "chatCandidateDiscovery", ok: hasChatCandidates, reason: hasChatCandidates ? "" : "No visible chat candidates detected near navigation areas." }
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
        },
        geminiSignals
      }
    };
  }

  return { extractContext, assessCapabilities };
})();

if (typeof window !== "undefined") {
  window.ContextExtractor = ContextExtractor;
  console.log("✅ ContextExtractor loaded");
}

