'use strict';

// ─── Side Panel Activation ───────────────────────────────────────────────────

fetch('http://127.0.0.1:7745/ingest/a0177b65-52e4-48e8-a970-4dc8c4b1460d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'08b659'},body:JSON.stringify({sessionId:'08b659',location:'background.js:top',message:'Background script top level executed',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});

chrome.runtime.onInstalled.addListener((details) => {
  fetch('http://127.0.0.1:7745/ingest/a0177b65-52e4-48e8-a970-4dc8c4b1460d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'08b659'},body:JSON.stringify({sessionId:'08b659',location:'background.js:onInstalled',message:'onInstalled fired',data:{reason:details.reason},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => {
      fetch('http://127.0.0.1:7745/ingest/a0177b65-52e4-48e8-a970-4dc8c4b1460d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'08b659'},body:JSON.stringify({sessionId:'08b659',location:'background.js:setPanelBehavior',message:'setPanelBehavior succeeded',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    })
    .catch(function (error) { 
      fetch('http://127.0.0.1:7745/ingest/a0177b65-52e4-48e8-a970-4dc8c4b1460d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'08b659'},body:JSON.stringify({sessionId:'08b659',location:'background.js:setPanelBehavior_catch',message:'setPanelBehavior failed',data:{error:error.toString()},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      console.error('[Brain] sidePanel behavior error:', error); 
    });
});

chrome.runtime.onStartup.addListener(() => {
  fetch('http://127.0.0.1:7745/ingest/a0177b65-52e4-48e8-a970-4dc8c4b1460d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'08b659'},body:JSON.stringify({sessionId:'08b659',location:'background.js:onStartup',message:'onStartup fired',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
});

// ─── Constants ────────────────────────────────────────────────────────────────
const LEDGER_KEY = 'webedit_ledger';
const SUPABASE_SESSION_KEY = 'webeditSupabaseSession';
const SUPABASE_SESSION_TIMESTAMP_KEY = 'webeditSessionTimestamp';
const WEBSITE_TAB_URL_PATTERNS = [
  'https://webeditai.com/*',
  'https://www.webeditai.com/*'
];

// ─── The Ledger: Storage Helpers ──────────────────────────────────────────────

async function getLedger() {
  const result = await chrome.storage.local.get(LEDGER_KEY);
  return result[LEDGER_KEY] || {};
}

async function setLedger(ledger) {
  await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
}

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

// ─── Unique Edit ID Generator ─────────────────────────────────────────────────

function generateEditId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 11);
  return 'edit_' + timestamp + '_' + random;
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function saveBlueprint(message) {
  const { url, edit } = message;

  if (!url || !edit || !edit.action || !edit.selector) {
    return { success: false, error: 'Missing required fields: url, edit.action, edit.selector' };
  }

  const ledger = await getLedger();

  if (!ledger[url]) {
    ledger[url] = {};
  }

  const editId = generateEditId();

  ledger[url][editId] = {
    action: edit.action,
    selector: edit.selector,
    status: edit.status || 'active',
    payload: edit.payload || {},
  };

  await setLedger(ledger);
  return { success: true, editId };
}

async function toggleStatus(message) {
  const { url, editId } = message;

  if (!url || !editId) {
    return { success: false, error: 'Missing required fields: url, editId' };
  }

  const ledger = await getLedger();

  if (!ledger[url] || !ledger[url][editId]) {
    return { success: false, error: 'Edit not found' };
  }

  const current = ledger[url][editId].status;
  const newStatus = current === 'active' ? 'inactive' : 'active';
  ledger[url][editId].status = newStatus;

  await setLedger(ledger);
  return { success: true, status: newStatus };
}

async function getActiveBlueprints(message) {
  const { url } = message;

  if (!url) {
    return { success: false, error: 'Missing required field: url' };
  }

  const ledger = await getLedger();
  const editsForUrl = ledger[url] || {};

  const blueprints = Object.entries(editsForUrl)
    .filter(function (entry) { return entry[1].status === 'active'; })
    .map(function (entry) {
      return { editId: entry[0], action: entry[1].action, selector: entry[1].selector, status: entry[1].status, payload: entry[1].payload };
    });

  return { success: true, blueprints: blueprints };
}

// ─── Broadcast: Notify Hands + Panel after state changes ─────────────────────

async function broadcastBlueprints(url) {
  var result = await getActiveBlueprints({ url: url });
  var blueprints = result.success ? result.blueprints : [];

  // Notify content scripts on matching tabs (Hands use `command`)
  var tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: url });
  } catch (_) {}
  tabs.forEach(function (tab) {
    chrome.tabs.sendMessage(tab.id, { command: 'BLUEPRINTS_UPDATED', blueprints: blueprints }).catch(function () {});
  });

  // Notify sidepanel / other extension pages (Panel uses `type`)
  chrome.runtime.sendMessage({ type: 'BLUEPRINTS_UPDATED', blueprints: blueprints }).catch(function () {});
}

// ─── The Spinal Cord: Message Router ──────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  // Relay specific events from content script to sidepanel
  if (sender?.tab?.id && typeof message?.type === 'string') {
    const relayTypes = new Set([
      "WEBEDIT_ELEMENT_PICKED",
      "WEBEDIT_MODE_STARTED",
      "WEBEDIT_MODE_EXITED"
    ]);
    if (relayTypes.has(message.type)) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  }

  (async function () {
    try {
      var response;

      var routingKey = message.type || message.command;

      switch (routingKey) {
        case 'WEBEDIT_STORE_SUPABASE_SESSION':
          response = await storeSupabaseSession(message.session || null);
          break;
        case 'WEBEDIT_GET_SESSION':
          response = await getStoredSupabaseSessionRecord();
          response.ok = true;
          response.success = true;
          break;
        case 'WEBEDIT_SIGN_OUT':
          response = await storeSupabaseSession(null);
          break;
        case 'SAVE_BLUEPRINT':
          response = await saveBlueprint(message);
          if (response.success) { await broadcastBlueprints(message.url); }
          break;
        case 'TOGGLE_STATUS':
          response = await toggleStatus(message);
          if (response.success) { await broadcastBlueprints(message.url); }
          break;
        case 'GET_ACTIVE_BLUEPRINTS':
          response = await getActiveBlueprints(message);
          break;
        case 'WEBEDIT_SIDEPANEL_COMMAND':
          // Relay command from sidepanel to active tab
          var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs.length > 0) {
            response = await chrome.tabs.sendMessage(tabs[0].id, message.payload).catch(e => ({ ok: false, error: e.message }));
            if (!response) response = { ok: true };
          } else {
            response = { ok: false, error: 'No active tab found' };
          }
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
