'use strict';

importScripts('supabaseClient.js');

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 0: Feature Module Registry (must load before feature importScripts)
// Each feature file calls registerFeature() to plug into the Brain.
// ═══════════════════════════════════════════════════════════════════════════════

const featureModules = {};

function registerFeature(name, handlers) {
  featureModules[name] = handlers;
  console.log('[Brain] Feature registered:', name);
}

function getFeatureHandler(featureName, handlerName) {
  return featureModules[featureName]?.[handlerName] || null;
}

importScripts('features/remove-brain.js');
importScripts('features/customize-brain.js');
importScripts('features/add-action-ops.js');
importScripts('features/add-brain.js');

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Side Panel Activation
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[Brain] sidePanel behavior error:', error));
});

chrome.runtime.onStartup.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch(function (error) { console.error('[Brain] sidePanel behavior error:', error); });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Auth Session Management
// (Used by bridge-listener.js & supabaseClient.js — do not remove)
// ═══════════════════════════════════════════════════════════════════════════════

const SUPABASE_SESSION_KEY = 'webeditSupabaseSession';
const SUPABASE_SESSION_TIMESTAMP_KEY = 'webeditSessionTimestamp';
const WEBSITE_TAB_URL_PATTERNS = [
  'https://webeditai.com/*',
  'https://www.webeditai.com/*'
];

function normalizeSessionFingerprint(session) {
  if (!session || typeof session !== 'object') return '';
  return JSON.stringify({
    access_token: session.access_token || null,
    refresh_token: session.refresh_token || null,
    expires_at: session.expires_at || null,
    user_id: session.user?.id || null,
    email: session.user?.email || null
  });
}

async function getStoredSupabaseSessionRecord() {
  const result = await chrome.storage.local.get([SUPABASE_SESSION_KEY, SUPABASE_SESSION_TIMESTAMP_KEY]);
  return {
    session: result[SUPABASE_SESSION_KEY] || null,
    timestamp: result[SUPABASE_SESSION_TIMESTAMP_KEY] || null
  };
}

async function sendSessionToWebsiteTabs(session) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: WEBSITE_TAB_URL_PATTERNS });
  } catch (_) {}

  await Promise.all(
    tabs.map(async function (tab) {
      if (!tab?.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'WEBEDIT_EXTENSION_SESSION_CHANGED',
          session: session || null
        });
      } catch (_) {}
    })
  );
}

async function broadcastSessionUpdate(session) {
  try {
    await chrome.runtime.sendMessage({
      type: 'WEBEDIT_SESSION_UPDATED',
      session: session || null
    });
  } catch (_) {}

  await sendSessionToWebsiteTabs(session || null);
}

