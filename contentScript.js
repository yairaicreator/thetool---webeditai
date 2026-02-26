// WebEdit AI Content Script (side panel controlled)
// Handles DOM interactions (pick/remove/customize/apply/add) on the active page.

console.log("[WebEdit] contentScript loaded on", location.href);
// #region agent log
fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e76c3f'},body:JSON.stringify({sessionId:'e76c3f',runId:'auth-debug-1',hypothesisId:'H0',location:'contentScript.js:top-level',message:'contentScript loaded',data:{href:location.href},timestamp:Date.now()})}).catch(()=>{});
// #endregion

let isPickMode = false;
let isRemoveMode = false;
let hoverEl = null;
let selectedEl = null;

let lastPicked = null; // { selector, description }
let currentUser = null; // { id, email, ... }
let authState = "unauthenticated"; // unauthenticated | authenticated
let authStateCheckedAt = 0;
let authStateEmail = null;
const AUTH_STATE_TTL_MS = 0; // Always revalidate auth status

// Preview Lab state
const PREVIEW_LAB_TARGET_ATTR = "data-webedit-preview-target";
const PREVIEW_GHOST_ATTR = "data-webedit-preview-ghost";
const previewLabPreviews = new Map(); // previewId -> { type, plan, spec, selector }

function getPreviewLab() {
  return window.PreviewLab || null;
}

async function ensurePreviewLabAvailable() {
  let lab = getPreviewLab();
  if (lab) return lab;
  try {
    await chrome.runtime.sendMessage({
      type: "WEBEDIT_ENSURE_CONTENT_SCRIPTS",
      files: ["previewLab.js"]
    });
  } catch (_) {}
  lab = getPreviewLab();
  return lab || null;
}

function ensureGhostStyles() {
  if (document.getElementById("webedit-preview-ghost-style")) return;
  const style = document.createElement("style");
  style.id = "webedit-preview-ghost-style";
  style.textContent = `
    [${PREVIEW_GHOST_ATTR}] {
      outline: 2px dashed #a855f7 !important;
      outline-offset: 2px !important;
    }
  `;
  document.head.appendChild(style);
}

function setGhostHighlight(previewId, selector) {
  ensureGhostStyles();
  clearGhostHighlight(previewId);
  if (!selector) return;
  let el = null;
  try { el = document.querySelector(selector); } catch (_) { el = null; }
  if (!el) return;
  el.setAttribute(PREVIEW_GHOST_ATTR, previewId);
}

function clearGhostHighlight(previewId) {
  const nodes = document.querySelectorAll(`[${PREVIEW_GHOST_ATTR}="${CSS.escape(previewId)}"]`);
  nodes.forEach((el) => el.removeAttribute(PREVIEW_GHOST_ATTR));
}

function notifyPreviewAction(action, previewId) {
  chrome.runtime.sendMessage({
    type: "WEBEDIT_PREVIEW_ACTION",
    payload: { action, previewId }
  }).catch(() => {});
}

function openPreviewLab(previewId, title) {
  const lab = getPreviewLab();
  if (!lab) return;
  lab.open(previewId, title || "Preview Lab", {
    onApply: () => notifyPreviewAction("apply", previewId),
    onRefine: () => notifyPreviewAction("refine", previewId),
    onUndo: () => notifyPreviewAction("undo", previewId),
    onClose: () => notifyPreviewAction("undo", previewId)
  });
}

function lockPreviewContextInteractivity(previewTarget, markerId) {
  if (!previewTarget || !markerId) return;
  const markerSelector = `[data-webedit-ai-insert-id="${CSS.escape(markerId)}"]`;
  const interactiveSelector = "a, button, input, textarea, select, details, summary, [role='button'], [contenteditable='true']";
  const nodes = previewTarget.querySelectorAll(interactiveSelector);
  nodes.forEach((el) => {
    if (!(el instanceof Element)) return;
    if (el.closest(markerSelector)) return;
    el.setAttribute("data-webedit-preview-static", "1");
    if (!el.hasAttribute("tabindex")) {
      el.setAttribute("tabindex", "-1");
    }
    if ("disabled" in el && el.tagName !== "A") {
      try { el.disabled = true; } catch (_) {}
    }
    try { el.style.pointerEvents = "none"; } catch (_) {}
  });
}

function applyPlanPreviewToElement(el, plan) {
  if (!el || !plan) return;
  const type = plan.feature_type;
  if (type === "ResizablePanel") {
    const fullscreen = plan.parameters?.mode === "fullscreen";
    if (fullscreen) {
      el.style.setProperty("width", "100%", "important");
      el.style.setProperty("height", "100%", "important");
    } else {
      if (plan.parameters?.width) el.style.setProperty("width", plan.parameters.width, "important");
      if (plan.parameters?.height) el.style.setProperty("height", plan.parameters.height, "important");
    }
    el.style.setProperty("outline", "2px dashed #4f46e5", "important");
    return;
  }
  if (type === "HideElement") {
    el.style.setProperty("opacity", "0.25", "important");
    el.style.setProperty("outline", "2px dashed #ef4444", "important");
    return;
  }
  if (type === "MoveElement") {
    const dir = plan.parameters?.direction === "down" ? 1 : -1;
    el.style.setProperty("transform", `translateY(${dir * 12}px)`, "important");
    el.style.setProperty("outline", "2px dashed #10b981", "important");
    return;
  }
  if (type === "StickyElement") {
    el.style.setProperty("position", "sticky", "important");
    el.style.setProperty("top", plan.parameters?.top || "0px", "important");
    el.style.setProperty("outline", "2px dashed #0ea5e9", "important");
  }
}

async function renderPlanPreviewInLab(plan, previewId) {
  const lab = await ensurePreviewLabAvailable();
  if (!lab) return { ok: false, error: "PreviewLab not available" };
  const selector = plan?.targetSelector || "";
  let target = null;
  try { target = selector ? document.querySelector(selector) : null; } catch (_) { target = null; }
  if (!target) return { ok: false, error: "Target element not found" };

  openPreviewLab(previewId, "Preview Lab");
  lab.clearContent();
  const clone = target.cloneNode(true);
  clone.setAttribute(PREVIEW_LAB_TARGET_ATTR, "1");
  const mount = lab.getMountNode();
  if (!mount) return { ok: false, error: "Preview mount unavailable" };
  mount.appendChild(clone);

  const shadowRoot = lab.getShadowRoot();
  const previewTarget = shadowRoot?.querySelector(`[${PREVIEW_LAB_TARGET_ATTR}="1"]`);
  if (!previewTarget) return { ok: false, error: "Preview target missing" };
  applyPlanPreviewToElement(previewTarget, plan);
  return { ok: true };
}

