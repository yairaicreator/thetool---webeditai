'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const LEDGER_KEY = 'webedit_ledger';

// ─── The Ledger: Storage Helpers ──────────────────────────────────────────────

async function getLedger() {
  const result = await chrome.storage.local.get(LEDGER_KEY);
  return result[LEDGER_KEY] || {};
}

async function setLedger(ledger) {
  await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
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

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  (async function () {
    try {
      var response;

      var routingKey = message.type || message.command;

      switch (routingKey) {
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
