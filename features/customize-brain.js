'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Customize Feature — Brain Module
// Registers the 'customize' feature with the Brain's feature registry.
// Unlike Remove (which commits immediately on pick), Customize transitions
// to PREVIEWING so the user can tweak CSS properties in a dashboard before
// committing. The flow stays active until CUSTOMIZE_APPLY or CUSTOMIZE_CANCEL.
// All background.js globals are available by the time these callbacks fire.
// ═══════════════════════════════════════════════════════════════════════════════

registerFeature('customize', {

  onStartPick: function (_tabId, _message) {
    return { success: true, state: 'PICKING', feature: 'customize' };
  },

  onElementPicked: async function (_callerTabId, _message) {
    var flow = brainState.activeFlow || {};
    var url = flow.url || '';
    var selector = flow.selector || '';
    var summary = selectorToHumanLabel(selector);

    // Transition to PREVIEWING — the flow stays open for live preview
    transitionState(BRAIN_STATES.PREVIEWING, {
      feature: 'customize',
      tabId: brainState.lockedTabId,
      selector: selector,
      url: url
    });

    // Tell the Panel to open the customization dashboard
    chrome.runtime.sendMessage({
      type: 'CUSTOMIZE_DASHBOARD_OPEN',
      selector: selector,
      summary: summary,
      url: url
    }).catch(function () {});

    return {
      success: true,
      feature: 'customize',
      state: 'PREVIEWING',
      selector: selector,
      url: url
    };
  },

  onApply: async function (message) {
    var flow = brainState.activeFlow || {};
    var url = normalizePageKey(message.url || flow.url || '');
    var selector = message.selector || flow.selector || '';
    var styles = message.styles || {};
    var lockedTabId = brainState.lockedTabId;
    var resumeEditId = String(message.resumeEditId || flow.resumeEditId || '').trim();
    var editId;
    var syncFailed = false;

    try {
      // ── Step 1: Clear the temporary preview CSS ──────────────────────────
      if (lockedTabId) {
        dispatchToTab(lockedTabId, { type: 'CLEAR_PREVIEW_CSS' }).catch(function () {});
      }

      // ── Step 2: Save to Global Ledger ────────────────────────────────────
      var ledger = await getLedger();
      if (!ledger[url]) {
        ledger[url] = {};
      }

      var editData;
      if (resumeEditId) {
        if (!ledger[url][resumeEditId]) {
          resetState();
          return { success: false, error: 'Original edit not found for this page' };
        }
        editId = resumeEditId;
        var existing = ledger[url][editId];
        var prevPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
        editData = {
          pageKey: url,
          action: 'customize',
          selector: selector,
          status: existing.status || 'active',
          payload: {
            selector: selector,
            styles: styles,
            summary: message.summary || prevPayload.summary || '',
            description: message.description || prevPayload.description || ''
          },
          createdAt: existing.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        ledger[url][editId] = editData;
        await saveLedger(ledger);

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Customize-Brain] Blueprint dispatch failed:', e.message);
        }

        var patchOk = await syncEditPayloadToSupabase(editId, editData);
        if (!patchOk) {
          syncFailed = true;
          console.warn('[Customize-Brain] Supabase payload update failed');
        }

        try {
          await syncLedgerPageFromSupabase(url);
        } catch (e) {
          console.warn('[Customize-Brain] Ledger refresh after PATCH failed:', e.message);
        }

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Customize-Brain] Post-patch blueprint dispatch failed:', e.message);
        }
      } else {
        editId = generateEditId();
        editData = {
          pageKey: url,
          action: 'customize',
          selector: selector,
          status: 'active',
          payload: {
            selector: selector,
            styles: styles,
            summary: message.summary || '',
            description: message.description || ''
          },
          createdAt: Date.now()
        };

        ledger[url][editId] = editData;
        await saveLedger(ledger);

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Customize-Brain] Blueprint dispatch failed:', e.message);
        }

        var supabaseId = await syncInsertToSupabase(editId, url, editData);
        if (!supabaseId) {
          syncFailed = true;
          console.warn('[Customize-Brain] Supabase sync returned failure');
        } else {
          if (supabaseId !== editId) {
            var freshLedger = await getLedger();
            if (freshLedger[url] && freshLedger[url][editId]) {
              delete freshLedger[url][editId];
              freshLedger[url][supabaseId] = editData;
              await saveLedger(freshLedger);
            }
            editId = supabaseId;
          }
        }

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Customize-Brain] Post-sync blueprint dispatch failed:', e.message);
        }
      }

      // ── Step 5: Broadcast history ────────────────────────────────────────
      try {
        await broadcastHistoryUpdate();
      } catch (e) {
        console.warn('[Customize-Brain] History broadcast failed:', e.message);
      }

      // ── Step 6: Notify Panel ─────────────────────────────────────────────
      var summary = String(message.summary || '').trim() || selectorToHumanLabel(selector);

      chrome.runtime.sendMessage({
        type: 'PICK_COMPLETED',
        feature: 'customize',
        selector: selector,
        summary: summary,
        url: url,
        editId: editId
      }).catch(function () {});

      chrome.runtime.sendMessage({
        type: 'CUSTOMIZE_COMPLETED',
        selector: selector,
        url: url,
        editId: editId,
        summary: summary,
        syncFailed: syncFailed
      }).catch(function () {});
    } finally {
      // ── Step 7: Reset state machine ──────────────────────────────────────
      resetState();
    }

    return {
      success: true,
      feature: 'customize',
      selector: selector,
      url: url,
      editId: editId
    };
  }
});

// ─── Reuse the same human-label helper as Remove ─────────────────────────────
// selectorToHumanLabel is defined in remove-brain.js and available globally
// because importScripts runs synchronously before this file loads.