async function renderSpecPreviewInLab(spec, previewId) {
  const lab = await ensurePreviewLabAvailable();
  if (!lab) return { ok: false, error: "PreviewLab not available" };
  const exec = window.FeatureSpecExecutor;
  if (!exec || typeof exec.applyFeatureSpec !== "function") {
    return { ok: false, error: "FeatureSpec executor not available" };
  }
  const parsed = typeof window.parseFeatureSpec === "function"
    ? window.parseFeatureSpec(spec)
    : { ok: true, spec };
  if (!parsed?.ok || !parsed?.spec) {
    return { ok: false, stage: "parse", error: parsed?.error || "Invalid feature spec" };
  }
  const normalizedSpec = parsed.spec;

  openPreviewLab(previewId, "Preview Lab");
  lab.clearContent();
  const mount = lab.getMountNode();
  const shadowRoot = lab.getShadowRoot();
  if (!mount || !shadowRoot) return { ok: false, error: "Preview mount unavailable" };

  const selector = normalizedSpec.selector || normalizedSpec.targetSelector || "";
  let previewTarget = null;

  if (normalizedSpec.action === "add") {
    let target = null;
    try { target = selector ? document.querySelector(selector) : null; } catch (_) { target = null; }
    if (target) {
      // For inside placement previews, use a shallow clone so insertion is visually
      // unambiguous inside the selected section instead of blending with full copied content.
      const clone = (normalizedSpec.position || "inside") === "inside"
        ? target.cloneNode(false)
        : target.cloneNode(true);
      clone.setAttribute(PREVIEW_LAB_TARGET_ATTR, "1");
      clone.setAttribute("data-webedit-preview-context", "1");
      mount.appendChild(clone);
      previewTarget = shadowRoot.querySelector(`[${PREVIEW_LAB_TARGET_ATTR}="1"]`);
    } else {
      // Fallback debug mode if anchor cannot be cloned.
      previewTarget = document.createElement("div");
      previewTarget.setAttribute(PREVIEW_LAB_TARGET_ATTR, "1");
      mount.appendChild(previewTarget);
    }
  } else {
    let target = null;
    try { target = selector ? document.querySelector(selector) : null; } catch (_) { target = null; }
    if (!target) return { ok: false, error: "Target element not found" };
    const clone = target.cloneNode(true);
    clone.setAttribute(PREVIEW_LAB_TARGET_ATTR, "1");
    mount.appendChild(clone);
    previewTarget = shadowRoot.querySelector(`[${PREVIEW_LAB_TARGET_ATTR}="1"]`);
  }

  if (!previewTarget) return { ok: false, error: "Preview target missing" };

  const previewSpec = {
    ...normalizedSpec,
    selector: `[${PREVIEW_LAB_TARGET_ATTR}="1"]`,
    targetSelector: `[${PREVIEW_LAB_TARGET_ATTR}="1"]`
  };

  const result = await exec.applyFeatureSpec(previewSpec, {
    root: shadowRoot,
    targetOverride: previewTarget,
    skipPersist: true,
    preview: true,
    id: previewId
  });
  if (!result?.ok) {
    return {
      ok: false,
      stage: result?.stage || "validation",
      error: result?.error || "Preview failed",
      failures: Array.isArray(result?.failures) ? result.failures : []
    };
  }

  if (normalizedSpec.action === "add") {
    lockPreviewContextInteractivity(previewTarget, String(previewId));
    if (typeof lab.setInsertionPositionControl === "function") {
      lab.setInsertionPositionControl({
        visible: true,
        value: normalizedSpec.position || "inside",
        onChange: async (nextPosition) => {
          const nextPos = typeof nextPosition === "string" && nextPosition ? nextPosition : "inside";
          const currentHandle = previewLabPreviews.get(previewId);
          const baseSpec = currentHandle?.type === "spec" && currentHandle.spec
            ? currentHandle.spec
            : normalizedSpec;
          if ((baseSpec.position || "inside") === nextPos) return;
          const updatedSpec = { ...baseSpec, position: nextPos };
          const refreshed = await renderSpecPreviewInLab(updatedSpec, previewId);
          if (!refreshed?.ok) return;
          previewLabPreviews.set(previewId, {
            type: "spec",
            spec: updatedSpec,
            selector: updatedSpec.targetSelector || updatedSpec.selector || ""
          });
          chrome.runtime.sendMessage({
            type: "WEBEDIT_PREVIEW_SPEC_UPDATED",
            payload: { previewId, spec: updatedSpec }
          }).catch(() => {});
        }
      });
    }
  } else if (typeof lab.setInsertionPositionControl === "function") {
    lab.setInsertionPositionControl({ visible: false });
  }

  function runPreviewAssertions(currentSpec, root) {
    const controller = currentSpec?.generated_module?.controller || "";
    const failures = [];
    if (!root) {
      failures.push({ code: "missing_root", message: "Preview root is unavailable." });
      return failures;
    }

    if (controller === "themeToggleController") {
      const trigger = root.querySelector('[data-webedit-ai-action="toggle"]');
      if (!trigger) {
        failures.push({ code: "missing_toggle", message: "Theme toggle control was not rendered." });
      } else {
        const beforePressed = trigger.getAttribute("aria-pressed") || "false";
        try { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (_) {}
        const afterPressed = trigger.getAttribute("aria-pressed") || "false";
        if (beforePressed === afterPressed) {
          failures.push({ code: "toggle_no_state_change", message: "Theme toggle did not change state on click." });
        }
      }
    }

    if (controller === "folderGeminiController") {
      const addFolderBtn = root.querySelector("[data-webedit-folder-module='1'] button");
      const folderList = root.querySelector("[data-webedit-folder-list='1']");
      if (!addFolderBtn || !folderList) {
        failures.push({ code: "missing_folder_ui", message: "Folder module controls were not rendered." });
      } else {
        const beforeCount = folderList.querySelectorAll("[data-folder-id]").length;
        try { addFolderBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (_) {}
        const afterCount = folderList.querySelectorAll("[data-folder-id]").length;
        if (afterCount <= beforeCount) {
          failures.push({ code: "folder_create_failed", message: "Folder creation action did not create a folder." });
        }
      }
    }

    return failures;
  }

  // Isolated preview sanity assertions to prevent "nothing happened" outcomes.
  const mountNode = lab.getMountNode();
  const hasRenderableNode = !!(mountNode && mountNode.querySelector("*"));
  if (!hasRenderableNode) {
    return {
      ok: false,
      stage: "validation",
      error: "Behavior tests failed: preview rendered no new elements.",
      failures: [{ code: "empty_preview", message: "No rendered nodes in isolated preview." }]
    };
  }

  const functionalFailures = runPreviewAssertions(previewSpec, shadowRoot);
  if (functionalFailures.length > 0) {
    return {
      ok: false,
      stage: "validation",
      error: functionalFailures[0].message,
      failures: functionalFailures
    };
  }

  return { ok: true };
}

// ============================================================
// Supabase "edits" (cloud) live application + Undo/Redo sync
// ============================================================

const WEBEDIT_CLOUD_EDIT_ATTR = "data-webedit-edit-id";
const WEBEDIT_MANAGED_ATTR = "data-webedit-managed";
const WEBEDIT_ORIG_DISPLAY_ATTR = "data-webedit-orig-display";
const WEBEDIT_ORIG_DISPLAY_PRIO_ATTR = "data-webedit-orig-display-priority";
const WEBEDIT_STYLE_ID_PREFIX = "webedit-style-";
const WEBEDIT_HIDDEN_CLASS_PREFIX = "webedit-hidden-";

let cloudWebsiteId = null;
let cloudRealtime = null; // { close() }
let cloudRealtimeKey = null; // `${userId}:${websiteId}`
let cloudRebuildTimer = null;
let cloudRebuildInFlight = null;
let cloudRuntimeStarted = false;
let cloudPollTimer = null;
let applySavedEditsInFlight = null;
let pendingApplySavedReason = null;
let lastSpaKey = null; // origin+pathname
let spaReapplyTimer = null;
const CUSTOMIZE_STYLE_PROPS = [
  "background-color",
  "color",
  "font-size",
  "width",
  "height",
  "transform",
  "transform-origin",
  "display",
  "margin-left",
  "margin-right"
];
const customizeSessions = new Map(); // selector -> { baseline: { prop: { value, priority } }, previewActive: boolean }

function getSpaKey() {
  return `${location.origin}${location.pathname || "/"}`;
}

function scheduleSpaReapply(reason = "spa") {
  if (shouldBypassAuthRuntimeOnPage()) {
    stopCloudEditsRuntime();
    return;
  }
  try { if (spaReapplyTimer) clearTimeout(spaReapplyTimer); } catch (_) {}
  spaReapplyTimer = setTimeout(() => {
    console.log("[WebEdit] SPA reapply triggered:", reason);
    // Re-run deterministic rehydration pipeline once per burst.
    applySavedEditsForUser(`spa:${reason}`).catch(() => {});
  }, 250);
}

function handleSpaUrlChange(reason = "url-change") {
  const nextKey = getSpaKey();
  if (nextKey === lastSpaKey) {
    // Hash-only changes are ignored by default for persistence, but UI may remount.
    scheduleSpaReapply(`hash-or-same-path:${reason}`);
    return;
  }

  console.log("[WebEdit] SPA URL changed:", { from: lastSpaKey, to: nextKey, href: location.href, reason });
  lastSpaKey = nextKey;

  // Reset cached website context so the next rebuild uses the correct website row.
  cloudWebsiteId = null;
  cloudRealtimeKey = null;
  try { cloudRealtime?.close?.(); } catch (_) {}
  cloudRealtime = null;

  // Re-run deterministic rehydration for the new route.
  scheduleSpaReapply(reason);
}

function isProbablyWebEditAppPage() {
  try {
    const host = (location.hostname || "").toLowerCase();
    return host === "webeditai.com" || host === "www.webeditai.com";
  } catch (_) {
    return false;
  }
}

function shouldBypassAuthRuntimeOnPage() {
  if (!isProbablyWebEditAppPage()) return false;
  const pathname = String(location.pathname || "").toLowerCase();
  const hash = String(location.hash || "").toLowerCase();
  const search = String(location.search || "").toLowerCase();
  const hasAuthCode = /(?:\?|&)code=/.test(search);
  const hasAuthError = /(?:\?|&)(error|error_description)=/.test(search);
  const authPath = pathname.includes("/auth/callback") || hash.includes("auth/callback");
  const authRoute = hash.includes("/signup") || hash.includes("/login") || hash.includes("/auth");
  const bypass = hasAuthCode || hasAuthError || authPath || authRoute;
  // #region agent log
  if (bypass) {
    fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e76c3f'},body:JSON.stringify({sessionId:'e76c3f',runId:'auth-debug-1',hypothesisId:'H3',location:'contentScript.js:shouldBypassAuthRuntimeOnPage:true',message:'Auth runtime bypass active',data:{pathname,hash,hasAuthCode,hasAuthError,authPath,authRoute},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion
  return bypass;
}

function setAuthState(nextState, email = null) {
  authState = nextState;
  authStateEmail = email || null;
  authStateCheckedAt = Date.now();
}

function authWaitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function resolveAuthorizationState(force = false) {
  const now = Date.now();
  if (!force && authStateCheckedAt && (now - authStateCheckedAt) < AUTH_STATE_TTL_MS) {
    return authState;
  }

  const client = window.SupabaseClient;
  if (!client) {
    setAuthState("unauthenticated");
    return authState;
  }

  let session = null;
  try {
    const sessionResp = await client.getSession({ allowRefresh: force });
    session = sessionResp?.data?.session || null;
  } catch (_) {
    session = null;
  }

  let user = session?.user || null;
  if (typeof client.fetchAuthUser === "function") {
    try {
      const authResp = await client.fetchAuthUser();
      user = authResp?.ok ? authResp.user : null;
    } catch (_) {
      user = null;
    }
  }
  if (!user?.email) {
    setAuthState("unauthenticated");
    return authState;
  }

  if (authStateEmail && authStateEmail === user.email && !force && (now - authStateCheckedAt) < AUTH_STATE_TTL_MS) {
    return authState;
  }

  setAuthState("authenticated", user.email);
  return authState;
}

async function isAuthenticated(force = false) {
  const state = await resolveAuthorizationState(force);
  return state === "authenticated";
}

async function getSupabaseAuth() {
  try {
    const authorized = await isAuthenticated();
    // #region agent log
    fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e76c3f'},body:JSON.stringify({sessionId:'e76c3f',runId:'auth-debug-1',hypothesisId:'H4',location:'contentScript.js:getSupabaseAuth:authorizedCheck',message:'Evaluated isAuthenticated in getSupabaseAuth',data:{authorized,href:location.href},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!authorized) return null;
    const client = window.SupabaseClient;
    if (!client) return null;
    const { data: { session } } = await client.getSession();
    // #region agent log
    fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e76c3f'},body:JSON.stringify({sessionId:'e76c3f',runId:'auth-debug-1',hypothesisId:'H4',location:'contentScript.js:getSupabaseAuth:sessionLoaded',message:'Loaded session in getSupabaseAuth',data:{hasSession:!!session,hasToken:!!session?.access_token,hasRefreshToken:!!session?.refresh_token,isExpired:!!(session&&typeof client.isSessionExpired==='function'&&client.isSessionExpired(session))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const token = session?.access_token || null;
    const userId = session?.user?.id || null;
    if (!token || !userId) return null;
    if (typeof client.isSessionExpired === "function" && client.isSessionExpired(session)) return null;
    return { token, userId, url: client.url, anonKey: client.anonKey };
  } catch (_) {
    return null;
  }
}

async function supabaseJsonGet(fullUrl, token, anonKey) {
  const response = await fetch(fullUrl, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {}
  if (!response.ok) {
    const msg = (json && (json.message || json.error)) ? (json.message || json.error) : text;
    const error = new Error(`Supabase GET failed (${response.status}): ${msg}`);
    error.status = response.status;
    error.payload = json;
    throw error;
  }
  return json;
}

async function fetchWebsiteIdForCurrentUrl() {
  const auth = await getSupabaseAuth();
  if (!auth) return null;

  const origin = location.origin;
  const path = location.pathname || "/";
  const normalizedFullUrl = `${origin}${path}`;

  // Prefer origin+path so SPA hash changes don't create new website rows.
  const byOriginPath = new URLSearchParams({
    select: "id,full_url,origin,path",
    origin: `eq.${origin}`,
    path: `eq.${path}`
  });
  const urlOriginPath = `${auth.url}/rest/v1/websites?${byOriginPath.toString()}`;
  let data = await supabaseJsonGet(urlOriginPath, auth.token, auth.anonKey).catch(() => []);

  // Back-compat fallback: older rows may have been keyed by full_url (including hash).
  if (!Array.isArray(data) || data.length === 0) {
    const fullUrl = location.href;
    const qs = new URLSearchParams({
      select: "id,full_url,origin,path",
      full_url: `eq.${fullUrl}`
    });
    const urlFull = `${auth.url}/rest/v1/websites?${qs.toString()}`;
    data = await supabaseJsonGet(urlFull, auth.token, auth.anonKey).catch(() => []);
  }

  console.log("[WebEdit] Website lookup:", { normalizedFullUrl, origin, path, found: Array.isArray(data) ? data.length : 0 });
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0]?.id || null;
}

function normalizeEditType(row) {
  const t = row?.edit_type || row?.type || row?.editType || row?.editType;
  return typeof t === "string" ? t.toLowerCase() : null;
}

function pickSelectorFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.selector || payload.targetSelector || payload.target_selector || payload?.metadata?.selector || null;
}

function pickStylesFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const styles =
    payload.styles ||
    payload?.metadata?.styles ||
    payload?.metadata?.style ||
    payload?.metadata?.cssVars ||
    null;
  return styles && typeof styles === "object" ? styles : null;
}

function pickCssFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const css = payload.css || payload?.metadata?.css || null;
  return typeof css === "string" ? css : null;
}

