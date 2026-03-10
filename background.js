'use strict';

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
