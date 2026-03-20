'use strict';

importScripts('supabaseClient.js');

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
  return 'edit_' + crypto.randomUUID();
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

async function syncInsertToSupabase(editId, url, editData) {
  try {
    const auth = await getSessionInfo();
    if (!auth) {
      console.warn('[Brain] No active session — skipping Supabase insert.');
      return;
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/edit_rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${auth.accessToken}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        id: editId,
        user_id: auth.userId,
        page_key: url,
        selector: editData.selector,
        action: editData.action.toLowerCase(),
        metadata: editData.payload || {},
        active: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[Brain] Supabase insert failed (${response.status}):`, text);
    }
  } catch (e) {
    console.warn('[Brain] Supabase insert network error:', e.message);
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
      `${SUPABASE_URL}/rest/v1/edit_rules?id=eq.${encodeURIComponent(editId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${auth.accessToken}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ active: newStatus === 'active' }),
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Strict Data Validation
// Rejects messages missing required fields before they reach any handler.
// ═══════════════════════════════════════════════════════════════════════════════

const MESSAGE_SCHEMAS = {
  SAVE_BLUEPRINT:        ['url', 'edit.action', 'edit.selector'],
  TOGGLE_STATUS:         ['url', 'editId'],
  GET_ACTIVE_BLUEPRINTS: ['url'],
  GENERATE_FEATURE:      ['prompt'],
  START_PICK_MODE:       ['feature'],
  ELEMENT_PICKED:        ['selector', 'url'],
  CANCEL_FLOW:           [],
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
// SECTION 7: Feature Module Registry (Modularisation Hook)
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Core Command Handlers
// Data-layer operations that any feature can trigger.
// ═══════════════════════════════════════════════════════════════════════════════

async function handleSaveBlueprint(message) {
  const { url, edit } = message;

  const ledger = await getLedger();
  if (!ledger[url]) {
    ledger[url] = {};
  }

  const editId = generateEditId();
  ledger[url][editId] = {
    action: edit.action,
    selector: edit.selector,
    status: 'active',
    payload: edit.payload || {},
    createdAt: Date.now(),
  };

  await saveLedger(ledger);
  syncInsertToSupabase(editId, url, ledger[url][editId]);
  return { success: true, editId };
}

async function handleToggleStatus(message) {
  const { url, editId } = message;

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
  const { url } = message;

  const ledger = await getLedger();
  const editsForUrl = ledger[url] || {};
  const activeBlueprints = {};

  for (const [id, edit] of Object.entries(editsForUrl)) {
    if (edit.status === 'active') {
      activeBlueprints[id] = edit;
    }
  }

  return { success: true, blueprints: activeBlueprints };
}

async function handleGenerateFeature(message) {
  const { prompt, domContext } = message;

  const keepAliveId = startKeepAlive();
  try {
    const result = await SupabaseClient.generateFeatureSpec(prompt, domContext || null);

    if (!result.ok) {
      return { success: false, error: 'AI Generation failed: ' + result.error };
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: Keep-Alive Mechanism
// Prevents the service worker from dying during long AI generation calls.
// ═══════════════════════════════════════════════════════════════════════════════

function startKeepAlive() {
  return setInterval(() => {
    chrome.storage.local.get('_keepAlive');
  }, 25000);
}

function stopKeepAlive(intervalId) {
  clearInterval(intervalId);
}

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

        case 'SAVE_BLUEPRINT':
          response = await handleSaveBlueprint(message);
          break;

        case 'TOGGLE_STATUS':
          response = await handleToggleStatus(message);
          break;

        case 'GET_ACTIVE_BLUEPRINTS':
          response = await handleGetActiveBlueprints(message);
          break;

        case 'GENERATE_FEATURE':
          transitionState(BRAIN_STATES.PROCESSING, { feature: 'add', tabId: callerTabId });
          try {
            response = await handleGenerateFeature(message);
          } finally {
            resetState();
          }
          break;

        case 'START_PICK_MODE': {
          const feature = message.feature;
          if (isFlowConflict(feature)) {
            response = { success: false, error: 'FLOW_CONFLICT', activeFlow: brainState.activeFlow };
            break;
          }
          transitionState(BRAIN_STATES.PICKING, { feature, tabId: callerTabId });
          const startHandler = getFeatureHandler(feature, 'onStartPick');
          if (startHandler) {
            response = await startHandler(callerTabId, message);
          } else {
            response = { success: true, state: 'PICKING', feature };
          }
          break;
        }

        case 'ELEMENT_PICKED': {
          const activeFeature = brainState.activeFlow?.feature;
          if (!activeFeature) {
            response = { success: false, error: 'No active pick flow' };
            break;
          }
          const pickHandler = getFeatureHandler(activeFeature, 'onElementPicked');
          if (pickHandler) {
            response = await pickHandler(callerTabId, message);
          } else {
            response = { success: true, received: true };
          }
          break;
        }

        case 'CANCEL_FLOW':
          resetState();
          response = { success: true, state: 'IDLE' };
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
    const editsForUrl = ledger[tab.url] || {};
    const activeBlueprints = {};

    for (const [id, edit] of Object.entries(editsForUrl)) {
      if (edit.status === 'active') {
        activeBlueprints[id] = edit;
      }
    }

    if (Object.keys(activeBlueprints).length > 0) {
      dispatchToTab(tabId, { type: 'APPLY_BLUEPRINTS', blueprints: activeBlueprints });
    }
  } catch (e) {
    console.warn('[Brain] Tab lifecycle dispatch error:', e.message);
  }
});
