'use strict';

importScripts('supabaseClient.js');

// ─── The Ledger: Storage Helpers ────────────────────────────────────────────

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

// ─── Supabase Dual-Write: Auth & Sync ───────────────────────────────────────

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

// ─── Command Handlers ───────────────────────────────────────────────────────

async function handleSaveBlueprint(message) {
  const { url, edit } = message;

  if (!url || !edit || !edit.action || !edit.selector) {
    return { success: false, error: 'INVALID_PAYLOAD' };
  }

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

  if (!url || !editId) {
    return { success: false, error: 'INVALID_PAYLOAD' };
  }

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

  if (!url) {
    return { success: false, error: 'INVALID_PAYLOAD' };
  }

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

// ─── The Spinal Cord: Message Router ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      let response;

      switch (message.type) {
        case 'SAVE_BLUEPRINT':
          response = await handleSaveBlueprint(message);
          break;
        case 'TOGGLE_STATUS':
          response = await handleToggleStatus(message);
          break;
        case 'GET_ACTIVE_BLUEPRINTS':
          response = await handleGetActiveBlueprints(message);
          break;
        default:
          response = { success: false, error: 'UNKNOWN_COMMAND' };
      }

      sendResponse(response);
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();

  return true;
});