async function fetchActiveEditsForWebsite(websiteId) {
  const auth = await getSupabaseAuth();
  if (!auth || !websiteId) return null;

  const baseQs = new URLSearchParams({
    website_id: `eq.${websiteId}`,
    status: "eq.active",
    order: "created_at.asc"
  });

  // Column name drift: some deployments used `type` vs `edit_type`.
  // We'll fetch with `select=*` to avoid unknown-column errors and normalize in JS.
  baseQs.set("select", "*");

  const url = `${auth.url}/rest/v1/edits?${baseQs.toString()}`;
  const data = await supabaseJsonGet(url, auth.token, auth.anonKey).catch((e) => {
    // Graceful degradation: if schema differs or table missing, skip destructive rebuild.
    const msg = String(e?.message || e || "");
    if (!/Failed to fetch|NetworkError|fetch/i.test(msg)) {
      console.warn("[WebEdit] Supabase fetchActiveEdits failed:", msg);
    }
    return null;
  });
  if (!Array.isArray(data)) return null;

  console.log("[WebEdit] Loaded active edits", { websiteId, count: data.length });

  // Extra safety: enforce user_id match client-side if present.
  return data
    .filter((row) => !row?.user_id || row.user_id === auth.userId)
    .filter((row) => (row?.status || "active") === "active");
}

function clearAppliedCloudEdits() {
  const summary = {
    removedNodes: 0,
    removedStyles: 0,
    restoredManagedNodes: 0
  };
  const isCloudInjectedArtifact = (node) => {
    if (!(node instanceof Element)) return false;
    return node.classList.contains("webedit-added-feature") ||
      node.hasAttribute("data-webedit-feature-id") ||
      node.hasAttribute("data-webedit-ai-insert-id");
  };

  // 1) Remove injected "Add" features (cloud-managed only)
  try {
    const injected = Array.from(document.querySelectorAll(`[${WEBEDIT_CLOUD_EDIT_ATTR}]`));
    injected.forEach((node) => {
      if (!isCloudInjectedArtifact(node)) return;
      try {
        node.remove();
        summary.removedNodes += 1;
      } catch (_) {}
    });
  } catch (_) {}

  // Back-compat cleanup: older injected features used data-webedit-feature-id.
  // Only remove those that look like extension artifacts.
  try {
    const legacy = Array.from(document.querySelectorAll(`.webedit-added-feature[data-webedit-feature-id]`));
    legacy.forEach((node) => {
      // If it doesn't have the new attr, it might be local-only (featureSpec undo stack).
      // Keep it to avoid breaking local Undo/Redo.
      if (!node.hasAttribute(WEBEDIT_CLOUD_EDIT_ATTR)) return;
      try {
        node.remove();
        summary.removedNodes += 1;
      } catch (_) {}
    });
  } catch (_) {}

  // 2) Remove injected style tags for cloud Customize edits only.
  // Preserve local FeatureSpec styles (`data-webedit-ai-style-id`) so local replayed
  // add features do not flicker/disappear after cloud rebuild.
  try {
    const styleEls = Array.from(document.querySelectorAll(`style[id^="${WEBEDIT_STYLE_ID_PREFIX}"]`));
    styleEls.forEach((el) => {
      const isFeatureSpecStyle = el.hasAttribute("data-webedit-ai-style-id");
      if (isFeatureSpecStyle) return;
      try {
        el.remove();
        summary.removedStyles += 1;
      } catch (_) {}
    });
  } catch (_) {}

  // 3) Unhide elements affected by cloud Hide/Remove edits
  try {
    const managed = Array.from(document.querySelectorAll(`[${WEBEDIT_MANAGED_ATTR}="1"]`));
    managed.forEach((el) => {
      try {
        // Remove any webedit-hidden-* classes
        const classes = Array.from(el.classList || []);
        classes.forEach((c) => {
          if (c && c.startsWith(WEBEDIT_HIDDEN_CLASS_PREFIX)) {
            el.classList.remove(c);
          }
        });

        // Restore original inline display (best-effort)
        const prevDisplay = el.getAttribute(WEBEDIT_ORIG_DISPLAY_ATTR);
        const prevPrio = el.getAttribute(WEBEDIT_ORIG_DISPLAY_PRIO_ATTR);
        if (prevDisplay === null) {
          // nothing to restore
        } else if (!prevDisplay) {
          el.style.removeProperty("display");
        } else {
          el.style.setProperty("display", prevDisplay, prevPrio || "");
        }
      } catch (_) {
        // ignore element-level failures
      } finally {
        try { el.removeAttribute(WEBEDIT_ORIG_DISPLAY_ATTR); } catch (_) {}
        try { el.removeAttribute(WEBEDIT_ORIG_DISPLAY_PRIO_ATTR); } catch (_) {}
        try { el.removeAttribute(WEBEDIT_MANAGED_ATTR); } catch (_) {}
        summary.restoredManagedNodes += 1;
      }
    });
  } catch (_) {}

  return summary;
}

function cssPropToKebab(prop) {
  if (!prop) return "";
  const s = String(prop).trim();
  if (!s) return "";
  // If already kebab-case, keep.
  if (s.includes("-")) return s.toLowerCase();
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function buildCssFromStyles(selector, styles) {
  const pairs = [];
  for (const [k, v] of Object.entries(styles || {})) {
    if (v === undefined || v === null || v === "") continue;
    const prop = cssPropToKebab(k);
    if (!prop) continue;
    pairs.push(`${prop}: ${String(v)} !important;`);
  }
  if (!selector || pairs.length === 0) return "";
  return `${selector} { ${pairs.join(" ")} }`;
}

function applyCustomizeEdit(editId, payload) {
  const selector = pickSelectorFromPayload(payload);
  if (!selector || !editId) return false;
  const styleId = `${WEBEDIT_STYLE_ID_PREFIX}${editId}`;

  const explicitCss = pickCssFromPayload(payload);
  const styles = pickStylesFromPayload(payload);
  const css = (explicitCss && explicitCss.trim())
    ? explicitCss
    : buildCssFromStyles(selector, styles || {});

  if (!css || !css.trim()) return false;

  const head = document.head || document.documentElement;
  if (!head) return false;

  let styleEl = document.getElementById(styleId);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    head.appendChild(styleEl);
  }
  styleEl.textContent = `/* WebEdit cloud customize: ${editId} */\n${css}\n`;
  return true;
}

function applyHideEdit(editId, payload) {
  const selector = pickSelectorFromPayload(payload);
  if (!selector || !editId) return 0;
  let count = 0;
  let nodes = [];
  try {
    nodes = Array.from(document.querySelectorAll(selector));
  } catch (_) {
    return 0;
  }
  nodes.forEach((el) => {
    // Skip extension injected nodes (avoid hiding the feature UI itself)
    if (el.closest && (el.closest(`[${WEBEDIT_CLOUD_EDIT_ATTR}]`) || el.closest("[data-webedit-feature-id]"))) return;

    try {
      // Save original inline display only once
      if (!el.hasAttribute(WEBEDIT_ORIG_DISPLAY_ATTR)) {
        el.setAttribute(WEBEDIT_ORIG_DISPLAY_ATTR, el.style.getPropertyValue("display") || "");
        el.setAttribute(WEBEDIT_ORIG_DISPLAY_PRIO_ATTR, el.style.getPropertyPriority("display") || "");
      }

      el.classList.add(`${WEBEDIT_HIDDEN_CLASS_PREFIX}${editId}`);
      el.setAttribute(WEBEDIT_MANAGED_ATTR, "1");
      el.style.setProperty("display", "none", "important");
      count += 1;
    } catch (_) {}
  });
  return count;
}

