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
function webeditBuildInitialUserMessage(htmlContext, userPrompt, relatedHtmlContext) {
  var ctx = htmlContext || 'No context provided';
  var rel = relatedHtmlContext && String(relatedHtmlContext).trim()
    ? String(relatedHtmlContext).trim()
    : '';
  var p = String(userPrompt || '').trim();
  var out = 'SECTION: CONTEXT_HTML\n```html\n' + ctx + '\n```\n';
  if (rel) {
    out += '\nSECTION: SECONDARY_CONTEXT_HTML\n```html\n' + rel + '\n```\n';
  }
  out += '\nSECTION: USER_REQUEST\n' + p +
    '\n\nUSER_REQUEST_HINT: Name one primary user action, what success looks like, what must stay unchanged on the page, persistence (remember state or not), and desktop vs mobile if relevant. If the feature must read or control another area of the page, say so (you may be asked to pick that section next).' +
    '\n\nSECTION: OUTPUT_CONSTRAINT\nRespond with ONLY a JSON object. Exactly three keys: "html", "css", "actions". No other keys. No markdown. No prose.';
  return out;
}

function webeditBuildRefinementUserMessage(userPrompt) {
  var p = String(userPrompt || '').trim();
  return 'SECTION: REFINEMENT_REQUEST\n' + p +
    '\n\nSECTION: INSTRUCTION\nApply only the changes in REFINEMENT_REQUEST. Output a COMPLETE replacement JSON with keys "html", "css", and "actions" (not a diff). Preserve all interactive behavior, all "on" event bindings, and all persistence (ifStorage/getStorage/setStorage) unless the user explicitly asks to remove them.';
}

/** Seeds refinement mode for “improve existing Add edit” (must match edge replay shape). */
function webeditBuildReviseSeedUserMessage(htmlContext, selector, pageUrl) {
  var ctx = String(htmlContext || '').trim() || 'No anchor HTML re-fetched; the assistant turn after this message carries the canonical html/css/actions JSON.';
  var sel = String(selector || '').trim() || '(unknown)';
  var u = String(pageUrl || '').trim();
  return 'SECTION: CONTEXT_HTML\n```html\n' + ctx + '\n```\n\nSECTION: USER_REQUEST\n' +
    'An Add feature is already injected on this page at anchor selector: ' + sel + (u ? ' (page: ' + u + ').' : '.') +
    ' Document it as JSON. The next assistant message in this thread is the frozen spec (html, css, actions); the user will send refinement requests afterward.\n\n' +
    'SECTION: OUTPUT_CONSTRAINT\nRespond with ONLY a JSON object. Exactly three keys: "html", "css", "actions". No other keys. No markdown. No prose.';
}

