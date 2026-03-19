'use strict';

// ─── Side Panel Activation ───────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────
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

// ─── The Spinal Cord: Message Router ──────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
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