async function clearUserScopedKeys(previousUserId) {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = [SUPABASE_SESSION_KEY, SUPABASE_SESSION_TIMESTAMP_KEY];

  if (previousUserId) {
    Object.keys(all || {}).forEach(function (key) {
      if (key.indexOf('::' + previousUserId) !== -1) {
        keysToRemove.push(key);
      }
    });
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

async function storeSupabaseSession(session) {
  const existing = await getStoredSupabaseSessionRecord();
  const nextFingerprint = normalizeSessionFingerprint(session);
  const currentFingerprint = normalizeSessionFingerprint(existing.session);
  const unchanged = nextFingerprint === currentFingerprint;

  if (unchanged) {
    return {
      ok: true,
      success: true,
      unchanged: true,
      session: existing.session,
      timestamp: existing.timestamp
    };
  }

  if (session) {
    const timestamp = Date.now();
    await chrome.storage.local.set({
      [SUPABASE_SESSION_KEY]: session,
      [SUPABASE_SESSION_TIMESTAMP_KEY]: timestamp
    });
  } else {
    const previousUserId = existing.session?.user?.id || null;
    await clearUserScopedKeys(previousUserId);
  }

  const stored = await getStoredSupabaseSessionRecord();
  await broadcastSessionUpdate(stored.session);
  return {
    ok: true,
    success: true,
    unchanged: false,
    session: stored.session,
    timestamp: stored.timestamp
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: The Global Ledger (Active Memory)
// O(1) dictionary: { url -> { editId -> editData } }
// ═══════════════════════════════════════════════════════════════════════════════

async function getLedger() {
  const result = await chrome.storage.local.get('ledger');
  return result.ledger || {};
}

async function saveLedger(ledger) {
  await chrome.storage.local.set({ ledger });
}

function generateEditId() {
  return crypto.randomUUID();
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePageKey(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
  } catch (_) {
    return String(url).trim();
  }
}

function getCategoryFromAction(editType, payloadOrMeta) {
  const meta = isPlainObject(payloadOrMeta) ? payloadOrMeta : {};
  const explicit = String(meta.historyCategory || meta.category || meta.feature || '').toLowerCase();

  if (explicit === 'remove' || explicit === 'add' || explicit === 'customize') {
    return explicit;
  }

  switch (String(editType || '').toLowerCase()) {
    case 'hide':
    case 'remove':
      return 'remove';
    case 'text':
    case 'add':
      return 'add';
    case 'style':
    case 'custom':
    case 'customize':
    default:
      return 'customize';
  }
}

function getDbActionFromEdit(action, payload) {
  const normalized = String(action || '').toLowerCase();
  const blueprint = isPlainObject(payload) ? payload : {};

  switch (normalized) {
    case 'remove':
    case 'hide':
      return 'remove';
    case 'customize':
    case 'style':
      return 'style';
    case 'add':
      return blueprint.html || blueprint.js ? 'custom' : 'text';
    case 'text':
    case 'custom':
      return normalized;
    default:
      return 'custom';
  }
}

function getDefaultPreview(category, phase) {
  if (category === 'remove') {
    return phase === 'before'
      ? { label: 'Visible', color: '#34d399', accent: '#ecfeff' }
      : { label: 'Hidden', color: '#0f172a', accent: '#cbd5e1' };
  }

  if (category === 'add') {
    return phase === 'before'
      ? { label: 'Before', color: '#cbd5e1', accent: '#f8fafc' }
      : { label: 'Added', color: '#8b5cf6', accent: '#ede9fe' };
  }

  return phase === 'before'
    ? { label: 'Before', color: '#60a5fa', accent: '#dbeafe' }
    : { label: 'After', color: '#f97316', accent: '#ffedd5' };
}

function normalizePreviewToken(token, fallback) {
  if (typeof token === 'string' && token.trim()) {
    return {
      label: token.trim(),
      color: fallback.color,
      accent: fallback.accent
    };
  }

  if (isPlainObject(token)) {
    return {
      label: token.label || fallback.label,
      color: token.color || fallback.color,
      accent: token.accent || fallback.accent
    };
  }

  return fallback;
}

function getDefaultSummary(category, selector) {
  const shortSelector = String(selector || '').trim();
  if (category === 'remove') return shortSelector ? 'Hidden element' : 'Removed item';
  if (category === 'add') return shortSelector ? 'Added feature' : 'New feature';
  return shortSelector ? 'Styled element' : 'Customized item';
}

function getDefaultDescription(category, selector) {
  const target = String(selector || '').trim() || 'the selected element';
  if (category === 'remove') {
    return 'This edit hides ' + target + ' from the page layout.';
  }
  if (category === 'add') {
    return 'This edit adds new content or functionality near ' + target + '.';
  }
  return 'This edit changes the visual appearance of ' + target + '.';
}

function buildHistoryMetadata(editData) {
  const payload = isPlainObject(editData?.payload) ? editData.payload : {};
  const category = getCategoryFromAction(editData?.action, payload);
  const summary = String(payload.summary || payload.title || payload.label || '').trim()
    || getDefaultSummary(category, editData?.selector);
  const description = String(payload.description || payload.details || payload.prompt || '').trim()
    || getDefaultDescription(category, editData?.selector);

  return {
    historyCategory: category,
    summary,
    description,
    beforePreview: normalizePreviewToken(
      payload.beforePreview || payload.before || payload.previewBefore,
      getDefaultPreview(category, 'before')
    ),
    afterPreview: normalizePreviewToken(
      payload.afterPreview || payload.after || payload.previewAfter,
      getDefaultPreview(category, 'after')
    ),
    blueprint: payload
  };
}

function extractBlueprintPayload(metadata) {
  const meta = isPlainObject(metadata) ? metadata : {};
  if (isPlainObject(meta.blueprint)) {
    return meta.blueprint;
  }
  if (isPlainObject(meta.payload)) {
    return meta.payload;
  }

  const fallback = { ...meta };
  delete fallback.historyCategory;
  delete fallback.summary;
  delete fallback.description;
  delete fallback.beforePreview;
  delete fallback.afterPreview;
  return fallback;
}

function rowToLedgerEdit(row) {
  const website = isPlainObject(row?.websites) ? row.websites : {};
  const pageKey = normalizePageKey(website.full_url || '');
  const payload = isPlainObject(row?.payload) ? row.payload : {};
  const category = getCategoryFromAction(row?.edit_type, payload);

  return {
    pageKey,
    action: category,
    selector: payload.selector || '',
    status: row?.status === 'active' ? 'active' : 'inactive',
    payload,
    createdAt: row?.created_at ? Date.parse(row.created_at) : Date.now(),
    updatedAt: row?.updated_at ? Date.parse(row.updated_at) : null,
  };
}

function getActiveBlueprintsForPage(ledger, url) {
  const pageKey = normalizePageKey(url);
  const editsForUrl = ledger[pageKey] || {};
  const activeBlueprints = {};

  for (const [id, edit] of Object.entries(editsForUrl)) {
    if (edit.status === 'active') {
      activeBlueprints[id] = edit;
    }
  }

  return { pageKey, blueprints: activeBlueprints };
}

function parsePageDetails(pageKey) {
  try {
    const parsed = new URL(pageKey);
    return {
      hostname: parsed.hostname,
      pageLabel: parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/',
      fullLabel: parsed.hostname + (parsed.pathname || '/')
    };
  } catch (_) {
    return {
      hostname: pageKey,
      pageLabel: pageKey,
      fullLabel: pageKey
    };
  }
}

function rowToHistoryEntry(row) {
  const website = isPlainObject(row?.websites) ? row.websites : {};
  const payload = isPlainObject(row?.payload) ? row.payload : {};
  const category = getCategoryFromAction(row?.edit_type, payload);
  const pageKey = normalizePageKey(website.full_url || '');
  const pageDetails = parsePageDetails(pageKey);
  const selector = payload.selector || '';

  const previewBefore = normalizePreviewToken(
    payload.beforePreview || payload.before,
    getDefaultPreview(category, 'before')
  );
  const previewAfter = normalizePreviewToken(
    payload.afterPreview || payload.after,
    getDefaultPreview(category, 'after')
  );

  return {
    id: row.id,
    pageKey,
    hostname: pageDetails.hostname,
    pageLabel: pageDetails.pageLabel,
    fullLabel: pageDetails.fullLabel,
    siteTitle: website.title || '',
    siteOrigin: website.origin || '',
    selector,
    category,
    summary: String(row.name || payload.summary || '').trim() || getDefaultSummary(category, selector),
    description: String(row.description || payload.description || '').trim() || getDefaultDescription(category, selector),
    isActive: row.status === 'active',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    beforeImageUrl: row.before_image_url || null,
    afterImageUrl: row.after_image_url || null,
    previews: {
      before: previewBefore,
      after: previewAfter
    }
  };
}

function buildHistorySites(rows) {
  const byPage = new Map();

  rows.forEach(function (row) {
    const entry = rowToHistoryEntry(row);
    if (!byPage.has(entry.pageKey)) {
      byPage.set(entry.pageKey, {
        pageKey: entry.pageKey,
        hostname: entry.hostname,
        pageLabel: entry.pageLabel,
        fullLabel: entry.fullLabel,
        siteTitle: entry.siteTitle,
        siteOrigin: entry.siteOrigin,
        latestTimestamp: 0,
        categories: {
          remove: [],
          add: [],
          customize: []
        }
      });
    }

    const site = byPage.get(entry.pageKey);
    site.categories[entry.category].push(entry);
    const stamp = Date.parse(entry.updatedAt || entry.createdAt || '') || 0;
    if (stamp > site.latestTimestamp) {
      site.latestTimestamp = stamp;
    }
  });

  return Array.from(byPage.values())
    .map(function (site) {
      site.categories.remove.sort(function (a, b) {
        return (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0);
      });
      site.categories.add.sort(function (a, b) {
        return (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0);
      });
      site.categories.customize.sort(function (a, b) {
        return (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0);
      });
      return site;
    })
    .sort(function (a, b) {
      return b.latestTimestamp - a.latestTimestamp;
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Auth Helper & Dual-Write Sync (Permanent Hard Drive)
// Local storage first, then fire-and-forget Supabase push.
// ═══════════════════════════════════════════════════════════════════════════════

async function getSessionInfo() {
  try {
    const { data: { session } } = await SupabaseClient.getSession();
    if (!session?.access_token || !session?.user?.id) return null;
    return { accessToken: session.access_token, userId: session.user.id };
  } catch (e) {
    console.warn('[Brain] Failed to retrieve session:', e.message);
    return null;
  }
}

async function ensureWebsiteRow(auth, url) {
  const normalizedUrl = normalizePageKey(url);
  if (!normalizedUrl) return null;

  let parsed;
  try { parsed = new URL(normalizedUrl); } catch (_) { return null; }

  const origin = parsed.origin || '';
  const path = parsed.pathname || '/';

  const checkResp = await fetch(
    `${SUPABASE_URL}/rest/v1/websites?user_id=eq.${auth.userId}&origin=eq.${encodeURIComponent(origin)}&path=eq.${encodeURIComponent(path)}&select=id`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${auth.accessToken}`,
      }
    }
  );

  const existing = await checkResp.json().catch(() => []);
  if (Array.isArray(existing) && existing.length > 0 && existing[0].id) {
    return existing[0].id;
  }

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/websites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${auth.accessToken}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      user_id: auth.userId,
      full_url: normalizedUrl,
      origin: origin,
      path: path,
      title: parsed.hostname || normalizedUrl,
    }),
  });

  if (insertResp.status === 409) {
    const fallbackResp = await fetch(
      `${SUPABASE_URL}/rest/v1/websites?user_id=eq.${auth.userId}&origin=eq.${encodeURIComponent(origin)}&path=eq.${encodeURIComponent(path)}&select=id`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${auth.accessToken}`,
        }
      }
    );
    const fallbackRows = await fallbackResp.json().catch(() => []);
    if (Array.isArray(fallbackRows) && fallbackRows.length > 0 && fallbackRows[0].id) {
      return fallbackRows[0].id;
    }
    return null;
  }

  const inserted = await insertResp.json().catch(() => []);
  if (Array.isArray(inserted) && inserted.length > 0 && inserted[0].id) {
    return inserted[0].id;
  }
  if (inserted && inserted.id) {
    return inserted.id;
  }
  return null;
}

async function syncInsertToSupabase(editId, url, editData) {
  try {
    const auth = await getSessionInfo();
    if (!auth) {
      console.warn('[Brain] No active session — skipping Supabase insert.');
      return false;
    }

    const websiteId = await ensureWebsiteRow(auth, url);
    if (!websiteId) {
      console.warn('[Brain] Could not resolve website row — skipping Supabase insert.');
      return false;
    }

    const historyMeta = buildHistoryMetadata(editData);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/edits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${auth.accessToken}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        id: editId,
        user_id: auth.userId,
        website_id: websiteId,
        edit_type: getCategoryFromAction(editData.action, editData.payload),
        status: 'active',
        name: historyMeta.summary || '',
        description: historyMeta.description || '',
        payload: isPlainObject(editData.payload) ? editData.payload : {},
        before_image_url: null,
        after_image_url: null,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[Brain] Supabase insert failed (${response.status}):`, text);
      return false;
    }

    const rows = await response.json().catch(() => []);
    const inserted = Array.isArray(rows) ? rows[0] : rows;
    if (!inserted || !inserted.id) {
      console.warn('[Brain] Supabase insert returned 2xx but no row — possible RLS or trigger rejection');
      return false;
    }

    return inserted.id;
  } catch (e) {
    console.warn('[Brain] Supabase insert network error:', e.message);
    return false;
  }
}

async function syncStatusToSupabase(editId, newStatus) {
  try {
    const auth = await getSessionInfo();
    if (!auth) {
      console.warn('[Brain] No active session — skipping Supabase status update.');
      return;
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/edits?id=eq.${encodeURIComponent(editId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${auth.accessToken}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ status: newStatus === 'active' ? 'active' : 'inactive' }),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[Brain] Supabase status update failed (${response.status}):`, text);
    }
  } catch (e) {
    console.warn('[Brain] Supabase status update network error:', e.message);
  }
}

async function syncEditPayloadToSupabase(editId, editData) {
  try {
    const auth = await getSessionInfo();
    if (!auth) {
      console.warn('[Brain] No active session — skipping Supabase payload update.');
      return false;
    }

    const meta = buildHistoryMetadata(editData);
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/edits?id=eq.${encodeURIComponent(editId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${auth.accessToken}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          payload: isPlainObject(editData.payload) ? editData.payload : {},
          name: meta.summary || '',
          description: meta.description || '',
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[Brain] Supabase payload update failed (${response.status}):`, text);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Brain] Supabase payload update network error:', e.message);
    return false;
  }
}

async function brainResetForArmingFlow() {
  const tabId = brainState.lockedTabId;
  if (brainState.current !== BRAIN_STATES.IDLE && tabId) {
    if (brainState.activeFlow?.feature === 'add') {
      try {
        await dispatchToTab(tabId, { type: 'CLOSE_PREVIEW' });
      } catch (_) {}
    }
    if (brainState.current === BRAIN_STATES.PREVIEWING && brainState.activeFlow?.feature === 'customize') {
      try {
        await dispatchToTab(tabId, { type: 'CLEAR_PREVIEW_CSS' });
      } catch (_) {}
    }
    try {
      await dispatchToTab(tabId, { type: 'STOP_PICK_MODE' });
    } catch (_) {}
  }
  resetState();
}

async function handleArmReviseAdd(message, callerTabId) {
  await brainResetForArmingFlow();

  const editId = String(message.editId || '').trim();
  const url = normalizePageKey(message.url || '');
  if (!editId || !url) {
    return { success: false, error: 'Missing editId or url' };
  }

  const ledger = await getLedger();
  const edit = ledger[url]?.[editId];
  if (!edit) {
    return { success: false, error: 'Edit not found on this page' };
  }

  const action = String(edit.action || '').toLowerCase();
  if (action !== 'add' && action !== 'text') {
    return { success: false, error: 'This edit is not an Add feature' };
  }

  const payload = isPlainObject(edit.payload) ? edit.payload : {};
  const html = payload.html || '';
  const css = payload.css || '';
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const selector = String(edit.selector || payload.targetSelector || '').trim();
  if (!selector) {
    return { success: false, error: 'Missing anchor selector for this edit' };
  }

  const tabId = await resolveTargetTabId(callerTabId);
  if (!tabId) {
    return { success: false, error: 'No active website tab found. Please open or focus a website tab.' };
  }

  const humanLabel = String(payload.summary || '').trim() || selectorToHumanLabel(selector);
  const seedUser = webeditBuildReviseSeedUserMessage('', selector, url);
  const seedModel = JSON.stringify({ html: html, css: css, actions: actions });

  transitionState(BRAIN_STATES.PREVIEWING, {
    feature: 'add',
    tabId: tabId,
    selector: selector,
    url: url,
    humanLabel: humanLabel,
    htmlContext: '',
    spec: { html: html, css: css, actions: actions, targetSelector: selector },
    reviseEditId: editId,
    conversationHistory: [
      { role: 'user', text: seedUser },
      { role: 'model', text: seedModel },
    ],
  });

  return { success: true, state: 'PREVIEWING', feature: 'add' };
}

async function handleResumeCustomizeEdit(message, callerTabId) {
  await brainResetForArmingFlow();

  const editId = String(message.editId || '').trim();
  const url = normalizePageKey(message.url || '');
  if (!editId || !url) {
    return { success: false, error: 'Missing editId or url' };
  }

  const ledger = await getLedger();
  const edit = ledger[url]?.[editId];
  if (!edit) {
    return { success: false, error: 'Edit not found on this page' };
  }

  const action = String(edit.action || '').toLowerCase();
  if (action !== 'customize') {
    return { success: false, error: 'This edit is not a customization' };
  }

  const tabId = await resolveTargetTabId(callerTabId);
  if (!tabId) {
    return { success: false, error: 'No active website tab found. Please open or focus a website tab.' };
  }

  const payload = isPlainObject(edit.payload) ? edit.payload : {};
  const selector = String(edit.selector || payload.selector || '').trim();
  const summary = String(payload.summary || '').trim() || selectorToHumanLabel(selector);
  const initialStyles = isPlainObject(payload.styles) ? payload.styles : {};

  transitionState(BRAIN_STATES.PREVIEWING, {
    feature: 'customize',
    tabId: tabId,
    selector: selector,
    url: url,
    resumeEditId: editId,
  });

  chrome.runtime.sendMessage({
    type: 'CUSTOMIZE_DASHBOARD_OPEN',
    selector: selector,
    summary: summary,
    url: url,
    initialStyles: initialStyles,
    resumeEditId: editId,
  }).catch(() => {});

  return { success: true, state: 'PREVIEWING', feature: 'customize' };
}

async function fetchHistoryRows(options = {}) {
  const auth = await getSessionInfo();
  if (!auth) {
    return { success: false, error: 'Not authenticated', rows: [] };
  }

  const params = new URLSearchParams();
  params.set('select', 'id,user_id,website_id,edit_type,status,name,description,before_image_url,after_image_url,created_at,updated_at,payload,websites(id,full_url,origin,path,title)');
  params.set('order', 'created_at.desc');
  params.set('user_id', 'eq.' + auth.userId);

  if (options.editId) {
    params.set('id', 'eq.' + options.editId);
  }

  if (options.websiteId) {
    params.set('website_id', 'eq.' + options.websiteId);
  }

  if (options.activeOnly) {
    params.set('status', 'eq.active');
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/edits?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${auth.accessToken}`,
      }
    });

    const rows = await response.json().catch(() => []);
    if (!response.ok) {
      return {
        success: false,
        error: Array.isArray(rows) ? 'Supabase history fetch failed' : (rows?.message || rows?.error || 'Supabase history fetch failed'),
        rows: []
      };
    }

    return { success: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    return { success: false, error: e.message, rows: [] };
  }
}

async function fetchHistoryRowsByPageKey(pageKey) {
  const auth = await getSessionInfo();
  if (!auth) {
    return { success: false, error: 'Not authenticated', rows: [] };
  }

  const normalizedUrl = normalizePageKey(pageKey);
  if (!normalizedUrl) {
    return { success: false, error: 'Invalid page key', rows: [] };
  }

  try {
    const siteResp = await fetch(
      `${SUPABASE_URL}/rest/v1/websites?user_id=eq.${auth.userId}&full_url=eq.${encodeURIComponent(normalizedUrl)}&select=id`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${auth.accessToken}`,
        }
      }
    );
    const sites = await siteResp.json().catch(() => []);
    if (!Array.isArray(sites) || sites.length === 0) {
      return { success: true, rows: [] };
    }

    return fetchHistoryRows({ websiteId: sites[0].id });
  } catch (e) {
    return { success: false, error: e.message, rows: [] };
  }
}

async function getHistoryPayload() {
  const historyResult = await fetchHistoryRows();
  if (!historyResult.success) {
    return { success: false, error: historyResult.error, sites: [] };
  }

  return {
    success: true,
    sites: buildHistorySites(historyResult.rows)
  };
}

async function syncLedgerPageFromSupabase(pageKey) {
  const normalizedPageKey = normalizePageKey(pageKey);
  if (!normalizedPageKey) {
    return { success: false, error: 'Missing page key', blueprints: {} };
  }

  const pageRowsResult = await fetchHistoryRowsByPageKey(normalizedPageKey);
  if (!pageRowsResult.success) {
    return { success: false, error: pageRowsResult.error, blueprints: {} };
  }

  const ledger = await getLedger();
  ledger[normalizedPageKey] = {};
  pageRowsResult.rows.forEach(function (row) {
    ledger[normalizedPageKey][row.id] = rowToLedgerEdit(row);
  });
  await saveLedger(ledger);

  const active = getActiveBlueprintsForPage(ledger, normalizedPageKey);
  return { success: true, pageKey: normalizedPageKey, blueprints: active.blueprints };
}

async function getMatchingTabsForPageKey(pageKey, preferredTabId) {
  const normalizedPageKey = normalizePageKey(pageKey);
  const matches = [];

  if (preferredTabId) {
    try {
      const preferredTab = await chrome.tabs.get(preferredTabId);
      if (preferredTab?.id && normalizePageKey(preferredTab.url || '') === normalizedPageKey) {
        matches.push(preferredTab);
      }
    } catch (_) {}
  }

  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach(function (tab) {
      if (!tab?.id || matches.some(function (candidate) { return candidate.id === tab.id; })) return;
      if (normalizePageKey(tab.url || '') === normalizedPageKey) {
        matches.push(tab);
      }
    });
  } catch (_) {}

  return matches;
}

async function broadcastBlueprintUpdate(pageKey, blueprints) {
  try {
    await chrome.runtime.sendMessage({
      type: 'BLUEPRINTS_UPDATED',
      pageKey: normalizePageKey(pageKey),
      blueprints: blueprints || {}
    });
  } catch (_) {}
}

async function broadcastHistoryUpdate() {
  const payload = await getHistoryPayload();
  try {
    await chrome.runtime.sendMessage({
      type: 'EDIT_HISTORY_UPDATED',
      sites: payload.sites || [],
      error: payload.success ? null : payload.error || null
    });
  } catch (_) {}
  return payload;
}

async function dispatchBlueprintsForPage(pageKey, preferredTabId) {
  const normalizedPageKey = normalizePageKey(pageKey);
  const ledger = await getLedger();
  const active = getActiveBlueprintsForPage(ledger, normalizedPageKey);
  const matchingTabs = await getMatchingTabsForPageKey(normalizedPageKey, preferredTabId);

  await Promise.all(
    matchingTabs.map(function (tab) {
      return dispatchToTab(tab.id, {
        type: 'APPLY_BLUEPRINTS',
        pageKey: normalizedPageKey,
        blueprints: active.blueprints
      });
    })
  );

  await broadcastBlueprintUpdate(normalizedPageKey, active.blueprints);
  return active;
}

async function handleFetchFullHistory() {
  return getHistoryPayload();
}

async function handleToggleHistoryEdit(message) {
  const editId = String(message.editId || '').trim();
  if (!editId) {
    return { success: false, error: 'Missing editId' };
  }

  const rowResult = await fetchHistoryRows({ editId });
  if (!rowResult.success) {
    return { success: false, error: rowResult.error };
  }

  const row = rowResult.rows[0];
  if (!row) {
    return { success: false, error: 'NOT_FOUND' };
  }

  const isCurrentlyActive = row.status === 'active';
  const nextStatus = isCurrentlyActive ? 'inactive' : 'active';
  const auth = await getSessionInfo();
  if (!auth) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/edits?id=eq.${encodeURIComponent(editId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${auth.accessToken}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ status: nextStatus })
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, error: text || 'Could not update edit history item' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }

  const website = isPlainObject(row.websites) ? row.websites : {};
  const pageKey = website.full_url || '';
  if (pageKey) {
    const syncedPage = await syncLedgerPageFromSupabase(pageKey);
    if (syncedPage.success) {
      await dispatchBlueprintsForPage(syncedPage.pageKey, null);
    }
  } else {
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    if (Array.isArray(allTabs)) {
      for (const tab of allTabs) {
        if (tab?.id && tab.url?.startsWith('http')) {
          const tabPageKey = normalizePageKey(tab.url);
          const synced = await syncLedgerPageFromSupabase(tabPageKey);
          if (synced.success) {
            await dispatchBlueprintsForPage(synced.pageKey, tab.id);
          }
        }
      }
    }
  }

  const historyPayload = await broadcastHistoryUpdate();
  return {
    success: true,
    pageKey: normalizePageKey(pageKey),
    isActive: nextStatus === 'active',
    sites: historyPayload.sites || []
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Central State Machine (Status Board)
// Prevents two feature flows from running simultaneously.
// ═══════════════════════════════════════════════════════════════════════════════

const BRAIN_STATES = {
  IDLE: 'IDLE',
  PICKING: 'PICKING',
  PREVIEWING: 'PREVIEWING',
  PROCESSING: 'PROCESSING',
};

let brainState = {
  current: BRAIN_STATES.IDLE,
  activeFlow: null,
  lockedTabId: null,
};

function transitionState(newState, flow) {
  brainState.current = newState;
  if (flow !== undefined) {
    brainState.activeFlow = flow;
  }
  if (flow?.tabId !== undefined) {
    brainState.lockedTabId = flow.tabId;
  }
  console.log('[Brain] State ->', brainState.current, brainState.activeFlow);
  chrome.runtime.sendMessage({
    type: 'FLOW_STATE_CHANGED',
    state: newState,
    feature: flow?.feature || brainState.activeFlow?.feature || null,
    pickPhase: flow?.addPickPhase || null
  }).catch(() => {});
}

function isFlowConflict(incomingFeature) {
  if (brainState.current === BRAIN_STATES.IDLE) return false;
  if (brainState.activeFlow?.feature === incomingFeature) return false;
  return true;
}

function resetState() {
  brainState.current = BRAIN_STATES.IDLE;
  brainState.activeFlow = null;
  brainState.lockedTabId = null;
  console.log('[Brain] State reset to IDLE');
  chrome.runtime.sendMessage({
    type: 'FLOW_STATE_CHANGED',
    state: BRAIN_STATES.IDLE,
    feature: null
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Strict Data Validation
// Rejects messages missing required fields before they reach any handler.
// ═══════════════════════════════════════════════════════════════════════════════

const MESSAGE_SCHEMAS = {
  PING:                  [],
  SAVE_BLUEPRINT:        ['url', 'edit.action', 'edit.selector'],
  TOGGLE_STATUS:         ['url', 'editId'],
  GET_ACTIVE_BLUEPRINTS: ['url'],
  FETCH_FULL_HISTORY:    [],
  TOGGLE_HISTORY_EDIT:   ['editId'],
  GENERATE_FEATURE:      ['prompt'],
  START_PICK_MODE:       ['feature'],
  ELEMENT_PICKED:        ['selector', 'url'],
  CANCEL_FLOW:           [],
  PREVIEW_CSS:           ['selector', 'cssText'],
  CUSTOMIZE_APPLY:       ['selector', 'url'],
  CUSTOMIZE_CANCEL:      [],
  ADD_APPLY:             [],
  ADD_CANCEL:            [],
  SAVE_CHAT_SESSION:     ['sessionId'],
  GET_CHAT_SESSIONS:     [],
  GET_CHAT_SESSION:      ['sessionId'],
  DELETE_CHAT_SESSION:    ['sessionId'],
  RENAME_CHAT_SESSION:   ['sessionId', 'title'],
  ARM_REVISE_ADD:        ['editId', 'url'],
  RESUME_CUSTOMIZE_EDIT: ['editId', 'url'],
};

function validateMessage(message) {
  const schema = MESSAGE_SCHEMAS[message.type];
  if (!schema) return null;

  for (const path of schema) {
    const parts = path.split('.');
    let value = message;
    for (const part of parts) {
      value = value?.[part];
    }
    if (value === undefined || value === null || value === '') {
      return 'Missing required field: ' + path;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Chat Session CRUD (chrome.storage.local, scoped per user)
// ═══════════════════════════════════════════════════════════════════════════════

const CHAT_SESSIONS_KEY = 'webedit_chat_sessions';
const MAX_CHAT_SESSIONS = 50;

async function getChatUserId() {
  const record = await getStoredSupabaseSessionRecord();
  return record?.session?.user?.id || null;
}

function chatStorageKey(userId) {
  return CHAT_SESSIONS_KEY + '::' + userId;
}

async function handleSaveChatSession(message) {
  const userId = await getChatUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const key = chatStorageKey(userId);
  const result = await chrome.storage.local.get([key]);
  const sessions = Array.isArray(result[key]) ? result[key] : [];

  const idx = sessions.findIndex(function (s) { return s.id === message.sessionId; });
  const session = {
    id: message.sessionId,
    timestamp: Date.now(),
    messages: message.messages || [],
    title: message.title || 'New chat',
    preview: message.preview || 'New chat',
  };

  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }

  const trimmed = sessions.slice(0, MAX_CHAT_SESSIONS);
  await chrome.storage.local.set({ [key]: trimmed });
  return { success: true, session };
}

async function handleGetChatSessions() {
  const userId = await getChatUserId();
  if (!userId) return { success: false, error: 'Not authenticated', sessions: [] };

  const key = chatStorageKey(userId);
  const result = await chrome.storage.local.get([key]);
  return { success: true, sessions: Array.isArray(result[key]) ? result[key] : [] };
}

async function handleGetChatSession(message) {
  const userId = await getChatUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const key = chatStorageKey(userId);
  const result = await chrome.storage.local.get([key]);
  const sessions = Array.isArray(result[key]) ? result[key] : [];
  const session = sessions.find(function (s) { return s.id === message.sessionId; });
  if (!session) return { success: false, error: 'Session not found' };
  return { success: true, session };
}

async function handleDeleteChatSession(message) {
  const userId = await getChatUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const key = chatStorageKey(userId);
  const result = await chrome.storage.local.get([key]);
  const sessions = Array.isArray(result[key]) ? result[key] : [];
  const filtered = sessions.filter(function (s) { return s.id !== message.sessionId; });
  await chrome.storage.local.set({ [key]: filtered });
  return { success: true };
}

async function handleRenameChatSession(message) {
  const userId = await getChatUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const key = chatStorageKey(userId);
  const result = await chrome.storage.local.get([key]);
  const sessions = Array.isArray(result[key]) ? result[key] : [];
  const session = sessions.find(function (s) { return s.id === message.sessionId; });
  if (!session) return { success: false, error: 'Session not found' };

  session.title = (message.title || '').trim() || session.title;
  await chrome.storage.local.set({ [key]: sessions });
  return { success: true, session };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Core Command Handlers
// Data-layer operations that any feature can trigger.
// ═══════════════════════════════════════════════════════════════════════════════

async function handleSaveBlueprint(message) {
  const { edit } = message;
  const url = normalizePageKey(message.url);

  const editId = generateEditId();
  const editData = {
    pageKey: url,
    action: edit.action,
    selector: edit.selector,
    status: 'active',
    payload: edit.payload || {},
    createdAt: Date.now(),
  };

  const ledger = await getLedger();
  if (!ledger[url]) {
    ledger[url] = {};
  }
  ledger[url][editId] = editData;
  await saveLedger(ledger);

  const supabaseId = await syncInsertToSupabase(editId, url, editData);
  if (supabaseId && supabaseId !== editId) {
    delete ledger[url][editId];
    ledger[url][supabaseId] = editData;
    await saveLedger(ledger);
  }

  return { success: true, editId: supabaseId || editId };
}

async function handleToggleStatus(message) {
  const editId = message.editId;
  const url = normalizePageKey(message.url);

  const ledger = await getLedger();
  if (!ledger[url] || !ledger[url][editId]) {
    return { success: false, error: 'NOT_FOUND' };
  }

  const current = ledger[url][editId].status;
  const newStatus = current === 'active' ? 'inactive' : 'active';
  ledger[url][editId].status = newStatus;

  await saveLedger(ledger);
  syncStatusToSupabase(editId, newStatus);
  return { success: true, newStatus };
}

async function handleGetActiveBlueprints(message) {
  const ledger = await getLedger();
  const active = getActiveBlueprintsForPage(ledger, message.url);
  return { success: true, pageKey: active.pageKey, blueprints: active.blueprints };
}

async function handleGenerateFeature(message) {
  const { prompt, domContext } = message;

  const keepAliveId = startKeepAlive();
  try {
    const result = await SupabaseClient.generateFeatureSpec(prompt, domContext || null);

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return { success: true, spec: result.spec };
  } finally {
    stopKeepAlive(keepAliveId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Targeted Dispatch (The Sniper)
// Sends a command to a specific tab using the Caller ID (sender.tab.id).
// ═══════════════════════════════════════════════════════════════════════════════

async function dispatchToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (e) {
    console.warn('[Brain] Dispatch failed for tab', tabId, e.message);
    return { ok: false, error: e.message };
  }
}

async function resolveTargetTabId(callerTabId) {
  if (callerTabId) return callerTabId;
  try {
    var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    for (var i = 0; i < tabs.length; i++) {
      var url = tabs[i].url || '';
      if (tabs[i].id && url.startsWith('http')) {
        return tabs[i].id;
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: Keep-Alive Mechanism
// Prevents the service worker from dying during long AI generation calls.
// ═══════════════════════════════════════════════════════════════════════════════

function startKeepAlive() {
  return setInterval(() => {
    chrome.runtime.sendMessage({ type: '_KEEP_ALIVE' }).catch(() => {});
  }, 20000);
}

function stopKeepAlive(intervalId) {
  clearInterval(intervalId);
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name === 'keep-alive') {
    port.onDisconnect.addListener(function () {});
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: The Spinal Cord (Message Router)
// One Single Front Door — reads the address and routes to the right module.
// Pipeline: Switchboard -> Validation -> State Machine -> Feature Execution
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  const callerTabId = sender.tab?.id || null;

  (async function () {
    try {
      let response;
      const routingKey = message.type || message.command;

      // ── Auth commands (bypass validation & state machine) ──
      switch (routingKey) {
        case 'WEBEDIT_STORE_SUPABASE_SESSION':
          sendResponse(await storeSupabaseSession(message.session || null));
          return;
        case 'WEBEDIT_GET_SESSION': {
          const record = await getStoredSupabaseSessionRecord();
          record.ok = true;
          record.success = true;
          sendResponse(record);
          return;
        }
        case 'WEBEDIT_SIGN_OUT':
          sendResponse(await storeSupabaseSession(null));
          return;
      }

      // ── Step 1: Strict Data Validation ──
      const validationError = validateMessage(message);
      if (validationError) {
        sendResponse({ success: false, error: validationError });
        return;
      }

      // ── Step 2: Feature commands (through state machine pipeline) ──
      switch (routingKey) {

        case 'PING':
          response = { success: true, timestamp: Date.now() };
          break;

        case 'SAVE_BLUEPRINT': {
          response = await handleSaveBlueprint(message);
          if (response.success) {
            await dispatchBlueprintsForPage(message.url, callerTabId);
            await broadcastHistoryUpdate();
          }
          break;
        }

        case 'TOGGLE_STATUS': {
          response = await handleToggleStatus(message);
          if (response.success) {
            await dispatchBlueprintsForPage(message.url, callerTabId);
            await broadcastHistoryUpdate();
          }
          break;
        }

        case 'GET_ACTIVE_BLUEPRINTS':
          response = await handleGetActiveBlueprints(message);
          break;

        case 'FETCH_FULL_HISTORY':
          response = await handleFetchFullHistory();
          break;

        case 'TOGGLE_HISTORY_EDIT':
          response = await handleToggleHistoryEdit(message);
          break;

        case 'SAVE_CHAT_SESSION':
          response = await handleSaveChatSession(message);
          break;

        case 'GET_CHAT_SESSIONS':
          response = await handleGetChatSessions();
          break;

        case 'GET_CHAT_SESSION':
          response = await handleGetChatSession(message);
          break;

        case 'DELETE_CHAT_SESSION':
          response = await handleDeleteChatSession(message);
          break;

        case 'RENAME_CHAT_SESSION':
          response = await handleRenameChatSession(message);
          break;

        case 'GENERATE_FEATURE': {
          if (brainState.current === BRAIN_STATES.PREVIEWING
              && brainState.activeFlow?.feature === 'add') {
            const addGenHandler = getFeatureHandler('add', 'onGenerate');
            if (addGenHandler) {
              response = await addGenHandler(message);
              break;
            }
          }
          transitionState(BRAIN_STATES.PROCESSING, { feature: 'add', tabId: callerTabId });
          try {
            response = await handleGenerateFeature(message);
          } finally {
            resetState();
          }
          break;
        }

        case 'START_PICK_MODE': {
          const feature = message.feature;
          const secondaryAddPick =
            feature === 'add' &&
            message.pickPhase === 'secondary' &&
            brainState.activeFlow?.feature === 'add' &&
            brainState.activeFlow?.selector &&
            brainState.activeFlow?.awaitingSecondaryPick === true &&
            (brainState.current === BRAIN_STATES.PREVIEWING || brainState.current === BRAIN_STATES.PICKING);

          if (brainState.current !== BRAIN_STATES.IDLE) {
            if (secondaryAddPick) {
              if (brainState.lockedTabId) {
                dispatchToTab(brainState.lockedTabId, { type: 'STOP_PICK_MODE' });
              }
            } else {
              if (brainState.lockedTabId) {
                dispatchToTab(brainState.lockedTabId, { type: 'STOP_PICK_MODE' });
              }
              resetState();
            }
          }

          const pickTabId = await resolveTargetTabId(callerTabId);
          if (!pickTabId) {
            response = { success: false, error: 'No active website tab found. Please open or focus a website tab.' };
            break;
          }

          if (secondaryAddPick) {
            const af = brainState.activeFlow;
            transitionState(BRAIN_STATES.PICKING, {
              feature: 'add',
              tabId: pickTabId,
              selector: af.selector,
              url: af.url,
              humanLabel: af.humanLabel,
              htmlContext: af.htmlContext,
              secondaryHtmlContext: af.secondaryHtmlContext || '',
              secondaryHumanLabel: af.secondaryHumanLabel || '',
              conversationHistory: af.conversationHistory || [],
              pendingPrompt: af.pendingPrompt || '',
              awaitingSecondaryPick: true,
              addPickPhase: 'secondary'
            });
          } else {
            transitionState(BRAIN_STATES.PICKING, { feature, tabId: pickTabId });
          }

          const startHandler = getFeatureHandler(feature, 'onStartPick');
          if (startHandler) {
            response = await startHandler(pickTabId, message);
          } else {
            response = { success: true, state: 'PICKING', feature };
          }

          const dispatchResult = await dispatchToTab(pickTabId, {
            type: 'START_PICK_MODE',
            feature: feature,
            pickPhase: message.pickPhase === 'secondary' ? 'secondary' : 'primary'
          });
          if (!dispatchResult || !dispatchResult.success) {
            resetState();
            response = { success: false, error: 'Could not reach the website. Please reload the page and try again.' };
          }
          break;
        }

        case 'ELEMENT_PICKED': {
          const activeFeature = brainState.activeFlow?.feature;
          if (!activeFeature) {
            response = { success: false, error: 'No active pick flow' };
            break;
          }

          const pickedSelector = String(message.selector || '').trim();
          const pickedUrl = normalizePageKey(message.url || '');
          const pickPhase = message.pickPhase === 'secondary' ? 'secondary' : 'primary';

          if (pickPhase === 'secondary' && activeFeature === 'add') {
            brainState.activeFlow.secondaryHtmlContext = String(message.htmlContext || '');
            brainState.activeFlow.secondaryHumanLabel = String(message.humanLabel || '').trim();
          } else {
            brainState.activeFlow.selector = pickedSelector;
            brainState.activeFlow.url = pickedUrl;
            brainState.activeFlow.humanLabel = String(message.humanLabel || '').trim();
          }

          if (brainState.lockedTabId) {
            dispatchToTab(brainState.lockedTabId, { type: 'STOP_PICK_MODE' });
          }

          transitionState(BRAIN_STATES.PROCESSING);

          const pickHandler = getFeatureHandler(activeFeature, 'onElementPicked');
          if (pickHandler) {
            // Feature module owns saving, dispatching, and resetting
            response = await pickHandler(callerTabId, message);
          } else {
            // Default path for features without a registered module
            const pickedLedger = await getLedger();
            if (!pickedLedger[pickedUrl]) {
              pickedLedger[pickedUrl] = {};
            }
            const pickedEditId = generateEditId();
            const pickedEditData = {
              pageKey: pickedUrl,
              action: activeFeature,
              selector: pickedSelector,
              status: 'active',
              payload: { selector: pickedSelector },
              createdAt: Date.now(),
            };
            pickedLedger[pickedUrl][pickedEditId] = pickedEditData;
            await saveLedger(pickedLedger);
            const pickedSupabaseId = await syncInsertToSupabase(pickedEditId, pickedUrl, pickedEditData);
            const finalPickedId = pickedSupabaseId || pickedEditId;
            if (pickedSupabaseId && pickedSupabaseId !== pickedEditId) {
              delete pickedLedger[pickedUrl][pickedEditId];
              pickedLedger[pickedUrl][finalPickedId] = pickedEditData;
              await saveLedger(pickedLedger);
            }

            chrome.runtime.sendMessage({
              type: 'PICK_COMPLETED',
              feature: activeFeature,
              selector: pickedSelector,
              url: pickedUrl,
              editId: finalPickedId
            }).catch(() => {});

            resetState();
            response = {
              success: true,
              feature: activeFeature,
              selector: pickedSelector,
              url: pickedUrl,
              editId: finalPickedId
            };
          }
          break;
        }

        case 'PREVIEW_CSS': {
          if (brainState.current !== BRAIN_STATES.PREVIEWING) {
            response = { success: false, error: 'Not in preview mode' };
            break;
          }
          if (brainState.lockedTabId) {
            dispatchToTab(brainState.lockedTabId, {
              type: 'INJECT_PREVIEW_CSS',
              selector: message.selector,
              cssText: message.cssText
            });
          }
          response = { success: true };
          break;
        }

        case 'CUSTOMIZE_APPLY': {
          if (brainState.current !== BRAIN_STATES.PREVIEWING) {
            response = { success: false, error: 'Not in preview mode' };
            break;
          }
          const applyHandler = getFeatureHandler('customize', 'onApply');
          if (applyHandler) {
            response = await applyHandler(message);
          } else {
            response = { success: false, error: 'Customize module not loaded' };
            resetState();
          }
          break;
        }

        case 'CUSTOMIZE_CANCEL':
          if (brainState.lockedTabId) {
            dispatchToTab(brainState.lockedTabId, { type: 'CLEAR_PREVIEW_CSS' });
          }
          resetState();
          response = { success: true, state: 'IDLE' };
          break;

        case 'ADD_APPLY': {
          if (brainState.activeFlow?.feature !== 'add') {
            response = { success: false, error: 'No active Add flow' };
            break;
          }
          const addApplyHandler = getFeatureHandler('add', 'onApply');
          if (addApplyHandler) {
            response = await addApplyHandler();
          } else {
            response = { success: false, error: 'Add module not loaded' };
            resetState();
          }
          break;
        }

        case 'ADD_CANCEL': {
          const addCancelHandler = getFeatureHandler('add', 'onCancel');
          if (addCancelHandler) { addCancelHandler(); }
          else { resetState(); }
          response = { success: true, state: 'IDLE' };
          break;
        }

        case 'CANCEL_FLOW':
          if (brainState.lockedTabId) {
            if (brainState.activeFlow?.feature === 'add') {
              dispatchToTab(brainState.lockedTabId, { type: 'CLOSE_PREVIEW' });
            } else if (brainState.current === BRAIN_STATES.PREVIEWING) {
              dispatchToTab(brainState.lockedTabId, { type: 'CLEAR_PREVIEW_CSS' });
            }
            dispatchToTab(brainState.lockedTabId, { type: 'STOP_PICK_MODE' });
          }
          resetState();
          response = { success: true, state: 'IDLE' };
          break;

        case 'ARM_REVISE_ADD':
          response = await handleArmReviseAdd(message, callerTabId);
          break;

        case 'RESUME_CUSTOMIZE_EDIT':
          response = await handleResumeCustomizeEdit(message, callerTabId);
          break;

        default:
          response = { success: false, error: 'Unknown command: ' + routingKey };
      }

      sendResponse(response);
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();

  return true;
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: Tab Lifecycle Listener
// Detects page-ready and dispatches active blueprints to the Hands.
// ═══════════════════════════════════════════════════════════════════════════════

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  try {
    const ledger = await getLedger();
    const active = getActiveBlueprintsForPage(ledger, tab.url);
    const activeBlueprints = active.blueprints;

    if (Object.keys(activeBlueprints).length > 0) {
      dispatchToTab(tabId, { type: 'APPLY_BLUEPRINTS', pageKey: active.pageKey, blueprints: activeBlueprints });
    }
  } catch (e) {
    console.warn('[Brain] Tab lifecycle dispatch error:', e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: Tab Close Guard
// If the tab that Pick Mode is running on gets closed, cancel the flow.
// ═══════════════════════════════════════════════════════════════════════════════

chrome.tabs.onRemoved.addListener(function (tabId) {
  if (brainState.lockedTabId === tabId && brainState.current !== BRAIN_STATES.IDLE) {
    resetState();
  }
});
