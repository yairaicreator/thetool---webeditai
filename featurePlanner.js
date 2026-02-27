// WebEdit AI - Client-only Feature Planner (no-build safe)
// Returns {feature_type, targetSelector, parameters, confidence, warnings}

const FeaturePlanner = (() => {
  function normalizePrompt(prompt) {
    return String(prompt || "").trim();
  }

  function normalizePlannerString(value) {
    return String(value || "").trim();
  }

  // Backward-compatible alias for any legacy planner path that still calls normalizeString.
  function normalizeString(value) {
    return normalizePlannerString(value);
  }

  function plan(prompt, context) {
    const text = (prompt || "").toLowerCase();
    const targetSelector = context?.selector || "";
    const warnings = [];
    let feature_type = "";
    let parameters = {};
    let confidence = 0.35;

    if (/hide|remove|dismiss/.test(text)) {
      feature_type = "HideElement";
      confidence = 0.7;
    } else if (/sticky|pin|stick/.test(text)) {
      feature_type = "StickyElement";
      parameters = { top: "0px" };
      confidence = 0.65;
    } else if (/move up|move higher|up one/.test(text)) {
      feature_type = "MoveElement";
      parameters = { direction: "up" };
      confidence = 0.6;
    } else if (/move down|lower|down one/.test(text)) {
      feature_type = "MoveElement";
      parameters = { direction: "down" };
      confidence = 0.6;
    } else if (/resize|expand|maximize|full screen|fullscreen/.test(text)) {
      feature_type = "ResizablePanel";
      parameters = { mode: "fullscreen", zIndex: "2147483647" };
      confidence = 0.72;
    } else {
      feature_type = "ResizablePanel";
      parameters = { mode: "custom" };
      warnings.push("Planner confidence is low; please refine parameters.");
    }

    if (!targetSelector) {
      warnings.push("No target selector provided; pick an element first.");
    }

    return { feature_type, targetSelector, parameters, confidence, warnings };
  }

  return { plan };
})();

if (typeof window !== "undefined") {
  window.FeaturePlanner = FeaturePlanner;
  console.log("✅ FeaturePlanner loaded");
}
