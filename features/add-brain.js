'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Add Feature — Brain Module
// Registers the 'add' feature with the Brain's feature registry.
// Unlike Remove (immediate commit) or Customize (CSS preview), the Add flow
// holds the picked element's context in short-term memory, waits for the user
// to describe a feature, sends the prompt + context to the LLM, then waits
// for Apply/Cancel before committing.
// All background.js globals are available by the time these callbacks fire.
// ═══════════════════════════════════════════════════════════════════════════════

// Must match supabase/functions/ai-generate-feature-spec/index.ts (conversation replay).
function webeditBuildInitialUserMessage(htmlContext, userPrompt) {
  var ctx = htmlContext || 'No context provided';
  var p = String(userPrompt || '').trim();
  return 'SECTION: CONTEXT_HTML\n```html\n' + ctx + '\n```\n\nSECTION: USER_REQUEST\n' + p +
    '\n\nSECTION: OUTPUT_CONSTRAINT\nRespond with ONLY a JSON object. Exactly three keys: "html", "css", "actions". No other keys. No markdown. No prose.';
}

function webeditBuildRefinementUserMessage(userPrompt) {
  var p = String(userPrompt || '').trim();
  return 'SECTION: REFINEMENT_REQUEST\n' + p +
    '\n\nSECTION: INSTRUCTION\nApply only the changes in REFINEMENT_REQUEST. Output a COMPLETE replacement JSON with keys "html", "css", and "actions" (not a diff). Preserve all interactive behavior, all "on" event bindings, and all persistence (ifStorage/getStorage/setStorage) unless the user explicitly asks to remove them.';
}

