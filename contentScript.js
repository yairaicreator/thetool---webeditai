// WebEdit AI Content Script (side panel controlled)
// Handles DOM interactions (pick/remove/customize/apply/add) on the active page.

console.log("[WebEdit] contentScript loaded on", location.href);

let isPickMode = false;
let isRemoveMode = false;
let hoverEl = null;
let selectedEl = null;

let lastPicked = null; // { selector, description }
let currentUser = null; // { id, email, ... }

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

function isProbablyWebEditAppPage() {
  try {
    const host = (location.hostname || "").toLowerCase();
    return host === "webeditai.com" || host === "www.webeditai.com";
  } catch (_) {
    return false;
  }
}

async function getSupabaseAuth() {
  try {
    const client = window.SupabaseClient;
    if (!client) return null;
    const { data: { session } } = await client.getSession();
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
  const fullUrl = location.href;
  const qs = new URLSearchParams({
    select: "id",
    full_url: `eq.${fullUrl}`
  });
  const url = `${auth.url}/rest/v1/websites?${qs.toString()}`;
  const data = await supabaseJsonGet(url, auth.token, auth.anonKey);
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
  if (!auth || !websiteId) return [];

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
    // Graceful degradation: if schema differs or table missing, skip.
    console.warn("[WebEdit] Supabase fetchActiveEdits failed:", e?.message || e);
    return [];
  });
  if (!Array.isArray(data)) return [];

  // Extra safety: enforce user_id match client-side if present.
  return data
    .filter((row) => !row?.user_id || row.user_id === auth.userId)
    .filter((row) => (row?.status || "active") === "active");
}

function clearAppliedCloudEdits() {
  // 1) Remove injected "Add" features (cloud-managed only)
  try {
    const injected = Array.from(document.querySelectorAll(`[${WEBEDIT_CLOUD_EDIT_ATTR}]`));
    injected.forEach((node) => {
      try { node.remove(); } catch (_) {}
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
      try { node.remove(); } catch (_) {}
    });
  } catch (_) {}

  // 2) Remove injected style tags for Customize edits
  try {
    const styleEls = Array.from(document.querySelectorAll(`style[id^="${WEBEDIT_STYLE_ID_PREFIX}"]`));
    styleEls.forEach((el) => {
      try { el.remove(); } catch (_) {}
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
      }
    });
  } catch (_) {}
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

function applyAddEdit(editId, payload) {
  if (!editId || !payload || typeof payload !== "object") return false;
  // Ensure we always wrap the inserted feature so cleanup is reliable.
  const result = injectFeatureCard({ ...(payload || {}), editId });
  return !!result?.ok;
}

