// WebEdit AI - Feature Engine (no-build safe)
// Deterministic executor for preview/commit modes.

const FeatureEngine = (() => {
  const DATA_FEATURE_ID = "data-webedit-feature-id";
  const DATA_PREVIEW_ID = "data-webedit-preview-id";
  const DATA_PREVIEW_BADGE = "data-webedit-preview-badge";
  const previewHandles = new Map(); // previewId -> { plan, snapshot }

  function safeQuery(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function snapshotStyles(el, keys) {
    const prev = {};
    const priority = {};
    keys.forEach((k) => {
      const cssKey = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      prev[cssKey] = el.style.getPropertyValue(cssKey) || "";
      priority[cssKey] = el.style.getPropertyPriority(cssKey) || "";
    });
    return { prev, priority };
  }

  function applyStyles(el, styles) {
    Object.entries(styles || {}).forEach(([k, v]) => {
      const cssKey = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      if (v === null || v === undefined || v === "") {
        el.style.removeProperty(cssKey);
      } else {
        el.style.setProperty(cssKey, String(v), "important");
      }
    });
  }

  function restoreStyles(el, snapshot) {
    const prev = snapshot?.prev || {};
    const priority = snapshot?.priority || {};
    Object.entries(prev).forEach(([k, v]) => {
      if (v) {
        el.style.setProperty(k, v, priority[k] || "");
      } else {
        el.style.removeProperty(k);
      }
    });
  }

  function addPreviewBadge(el, previewId) {
    const existing = el.querySelector(`[${DATA_PREVIEW_BADGE}="${previewId}"]`);
    if (existing) return;
    const badge = document.createElement("div");
    badge.setAttribute(DATA_PREVIEW_BADGE, previewId);
    badge.textContent = "Preview";
    badge.style.setProperty("position", "absolute", "important");
    badge.style.setProperty("top", "6px", "important");
    badge.style.setProperty("right", "6px", "important");
    badge.style.setProperty("z-index", "2147483647", "important");
    badge.style.setProperty("background", "#1b1f23", "important");
    badge.style.setProperty("color", "#fff", "important");
    badge.style.setProperty("font-size", "11px", "important");
    badge.style.setProperty("padding", "2px 6px", "important");
    badge.style.setProperty("border-radius", "10px", "important");
    badge.style.setProperty("pointer-events", "none", "important");
    const cs = window.getComputedStyle(el);
    if (cs.position === "static") {
      el.style.setProperty("position", "relative", "important");
    }
    el.appendChild(badge);
  }

  function removePreviewBadge(el, previewId) {
    const badge = el.querySelector(`[${DATA_PREVIEW_BADGE}="${previewId}"]`);
    if (badge) badge.remove();
  }

  function applyResizablePanel(el, params, mode) {
    const fullscreen = params.mode === "fullscreen";
    const styleKeys = ["width", "height", "position", "top", "left", "right", "bottom", "zIndex"];
    const snapshot = snapshotStyles(el, styleKeys);
    const styles = fullscreen
      ? {
          width: "100%",
          height: "100%",
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
          zIndex: params.zIndex || "2147483647"
        }
      : {
          width: params.width || "",
          height: params.height || "",
          position: params.position || "",
          top: params.top || "",
          left: params.left || "",
          zIndex: params.zIndex || ""
        };
    applyStyles(el, styles);
    if (mode === "preview") {
      el.style.setProperty("outline", "2px dashed #4f46e5", "important");
    }
    return { snapshot };
  }

  function applyHideElement(el, params, mode) {
    const snapshot = snapshotStyles(el, ["display", "opacity", "outline"]);
    if (mode === "preview") {
      el.style.setProperty("opacity", "0.25", "important");
      el.style.setProperty("outline", "2px dashed #ef4444", "important");
    } else {
      el.style.setProperty("display", "none", "important");
    }
    return { snapshot };
  }

  function applyMoveElement(el, params, mode) {
    const parent = el.parentElement;
    if (!parent) return { snapshot: null };
    const children = Array.from(parent.children);
    const originalIndex = children.indexOf(el);
    const snapshot = { originalIndex };
    if (mode === "commit") {
      if (params.direction === "up" && el.previousElementSibling) {
        parent.insertBefore(el, el.previousElementSibling);
      } else if (params.direction === "down" && el.nextElementSibling) {
        parent.insertBefore(el.nextElementSibling, el);
      }
    }
    if (mode === "preview") {
      el.style.setProperty("outline", "2px dashed #10b981", "important");
    }
    return { snapshot };
  }

  function applyStickyElement(el, params, mode) {
    const snapshot = snapshotStyles(el, ["position", "top", "zIndex"]);
    applyStyles(el, {
      position: "sticky",
      top: params.top || "0px",
      zIndex: "999"
    });
    if (mode === "preview") {
      el.style.setProperty("outline", "2px dashed #0ea5e9", "important");
    }
    return { snapshot };
  }

  function removePreviewStyles(el, snapshot, previewId) {
    restoreStyles(el, snapshot);
    removePreviewBadge(el, previewId);
    el.removeAttribute(DATA_PREVIEW_ID);
  }

  function applyFeature(plan, mode, options = {}) {
    const validation = window.FeatureRegistry?.validatePlan?.(plan);
    if (!validation?.ok) {
      return { ok: false, error: validation?.error || "Invalid plan" };
    }
    const normalized = validation.plan;
    const el = safeQuery(normalized.targetSelector);
    if (!el) return { ok: false, error: "Target element not found" };

    const featureId = options.id || normalized.id || `feat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (mode === "commit") {
      if (el.getAttribute(DATA_FEATURE_ID) === featureId) {
        return { ok: true, featureId, replayed: true };
      }
      el.setAttribute(DATA_FEATURE_ID, featureId);
    } else {
      el.setAttribute(DATA_PREVIEW_ID, featureId);
    }

    let snapshot = null;
    if (normalized.feature_type === "ResizablePanel") {
      snapshot = applyResizablePanel(el, normalized.parameters || {}, mode).snapshot;
    } else if (normalized.feature_type === "HideElement") {
      snapshot = applyHideElement(el, normalized.parameters || {}, mode).snapshot;
    } else if (normalized.feature_type === "MoveElement") {
      snapshot = applyMoveElement(el, normalized.parameters || {}, mode).snapshot;
    } else if (normalized.feature_type === "StickyElement") {
      snapshot = applyStickyElement(el, normalized.parameters || {}, mode).snapshot;
    } else {
      return { ok: false, error: "Unsupported feature type" };
    }

    if (mode === "preview") {
      addPreviewBadge(el, featureId);
      previewHandles.set(featureId, { plan: normalized, snapshot });
      return { ok: true, previewId: featureId, plan: normalized };
    }

    return {
      ok: true,
      featureId,
      record: {
        id: featureId,
        feature_type: normalized.feature_type,
        targetSelector: normalized.targetSelector,
        parameters: normalized.parameters || {},
        createdAt: Date.now(),
        schemaVersion: "2",
        migration: {
          version: "2",
          strategy: "feature-engine-commit"
        },
        rollback: {
          type: "undoSnapshot",
          selector: normalized.targetSelector
        },
        featureArtifact: {
          html: "",
          css: "",
          js: ""
        },
        undoSnapshot: snapshot
      }
    };
  }

  function undoPreview(previewId) {
    const handle = previewHandles.get(previewId);
    if (!handle) return { ok: false, error: "Preview not found" };
    const el = safeQuery(handle.plan.targetSelector);
    if (!el) return { ok: false, error: "Target element not found" };
    removePreviewStyles(el, handle.snapshot, previewId);
    previewHandles.delete(previewId);
    return { ok: true };
  }

  function commitPreview(previewId) {
    const handle = previewHandles.get(previewId);
    if (!handle) return { ok: false, error: "Preview not found" };
    const el = safeQuery(handle.plan.targetSelector);
    if (!el) return { ok: false, error: "Target element not found" };
    removePreviewStyles(el, handle.snapshot, previewId);
    previewHandles.delete(previewId);
    return applyFeature(handle.plan, "commit", { id: previewId });
  }

  function undoCommit(record) {
    if (!record) return { ok: false, error: "Missing record" };
    const el = safeQuery(record.targetSelector);
    if (!el) return { ok: false, error: "Target element not found" };
    restoreStyles(el, record.undoSnapshot);
    el.removeAttribute(DATA_FEATURE_ID);
    return { ok: true };
  }

  return {
    applyFeature,
    undoPreview,
    commitPreview,
    undoCommit
  };
})();

if (typeof window !== "undefined") {
  window.FeatureEngine = FeatureEngine;
  console.log("✅ FeatureEngine loaded");
}