function cssEscapeSafe(value) {
  try {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  } catch (_) {}
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function normalizeAddPayloadToSpec(payload = {}) {
  if (!payload || typeof payload !== "object") return null;
  const directAction = String(payload.action || "").toLowerCase();
  const looksLikeAddSpec =
    directAction === "add" ||
    !!payload.generated_module ||
    !!payload.featureArtifact ||
    typeof payload.html === "string" ||
    typeof payload.content === "string";
  if (!looksLikeAddSpec) return null;

  const targetSelector =
    payload.targetSelector ||
    payload.selector ||
    payload?.selectors?.anchor ||
    payload?.rollback?.selector ||
    null;
  if (!targetSelector) return null;

  const artifact = payload.featureArtifact || {};
  const generatedModule = payload.generated_module || {};
  return {
    ...payload,
    action: "add",
    targetSelector,
    selector: payload.selector || targetSelector,
    position: payload.position || payload?.parameters?.position || "inside",
    html: payload.html || artifact.html || generatedModule.html || "",
    css: payload.css || artifact.css || generatedModule.css || "",
    js: payload.js || artifact.js || generatedModule.js || "",
    generated_module: {
      ...generatedModule,
      html: generatedModule.html || artifact.html || payload.html || "",
      css: generatedModule.css || artifact.css || payload.css || "",
      js: generatedModule.js || artifact.js || payload.js || "",
      controller: generatedModule.controller || payload?.controller?.id || null,
      config: generatedModule.config || payload?.controller?.config || null,
      stateSchema: generatedModule.stateSchema || payload?.stateSchema || null
    }
  };
}

async function applyAddEdit(editId, payload) {
  if (!editId || !payload || typeof payload !== "object") return false;

  // If this is a FeatureSpec-style add (html/css/behavior), apply via FeatureSpecExecutor so interactivity persists.
  const addSpec = normalizeAddPayloadToSpec(payload);
  if (addSpec && window.FeatureSpecExecutor && typeof window.FeatureSpecExecutor.applyFeatureSpec === "function") {
    const res = await window.FeatureSpecExecutor.applyFeatureSpec(addSpec, { replay: true, id: editId, skipPersist: true });
    if (res?.ok) {
      try {
        const nodes = document.querySelectorAll(`[data-webedit-ai-insert-id="${cssEscapeSafe(editId)}"]`);
        nodes.forEach((el) => {
          try { el.setAttribute(WEBEDIT_CLOUD_EDIT_ATTR, editId); } catch (_) {}
        });
      } catch (_) {}
      return true;
    }
    console.warn("[WebEdit] Failed to replay add edit via FeatureSpecExecutor", {
      editId,
      reason: res?.error || "unknown"
    });
    return false;
  }

  // Legacy: Ensure we always wrap the inserted feature so cleanup is reliable.
  const result = injectFeatureCard({ ...(payload || {}), editId });
  return !!result?.ok;
}

async function applyActiveEditsInOrder(edits) {
  if (!Array.isArray(edits) || edits.length === 0) return { applied: 0 };
  let applied = 0;
  for (const row of edits) {
    const editId = row?.id || row?.edit_id || row?.editId;
    const type = normalizeEditType(row);
    const payload = row?.payload || row?.metadata?.payload || row?.data || {};
    if (!editId || !type) continue;

    try {
      if (type === "add") {
        if (await applyAddEdit(editId, payload)) applied += 1;
      } else if (type === "remove" || type === "hide") {
        const n = applyHideEdit(editId, payload);
        if (n > 0) applied += 1;
      } else if (type === "customize" || type === "style") {
        if (applyCustomizeEdit(editId, payload)) applied += 1;
      } else {
        // Ignore unknown edit types for now (future-proof).
      }
    } catch (e) {
      console.warn("[WebEdit] Failed to apply cloud edit", editId, e);
    }
  }
  return { applied };
}

async function rebuildCloudEdits(reason = "unknown") {
  if (cloudRebuildInFlight) return cloudRebuildInFlight;
  cloudRebuildInFlight = (async () => {
    try {
      if (shouldBypassAuthRuntimeOnPage()) {
        stopCloudEditsRuntime();
        return { ok: false, skipped: true, reason: "webedit-auth-flow" };
      }
      const auth = await getSupabaseAuth();
      if (!auth?.userId) return { ok: false, skipped: true, reason: "no-auth" };
      if (isProbablyWebEditAppPage()) return { ok: false, skipped: true, reason: "webedit-app" };

      const websiteId = cloudWebsiteId || await fetchWebsiteIdForCurrentUrl();
      cloudWebsiteId = websiteId;
      if (!websiteId) return { ok: false, skipped: true, reason: "no-website-id" };

      const edits = await fetchActiveEditsForWebsite(websiteId);
      if (!Array.isArray(edits)) {
        console.warn("[WebEdit] Cloud rebuild skipped (fetch unavailable)", { reason, websiteId });
        return { ok: false, skipped: true, reason: "fetch-unavailable" };
      }
      // Deterministic correctness: clear everything we manage, then reapply ACTIVE edits in order.
      const clearSummary = clearAppliedCloudEdits();
      // stable order (server orders by created_at asc, but keep client-side fallback)
      edits.sort((a, b) => String(a?.created_at || "").localeCompare(String(b?.created_at || "")));
      const result = await applyActiveEditsInOrder(edits);
      console.log("[WebEdit] Cloud rebuild applied", {
        reason,
        websiteId,
        fetched: edits.length,
        applied: result?.applied || 0,
        clearSummary
      });
      
      // Check for discrepancies (e.g. edits applied by legacy system but missing from Cloud)
      try {
        scanForOrphanedEdits(edits);
      } catch (_) {}

      return { ok: true, ...result, reason };
    } catch (e) {
      console.warn("[WebEdit] Cloud rebuild failed:", e?.message || e);
      return { ok: false, error: e?.message || String(e) };
    } finally {
      // allow next rebuild
      cloudRebuildInFlight = null;
    }
  })();
  return cloudRebuildInFlight;
}

function scheduleCloudRebuild(reason = "update", delayMs = 150) {
  try {
    if (cloudRebuildTimer) clearTimeout(cloudRebuildTimer);
  } catch (_) {}
  cloudRebuildTimer = setTimeout(() => {
    rebuildCloudEdits(reason).catch(() => {});
  }, Math.max(0, delayMs));
}

function startCloudRealtimeSubscription(userId, websiteId) {
  const authPromise = getSupabaseAuth();
  const key = `${userId}:${websiteId}`;
  if (cloudRealtimeKey === key && cloudRealtime) return;

  // Tear down old subscription if any.
  try { cloudRealtime?.close?.(); } catch (_) {}
  cloudRealtime = null;
  cloudRealtimeKey = key;

  const createPhoenixRealtime = async () => {
    const auth = await authPromise;
    if (!auth || !auth.url || !auth.anonKey || !auth.token) return null;

    const supabaseWsUrl = (() => {
      try {
        const u = new URL(auth.url);
        u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
        u.pathname = "/realtime/v1/websocket";
        u.search = new URLSearchParams({ apikey: auth.anonKey, vsn: "1.0.0" }).toString();
        return u.toString();
      } catch (_) {
        return null;
      }
    })();
    if (!supabaseWsUrl) return null;

    let ws = null;
    let closed = false;
    let joinRef = 0;
    let ref = 0;
    let heartbeatTimer = null;
    let reconnectTimer = null;

    const nextRef = () => String(++ref);
    const topic = `realtime:webedit-edits-${websiteId}`;

    const send = (msg) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify(msg)); } catch (_) {}
    };

    const join = () => {
      joinRef += 1;
      const jr = String(joinRef);
      const config = {
        broadcast: { ack: false, self: false },
        presence: { key: "" },
        postgres_changes: [
          { event: "UPDATE", schema: "public", table: "edits", filter: `website_id=eq.${websiteId}` },
          { event: "INSERT", schema: "public", table: "edits", filter: `website_id=eq.${websiteId}` },
          { event: "DELETE", schema: "public", table: "edits", filter: `website_id=eq.${websiteId}` }
        ]
      };
      send({
        topic,
        event: "phx_join",
        payload: { config, access_token: auth.token },
        ref: nextRef(),
        join_ref: jr
      });
    };

    const startHeartbeat = () => {
      try { if (heartbeatTimer) clearInterval(heartbeatTimer); } catch (_) {}
      heartbeatTimer = setInterval(() => {
        send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: nextRef() });
      }, 25000);
    };

    const scheduleReconnect = () => {
      if (closed) return;
      try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch (_) {}
      reconnectTimer = setTimeout(() => {
        if (closed) return;
        try { ws?.close?.(); } catch (_) {}
        connect();
      }, 1000);
    };

    const connect = () => {
      if (closed) return;
      try { ws?.close?.(); } catch (_) {}
      ws = new WebSocket(supabaseWsUrl);

      ws.addEventListener("open", () => {
        join();
        startHeartbeat();
      });

      ws.addEventListener("message", (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch (_) {}
        if (!msg || typeof msg !== "object") return;
        if (msg.event === "postgres_changes") {
          // Always rebuild for correctness (status changes, inserts, deletes, edits)
          scheduleCloudRebuild("realtime:postgres_changes", 50);
        }
      });

      ws.addEventListener("close", () => {
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        scheduleReconnect();
      });
    };

    connect();

    return {
      close() {
        closed = true;
        try { if (heartbeatTimer) clearInterval(heartbeatTimer); } catch (_) {}
        try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch (_) {}
        try { ws?.close?.(); } catch (_) {}
      }
    };
  };

  createPhoenixRealtime()
    .then((rt) => {
      cloudRealtime = rt;
      if (cloudRealtime) {
        // Initial rebuild shortly after connecting (also covers pages that already have edits).
        scheduleCloudRebuild("realtime:init", 50);
      }
    })
    .catch((e) => {
      console.warn("[WebEdit] Failed to start realtime subscription:", e?.message || e);
    });
}

async function initCloudEditsRuntime(options = {}) {
  const skipInitialRebuild = !!options?.skipInitialRebuild;
  try {
    if (cloudRuntimeStarted) return;
    const auth = await getSupabaseAuth();
    if (!auth?.userId) return;
    if (isProbablyWebEditAppPage()) return;

    cloudWebsiteId = await fetchWebsiteIdForCurrentUrl();
    if (!cloudWebsiteId) return;

    cloudRuntimeStarted = true;
    startCloudRealtimeSubscription(auth.userId, cloudWebsiteId);
    if (!skipInitialRebuild) {
      scheduleCloudRebuild("init", 50);
    }

    // Polling fallback (covers cases where websockets are blocked)
    cloudPollTimer = setInterval(() => {
      // Only poll if we still have auth and website context.
      getSupabaseAuth().then((a) => {
        if (!a?.userId || !cloudWebsiteId) return;
        scheduleCloudRebuild("poll", 0);
      }).catch(() => {});
    }, 5000);
  } catch (_) {
    // ignore init failures
  }
}

function stopCloudEditsRuntime() {
  try { cloudRealtime?.close?.(); } catch (_) {}
  cloudRealtime = null;
  cloudRuntimeStarted = false;
  cloudWebsiteId = null;
  cloudRealtimeKey = null;
  try { if (cloudPollTimer) clearInterval(cloudPollTimer); } catch (_) {}
  try { if (cloudRebuildTimer) clearTimeout(cloudRebuildTimer); } catch (_) {}
  cloudPollTimer = null;
  cloudRebuildTimer = null;
}

// Best-effort cleanup on navigation/unload (avoid dangling sockets / timers)
try {
  window.addEventListener("beforeunload", () => {
    try { cloudRealtime?.close?.(); } catch (_) {}
    try { if (cloudPollTimer) clearInterval(cloudPollTimer); } catch (_) {}
  });
} catch (_) {}

// ============================================================
// SPA support: URL + DOM remount reapply
// ============================================================
try {
  lastSpaKey = getSpaKey();

  window.addEventListener("popstate", () => handleSpaUrlChange("popstate"));
  window.addEventListener("hashchange", () => handleSpaUrlChange("hashchange"));

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const ret = originalPushState.apply(history, args);
    handleSpaUrlChange("pushState");
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = originalReplaceState.apply(history, args);
    handleSpaUrlChange("replaceState");
    return ret;
  };

  // DOM remount watcher: on heavy SPA remounts, reapply edits after a short debounce.
  const observer = new MutationObserver(() => {
    scheduleSpaReapply("mutation");
  });
  observer.observe(document.documentElement, { subtree: true, childList: true });
} catch (e) {
  console.warn("[WebEdit] SPA hooks setup failed:", e?.message || e);
}

