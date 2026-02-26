// WebEdit AI - FeatureSpec Type + Validation (no-build safe)
// This file is loaded as a classic script (not a module) and exposes helpers on window.

/**
 * @typedef {Object} FeatureSpec
 * @property {"hide"|"customize"|"add"|"text"} action
 * @property {string=} selector
 * @property {string=} targetSelector
 * @property {string=} description
 * @property {Object.<string,string>=} styles
 * @property {string=} content
 * @property {"before"|"after"|"inside"|"replace"=} position
 * @property {string=} html
 * @property {string=} css
 * @property {string=} js
 * @property {Object=} behavior
 * @property {Object=} ui_components
 * @property {Object=} state_model
 * @property {Array<Object>=} events
 * @property {Array<Object>=} data_bindings
 * @property {Object=} persistence
 * @property {Object=} accessibility
 * @property {Object=} undo_strategy
 * @property {Object=} selectors
 * @property {Object=} generated_module
 * @property {Object=} validation
 * @property {Object=} metadata
 */

const FeatureSpecSchema = {
  // Documentation placeholder. In this no-build repo we use runtime validation via parseFeatureSpec().
};

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePosition(value) {
  const v = normalizeString(value);
  if (v === "before" || v === "after" || v === "inside" || v === "replace") return v;
  return "";
}

function normalizeAction(value) {
  const v = normalizeString(value);
  if (v === "hide" || v === "customize" || v === "add" || v === "text") return v;
  return "";
}

