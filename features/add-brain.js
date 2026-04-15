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
// ── Vocabulary reference + few-shot examples ──────────────────────────────
// Injected into every initial prompt so the LLM has an instruction manual.
// When you add a new op to add-action-ops.js + add-hands.js, add a line here.
var WEBEDIT_VOCAB_REFERENCE = [
  'SECTION: VOCABULARY',
  'Use ONLY these ops in "actions". No other op names are valid.',
  '',
  'on            Listen for events INSIDE the feature.',
  '              { op:"on", selector:".btn", event:"click", prevent:false, actions:[...] }',
  'addClass      Add class INSIDE feature.     { op:"addClass",    selector:".el", class:"x" }',
  'removeClass   Remove class INSIDE feature.  { op:"removeClass", selector:".el", class:"x" }',
  'toggleClass   Toggle class INSIDE feature.  { op:"toggleClass", selector:".el", class:"x" }',
  'pageAddClass     Add class on HOST PAGE.    { op:"pageAddClass",    selector:"body", class:"dark" }',
  'pageRemoveClass  Remove on HOST PAGE.       { op:"pageRemoveClass", selector:"body", class:"dark" }',
  'pageToggleClass  Toggle on HOST PAGE.       { op:"pageToggleClass", selector:"body", class:"dark" }',
  'setStyle      Inline style INSIDE feature. { op:"setStyle", selector:".el", property:"color", value:"red" }',
  'pageSetStyle  Inline style on HOST PAGE.   { op:"pageSetStyle", selector:"header", property:"display", value:"none" }',
  'show    { op:"show",   selector:".el" }   hide  { op:"hide",   selector:".el" }   toggle { op:"toggle", selector:".el" }',
  'pageShow { op:"pageShow", selector:".x" }  pageHide { op:"pageHide", selector:".x" }  pageToggle { op:"pageToggle", selector:".x" }',
  'setText  { op:"setText",  selector:".el", text:"Hi" }',
  'setHTML  { op:"setHTML",  selector:".el", html:"<b>Hi</b>" }',
  'setAttr  { op:"setAttr",  selector:".el", attr:"href", value:"..." }',
  'removeAttr { op:"removeAttr", selector:".el", attr:"disabled" }',
  'toggleAttr { op:"toggleAttr", selector:".btn", attr:"aria-pressed", onValue:"true", offValue:"false" }',
  'pageToggleAttr { op:"pageToggleAttr", selector:"[data-theme]", attr:"data-theme", onValue:"dark", offValue:"light" }',
  'appendText  { op:"appendText",  selector:".el", text:" more" }',
  'prependText { op:"prependText", selector:".el", text:"pre " }',
  'createElement   Create element INSIDE feature.',
  '                { op:"createElement", tag:"div", id:"x", classes:["a"], text:"Label", parent:".c", position:"beforeend" }',
  'removeElement   { op:"removeElement", selector:".el" }',
  'pageCreateElement  Create on HOST PAGE. { op:"pageCreateElement", tag:"div", id:"x", parent:"body", position:"beforeend" }',
  'setStorage    { op:"setStorage",    key:"we_key", value:"on" }',
  'getStorage    { op:"getStorage",    key:"we_key", selector:".el" }  -- writes to textContent; add attr:"x" to write to attribute',
  'removeStorage { op:"removeStorage", key:"we_key" }',
  'ifStorage   { op:"ifStorage", key:"we_key", equals:"on", then:[...], else:[...] }  equals:true=exists, false=absent',
  'ifHasClass  { op:"ifHasClass", selector:".el", class:"x", then:[...], else:[...] }',
  'ifVisible   { op:"ifVisible",  selector:".el", then:[...], else:[...] }',
  'delay       { op:"delay",    ms:500,  actions:[...] }',
  'interval    { op:"interval", ms:1000, id:"t1", actions:[...] }',
  'clearInterval { op:"clearInterval", id:"t1" }',
  'scrollTo    { op:"scrollTo", selector:".el" }',
  'getValue    Read input value into storage.   { op:"getValue",  selector:"input", storageKey:"we_q" }',
  'setValue    Set input value.                 { op:"setValue",  selector:"input", value:"x" }',
  'pageQueryText   Read text from HOST PAGE.   { op:"pageQueryText",  selector:"h1", storageKey:"we_t", mode:"first" }',
  'pageQueryValue  Read input from HOST PAGE.  { op:"pageQueryValue", selector:"input", storageKey:"we_v" }',
  'pageGetValue    Alias for pageQueryValue.',
  'pageClick  { op:"pageClick", selector:".btn" }    pageFocus { op:"pageFocus", selector:"input" }',
  'copyText              { op:"copyText", text:"Hello" }',
  'copyFromSelector      Copy from element INSIDE feature.  { op:"copyFromSelector",     selector:".out", useValue:false }',
  'pageCopyFromSelector  Copy from HOST PAGE element.       { op:"pageCopyFromSelector", selector:"h1",   useValue:false }',
  'copyFromStorage  { op:"copyFromStorage", key:"we_result" }',
  'copyToClipboard  { op:"copyToClipboard", storageKey:"we_result", text:"fallback" }',
  'run  { op:"run", actions:[...] }',
  '',
  'RULES: (1) localStorage keys must start with "we_". (2) Never write raw JS. (3) page* ops target the HOST WEBSITE; non-page ops target INSIDE your injected HTML. (4) actions[] runs once on inject; use "on" for clicks. (5) For state across reloads: setStorage on change + ifStorage on load.',
].join('\n');

