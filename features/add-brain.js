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
function webeditBuildInitialUserMessage(htmlContext, userPrompt, relatedHtmlContext, pageUrl) {
  var ctx = htmlContext || 'No context provided';
  var p = String(userPrompt || '').trim();
  var out = 'SECTION: CONTEXT_HTML\n```html\n' + ctx + '\n```\n';
  var rel = relatedHtmlContext != null ? String(relatedHtmlContext).trim() : '';
  if (rel) {
    out += '\nSECTION: RELATED_CONTEXT_HTML\nA second region the user picked on the same page (use together with CONTEXT_HTML for cross-region behavior).\n```html\n' + rel + '\n```\n';
  }
  var u = pageUrl != null ? String(pageUrl).trim() : '';
  if (u) {
    out += '\nSECTION: PAGE_URL\n' + u + '\n(Site-specific hints are heuristic only; the live DOM may differ.)\n';
  }
  out += '\nSECTION: USER_REQUEST\n' + p +
    '\n\nSECTION: OUTPUT_CONSTRAINT\nEither (A) a complete feature spec as JSON with exactly "html", "css", "actions", OR (B) if you truly cannot build the feature without another region the user has NOT yet provided, JSON with "needSecondaryContext": true, "secondaryContextPrompt" (short user-facing string: why pick and what to pick), and empty "html", "css", "actions". Use (B) only on the FIRST generation turn when RELATED_CONTEXT_HTML is absent and the request clearly depends on another part of the page (e.g. copy from a distant panel, wire a button to content outside CONTEXT_HTML). If RELATED_CONTEXT_HTML is already present, you MUST output (A) only. No markdown fences. No prose outside the JSON.';
  return out;
}

function webeditBuildRefinementUserMessage(userPrompt) {
  var p = String(userPrompt || '').trim();
  return 'SECTION: REFINEMENT_REQUEST\n' + p +
    '\n\nSECTION: INSTRUCTION\nApply only the changes in REFINEMENT_REQUEST. Output a COMPLETE replacement JSON with keys "html", "css", and "actions" (not a diff). Preserve all interactive behavior, all "on" event bindings, and all persistence (ifStorage/getStorage/setStorage) unless the user explicitly asks to remove them. Do not use needSecondaryContext during refinement — output the full spec only.';
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

/**
 * Shared LLM → preview path for Add (initial generate, after secondary pick, refinements).
 * Mutates flow; updates brainState.activeFlow on success paths.
 */
async function runAddFeatureGeneration(message, flow, isRefinement) {
  var htmlContext = flow.htmlContext || '';
  var selector = flow.selector || '';
  var keepAliveId = startKeepAlive();
  try {
    var history = isRefinement ? flow.conversationHistory : null;

    var genContext = {
      anchorElement: { htmlContext: htmlContext, selector: selector }
    };
    var sec = flow.secondaryHtmlContext != null ? String(flow.secondaryHtmlContext).trim() : '';
    if (sec) {
      genContext.relatedHtmlContext = sec;
    }
    if (flow.url && String(flow.url).trim()) {
      genContext.pageUrl = String(flow.url).trim();
    }

    var result = await SupabaseClient.generateFeatureSpec(message.prompt, genContext, history);

    if (!result.ok) {
      transitionState(BRAIN_STATES.PREVIEWING);
      brainState.activeFlow = flow;
      return { success: false, error: result.error };
    }

    if (result.needSecondaryContext && !isRefinement) {
      flow.pendingPrompt = message.prompt;
      flow.addPickPhase = 'secondary';
      brainState.activeFlow = flow;
      transitionState(BRAIN_STATES.PICKING, flow);

      var promptText = result.secondaryContextPrompt ||
        'This feature seems to depend on another part of the page. Please pick that section.';
      chrome.runtime.sendMessage({
        type: 'ADD_SECONDARY_PICK_NEEDED',
        secondaryContextPrompt: promptText
      }).catch(function () {});

      var tabPick = brainState.lockedTabId;
      if (tabPick) {
        await dispatchToTab(tabPick, { type: 'START_PICK_MODE', feature: 'add', pickPhase: 'secondary' });
      }

      return { success: true, needSecondaryPick: true };
    }

    if (!flow.conversationHistory) {
      flow.conversationHistory = [];
    }

    if (!isRefinement) {
      flow.conversationHistory.push({
        role: 'user',
        text: webeditBuildInitialUserMessage(htmlContext, message.prompt, flow.secondaryHtmlContext, flow.url)
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
    flow.pendingPrompt = undefined;
    flow.specUnknownOps = undefined;

    var unknownOps = [];
    if (typeof globalThis.__webeditCollectUnknownActionOps === 'function') {
      unknownOps = globalThis.__webeditCollectUnknownActionOps(result.spec.actions || []);
    }
    if (unknownOps.length > 0) {
      flow.specUnknownOps = unknownOps;
      chrome.runtime.sendMessage({
        type: 'ADD_SPEC_VALIDATION_WARNING',
        unknownOps: unknownOps
      }).catch(function () {});
    }

    brainState.activeFlow = flow;

    transitionState(BRAIN_STATES.PREVIEWING);

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
}

registerFeature('add', {

  onStartPick: function (_tabId, _message) {
    return { success: true, state: 'PICKING', feature: 'add' };
  },

  onElementPicked: async function (_callerTabId, message) {
    if (message.pickPhase === 'secondary') {
      var flowSec = brainState.activeFlow || {};
      flowSec.addPickPhase = undefined;
      brainState.activeFlow = flowSec;
      transitionState(BRAIN_STATES.PREVIEWING, flowSec);

      chrome.runtime.sendMessage({
        type: 'ADD_SECONDARY_PICK_COMPLETED',
        summary: flowSec.secondaryHumanLabel || 'additional section'
      }).catch(function () {});

      var pend = flowSec.pendingPrompt || '';
      if (!pend) {
        return { success: false, error: 'No pending prompt' };
      }

      transitionState(BRAIN_STATES.PROCESSING);
      return await runAddFeatureGeneration({ prompt: pend }, flowSec, false);
    }

    var flow = brainState.activeFlow || {};
    var selector = flow.selector || '';
    var url = flow.url || '';
    var humanLabel = flow.humanLabel || selectorToHumanLabel(selector);

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
    var isRefinement = Array.isArray(flow.conversationHistory) && flow.conversationHistory.length > 0;

    transitionState(BRAIN_STATES.PROCESSING);

    if (!flow.conversationHistory) {
      flow.conversationHistory = [];
    }

    return await runAddFeatureGeneration(message, flow, isRefinement);
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