async function refreshCurrentUser() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "WEBEDIT_GET_SESSION" });
    const session = resp?.session || null;
    currentUser = session?.user || null;
  } catch (e) {
    currentUser = null;
  }

  try {
    if (window.EditRules && typeof window.EditRules.setActiveUser === "function") {
      window.EditRules.setActiveUser(currentUser);
    }
  } catch (e) {
    // ignore
  }

  return currentUser;
}

async function applySavedEditsForUser(reason = "manual") {
  pendingApplySavedReason = reason || "manual";
  if (applySavedEditsInFlight) return applySavedEditsInFlight;
  applySavedEditsInFlight = (async () => {
    while (pendingApplySavedReason) {
      const passReason = pendingApplySavedReason;
      pendingApplySavedReason = null;
      await applySavedEditsForUserOnce(passReason);
    }
  })().finally(() => {
    applySavedEditsInFlight = null;
  });
  return applySavedEditsInFlight;
}

async function applySavedEditsForUserOnce(reason = "manual") {
  if (shouldBypassAuthRuntimeOnPage()) {
    stopCloudEditsRuntime();
    return;
  }
  const authorized = await isAuthenticated();
  if (!authorized) {
    stopCloudEditsRuntime();
    return;
  }
  await refreshCurrentUser();
  if (!currentUser?.id) {
    return;
  }

  console.log("[WebEdit] applySavedEditsForUser start", {
    reason,
    origin: location.origin,
    pathname: location.pathname,
    href: location.href
  });

  if (!window.EditRules) {
    return;
  }
  try {
    if (typeof window.EditRules.applyAllRulesForCurrentPage === "function") {
      await window.EditRules.applyAllRulesForCurrentPage(true);
    } else if (typeof window.EditRules.applyRules === "function") {
      await window.EditRules.applyRules();
    }
    if (typeof window.EditRules.setupMutationObserver === "function") {
      window.EditRules.setupMutationObserver();
    }
    console.log("[WebEdit] Re-applied saved edits for", currentUser.id);
  } catch (e) {
    console.warn("[WebEdit] Failed to re-apply saved edits:", e);
  }

  // Local FeatureSpecs (AI-generated, with interactive behaviors) rehydrate here too.
  try {
    const exec = window.FeatureSpecExecutor;
    if (exec && typeof exec.restoreAndReplay === "function") {
      const res = await exec.restoreAndReplay();
      console.log("[WebEdit] FeatureSpec restoreAndReplay:", res);
    } else {
      console.log("[WebEdit] FeatureSpecExecutor not available; skipping local FeatureSpec rehydrate");
    }
  } catch (e) {
    console.warn("[WebEdit] FeatureSpec restoreAndReplay failed:", e?.message || e);
  }

  // New deterministic features (Planner → Engine → Commit)
  try {
    const store = window.FeatureStore;
    if (store && typeof store.restoreCommittedFeatures === "function") {
      const res = await store.restoreCommittedFeatures();
      console.log("[WebEdit] FeatureStore restoreCommittedFeatures:", res);
    }
  } catch (e) {
    console.warn("[WebEdit] FeatureStore restoreCommittedFeatures failed:", e?.message || e);
  }

  // Cloud edits apply last so local restore and cloud cleanup do not overlap.
  await initCloudEditsRuntime({ skipInitialRebuild: true }).catch(() => {});
  await rebuildCloudEdits(`rehydrate:${reason}`).catch(() => {});
}

async function ensureEditRulesReady() {
  if (!window.EditRules) {
    return null;
  }
  if (!currentUser?.id) {
    await refreshCurrentUser();
  }
  return currentUser?.id ? window.EditRules : null;
}

async function upsertStyleRule(selector, el, styles) {
  const editRules = await ensureEditRulesReady();
  if (!editRules || !selector || !el) return null;

  const baseStyles = {};
  try {
    if (typeof editRules.getRulesForCurrentPage === "function") {
      const rules = await editRules.getRulesForCurrentPage();
      const existing = rules.find(r => r.selector === selector && r.action === "style");
      if (existing?.metadata?.styles && typeof existing.metadata.styles === "object") {
        Object.assign(baseStyles, existing.metadata.styles);
      }
    }
  } catch (e) {
    // ignore
  }

  const merged = { ...baseStyles, ...(styles || {}) };
  const rule = await editRules.createRule(el, "style", { styles: merged }, currentUser, selector);
  if (window.SaveEdit?.saveCustomizeEdit) {
    window.SaveEdit.saveCustomizeEdit(el, rule).catch(() => {});
  }
  return rule;
}

async function deleteRulesForSelectorAction(selector, action) {
  const editRules = await ensureEditRulesReady();
  if (!editRules || !selector) return 0;
  if (typeof editRules.getRulesForCurrentPage !== "function" || typeof editRules.deleteRule !== "function") {
    return 0;
  }
  const rules = await editRules.getRulesForCurrentPage();
  const matches = rules.filter(r => r.selector === selector && r.action === action);
  for (const rule of matches) {
    await editRules.deleteRule(rule.id);
  }
  return matches.length;
}

function buildReorderLayoutMetadata(el) {
  if (!el || !el.parentElement) return null;
  const parent = el.parentElement;
  const parentSelector = generateSelectorForElement(parent);
  const siblings = Array.from(parent.children);
  const targetIndex = siblings.indexOf(el);
  const prev = el.previousElementSibling;
  return {
    type: "reorder",
    parentSelector,
    targetIndex,
    previousSiblingSelector: prev ? generateSelectorForElement(prev) : null
  };
}

function clearHover() {
  if (hoverEl) {
    hoverEl.classList.remove("webedit-hover-highlight");
    hoverEl = null;
  }
}

function clearSelected() {
  if (selectedEl) {
    selectedEl.classList.remove("webedit-selected");
    selectedEl = null;
  }
}

function setHover(el) {
  clearHover();
  hoverEl = el;
  hoverEl.classList.add("webedit-hover-highlight");
}

function cssEscape(value) {
  if (!value) return "";
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => {
    const hex = char.codePointAt(0).toString(16).padStart(2, "0");
    return `\\${hex} `;
  });
}

function generateSelectorForElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  if (el.id) return `#${cssEscape(el.id)}`;

  if (el.className && typeof el.className === "string") {
    const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith("webedit-"));
    if (classes.length > 0) {
      const safeClasses = classes.map(cssEscape);
      const classSelector = el.tagName.toLowerCase() + "." + safeClasses.join(".");
      if (document.querySelectorAll(classSelector).length === 1) return classSelector;
    }
  }

  const path = [];
  let current = el;
  let depth = 0;
  const maxDepth = 12;
  while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${cssEscape(current.id)}`;
      path.unshift(selector);
      break;
    }
    if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith("webedit-"));
      if (classes.length > 0) {
        const safeClasses = classes.slice(0, 2).map(cssEscape);
        selector += "." + safeClasses.join(".");
      }
    }
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current);
      if (siblings.length > 1) selector += `:nth-child(${index + 1})`;
      }
    path.unshift(selector);
    current = current.parentElement;
    depth++;
  }
  if (path.length > 0) {
    const pathSelector = path.join(" > ");
    const matches = document.querySelectorAll(pathSelector);
    if (matches.length > 0) return pathSelector;
  }

  // Last resort: avoid non-persistent data attributes (they won't survive refresh)
  return el.tagName.toLowerCase();
}

function generateDescriptionForElement(el) {
  const tag = el.tagName.toLowerCase();
  const map = {
    a: "Link",
    button: "Button",
    img: "Image",
    input: "Input field",
    textarea: "Text area",
    select: "Dropdown",
    p: "Paragraph",
    span: "Text",
    div: "Container",
    h1: "Heading",
    h2: "Heading",
    h3: "Heading"
  };
  const humanType = map[tag] || (tag.charAt(0).toUpperCase() + tag.slice(1));
  let text = "";
  if (tag === "img") text = el.alt || el.title || "";
  else if (tag === "input" || tag === "textarea") {
    text = el.placeholder || el.name || "";
    if (!text && el.id) {
      const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label) text = label.textContent || "";
    }
  } else {
    text = (el.textContent || "").trim();
  }
  if (text.length > 30) text = text.substring(0, 27) + "...";
  if (text) return `${humanType} "${text}"`;
  if (el.id) return `${humanType} (#${el.id})`;
  return humanType;
}

function isEventInsideExtensionUI(target) {
  if (!target || target === document.body || target === document.documentElement) return true;
  // Side panel UI is separate; we only exclude injected WebEdit nodes from selection/removal.
  return !!(target.closest && (
    target.closest(`[${WEBEDIT_CLOUD_EDIT_ATTR}]`) ||
    target.closest('[data-webedit-feature-id]')
  ));
}

function startPickMode() {
  if (isPickMode) return;
  stopRemoveMode();
  isPickMode = true;
  document.addEventListener("mousemove", handlePickMouseMove, true);
  document.addEventListener("click", handlePickClick, true);
}

function stopPickMode() {
  if (!isPickMode) return;
  isPickMode = false;
  clearHover();
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handlePickClick, true);
}

function startRemoveMode() {
  if (isRemoveMode) return;
  stopPickMode();
  isRemoveMode = true;
  document.addEventListener("mousemove", handleRemoveMouseMove, true);
  document.addEventListener("click", handleRemoveClick, true);
}

function stopRemoveMode() {
  if (!isRemoveMode) return;
  isRemoveMode = false;
  clearHover();
  document.removeEventListener("mousemove", handleRemoveMouseMove, true);
  document.removeEventListener("click", handleRemoveClick, true);
}