var WEBEDIT_FEW_SHOT_EXAMPLES = [
  'SECTION: EXAMPLES',
  '',
  '-- EXAMPLE 1: Dark mode toggle --',
  JSON.stringify({ html: '<button class="we-dark-btn" aria-pressed="false">Dark Mode</button>', css: '.we-dark-btn{padding:8px 14px;border-radius:20px;border:1px solid #555;background:#1a1a1a;color:#eee;cursor:pointer;font-size:13px;}', actions: [ { op:'ifStorage', key:'we_darkmode', equals:'on', then:[{op:'pageAddClass',selector:'html',class:'we-dark'},{op:'setAttr',selector:'.we-dark-btn',attr:'aria-pressed',value:'true'}], else:[{op:'pageRemoveClass',selector:'html',class:'we-dark'}] }, { op:'on', selector:'.we-dark-btn', event:'click', actions:[ { op:'ifStorage', key:'we_darkmode', equals:'on', then:[{op:'removeStorage',key:'we_darkmode'},{op:'pageRemoveClass',selector:'html',class:'we-dark'},{op:'setAttr',selector:'.we-dark-btn',attr:'aria-pressed',value:'false'}], else:[{op:'setStorage',key:'we_darkmode',value:'on'},{op:'pageAddClass',selector:'html',class:'we-dark'},{op:'setAttr',selector:'.we-dark-btn',attr:'aria-pressed',value:'true'}] } ] } ] }),
  '',
  '-- EXAMPLE 2: Copy title to clipboard --',
  JSON.stringify({ html: '<div class="we-cp-wrap"><button class="we-cp-btn">Copy Title</button><span class="we-cp-ok"></span></div>', css: '.we-cp-wrap{display:flex;align-items:center;gap:8px}.we-cp-btn{padding:6px 12px;border-radius:6px;border:1px solid #0070f3;background:#0070f3;color:#fff;cursor:pointer}', actions: [ { op:'on', selector:'.we-cp-btn', event:'click', actions:[ {op:'pageQueryText',selector:'h1',storageKey:'we_cp_text',mode:'first'}, {op:'copyFromStorage',key:'we_cp_text'}, {op:'setText',selector:'.we-cp-ok',text:'Copied!'}, {op:'delay',ms:2000,actions:[{op:'setText',selector:'.we-cp-ok',text:''}]} ] } ] }),
  '',
  '-- EXAMPLE 3: Collapsible section --',
  JSON.stringify({ html: '<div class="we-col"><button class="we-col-btn">Show Details</button><div class="we-col-body" style="display:none"><p>Content here.</p></div></div>', css: '.we-col{border:1px solid #ddd;border-radius:8px;overflow:hidden}.we-col-btn{width:100%;padding:10px 14px;background:#f5f5f5;border:none;text-align:left;cursor:pointer}.we-col-body{padding:12px}', actions: [ {op:'ifStorage',key:'we_col_open',equals:'yes',then:[{op:'show',selector:'.we-col-body'},{op:'setText',selector:'.we-col-btn',text:'Hide Details'}]}, {op:'on',selector:'.we-col-btn',event:'click',actions:[ {op:'ifVisible',selector:'.we-col-body', then:[{op:'hide',selector:'.we-col-body'},{op:'setText',selector:'.we-col-btn',text:'Show Details'},{op:'removeStorage',key:'we_col_open'}], else:[{op:'show',selector:'.we-col-body'},{op:'setText',selector:'.we-col-btn',text:'Hide Details'},{op:'setStorage',key:'we_col_open',value:'yes'}]} ]} ] }),
  '',
  '-- EXAMPLE 4: Floating note panel (persists across reloads) --',
  JSON.stringify({ html: '<div class="we-note"><div class="we-note-bar"><span>Note</span><button class="we-note-x">x</button></div><textarea class="we-note-ta" rows="4"></textarea><button class="we-note-save">Save</button></div>', css: '.we-note{position:fixed;bottom:20px;right:20px;width:240px;background:#fffbe6;border:1px solid #f0c040;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:99999;font-size:13px}.we-note-bar{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #f0c040;font-weight:600}.we-note-x{background:none;border:none;cursor:pointer}.we-note-ta{width:100%;box-sizing:border-box;padding:8px;border:none;background:transparent;resize:vertical}.we-note-save{display:block;width:calc(100% - 16px);margin:0 8px 8px;padding:6px;background:#f0c040;border:none;border-radius:6px;cursor:pointer;font-weight:600}', actions: [ {op:'getStorage',key:'we_note_text',selector:'.we-note-ta',attr:'value'}, {op:'on',selector:'.we-note-save',event:'click',actions:[{op:'getValue',selector:'.we-note-ta',storageKey:'we_note_text'},{op:'setText',selector:'.we-note-save',text:'Saved!'},{op:'delay',ms:1500,actions:[{op:'setText',selector:'.we-note-save',text:'Save'}]}]}, {op:'on',selector:'.we-note-x',event:'click',actions:[{op:'hide',selector:'.we-note'}]} ] }),
].join('\n');