function applyActiveEditsInOrder(edits) {
  if (!Array.isArray(edits) || edits.length === 0) return { applied: 0 };
  let applied = 0;
  for (const row of edits) {
    const editId = row?.id || row?.edit_id || row?.editId;
    const type = normalizeEditType(row);
    const payload = row?.payload || row?.metadata?.payload || row?.data || {};
    if (!editId || !type) continue;

    try {
      if (type === "add") {
        if (applyAddEdit(editId, payload)) applied += 1;
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
      const auth = await getSupabaseAuth();
      if (!auth?.userId) return { ok: false, skipped: true, reason: "no-auth" };
      if (isProbablyWebEditAppPage()) return { ok: false, skipped: true, reason: "webedit-app" };

      const websiteId = cloudWebsiteId || await fetchWebsiteIdForCurrentUrl();
      cloudWebsiteId = websiteId;
      if (!websiteId) return { ok: false, skipped: true, reason: "no-website-id" };

      // Deterministic correctness: clear everything we manage, then reapply ACTIVE edits in order.
      clearAppliedCloudEdits();
      const edits = await fetchActiveEditsForWebsite(websiteId);
      // stable order (server orders by created_at asc, but keep client-side fallback)
      edits.sort((a, b) => String(a?.created_at || "").localeCompare(String(b?.created_at || "")));
      const result = applyActiveEditsInOrder(edits);
      
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

async function initCloudEditsRuntime() {
  try {
    if (cloudRuntimeStarted) return;
    const auth = await getSupabaseAuth();
    if (!auth?.userId) return;
    if (isProbablyWebEditAppPage()) return;

    cloudWebsiteId = await fetchWebsiteIdForCurrentUrl();
    if (!cloudWebsiteId) return;

    cloudRuntimeStarted = true;
    startCloudRealtimeSubscription(auth.userId, cloudWebsiteId);
    scheduleCloudRebuild("init", 50);

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

// Best-effort cleanup on navigation/unload (avoid dangling sockets / timers)
try {
  window.addEventListener("beforeunload", () => {
    try { cloudRealtime?.close?.(); } catch (_) {}
    try { if (cloudPollTimer) clearInterval(cloudPollTimer); } catch (_) {}
  });
} catch (_) {}

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

async function applySavedEditsForUser() {
  await refreshCurrentUser();
  if (!currentUser?.id) {
    return;
  }

  // Cloud edits (Supabase `edits` table) apply + realtime undo/redo sync
  // This is separate from EditRules and is driven only by Supabase (Realtime + polling).
  initCloudEditsRuntime().catch(() => {});

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
  const description = generateDescriptionForElement(el);
  const prevDisplayValue = el.style.getPropertyValue("display") || "";
  const prevDisplayPriority = el.style.getPropertyPriority("display") || "";

  // Apply hide
  el.style.setProperty("display", "none", "important");

  // Persist hide so it survives refresh
  ensureEditRulesReady().then((editRules) => {
    if (!editRules || !selector) return;
    editRules.createRule(el, "hide", {}, currentUser, selector).then((rule) => {
      if (window.SaveEdit?.saveRemoveEdit) {
        window.SaveEdit.saveRemoveEdit(el, rule).catch(() => {});
      }
    }).catch((err) => {
      console.warn("[WebEdit] Failed to persist hide:", err);
    });
  });

  stopRemoveMode();
  chrome.runtime.sendMessage({ type: "WEBEDIT_MODE_EXITED" }).catch(() => {});

}

function applyStylesToSelector(selector, styles) {
  if (!selector) return false;
  const el = document.querySelector(selector);
  if (!el) return false;
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
  el.style.removeProperty("background-color");
  el.style.removeProperty("color");
  el.style.removeProperty("font-size");
  el.style.removeProperty("width");
  el.style.removeProperty("height");
  el.style.removeProperty("transform");
  el.style.removeProperty("transform-origin");
  el.style.removeProperty("display");
  el.style.removeProperty("margin-left");
  el.style.removeProperty("margin-right");
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
        await applySavedEditsForUser();
        sendResponse({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: message || "Failed to apply saved edits" });
      }
    })();
    return true;
  }
  if (message?.type === "WEBEDIT_SIDEPANEL_COMMAND") {
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
    if (type === "START_REMOVE_MODE") {
      startRemoveMode();
      chrome.runtime.sendMessage({
        type: "WEBEDIT_MODE_STARTED",
        payload: { mode: "remove", reason: payload.reason || null }
      }).catch(() => {});
      sendResponse({ ok: true });
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
        try {
          const exec = window.FeatureSpecExecutor;
          if (!exec || typeof exec.applyFeatureSpec !== "function") {
            sendResponse({ ok: false, error: "FeatureSpec executor not found" });
            return;
          }
          const result = await exec.applyFeatureSpec(payload.spec);
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      })();
      return true;
    }
    if (type === "UNDO_LAST") {
      (async () => {
        try {
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
  requestIdleCallback(() => applySavedEditsForUser(), { timeout: 3000 });
} else {
  setTimeout(() => applySavedEditsForUser(), 500);
}
