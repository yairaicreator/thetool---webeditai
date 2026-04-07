'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Remove Feature — Brain Module
// Registers the 'remove' feature with the Brain's feature registry.
// Owns the FULL lifecycle: ledger save, Supabase sync, blueprint dispatch,
// history broadcast, panel notification, and state reset.
// All background.js globals are available by the time these callbacks fire.
// ═══════════════════════════════════════════════════════════════════════════════

registerFeature('remove', {

  onStartPick: function (_tabId, _message) {
    return { success: true, state: 'PICKING', feature: 'remove' };
  },

  onElementPicked: async function (_callerTabId, _message) {
    var flow = brainState.activeFlow || {};
    var url = flow.url || '';
    var selector = flow.selector || '';
    var lockedTabId = brainState.lockedTabId;
    var editId;
    var syncFailed = false;

    var gateRem = await WebeditGatekeeper.assertGate('remove', { url: url });
    if (!gateRem.ok) {
      WebeditGatekeeper.notifyGateBlocked(gateRem.message, gateRem.code);
      resetState();
      return { success: false, error: gateRem.message, gateCode: gateRem.code };
    }

    try {
      // ── Step 1: Save to Global Ledger ────────────────────────────────────

      var ledger = await getLedger();
      if (!ledger[url]) {
        ledger[url] = {};
      }

      editId = generateEditId();
      var pickedLabel = String(flow.humanLabel || '').trim() || selectorToHumanLabel(selector);
      var editData = {
        pageKey: url,
        action: 'remove',
        selector: selector,
        status: 'active',
        payload: { selector: selector, summary: pickedLabel },
        createdAt: Date.now(),
      };

      ledger[url][editId] = editData;
      await saveLedger(ledger);

      // ── Step 2: Targeted Dispatch — element hidden instantly ──────────────

      try {
        await dispatchBlueprintsForPage(url, lockedTabId);
      } catch (e) {
        console.warn('[Remove-Brain] Blueprint dispatch failed:', e.message);
      }

      // ── Step 3: Await Supabase insert (must finish before history read) ──

      var supabaseId = await syncInsertToSupabase(editId, url, editData);
      if (!supabaseId) {
        syncFailed = true;
        console.warn('[Remove-Brain] Supabase sync returned failure');
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

      // ── Step 3b: Re-dispatch with reconciled IDs ───────────────────────

      try {
        await dispatchBlueprintsForPage(url, lockedTabId);
      } catch (e) {
        console.warn('[Remove-Brain] Post-sync blueprint dispatch failed:', e.message);
      }

      // ── Step 4: Broadcast history (row now exists in Supabase) ───────────

      try {
        await broadcastHistoryUpdate();
      } catch (e) {
        console.warn('[Remove-Brain] History broadcast failed:', e.message);
      }

      // ── Step 5: Notify Panel ─────────────────────────────────────────────

      var summary = String(flow.humanLabel || '').trim() || selectorToHumanLabel(selector);

      chrome.runtime.sendMessage({
        type: 'PICK_COMPLETED',
        feature: 'remove',
        selector: selector,
        summary: summary,
        url: url,
        editId: editId
      }).catch(function () {});

      chrome.runtime.sendMessage({
        type: 'REMOVE_COMPLETED',
        selector: selector,
        url: url,
        editId: editId,
        summary: summary,
        syncFailed: syncFailed
      }).catch(function () {});

      await WebeditGatekeeper.recordUsage('remove', url);
    } finally {
      // ── Step 6: Reset state machine (always runs) ────────────────────────
      resetState();
    }

    return {
      success: true,
      feature: 'remove',
      selector: selector,
      url: url,
      editId: editId
    };
  }
});

// selectorToHumanLabel is provided by elementLabels.js (imported before this file).