function handlePickMouseMove(event) {
  if (!isPickMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  setHover(el);
}

function handleRemoveMouseMove(event) {
  if (!isRemoveMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  setHover(el);
}

function handlePickClick(event) {
  if (!isPickMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  event.preventDefault();
  event.stopPropagation();

  clearSelected();
  selectedEl = el;
  selectedEl.classList.add("webedit-selected");

  const selector = generateSelectorForElement(el);
  const description = generateDescriptionForElement(el);
  lastPicked = { selector, description };

  chrome.runtime.sendMessage({
    type: "WEBEDIT_ELEMENT_PICKED",
    payload: lastPicked
  }).catch(() => {});

  stopPickMode();
}

function handleRemoveClick(event) {
  if (!isRemoveMode) return;
  const el = event.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (isEventInsideExtensionUI(el)) return;
  event.preventDefault();
  event.stopPropagation();

  const selector = generateSelectorForElement(el);
  removeElementBySelector(selector, el);

  stopRemoveMode();
  chrome.runtime.sendMessage({ type: "WEBEDIT_MODE_EXITED" }).catch(() => {});

}

function removeElementBySelector(selector, targetEl = null) {
  if (!selector && !targetEl) return { ok: false, error: "Missing selector" };
  const el = targetEl || (selector ? document.querySelector(selector) : null);
  if (!el) return { ok: false, error: "Element not found" };
  const resolvedSelector = selector || generateSelectorForElement(el);
  if (!resolvedSelector) return { ok: false, error: "Could not resolve selector" };

  el.style.setProperty("display", "none", "important");

  ensureEditRulesReady().then((editRules) => {
    if (!editRules) return;
    editRules.createRule(el, "hide", {}, currentUser, resolvedSelector).then((rule) => {
      if (window.SaveEdit?.saveRemoveEdit) {
        window.SaveEdit.saveRemoveEdit(el, rule).catch(() => {});
      }
    }).catch((err) => {
      console.warn("[WebEdit] Failed to persist hide:", err);
    });
  });

  return { ok: true, selector: resolvedSelector };
}

function captureCustomizeBaseline(el) {
  const baseline = {};
  CUSTOMIZE_STYLE_PROPS.forEach((prop) => {
    baseline[prop] = {
      value: el.style.getPropertyValue(prop) || "",
      priority: el.style.getPropertyPriority(prop) || ""
    };
  });
  return baseline;
}

function restoreCustomizeBaseline(el, baseline) {
  if (!el || !baseline) return;
  CUSTOMIZE_STYLE_PROPS.forEach((prop) => {
    const previous = baseline[prop] || { value: "", priority: "" };
    if (previous.value) {
      el.style.setProperty(prop, previous.value, previous.priority || "");
    } else {
      el.style.removeProperty(prop);
    }
  });
}

function startCustomizeSession(selector) {
  if (!selector) return { ok: false, error: "Missing selector" };
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: "Element not found" };
  if (!customizeSessions.has(selector)) {
    customizeSessions.set(selector, { baseline: captureCustomizeBaseline(el), previewActive: false });
  }
  return { ok: true };
}

function previewStylesForSelector(selector, styles) {
  const sessionRes = startCustomizeSession(selector);
  if (!sessionRes.ok) return sessionRes;
  const el = document.querySelector(selector);
  const session = customizeSessions.get(selector);
  if (!el || !session) return { ok: false, error: "Element not found" };
  restoreCustomizeBaseline(el, session.baseline);
  Object.entries(styles || {}).forEach(([key, value]) => {
    if (!value) return;
    const cssKey = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    el.style.setProperty(cssKey, String(value), "important");
  });
  session.previewActive = true;
  return { ok: true };
}

function resetPreviewStylesForSelector(selector) {
  const el = selector ? document.querySelector(selector) : null;
  const session = selector ? customizeSessions.get(selector) : null;
  if (!el || !session) return true;
  restoreCustomizeBaseline(el, session.baseline);
  session.previewActive = false;
  return true;
}

function applyStylesToSelector(selector, styles) {
  if (!selector) return { ok: false, error: "Missing selector" };
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: "Element not found" };
  startCustomizeSession(selector);
  const previous = {};
  Object.entries(styles || {}).forEach(([key, value]) => {
    if (!value) return;
    const cssKey = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    previous[key] = {
      value: el.style.getPropertyValue(cssKey) || "",
      priority: el.style.getPropertyPriority(cssKey) || ""
    };
    el.style.setProperty(cssKey, String(value), "important");
  });
  upsertStyleRule(selector, el, styles).catch((err) => {
    console.warn("[WebEdit] Failed to persist styles:", err);
  });
  return { ok: true, previous };
}

function resetStylesForSelector(selector) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return false;
  const session = customizeSessions.get(selector);
  if (session?.baseline) {
    restoreCustomizeBaseline(el, session.baseline);
    customizeSessions.delete(selector);
  } else {
    CUSTOMIZE_STYLE_PROPS.forEach((prop) => el.style.removeProperty(prop));
  }
  deleteRulesForSelectorAction(selector, "style").catch(() => {});
  return true;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function injectFeatureCard(payload = {}) {
  const selector = payload.selector || payload.targetSelector || null;
  let target = null;
  try {
    target = selector ? document.querySelector(selector) : null;
  } catch (_) {
    target = null;
  }
  if (!target || !target.parentElement) return false;

  const id = payload.featureId || payload.id || `feature-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const editId = payload.editId || payload.edit_id || payload.webeditEditId || null;
  const position = payload.position || "after";
  const name = payload.name || "WebEdit feature";
  const description = payload.description || payload.content || "";
  const html = typeof payload.html === "string" && payload.html.trim() ? payload.html : null;
  const css = typeof payload.css === "string" ? payload.css : null;

  const container = document.createElement("div");
  container.className = "webedit-added-feature";
  if (editId) {
    container.setAttribute(WEBEDIT_CLOUD_EDIT_ATTR, String(editId));
  }
  container.setAttribute("data-webedit-feature-id", id);
  container.setAttribute("data-webedit-selector", selector);

  if (css && css.trim()) {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    container.appendChild(styleEl);
  }

  const contentHolder = document.createElement("div");
  if (html) {
    contentHolder.innerHTML = html;
  } else {
    contentHolder.innerHTML = `
      <div style="font-weight:600; font-size:15px; margin-bottom:6px;">${escapeHtml(name)}</div>
      <div style="font-size:13px; line-height:1.5;">${escapeHtml(description)}</div>
    `;
  }
  container.appendChild(contentHolder);

  if (position === "before") {
    target.parentElement.insertBefore(container, target);
  } else if (position === "inside") {
    target.insertBefore(container, target.firstChild);
          } else {
    target.parentElement.insertBefore(container, target.nextSibling);
  }

  return { ok: true, featureId: id };
}

function removeFeatureCardById(featureId) {
  if (!featureId) return false;
  const escapeValue = (value) => {
    try {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(String(value));
      }
    } catch (e) {}
    return String(value).replace(/"/g, '\\"');
  };
  const el = document.querySelector(`[data-webedit-feature-id="${escapeValue(featureId)}"]`);
  if (!el) return false;
  el.remove();
  return true;
}

function setElementDisplay(selector, value, priority) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return false;
  const nextValue = value === undefined || value === null ? "" : String(value);
  const nextPriority = priority ? String(priority) : "";
  if (!nextValue) {
    el.style.removeProperty("display");
  } else {
    el.style.setProperty("display", nextValue, nextPriority || "");
  }
  return true;
}

function applyStylePatch(selector, patch = []) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return false;
  if (!Array.isArray(patch)) return false;
  patch.forEach((entry) => {
    const prop = entry?.prop;
    if (!prop) return;
    const cssKey = prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    const value = entry?.value ?? "";
    const priority = entry?.priority ?? "";
    if (!value) {
      el.style.removeProperty(cssKey);
    } else {
      el.style.setProperty(cssKey, String(value), String(priority || ""));
    }
  });
  return true;
}

function moveElement(selector, direction) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el || !el.parentElement) return false;
  const parent = el.parentElement;
  if (direction === "up") {
    const prev = el.previousElementSibling;
    if (!prev) return false;
    parent.insertBefore(el, prev);
    const layout = buildReorderLayoutMetadata(el);
    if (layout) {
      ensureEditRulesReady().then((editRules) => {
        if (!editRules) return;
        editRules.createRule(el, "reorder", { layout }, currentUser, selector).catch(() => {});
      });
    }
    return true;
  }
  if (direction === "down") {
    const next = el.nextElementSibling;
    if (!next) return false;
    parent.insertBefore(next, el);
    const layout = buildReorderLayoutMetadata(el);
    if (layout) {
      ensureEditRulesReady().then((editRules) => {
        if (!editRules) return;
        editRules.createRule(el, "reorder", { layout }, currentUser, selector).catch(() => {});
      });
    }
    return true;
  }
  return false;
}

function alignElement(selector, align) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return false;
  el.style.setProperty("display", "block", "important");
  if (align === "left") {
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "auto", "important");
    upsertStyleRule(selector, el, { display: "block", marginLeft: "0", marginRight: "auto" }).catch(() => {});
    return true;
  }
  if (align === "center") {
    el.style.setProperty("margin-left", "auto", "important");
    el.style.setProperty("margin-right", "auto", "important");
    upsertStyleRule(selector, el, { display: "block", marginLeft: "auto", marginRight: "auto" }).catch(() => {});
    return true;
  }
  if (align === "right") {
    el.style.setProperty("margin-left", "auto", "important");
    el.style.setProperty("margin-right", "0", "important");
    upsertStyleRule(selector, el, { display: "block", marginLeft: "auto", marginRight: "0" }).catch(() => {});
    return true;
  }
  return false;
}

async function applyFeatureSpecFlow(spec) {
  try {
    const exec = window.FeatureSpecExecutor;
    if (!exec || typeof exec.applyFeatureSpec !== "function") {
      return { ok: false, error: "FeatureSpec executor not found" };
    }

    const parsed = typeof window.parseFeatureSpec === "function"
      ? window.parseFeatureSpec(spec)
      : { ok: true, spec };
    if (!parsed?.ok || !parsed?.spec) {
      return { ok: false, stage: "parse", error: parsed?.error || "Invalid feature spec" };
    }
    const normalizedSpec = parsed.spec;

    // Retry a few times on SPA remounts where the target selector may not exist yet.
    let result = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await exec.applyFeatureSpec(normalizedSpec, { skipPersist: true });
      if (result?.ok) break;
      lastErr = result?.error || "apply failed";
      if (typeof lastErr === "string" && lastErr.includes("Could not find target")) {
        await new Promise(r => setTimeout(r, 250 * attempt));
        continue;
      }
      break;
    }
    if (!result?.ok) {
      return { ok: false, stage: "apply", error: lastErr || "Failed to apply spec" };
    }

    const generatedModule = normalizedSpec?.generated_module || {};
    const featureRecord = {
      id: result?.applied?.id || spec?.id || `spec-${Date.now()}`,
      feature_type: normalizedSpec?.action || "add",
      targetSelector: normalizedSpec?.targetSelector || normalizedSpec?.selector || "",
      parameters: {
        position: normalizedSpec?.position || "inside"
      },
      createdAt: Date.now(),
      schemaVersion: normalizedSpec?.metadata?.schemaVersion || "2",
      featureArtifact: {
        html: generatedModule?.html || normalizedSpec?.html || "",
        css: generatedModule?.css || normalizedSpec?.css || "",
        js: generatedModule?.js || normalizedSpec?.js || ""
      },
      controller: {
        id: generatedModule?.controller || null,
        config: generatedModule?.config || null
      },
      stateSchema: generatedModule?.stateSchema || normalizedSpec?.state_model || null,
      migration: {
        version: normalizedSpec?.persistence?.migrationVersion || "2",
        strategy: normalizedSpec?.undo_strategy?.mode || "dom-revert",
        persistenceKey: normalizedSpec?.persistence?.key || null
      },
      rollback: {
        type: "spec-undo",
        selector: normalizedSpec?.targetSelector || normalizedSpec?.selector || ""
      },
      undoSnapshot: result?.applied?.undo || null
    };

    // Confirm persistence to Supabase for add features; if it fails, undo to avoid lying.
    if (normalizedSpec?.action === "add") {
      const saver = window.SaveEdit?.saveAddFeature;
      if (typeof saver !== "function") {
        await exec.undoById?.(result.applied?.id);
        return { ok: false, error: "SaveEdit module not available; cannot persist feature" };
      }
      const saveResp = await saver({
        ...normalizedSpec,
        selector: normalizedSpec.selector || normalizedSpec.targetSelector,
        name: normalizedSpec.name || "AI Feature",
        purpose: normalizedSpec.purpose || normalizedSpec.description || "AI generated feature"
      });
      if (!saveResp?.ok) {
        try { await exec.undoById?.(result.applied?.id); } catch (_) {}
        return { ok: false, stage: "apply", error: `Failed to persist to Supabase: ${saveResp?.error || "unknown error"}` };
      }

      // Replace the local (temporary) insertion with a cloud-managed insertion keyed by the Supabase edit id.
      const persistedEditId = saveResp?.edit?.id;
      if (persistedEditId) {
        try { await exec.undoById?.(result.applied?.id); } catch (_) {}
        const replayed = await exec.applyFeatureSpec(normalizedSpec, { replay: true, id: persistedEditId, skipPersist: true });
        if (replayed?.ok) {
          try {
            const nodes = document.querySelectorAll(`[data-webedit-ai-insert-id="${cssEscapeSafe(persistedEditId)}"]`);
            nodes.forEach((el) => {
              try { el.setAttribute(WEBEDIT_CLOUD_EDIT_ATTR, persistedEditId); } catch (_) {}
            });
          } catch (_) {}
        }
        return { ok: true, applied: replayed?.applied || result.applied, persisted: true, edit: saveResp.edit || null, record: featureRecord };
      }

      return { ok: true, applied: result.applied, persisted: true, edit: saveResp.edit || null, record: featureRecord };
    }

    // Non-add actions are applied but not persisted via SaveEdit yet.
    return { ok: true, applied: result.applied, persisted: false, record: featureRecord };
  } catch (error) {
    return { ok: false, stage: "apply", error: error.message };
  }
}

function getPagePlainText() {
  const text = document.body?.innerText || "";
  return text.slice(0, 5000).trim();
}

function revealLikelyHeader() {
  const candidates = Array.from(document.querySelectorAll("header, nav, [role='banner'], .header, .nav, .top-bar, .navbar"));
  let revealed = 0;
  candidates.forEach(el => {
    // 1. Remove WebEdit specific hiding classes
    const classes = Array.from(el.classList);
    let changed = false;
    classes.forEach(c => {
      if (c.startsWith(WEBEDIT_HIDDEN_CLASS_PREFIX)) {
        el.classList.remove(c);
        changed = true;
      }
    });

    // 2. Remove WebEdit managed attributes
    if (el.hasAttribute(WEBEDIT_MANAGED_ATTR)) {
      el.removeAttribute(WEBEDIT_MANAGED_ATTR);
      changed = true;
    }

    // 3. Force visibility if hidden
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
       // Restore original if known
       const orig = el.getAttribute(WEBEDIT_ORIG_DISPLAY_ATTR);
       if (orig) {
         el.style.setProperty("display", orig, el.getAttribute(WEBEDIT_ORIG_DISPLAY_PRIO_ATTR) || "");
       } else {
         el.style.removeProperty("display");
         el.style.removeProperty("visibility");
         el.style.removeProperty("opacity");
       }
       changed = true;
    }
    if (changed) revealed++;
  });
  return revealed;
}

function scanForOrphanedEdits(activeEdits = []) {
   const activeIds = new Set(activeEdits.map(e => e.id));
   const managed = document.querySelectorAll(`[${WEBEDIT_MANAGED_ATTR}], [${WEBEDIT_CLOUD_EDIT_ATTR}]`);
   let orphans = 0;
   managed.forEach(el => {
      const editIdAttr = el.getAttribute(WEBEDIT_CLOUD_EDIT_ATTR);
      if (editIdAttr && !activeIds.has(editIdAttr)) {
         console.warn("[WebEdit] Orphaned ADD edit detected:", editIdAttr, el);
         orphans++;
      }
      el.classList.forEach(c => {
        if (c.startsWith(WEBEDIT_HIDDEN_CLASS_PREFIX)) {
           const id = c.replace(WEBEDIT_HIDDEN_CLASS_PREFIX, "");
           if (!activeIds.has(id)) {
             console.warn("[WebEdit] Orphaned HIDE edit detected:", id, el);
             orphans++;
           }
        }
      });
   });
   if (orphans > 0) {
     console.log(`[WebEdit] Found ${orphans} orphaned edits on this page.`);
   }
   return orphans;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WEBEDIT_SESSION_UPDATED") {
    (async () => {
      try {
        const authorized = await isAuthenticated(true);
        if (!authorized) {
          stopPickMode();
          stopRemoveMode();
          clearHover();
          clearSelected();
          stopCloudEditsRuntime();
        }
        await applySavedEditsForUser("session-updated");
        sendResponse({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: message || "Failed to apply saved edits" });
      }
    })();
    return true;
  }
  if (message?.type === "WEBEDIT_SIDEPANEL_COMMAND") {
    (async () => {
      let authorized = await isAuthenticated();
      if (!authorized) {
        // Brief grace window for auth propagation after recent sign-in/refresh.
        await authWaitMs(220);
        authorized = await isAuthenticated(true);
      }
      if (!authorized) {
        stopPickMode();
        stopRemoveMode();
        clearHover();
        clearSelected();
        sendResponse({ ok: false, error: "Not authorized" });
        return;
      }
      const payload = message.payload || {};
      const type = payload.type;

    if (type === "START_PICK_MODE") {
      startPickMode();
      chrome.runtime.sendMessage({
        type: "WEBEDIT_MODE_STARTED",
        payload: { mode: "pick", reason: payload.reason || null }
      }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    if (type === "REMOVE_ELEMENT") {
      const result = removeElementBySelector(payload.selector);
      sendResponse(result);
      return true;
    }
    if (type === "START_REMOVE_MODE") {
      startRemoveMode();
      chrome.runtime.sendMessage({
        type: "WEBEDIT_MODE_STARTED",
        payload: { mode: "remove", reason: payload.reason || null }
      }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    if (type === "START_CUSTOMIZE_SESSION") {
      const result = startCustomizeSession(payload.selector);
      sendResponse(result);
      return true;
    }
    if (type === "PREVIEW_STYLES") {
      const result = previewStylesForSelector(payload.selector, payload.styles || {});
      sendResponse(result);
      return true;
    }
    if (type === "RESET_PREVIEW_STYLES") {
      const ok = resetPreviewStylesForSelector(payload.selector);
      sendResponse({ ok });
      return true;
    }
    if (type === "EXIT_FEATURES") {
      stopPickMode();
      stopRemoveMode();
      clearHover();
      clearSelected();
      sendResponse({ ok: true });
      chrome.runtime.sendMessage({ type: "WEBEDIT_MODE_EXITED" }).catch(() => {});
      return true;
    }
    if (type === "APPLY_STYLES") {
      const result = applyStylesToSelector(payload.selector, payload.styles || {});
      sendResponse(result?.ok ? result : { ok: false });
      return true;
    }
    if (type === "RESET_STYLES") {
      const ok = resetStylesForSelector(payload.selector);
      sendResponse({ ok });
      return true;
    }
    if (type === "ADD_FEATURE_CARD") {
      const result = injectFeatureCard(payload);
      sendResponse(result?.ok ? result : { ok: false });
      return true;
    }
    if (type === "REMOVE_FEATURE_CARD") {
      const ok = removeFeatureCardById(payload.featureId);
      sendResponse({ ok });
      return true;
    }
    if (type === "SET_ELEMENT_DISPLAY") {
      const ok = setElementDisplay(payload.selector, payload.value, payload.priority);
      sendResponse({ ok });
      return true;
    }
    if (type === "APPLY_STYLE_PATCH") {
      const ok = applyStylePatch(payload.selector, payload.patch || []);
      sendResponse({ ok });
      return true;
    }
    if (type === "MOVE_ELEMENT") {
      const ok = moveElement(payload.selector, payload.direction);
      sendResponse({ ok });
      return true;
    }
    if (type === "ALIGN_ELEMENT") {
      const ok = alignElement(payload.selector, payload.align);
      sendResponse({ ok });
      return true;
    }
    if (type === "APPLY_FEATURE_SPEC") {
      (async () => {
        const spec = payload.spec;
        const result = await applyFeatureSpecFlow(spec);
        sendResponse(result);
      })();
      return true;
    }
    if (type === "PREVIEW_FEATURE_SPEC") {
      (async () => {
        const spec = payload.spec || null;
        if (!spec) {
          sendResponse({ ok: false, error: "Missing spec" });
          return;
        }
        const previewId = payload.previewId || `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const res = await renderSpecPreviewInLab(spec, previewId);
        if (res?.ok) {
          previewLabPreviews.set(previewId, {
            type: "spec",
            spec,
            selector: spec.targetSelector || spec.selector || ""
          });
          if (spec.targetSelector || spec.selector) {
            setGhostHighlight(previewId, spec.targetSelector || spec.selector);
          }
          sendResponse({ ok: true, previewId });
          return;
        }
        sendResponse({
          ok: false,
          stage: res?.stage || "validation",
          error: res?.error || "Preview failed",
          failures: Array.isArray(res?.failures) ? res.failures : []
        });
      })();
      return true;
    }
    if (type === "COMMIT_FEATURE_SPEC") {
      (async () => {
        const store = window.FeatureStore;
        const previewId = payload.previewId || null;
        const handle = previewId ? previewLabPreviews.get(previewId) : null;
        const fallbackSpec = payload.spec || null;
        let specToApply = null;

        if (handle && handle.type === "spec") {
          const lab = getPreviewLab();
          const content = lab?.getContent?.() || {};
          const shadowRoot = lab?.getShadowRoot?.();
          const previewTarget = shadowRoot?.querySelector(`[${PREVIEW_LAB_TARGET_ATTR}="1"]`);
          const isAddSpec = handle.spec?.action === "add";
          let html = content.html || "";
          if (isAddSpec && previewTarget) {
            const insertedNodes = Array.from(
              previewTarget.querySelectorAll(`[data-webedit-ai-insert-id="${CSS.escape(previewId)}"]`)
            );
            const insertedHtml = insertedNodes
              .map((node) => (node instanceof Element ? node.outerHTML : ""))
              .join("\n")
              .trim();
            html = insertedHtml || handle.spec.html || "";
          } else if (previewTarget && previewTarget.innerHTML.trim()) {
            html = previewTarget.innerHTML;
          } else if (previewTarget) {
            const mount = lab?.getMountNode?.();
            if (mount) {
              const clone = mount.cloneNode(true);
              const placeholder = clone.querySelector(`[${PREVIEW_LAB_TARGET_ATTR}="1"]`);
              if (placeholder) placeholder.remove();
              html = clone.innerHTML;
            }
          }
          specToApply = {
            ...handle.spec,
            html: html || handle.spec.html,
            css: content.css || handle.spec.css,
            js: content.js || handle.spec.js
          };
        } else if (fallbackSpec) {
          specToApply = fallbackSpec;
        } else {
          sendResponse({ ok: false, error: "Preview not found" });
          return;
        }

        const result = await applyFeatureSpecFlow(specToApply);
        if (result?.ok) {
          if (store && typeof store.addCommittedFeature === "function" && result.record) {
            await store.addCommittedFeature(result.record);
          }
          if (previewId) {
            previewLabPreviews.delete(previewId);
            clearGhostHighlight(previewId);
          }
          const lab = getPreviewLab();
          lab?.close?.();
        }
        sendResponse(result);
      })();
      return true;
    }
    if (type === "UNDO_FEATURE_SPEC") {
      const previewId = payload.previewId || null;
      if (previewId && previewLabPreviews.has(previewId)) {
        previewLabPreviews.delete(previewId);
        clearGhostHighlight(previewId);
        const lab = getPreviewLab();
        lab?.close?.();
        sendResponse({ ok: true });
        return true;
      }
      sendResponse({ ok: false, error: "Preview not found" });
      return true;
    }
    if (type === "PREVIEW_FEATURE") {
      (async () => {
        const plan = payload.plan || null;
        if (!plan) {
          sendResponse({ ok: false, error: "Missing plan" });
          return;
        }
        const previewId = payload.previewId || plan.id || `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const res = await renderPlanPreviewInLab(plan, previewId);
        if (res?.ok) {
          previewLabPreviews.set(previewId, { type: "plan", plan, selector: plan.targetSelector || "" });
          if (plan.targetSelector) setGhostHighlight(previewId, plan.targetSelector);
          sendResponse({ ok: true, previewId, plan });
          return;
        }
        sendResponse({ ok: false, error: res?.error || "Preview failed" });
      })();
      return true;
    }
    if (type === "REOPEN_PREVIEW") {
      (async () => {
        const previewId = payload.previewId || `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const previewKind = payload.previewKind || "plan";
        if (previewKind === "spec") {
          const spec = payload.spec || null;
          if (!spec) {
            sendResponse({ ok: false, error: "Missing spec" });
            return;
          }
          const res = await renderSpecPreviewInLab(spec, previewId);
          if (!res?.ok) {
            sendResponse({ ok: false, error: res?.error || "Preview failed" });
            return;
          }
          previewLabPreviews.set(previewId, {
            type: "spec",
            spec,
            selector: spec.targetSelector || spec.selector || ""
          });
          if (spec.targetSelector || spec.selector) {
            setGhostHighlight(previewId, spec.targetSelector || spec.selector);
          }
          sendResponse({ ok: true, previewId });
          return;
        }
        const plan = payload.plan || null;
        if (!plan) {
          sendResponse({ ok: false, error: "Missing plan" });
          return;
        }
        const res = await renderPlanPreviewInLab(plan, previewId);
        if (!res?.ok) {
          sendResponse({ ok: false, error: res?.error || "Preview failed" });
          return;
        }
        previewLabPreviews.set(previewId, { type: "plan", plan, selector: plan.targetSelector || "" });
        if (plan.targetSelector) setGhostHighlight(previewId, plan.targetSelector);
        sendResponse({ ok: true, previewId });
      })();
      return true;
    }
    if (type === "COMMIT_FEATURE") {
      (async () => {
        const engine = window.FeatureEngine;
        const store = window.FeatureStore;
        if (!engine || typeof engine.applyFeature !== "function") {
          sendResponse({ ok: false, error: "FeatureEngine not available" });
          return;
        }
        if (!store || typeof store.addCommittedFeature !== "function") {
          sendResponse({ ok: false, error: "FeatureStore not available" });
          return;
        }
        const previewId = payload.previewId || null;
        const plan = payload.plan || null;
        let result = null;
        if (previewId && previewLabPreviews.has(previewId)) {
          const handle = previewLabPreviews.get(previewId);
          if (handle?.type === "plan") {
            result = engine.applyFeature(handle.plan, "commit", { id: previewId });
          } else {
            result = { ok: false, error: "Preview type mismatch" };
          }
        } else if (previewId) {
          result = plan ? engine.applyFeature(plan, "commit", { id: previewId }) : engine.commitPreview(previewId);
        } else {
          result = engine.applyFeature(plan, "commit");
        }
        if (!result?.ok) {
          sendResponse(result || { ok: false, error: "Commit failed" });
          return;
        }
        if (result.record) {
          await store.addCommittedFeature(result.record);
        }
        if (previewId && previewLabPreviews.has(previewId)) {
          previewLabPreviews.delete(previewId);
          clearGhostHighlight(previewId);
          const lab = getPreviewLab();
          lab?.close?.();
        }
        sendResponse({ ok: true, record: result.record || null });
      })();
      return true;
    }
    if (type === "UNDO_FEATURE") {
      const engine = window.FeatureEngine;
      if (payload.previewId) {
        if (previewLabPreviews.has(payload.previewId)) {
          previewLabPreviews.delete(payload.previewId);
          clearGhostHighlight(payload.previewId);
          const lab = getPreviewLab();
          lab?.close?.();
          sendResponse({ ok: true });
          return true;
        }
        if (!engine) {
          sendResponse({ ok: false, error: "FeatureEngine not available" });
          return true;
        }
        const res = engine.undoPreview(payload.previewId);
        sendResponse(res);
        return true;
      }
      sendResponse({ ok: false, error: "Missing previewId" });
      return true;
    }
    if (type === "UNDO_LAST") {
      (async () => {
        try {
          const store = window.FeatureStore;
          if (store && typeof store.undoLastCommit === "function") {
            const storeRes = await store.undoLastCommit();
            if (storeRes?.ok) {
              sendResponse(storeRes);
              return;
            }
          }
          const exec = window.FeatureSpecExecutor;
          if (!exec || typeof exec.undoLast !== "function") {
            sendResponse({ ok: false, error: "Undo not available" });
            return;
          }
          const result = await exec.undoLast();
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      })();
      return true;
    }
    if (type === "REDO_LAST") {
      (async () => {
        try {
          const store = window.FeatureStore;
          if (store && typeof store.redoLastCommit === "function") {
            const storeRes = await store.redoLastCommit();
            if (storeRes?.ok) {
              sendResponse(storeRes);
              return;
            }
          }
          const exec = window.FeatureSpecExecutor;
          if (!exec || typeof exec.redoLast !== "function") {
            sendResponse({ ok: false, error: "Redo not available" });
            return;
          }
          const result = await exec.redoLast();
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      })();
      return true;
    }
    if (type === "UNDO_BY_ID") {
      (async () => {
        try {
          const exec = window.FeatureSpecExecutor;
          if (!exec || typeof exec.undoById !== "function") {
            sendResponse({ ok: false, error: "UndoById not available" });
            return;
          }
          const result = await exec.undoById(payload.targetId);
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      })();
      return true;
    }
    if (type === "REVEAL_HEADER") {
      const count = revealLikelyHeader();
      sendResponse({ ok: true, count });
      return true;
    }
    if (type === "GET_ADD_CONTEXT") {
      const selector = payload.selector || payload.targetSelector || "";
      const extractor = window.ContextExtractor;
      if (!selector) {
        sendResponse({ ok: false, error: "Missing selector" });
        return true;
      }
      if (!extractor || typeof extractor.extractContext !== "function") {
        sendResponse({ ok: false, error: "ContextExtractor not available" });
        return true;
      }
      const result = extractor.extractContext(selector);
      sendResponse(result);
      return true;
    }
    if (type === "GET_SITE_CAPABILITIES") {
      const selector = payload.selector || payload.targetSelector || "";
      const extractor = window.ContextExtractor;
      if (!extractor || typeof extractor.assessCapabilities !== "function") {
        sendResponse({ ok: false, error: "Capability engine not available" });
        return true;
      }
      const result = extractor.assessCapabilities(selector);
      sendResponse(result);
      return true;
    }
    if (type === "GET_PAGE_CONTEXT") {
      // Prefer FeatureSpecExecutor page context when available (it provides a richer outline),
      // but always include plain text for the AI endpoints.
      const plainText = getPagePlainText();
      const exec = window.FeatureSpecExecutor;
      if (exec && typeof exec.getPageContext === "function") {
        try {
          const ctx = exec.getPageContext() || {};
          sendResponse({
            ok: true,
            pageContext: {
              url: ctx.url || location.href,
              title: ctx.title || document.title || "",
              text: typeof ctx.text === "string" && ctx.text.trim() ? ctx.text : plainText,
              outline: ctx.outline ?? null
            }
          });
          return true;
    } catch (error) {
          // Fall through to basic context below.
        }
      }
      sendResponse({
        ok: true,
        pageContext: {
          url: location.href,
          title: document.title || "",
          text: plainText,
          outline: null
        }
      });
      return true;
    }

    sendResponse({ ok: false, error: "Unknown command" });
    return true;
    })();
    return true;
  }

  if (message?.type === "PING") {
    sendResponse({ ok: true, status: "ready" });
    return true;
  }

  if (message?.type === "WEBEDIT_FROM_SIDEPANEL") {
    sendResponse({ ok: true, received: true });
    return true;
  }

  return false;
});

// Re-apply saved edits on each page load, but yield to main thread first
// to avoid conflicts with hydration (e.g. React error #418).
if (typeof requestIdleCallback === "function") {
  requestIdleCallback(() => applySavedEditsForUser("initial-load"), { timeout: 3000 });
} else {
  setTimeout(() => applySavedEditsForUser("initial-load"), 500);
}
