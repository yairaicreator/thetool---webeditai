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

      editId = generateEditId();
      var editData = {
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

      // ── Step 3: Targeted Dispatch — element styled instantly ─────────────
      try {
        await dispatchBlueprintsForPage(url, lockedTabId);
      } catch (e) {
        console.warn('[Customize-Brain] Blueprint dispatch failed:', e.message);
      }

      // ── Step 4: Await Supabase insert ────────────────────────────────────
      var insertOk = await syncInsertToSupabase(editId, url, editData);
      if (!insertOk) {
        syncFailed = true;
        console.warn('[Customize-Brain] Supabase sync returned failure');
      } else {
        console.log('[Customize-Brain] Supabase row created:', insertOk);
      }

      // ── Step 5: Broadcast history ────────────────────────────────────────
      try {
        await broadcastHistoryUpdate();
      } catch (e) {
        console.warn('[Customize-Brain] History broadcast failed:', e.message);
      }

      // ── Step 6: Notify Panel ─────────────────────────────────────────────
      var summary = selectorToHumanLabel(selector);

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
