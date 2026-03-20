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

    try {
      // ── Step 1: Save to Global Ledger ────────────────────────────────────

      var ledger = await getLedger();
      if (!ledger[url]) {
        ledger[url] = {};
      }

      editId = generateEditId();
      var editData = {
        pageKey: url,
        action: 'remove',
        selector: selector,
        status: 'active',
        payload: { selector: selector },
        createdAt: Date.now(),
      };

      ledger[url][editId] = editData;
      await saveLedger(ledger);

      // ── Step 2: Sync to Supabase (fire-and-forget) ───────────────────────

      syncInsertToSupabase(editId, url, editData);

      // ── Step 3: Targeted Dispatch — element hidden instantly ──────────────

      try {
        await dispatchBlueprintsForPage(url, lockedTabId);
      } catch (e) {
        console.warn('[Remove-Brain] Blueprint dispatch failed:', e.message);
      }

      // ── Step 4: Broadcast updates to Panel ───────────────────────────────

      try {
        await broadcastHistoryUpdate();
      } catch (e) {
        console.warn('[Remove-Brain] History broadcast failed:', e.message);
      }

      chrome.runtime.sendMessage({
        type: 'PICK_COMPLETED',
        feature: 'remove',
        selector: selector,
        url: url,
        editId: editId
      }).catch(function () {});

      var summary = selectorToHumanLabel(selector);

      chrome.runtime.sendMessage({
        type: 'REMOVE_COMPLETED',
        selector: selector,
        url: url,
        editId: editId,
        summary: summary
      }).catch(function () {});
    } finally {
      // ── Step 5: Reset state machine (always runs) ────────────────────────
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

// ─── Helper: derive a short human-readable label from a CSS selector ────────

function selectorToHumanLabel(selector) {
  if (!selector) return 'an element';

  if (selector.charAt(0) === '#') {
    var id = selector.split(/[\s>+~:[\]]/)[0].slice(1);
    return '"' + id.replace(/[-_]/g, ' ') + '" element';
  }

  var classMatch = selector.match(/\.([a-zA-Z][\w-]*)/);
  if (classMatch) {
    return '"' + classMatch[1].replace(/[-_]/g, ' ') + '" element';
  }

  var tagMatch = selector.match(/^([a-z][a-z0-9]*)/i);
  if (tagMatch) {
    var tag = tagMatch[1].toLowerCase();
    var friendly = {
      nav: 'navigation', header: 'header', footer: 'footer',
      aside: 'sidebar', section: 'section', article: 'article',
      div: 'div', span: 'span', ul: 'list', ol: 'list',
      li: 'list item', img: 'image', a: 'link', p: 'paragraph',
      button: 'button', form: 'form', input: 'input field',
      table: 'table', iframe: 'iframe'
    };
    return (friendly[tag] || tag) + ' element';
  }

  var short = selector.length > 40 ? selector.substring(0, 37) + '...' : selector;
  return '"' + short + '"';
}
