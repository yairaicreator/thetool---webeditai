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
  const content = normalizeString(raw.content);
  const html = typeof raw.html === "string" ? raw.html : "";
  const css = typeof raw.css === "string" ? raw.css : "";

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

    const hasHtml = typeof raw.html === "string" && raw.html.trim().length > 0;
    const hasContent = content.length > 0;
    if (!hasHtml && !hasContent) {
      return { ok: false, error: "Invalid spec: add requires html or content" };
    }
  }

  const styles = normalizeStyles(raw.styles);

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
    css: css || undefined
  };

  return { ok: true, spec };
}

if (typeof window !== "undefined") {
  window.FeatureSpecSchema = FeatureSpecSchema;
  window.parseFeatureSpec = parseFeatureSpec;
  console.log("✅ FeatureSpec validator loaded");
}


