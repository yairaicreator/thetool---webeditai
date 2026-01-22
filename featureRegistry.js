// WebEdit AI - Feature Registry (no-build safe)
// Defines supported feature types and their parameter constraints.

const FeatureRegistry = (() => {
  const registry = {
    ResizablePanel: {
      supportsPreview: true,
      allowedTargets: ["*"],
      parametersSchema: {
        mode: ["fullscreen", "custom"],
        width: "string",
        height: "string",
        top: "string",
        left: "string",
        zIndex: "string"
      }
    },
    HideElement: {
      supportsPreview: true,
      allowedTargets: ["*"],
      parametersSchema: {}
    },
    MoveElement: {
      supportsPreview: true,
      allowedTargets: ["*"],
      parametersSchema: {
        direction: ["up", "down"]
      }
    },
    StickyElement: {
      supportsPreview: true,
      allowedTargets: ["*"],
      parametersSchema: {
        top: "string"
      }
    }
  };

  function listFeatures() {
    return Object.keys(registry);
  }

  function getFeature(featureType) {
    return registry[featureType] || null;
  }

  function validatePlan(plan) {
    if (!plan || typeof plan !== "object") {
      return { ok: false, error: "Invalid plan object" };
    }
    const featureType = plan.feature_type;
    if (!featureType || !registry[featureType]) {
      return { ok: false, error: "Unknown feature type" };
    }
    const targetSelector = plan.targetSelector || plan.selector;
    if (!targetSelector || typeof targetSelector !== "string") {
      return { ok: false, error: "Missing targetSelector" };
    }
    const params = plan.parameters && typeof plan.parameters === "object" ? plan.parameters : {};
    const schema = registry[featureType].parametersSchema || {};
    for (const key of Object.keys(params)) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) {
        return { ok: false, error: `Unsupported parameter: ${key}` };
      }
    }
    return { ok: true, plan: { ...plan, targetSelector, parameters: params } };
  }

  return { listFeatures, getFeature, validatePlan };
})();

if (typeof window !== "undefined") {
  window.FeatureRegistry = FeatureRegistry;
  console.log("✅ FeatureRegistry loaded");
}