registerFeature('add', {

  onStartPick: function (_tabId, _message) {
    return { success: true, state: 'PICKING', feature: 'add' };
  },

  onElementPicked: async function (_callerTabId, message) {
    var flow = brainState.activeFlow || {};
    var selector = flow.selector || '';
    var url = flow.url || '';
    var humanLabel = flow.humanLabel || selectorToHumanLabel(selector);

    // Save HTML context from the Hands into short-term memory
    var htmlContext = message.htmlContext || '';

    transitionState(BRAIN_STATES.PREVIEWING, {
      feature: 'add',
      tabId: brainState.lockedTabId,
      selector: selector,
      url: url,
      humanLabel: humanLabel,
      htmlContext: htmlContext
    });

    chrome.runtime.sendMessage({
      type: 'ADD_PICK_COMPLETED',
      selector: selector,
      summary: humanLabel,
      url: url
    }).catch(function () {});

    return {
      success: true,
      feature: 'add',
      state: 'PREVIEWING',
      selector: selector,
      url: url
    };
  },

  // Called by the GENERATE_FEATURE router when an Add flow is active.
  // First call: sends prompt + context to LLM, dispatches INJECT_PREVIEW.
  // Refinement calls: builds conversation history, dispatches UPDATE_PREVIEW.
  onGenerate: async function (message) {
    var flow = brainState.activeFlow || {};
    var htmlContext = flow.htmlContext || '';
    var selector = flow.selector || '';
    var isRefinement = !!flow.spec;

    transitionState(BRAIN_STATES.PROCESSING);

    if (!flow.conversationHistory) {
      flow.conversationHistory = [];
    }

    var keepAliveId = startKeepAlive();
    try {
      var history = isRefinement ? flow.conversationHistory : null;

      var result = await SupabaseClient.generateFeatureSpec(
        message.prompt,
        { anchorElement: { htmlContext: htmlContext, selector: selector } },
        history
      );

      if (!result.ok) {
        transitionState(BRAIN_STATES.PREVIEWING);
        return { success: false, error: result.error };
      }

      // Build conversation history for future refinements (text must match edge function templates)
      if (!isRefinement) {
        flow.conversationHistory.push({
          role: 'user',
          text: webeditBuildInitialUserMessage(htmlContext, message.prompt)
        });
      } else {
        flow.conversationHistory.push({
          role: 'user',
          text: webeditBuildRefinementUserMessage(message.prompt)
        });
      }
      flow.conversationHistory.push({
        role: 'model',
        text: JSON.stringify({
          html: result.spec.html || '',
          css: result.spec.css || '',
          actions: result.spec.actions || []
        })
      });

      flow.spec = result.spec;
      flow.spec.targetSelector = selector;
      brainState.activeFlow = flow;

      transitionState(BRAIN_STATES.PREVIEWING);

      // Dispatch preview to Hands
      var tabId = brainState.lockedTabId;
      if (tabId) {
        if (!isRefinement) {
          dispatchToTab(tabId, {
            type: 'INJECT_PREVIEW',
            selector: selector,
            spec: { html: result.spec.html, css: result.spec.css, actions: result.spec.actions }
          });
        } else {
          dispatchToTab(tabId, {
            type: 'UPDATE_PREVIEW',
            spec: { html: result.spec.html, css: result.spec.css, actions: result.spec.actions }
          });
        }
      }

      chrome.runtime.sendMessage({
        type: 'ADD_SPEC_READY',
        spec: result.spec,
        selector: selector,
        summary: flow.humanLabel || selectorToHumanLabel(selector)
      }).catch(function () {});

      return { success: true, spec: result.spec };
    } finally {
      stopKeepAlive(keepAliveId);
    }
  },

  onApply: async function () {
    var flow = brainState.activeFlow || {};
    var spec = flow.spec;
    var url = flow.url || '';
    var selector = flow.selector || '';
    var lockedTabId = brainState.lockedTabId;
    var editId;
    var syncFailed = false;

    if (!spec) {
      resetState();
      return { success: false, error: 'No spec to apply' };
    }

    try {
      // ── Step 0: Close the Preview Lab ──────────────────────────────────
      if (lockedTabId) {
        dispatchToTab(lockedTabId, { type: 'CLOSE_PREVIEW' });
      }

      // ── Step 1: Save to Global Ledger ────────────────────────────────────

      var ledger = await getLedger();
      if (!ledger[url]) {
        ledger[url] = {};
      }

      editId = generateEditId();
      var editData = {
        pageKey: url,
        action: 'add',
        selector: selector,
        status: 'active',
        payload: {
          targetSelector: selector,
          html: spec.html || '',
          css: spec.css || '',
          actions: spec.actions || [],
          position: 'beforeend'
        },
        createdAt: Date.now()
      };

      ledger[url][editId] = editData;
      await saveLedger(ledger);

      // ── Step 2: Targeted Dispatch — feature injected instantly ──────────

      try {
        await dispatchBlueprintsForPage(url, lockedTabId);
      } catch (e) {
        console.warn('[Add-Brain] Blueprint dispatch failed:', e.message);
      }

      // ── Step 3: Await Supabase insert ──────────────────────────────────

      var supabaseId = await syncInsertToSupabase(editId, url, editData);
      if (!supabaseId) {
        syncFailed = true;
        console.warn('[Add-Brain] Supabase sync returned failure');
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

      // ── Step 3b: Re-dispatch with reconciled IDs ────────────────────────

      try {
        await dispatchBlueprintsForPage(url, lockedTabId);
      } catch (e) {
        console.warn('[Add-Brain] Post-sync blueprint dispatch failed:', e.message);
      }

      // ── Step 4: Broadcast history ──────────────────────────────────────

      try {
        await broadcastHistoryUpdate();
      } catch (e) {
        console.warn('[Add-Brain] History broadcast failed:', e.message);
      }

      // ── Step 5: Notify Panel ───────────────────────────────────────────

      var summary = flow.humanLabel || selectorToHumanLabel(selector);

      chrome.runtime.sendMessage({
        type: 'PICK_COMPLETED',
        feature: 'add',
        selector: selector,
        summary: summary,
        url: url,
        editId: editId
      }).catch(function () {});

      chrome.runtime.sendMessage({
        type: 'ADD_COMPLETED',
        selector: selector,
        url: url,
        editId: editId,
        summary: summary,
        syncFailed: syncFailed
      }).catch(function () {});
    } finally {
      // ── Step 6: Reset state machine (always runs) ──────────────────────
      resetState();
    }

    return {
      success: true,
      feature: 'add',
      selector: selector,
      url: url,
      editId: editId
    };
  },

  onCancel: function () {
    if (brainState.lockedTabId) {
      dispatchToTab(brainState.lockedTabId, { type: 'CLOSE_PREVIEW' });
    }
    resetState();
    return { success: true, state: 'IDLE' };
  }
});