function normalizeStyles(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = normalizeString(k);
    const val = normalizeString(v);
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

function normalizeStringArray(value, maxItems = 24) {
  if (!Array.isArray(value)) return null;
  const out = [];
  value.forEach((item) => {
    const next = normalizeString(item);
    if (next) out.push(next);
  });
  if (!out.length) return null;
  return out.slice(0, maxItems);
}

function normalizeEvents(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  value.forEach((evt) => {
    if (!isPlainObject(evt)) return;
    const name = normalizeString(evt.name || evt.event || evt.type);
    const target = normalizeString(evt.target || evt.selector);
    const handler = normalizeString(evt.handler || evt.action);
    if (!name || !handler) return;
    out.push({
      name,
      target: target || undefined,
      handler
    });
  });
  return out.length ? out.slice(0, 64) : null;
}

function normalizeDataBindings(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  value.forEach((binding) => {
    if (!isPlainObject(binding)) return;
    const source = normalizeString(binding.source || binding.from);
    const target = normalizeString(binding.target || binding.to);
    const transform = normalizeString(binding.transform || "");
    if (!source || !target) return;
    out.push({ source, target, transform: transform || undefined });
  });
  return out.length ? out.slice(0, 64) : null;
}

function normalizeFeatureSpecV2(raw) {
  if (!isPlainObject(raw)) return null;

  const uiComponents = isPlainObject(raw.ui_components)
    ? {
        type: normalizeString(raw.ui_components.type || "module"),
        slots: normalizeStringArray(raw.ui_components.slots || []),
        notes: normalizeString(raw.ui_components.notes || "")
      }
    : null;

  const stateModel = isPlainObject(raw.state_model)
    ? {
        type: normalizeString(raw.state_model.type || "local"),
        keys: normalizeStringArray(raw.state_model.keys || []),
        transitions: Array.isArray(raw.state_model.transitions) ? raw.state_model.transitions.slice(0, 64) : undefined
      }
    : null;

  const persistence = isPlainObject(raw.persistence)
    ? {
        scope: normalizeString(raw.persistence.scope || "page"),
        storage: normalizeString(raw.persistence.storage || "chrome.storage.local"),
        key: normalizeString(raw.persistence.key || ""),
        migrationVersion: normalizeString(raw.persistence.migrationVersion || raw.persistence.version || "1")
      }
    : null;

  const accessibility = isPlainObject(raw.accessibility)
    ? {
        ariaLabels: normalizeStringArray(raw.accessibility.ariaLabels || []),
        keyboardSupport: normalizeString(raw.accessibility.keyboardSupport || "")
      }
    : null;

  const undoStrategy = isPlainObject(raw.undo_strategy)
    ? {
        mode: normalizeString(raw.undo_strategy.mode || "dom-revert"),
        preserveStateKeys: normalizeStringArray(raw.undo_strategy.preserveStateKeys || [])
      }
    : null;

  const selectors = isPlainObject(raw.selectors)
    ? {
        anchor: normalizeString(raw.selectors.anchor || ""),
        fallback: normalizeStringArray(raw.selectors.fallback || [])
      }
    : null;

  const generatedModule = isPlainObject(raw.generated_module)
    ? {
        moduleId: normalizeString(raw.generated_module.moduleId || raw.generated_module.id || ""),
        title: normalizeString(raw.generated_module.title || ""),
        html: typeof raw.generated_module.html === "string" ? raw.generated_module.html : "",
        css: typeof raw.generated_module.css === "string" ? raw.generated_module.css : "",
        js: typeof raw.generated_module.js === "string" ? raw.generated_module.js : "",
        controller: normalizeString(raw.generated_module.controller || ""),
        config: isPlainObject(raw.generated_module.config) ? raw.generated_module.config : undefined,
        stateSchema: isPlainObject(raw.generated_module.stateSchema) ? raw.generated_module.stateSchema : undefined
      }
    : null;

  const validation = isPlainObject(raw.validation)
    ? {
        tests: Array.isArray(raw.validation.tests) ? raw.validation.tests.slice(0, 64) : [],
        required: normalizeStringArray(raw.validation.required || [])
      }
    : null;

  const events = normalizeEvents(raw.events);
  const dataBindings = normalizeDataBindings(raw.data_bindings);

  const result = {};
  if (uiComponents) result.ui_components = uiComponents;
  if (stateModel) result.state_model = stateModel;
  if (events) result.events = events;
  if (dataBindings) result.data_bindings = dataBindings;
  if (persistence) result.persistence = persistence;
  if (accessibility) result.accessibility = accessibility;
  if (undoStrategy) result.undo_strategy = undoStrategy;
  if (selectors) result.selectors = selectors;
  if (generatedModule) result.generated_module = generatedModule;
  if (validation) result.validation = validation;
  result.metadata = {
    schemaVersion: "2",
    generatedAt: Date.now()
  };
  return result;
}

function normalizeBehavior(value) {
  if (!isPlainObject(value)) return null;

  const type = normalizeString(value.type);
  const allowed = ["toggleClass", "toggleStyles"];
  if (!allowed.includes(type)) return null;

  const triggerAttr = normalizeString(value.triggerAttr) || "data-webedit-ai-action";
  const triggerValue = normalizeString(value.triggerValue) || "toggle";
  const targetSelector = normalizeString(value.targetSelector);
  if (!targetSelector) return null;

  if (type === "toggleClass") {
    const className = normalizeString(value.className);
    if (!className) return null;
    return {
      type,
      triggerAttr,
      triggerValue,
      targetSelector,
      className,
      expandedLabel: normalizeString(value.expandedLabel) || "",
      collapsedLabel: normalizeString(value.collapsedLabel) || ""
    };
  }

  if (type === "toggleStyles") {
    const stylesOn = normalizeStyles(value.stylesOn);
    const stylesOff = normalizeStyles(value.stylesOff);
    if (!stylesOn || !stylesOff) return null;
    return {
      type,
      triggerAttr,
      triggerValue,
      targetSelector,
      stylesOn,
      stylesOff,
      expandedLabel: normalizeString(value.expandedLabel) || "",
      collapsedLabel: normalizeString(value.collapsedLabel) || ""
    };
  }

  return null;
}

/**
 * parseFeatureSpec(raw) enforces the strict schema the executor expects.
 * It also fills safe defaults (position) for deterministic behavior.
 *
 * @param {unknown} raw
 * @returns {{ok:true,spec:FeatureSpec}|{ok:false,error:string}}
 */
function parseFeatureSpec(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Invalid spec: expected an object" };
  }

  const action = normalizeAction(raw.action);
  if (!action) {
    return { ok: false, error: "Invalid spec: missing or invalid action" };
  }

  const selector = normalizeString(raw.selector);
  const targetSelector = normalizeString(raw.targetSelector);
  const description = normalizeString(raw.description);
  let content = normalizeString(raw.content);
  const generatedModule = isPlainObject(raw.generated_module) ? raw.generated_module : null;
  const moduleHtml = typeof generatedModule?.html === "string" ? generatedModule.html : "";
  const moduleCss = typeof generatedModule?.css === "string" ? generatedModule.css : "";
  const moduleJs = typeof generatedModule?.js === "string" ? generatedModule.js : "";
  const html = typeof raw.html === "string" && raw.html.trim().length ? raw.html : moduleHtml;
  const css = typeof raw.css === "string" && raw.css.trim().length ? raw.css : moduleCss;
  const js = typeof raw.js === "string" && raw.js.trim().length ? raw.js : moduleJs;
  const behavior = normalizeBehavior(raw.behavior);

  let position = normalizePosition(raw.position);

  // Validation rules by action
  if (action === "hide") {
    if (!selector) return { ok: false, error: "Invalid spec: hide requires selector" };
  }

  if (action === "customize") {
    if (!selector) return { ok: false, error: "Invalid spec: customize requires selector" };
    const styles = normalizeStyles(raw.styles);
    if (!styles) return { ok: false, error: "Invalid spec: customize requires non-empty styles" };
    return {
      ok: true,
      spec: {
        action,
        selector,
        description: description || undefined,
        styles,
        content: content || undefined,
        position: position || undefined,
        html: html || undefined,
        css: css || undefined
      }
    };
  }

  if (action === "text") {
    if (!selector) return { ok: false, error: "Invalid spec: text requires selector" };
    if (!content) return { ok: false, error: "Invalid spec: text requires content" };
    if (!position) position = "replace";
  }

  if (action === "add") {
    if (!targetSelector && !selector) {
      return { ok: false, error: "Invalid spec: add requires targetSelector (or selector)" };
    }
    if (!position) position = "inside";

    // Last-resort compatibility path: allow add specs that only contain descriptive text.
    if (!content) {
      content = normalizeString(raw.purpose) || normalizeString(raw.name) || description || "";
    }

    const hasHtml = html.trim().length > 0;
    const hasContent = content.length > 0;
    if (!hasHtml && !hasContent) {
      return { ok: false, error: "Invalid spec: add requires html or content" };
    }

    if (raw.behavior !== undefined && !behavior) {
      return { ok: false, error: "Invalid spec: behavior is invalid or unsupported" };
    }
  }

  const styles = normalizeStyles(raw.styles);
  const v2 = normalizeFeatureSpecV2(raw);

  /** @type {FeatureSpec} */
  const spec = {
    action,
    selector: selector || undefined,
    targetSelector: targetSelector || undefined,
    description: description || undefined,
    styles: styles || undefined,
    content: content || undefined,
    position: position || undefined,
    html: html || undefined,
    css: css || undefined,
    js: js || undefined,
    behavior: behavior || undefined,
    ...(v2 || {})
  };

  return { ok: true, spec };
}