function webeditBuildInitialUserMessage(htmlContext, userPrompt, relatedHtmlContext) {
  var ctx = htmlContext || 'No context provided';
  var rel = relatedHtmlContext && String(relatedHtmlContext).trim()
    ? String(relatedHtmlContext).trim()
    : '';
  var p = String(userPrompt || '').trim();

  var out = WEBEDIT_VOCAB_REFERENCE + '\n\n' + WEBEDIT_FEW_SHOT_EXAMPLES + '\n\n';
  out += 'SECTION: CONTEXT_HTML\n```html\n' + ctx + '\n```\n';
  if (rel) {
    out += '\nSECTION: SECONDARY_CONTEXT_HTML\n```html\n' + rel + '\n```\n';
  }
  out += '\nSECTION: USER_REQUEST\n' + p +
    '\n\nUSER_REQUEST_HINT: Name one primary user action, what success looks like, what must stay unchanged on the page, persistence (remember state or not), and desktop vs mobile if relevant. If the feature must read or control another area of the page, say so (you may be asked to pick that section next).' +
    '\n\nSECTION: OUTPUT_CONSTRAINT\nRespond with ONLY a JSON object. Exactly three keys: "html", "css", "actions". No other keys. No markdown. No prose. Use ONLY op names from the VOCABULARY section above.';
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

function webeditEmitSpecValidationWarnings(spec, context) {
  var actions = spec && Array.isArray(spec.actions) ? spec.actions : [];

  // Step 1: Rewrite aliased ops in-place before validation.
  if (typeof __webeditRewriteAliasedOps === 'function') {
    __webeditRewriteAliasedOps(actions);
  }

  // Step 2: Collect any ops still unknown after alias rewriting.
  var unknownOps = typeof __webeditCollectUnknownActionOps === 'function'
    ? __webeditCollectUnknownActionOps(actions)
    : [];

  // Step 3: Write unknown ops to the persistent log.
  if (unknownOps.length && typeof WebeditUnknownOpsLog !== 'undefined') {
    WebeditUnknownOpsLog.record(unknownOps, {
      userPrompt:  (context && context.userPrompt)  || '',
      pageUrl:     (context && context.pageUrl)     || '',
      fullActions: actions
    });
  }

  // Step 4: Broadcast validation warnings to the Panel (unchanged).
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

    webeditEmitSpecValidationWarnings(flow.spec, {
      userPrompt: message.prompt || '',
      pageUrl:    flow.url || ''
    });

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

    if (!reviseEditId) {
      var gateAdd = await WebeditGatekeeper.assertGate('add', { url: url });
      if (!gateAdd.ok) {
        return { success: false, error: gateAdd.message, gateCode: gateAdd.code };
      }
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

        await WebeditGatekeeper.recordUsage('add', url);
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