function webeditHtmlLooksInteractive(html) {
  var h = String(html || '');
  return /<(button|input|select|textarea)\b/i.test(h) || /role\s*=\s*["']button["']/i.test(h);
}

function webeditEmitSpecValidationWarnings(spec) {
  var actions = spec && Array.isArray(spec.actions) ? spec.actions : [];
  var unknownOps = typeof __webeditCollectUnknownActionOps === 'function'
    ? __webeditCollectUnknownActionOps(actions)
    : [];
  if (unknownOps.length) {
    chrome.runtime.sendMessage({
      type: 'ADD_SPEC_VALIDATION_WARNING',
      reason: 'unknown_ops',
      unknownOps: unknownOps
    }).catch(function () {});
  }
  if (actions.length === 0 && webeditHtmlLooksInteractive(spec && spec.html)) {
    chrome.runtime.sendMessage({
      type: 'ADD_SPEC_VALIDATION_WARNING',
      reason: 'empty_actions'
    }).catch(function () {});
  }
}

/**
 * Runs LLM generate + preview + history. message.prompt is required.
 */
async function runAddFeatureGeneration(message) {
  var flow = brainState.activeFlow || {};
  var htmlContext = flow.htmlContext || '';
  var relatedHtmlContext = flow.secondaryHtmlContext || '';
  var selector = flow.selector || '';
  var isRefinement = Array.isArray(flow.conversationHistory) && flow.conversationHistory.length > 0;

  transitionState(BRAIN_STATES.PROCESSING);

  if (!flow.conversationHistory) {
    flow.conversationHistory = [];
  }

  var keepAliveId = startKeepAlive();
  try {
    var history = isRefinement ? flow.conversationHistory : null;

    var result = await SupabaseClient.generateFeatureSpec(
      message.prompt,
      {
        anchorElement: { htmlContext: htmlContext, selector: selector },
        relatedHtmlContext: relatedHtmlContext,
        secondaryHtmlContext: relatedHtmlContext
      },
      history
    );

    if (!result.ok) {
      transitionState(BRAIN_STATES.PREVIEWING, flow);
      brainState.activeFlow = flow;
      return { success: false, error: result.error };
    }

    if (result.needSecondaryContext === true) {
      flow.pendingPrompt = String(message.prompt || '').trim();
      flow.awaitingSecondaryPick = true;
      flow.secondaryHtmlContext = flow.secondaryHtmlContext || '';
      delete flow.spec;
      brainState.activeFlow = flow;

      var tabId = brainState.lockedTabId;
      transitionState(BRAIN_STATES.PICKING, {
        feature: 'add',
        tabId: tabId,
        selector: flow.selector,
        url: flow.url,
        humanLabel: flow.humanLabel,
        htmlContext: flow.htmlContext,
        secondaryHtmlContext: flow.secondaryHtmlContext,
        secondaryHumanLabel: flow.secondaryHumanLabel,
        conversationHistory: flow.conversationHistory,
        pendingPrompt: flow.pendingPrompt,
        awaitingSecondaryPick: true,
        addPickPhase: 'secondary'
      });

      chrome.runtime.sendMessage({
        type: 'ADD_NEED_SECONDARY_PICK',
        secondaryContextPrompt: result.secondaryContextPrompt || '',
        message: result.secondaryContextPrompt || ''
      }).catch(function () {});

      if (tabId) {
        await dispatchToTab(tabId, {
          type: 'START_PICK_MODE',
          feature: 'add',
          pickPhase: 'secondary'
        });
      }

      return { success: true, awaitingSecondaryPick: true };
    }

    if (!isRefinement) {
      flow.conversationHistory.push({
        role: 'user',
        text: webeditBuildInitialUserMessage(htmlContext, message.prompt, relatedHtmlContext)
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
    flow.awaitingSecondaryPick = false;
    flow.pendingPrompt = '';
    flow.addPickPhase = null;
    brainState.activeFlow = flow;

    webeditEmitSpecValidationWarnings(flow.spec);

    transitionState(BRAIN_STATES.PREVIEWING, flow);

    var genTabId = brainState.lockedTabId;
    if (genTabId) {
      if (!isRefinement) {
        dispatchToTab(genTabId, {
          type: 'INJECT_PREVIEW',
          selector: selector,
          spec: { html: result.spec.html, css: result.spec.css, actions: result.spec.actions }
        });
      } else {
        dispatchToTab(genTabId, {
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
}

registerFeature('add', {

  onStartPick: function (_tabId, _message) {
    return { success: true, state: 'PICKING', feature: 'add' };
  },

  onElementPicked: async function (_callerTabId, message) {
    var flow = brainState.activeFlow || {};
    var pickPhase = message.pickPhase === 'secondary' ? 'secondary' : 'primary';
    var selector = flow.selector || '';
    var url = flow.url || '';
    var humanLabel = flow.humanLabel || selectorToHumanLabel(selector);
    var primaryHtml = flow.htmlContext || '';

    if (pickPhase === 'secondary') {
      var secHtml = message.htmlContext || '';
      var secLabel = String(message.humanLabel || '').trim();
      transitionState(BRAIN_STATES.PREVIEWING, {
        feature: 'add',
        tabId: brainState.lockedTabId,
        selector: selector,
        url: url,
        humanLabel: humanLabel,
        htmlContext: primaryHtml,
        secondaryHtmlContext: secHtml,
        secondaryHumanLabel: secLabel,
        conversationHistory: flow.conversationHistory || [],
        pendingPrompt: flow.pendingPrompt,
        awaitingSecondaryPick: false,
        addPickPhase: null
      });
      flow = brainState.activeFlow;

      chrome.runtime.sendMessage({
        type: 'ADD_SECONDARY_PICK_COMPLETED',
        summary: secLabel,
        primarySummary: humanLabel
      }).catch(function () {});

      var pending = String(flow.pendingPrompt || '').trim();
      if (pending) {
        return runAddFeatureGeneration({ prompt: pending });
      }

      return {
        success: true,
        feature: 'add',
        state: 'PREVIEWING',
        selector: selector,
        url: url
      };
    }

    var htmlContext = message.htmlContext || '';

    transitionState(BRAIN_STATES.PREVIEWING, {
      feature: 'add',
      tabId: brainState.lockedTabId,
      selector: selector,
      url: url,
      humanLabel: humanLabel,
      htmlContext: htmlContext,
      secondaryHtmlContext: '',
      secondaryHumanLabel: '',
      conversationHistory: flow.conversationHistory || [],
      pendingPrompt: '',
      awaitingSecondaryPick: false,
      addPickPhase: null
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

  onGenerate: async function (message) {
    return runAddFeatureGeneration(message);
  },

  onApply: async function () {
    var flow = brainState.activeFlow || {};
    var spec = flow.spec;
    var url = normalizePageKey(flow.url || '');
    var selector = flow.selector || '';
    var lockedTabId = brainState.lockedTabId;
    var editId;
    var syncFailed = false;

      if (!spec) {
      resetState();
      return { success: false, error: 'No spec to apply' };
    }

    var reviseEditId = flow.reviseEditId ? String(flow.reviseEditId).trim() : '';

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

      var editData;
      if (reviseEditId && !ledger[url][reviseEditId]) {
        resetState();
        return { success: false, error: 'Original edit not found for this page' };
      }
      if (reviseEditId && ledger[url][reviseEditId]) {
        editId = reviseEditId;
        var existing = ledger[url][editId];
        var prevPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
        editData = {
          pageKey: url,
          action: existing.action || 'add',
          selector: selector,
          status: existing.status || 'active',
          payload: {
            targetSelector: selector,
            html: spec.html || '',
            css: spec.css || '',
            actions: spec.actions || [],
            position: prevPayload.position || 'beforeend',
            summary: prevPayload.summary,
            description: prevPayload.description
          },
          createdAt: existing.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        ledger[url][editId] = editData;
        await saveLedger(ledger);

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Add-Brain] Blueprint dispatch failed:', e.message);
        }

        var patchOk = await syncEditPayloadToSupabase(editId, editData);
        if (!patchOk) {
          syncFailed = true;
          console.warn('[Add-Brain] Supabase payload update failed');
        }

        try {
          await syncLedgerPageFromSupabase(url);
        } catch (e) {
          console.warn('[Add-Brain] Ledger refresh after PATCH failed:', e.message);
        }

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Add-Brain] Post-patch blueprint dispatch failed:', e.message);
        }
      } else {
        editId = generateEditId();
        editData = {
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

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Add-Brain] Blueprint dispatch failed:', e.message);
        }

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

        try {
          await dispatchBlueprintsForPage(url, lockedTabId);
        } catch (e) {
          console.warn('[Add-Brain] Post-sync blueprint dispatch failed:', e.message);
        }
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