function validateAddSpecContract(raw) {
  const parsed = parseFeatureSpec(raw);
  if (!parsed?.ok || !parsed?.spec) {
    return { ok: false, stage: "parse", error: parsed?.error || "Invalid spec" };
  }
  const spec = parsed.spec;
  if (spec.action !== "add") {
    return { ok: false, stage: "contract", error: "Add contract requires action=add" };
  }
  const anchor = normalizeString(spec.targetSelector || spec.selector || "");
  if (!anchor) {
    return { ok: false, stage: "contract", error: "Add contract requires targetSelector/selector" };
  }
  const hasHtml = typeof spec.html === "string" && spec.html.trim().length > 0;
  const hasContent = typeof spec.content === "string" && spec.content.trim().length > 0;
  if (!hasHtml && !hasContent) {
    return { ok: false, stage: "contract", error: "Add contract requires html or content" };
  }
  const normalized = {
    ...spec,
    targetSelector: anchor,
    selector: spec.selector || anchor,
    position: spec.position || "inside",
    metadata: {
      ...(spec.metadata || {}),
      addContract: "v1"
    }
  };
  return { ok: true, spec: normalized };
}

if (typeof window !== "undefined") {
  window.FeatureSpecSchema = FeatureSpecSchema;
  window.parseFeatureSpec = parseFeatureSpec;
  window.normalizeFeatureSpecV2 = normalizeFeatureSpecV2;
  window.validateAddSpecContract = validateAddSpecContract;
  console.log("✅ FeatureSpec validator loaded");
}


