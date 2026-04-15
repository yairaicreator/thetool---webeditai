'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Add Feature — known action ops + alias system
// Loaded before add-hands.js in manifest, and importScripts'd into background.js
// before add-brain.js.
//
// TWO SYSTEMS IN THIS FILE:
//
// 1. KNOWN LIST — the definitive set of op names the execution engine supports.
//    Any op not in this list will be caught by __webeditCollectUnknownActionOps
//    and logged by WebeditOpsLog.
//
// 2. ALIAS TABLE — maps op names the LLM commonly invents to their correct
//    equivalents. When the LLM writes "setClassName" it means "toggleClass".
//    When it writes "readText" it means "pageQueryText". The alias rewriter
//    (__webeditRewriteAliasedOps) patches the spec in-place before execution,
//    so the engine always receives valid op names.
//
//    RULE: Aliases only redirect to ops that already exist in the KNOWN list.
//    They never introduce new behavior. Adding a new alias is safe and requires
//    no changes to add-hands.js.
//
//    RULE: To add a genuinely new op (new behavior), you must add it to BOTH
//    the KNOWN list below AND write a new case block in add-hands.js.
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  // ── SECTION 1: Known Ops List ────────────────────────────────────────────────
  // These are the ops the execution engine in add-hands.js can actually run.
  // Do not add an op here unless you have also added its case block in add-hands.js.

  var KNOWN = [
    'on',
    'addClass', 'removeClass', 'toggleClass', 'toggleAttr',
    'setStyle',
    'setText', 'setHTML', 'setAttr', 'removeAttr',
    'appendText', 'prependText',
    'show', 'hide', 'toggle',
    'createElement', 'removeElement', 'pageCreateElement',
    'setStorage', 'getStorage', 'removeStorage',
    'ifStorage', 'ifHasClass', 'ifVisible',
    'delay', 'interval', 'clearInterval', 'run',
    'scrollTo',
    'getValue', 'setValue',
    'pageAddClass', 'pageRemoveClass', 'pageToggleClass', 'pageSetStyle',
    'pageShow', 'pageHide', 'pageToggle', 'pageToggleAttr',
    'pageQueryText', 'pageQueryValue', 'pageGetValue', 'pageClick', 'pageFocus',
    'copyText', 'copyFromSelector', 'pageCopyFromSelector', 'copyFromStorage', 'copyToClipboard'
  ];

  var knownSet = new Set(KNOWN);

  // ── SECTION 2: Alias Table ───────────────────────────────────────────────────
  //
  // Format: 'wrong-name-LLM-invents': 'correct-name-in-KNOWN'
  //
  // How to add a new alias:
  //   1. Look at WebeditOpsLog.summary() in the service worker console.
  //   2. Find a frequently-invented op name in the results.
  //   3. Decide which existing KNOWN op it most closely matches.
  //   4. Add the entry below: 'invented-name': 'existing-name'
  //   5. That is it. No changes to add-hands.js needed.
  //
  // Groups are organized by what they map TO.

  var ALIASES = {

    // ── Class manipulation ────────────────────────────────────────────────────
    'setClass':          'toggleClass',
    'setClassName':      'toggleClass',
    'addClassName':      'addClass',
    'removeClassName':   'removeClass',
    'toggleClassName':   'toggleClass',
    'updateClass':       'toggleClass',
    'changeClass':       'toggleClass',
    'switchClass':       'toggleClass',
    'applyClass':        'addClass',

    // ── Style ─────────────────────────────────────────────────────────────────
    'updateStyle':       'setStyle',
    'applyStyle':        'setStyle',
    'changeStyle':       'setStyle',
    'css':               'setStyle',
    'setCSS':            'setStyle',
    'applyCSS':          'setStyle',
    'styleEl':           'setStyle',
    'styleElement':      'setStyle',

    // ── Content / text ────────────────────────────────────────────────────────
    'updateText':        'setText',
    'changeText':        'setText',
    'writeText':         'setText',
    'insertText':        'setText',
    'replaceText':       'setText',
    'setContent':        'setHTML',
    'updateHTML':        'setHTML',
    'insertHTML':        'setHTML',
    'replaceHTML':       'setHTML',
    'writeHTML':         'setHTML',

    // ── Visibility ────────────────────────────────────────────────────────────
    'showEl':            'show',
    'showElement':       'show',
    'hideEl':            'hide',
    'hideElement':       'hide',
    'display':           'show',
    'toggleDisplay':     'toggle',
    'toggleVisibility':  'toggle',
    'toggleEl':          'toggle',
    'toggleElement':     'toggle',

    // ── Attributes ────────────────────────────────────────────────────────────
    'setAttribute':      'setAttr',
    'updateAttr':        'setAttr',
    'changeAttr':        'setAttr',
    'writeAttr':         'setAttr',
    'deleteAttr':        'removeAttr',
    'clearAttr':         'removeAttr',
    'toggleAttribute':   'toggleAttr',
    'flipAttr':          'toggleAttr',

    // ── Storage / persistence ─────────────────────────────────────────────────
    'store':             'setStorage',
    'save':              'setStorage',
    'saveValue':         'setStorage',
    'storeValue':        'setStorage',
    'persist':           'setStorage',
    'writeStorage':      'setStorage',
    'setLocal':          'setStorage',
    'load':              'getStorage',
    'loadValue':         'getStorage',
    'readStorage':       'getStorage',
    'retrieve':          'getStorage',
    'getLocal':          'getStorage',
    'fetchStorage':      'getStorage',
    'deleteStorage':     'removeStorage',
    'clearStorage':      'removeStorage',
    'removeLocal':       'removeStorage',

    // ── Conditionals ──────────────────────────────────────────────────────────
    'if':                'ifStorage',
    'ifState':           'ifStorage',
    'ifValue':           'ifStorage',
    'checkStorage':      'ifStorage',
    'conditionalClass':  'ifHasClass',
    'checkClass':        'ifHasClass',
    'ifShown':           'ifVisible',
    'ifDisplayed':       'ifVisible',
    'checkVisible':      'ifVisible',

    // ── Form / input ──────────────────────────────────────────────────────────
    'getInput':          'getValue',
    'readInput':         'getValue',
    'setInput':          'setValue',
    'updateInput':       'setValue',
    'fillInput':         'setValue',
    'writeInput':        'setValue',

    // ── Timers ────────────────────────────────────────────────────────────────
    'wait':              'delay',
    'sleep':             'delay',
    'setTimeout':        'delay',
    'setInterval':       'interval',
    'repeat':            'interval',
    'loop':              'interval',
    'stopInterval':      'clearInterval',
    'cancelInterval':    'clearInterval',

    // ── Clipboard ─────────────────────────────────────────────────────────────
    'copy':              'copyToClipboard',
    'copyToClip':        'copyToClipboard',
    'writeClipboard':    'copyToClipboard',
    'clipboard':         'copyToClipboard',
    'copyValue':         'copyFromStorage',
    'copySaved':         'copyFromStorage',
    'copyElement':       'copyFromSelector',
    'copyContent':       'copyFromSelector',
    'copyPageElement':   'pageCopyFromSelector',
    'copyFromPage':      'pageCopyFromSelector',
    'copyPageContent':   'pageCopyFromSelector',

    // ── Page-scope (host website targeting) ───────────────────────────────────
    'hostAddClass':      'pageAddClass',
    'hostRemoveClass':   'pageRemoveClass',
    'hostToggleClass':   'pageToggleClass',
    'hostSetStyle':      'pageSetStyle',
    'hostShow':          'pageShow',
    'hostHide':          'pageHide',
    'hostToggle':        'pageToggle',
    'hostClick':         'pageClick',
    'hostFocus':         'pageFocus',
    'readText':          'pageQueryText',
    'fetchText':         'pageQueryText',
    'queryText':         'pageQueryText',
    'getPageText':       'pageQueryText',
    'fetchInput':        'pageGetValue',
    'getPageInput':      'pageGetValue',

    // ── Scroll ────────────────────────────────────────────────────────────────
    'scroll':            'scrollTo',
    'scrollIntoView':    'scrollTo',
    'scrollToEl':        'scrollTo',
    'scrollToElement':   'scrollTo',

    // ── Element creation ──────────────────────────────────────────────────────
    'create':            'createElement',
    'createEl':          'createElement',
    'createNode':        'createElement',
    'addElement':        'createElement',
    'insertElement':     'createElement',
    'delete':            'removeElement',
    'deleteElement':     'removeElement',
    'destroy':           'removeElement',
    'remove':            'removeElement',
    'removeEl':          'removeElement',
    'createPage':        'pageCreateElement',
    'createOnPage':      'pageCreateElement',
    'addToPage':         'pageCreateElement',
    'insertOnPage':      'pageCreateElement',

    // ── Event binding ─────────────────────────────────────────────────────────
    'listen':            'on',
    'bind':              'on',
    'addListener':       'on',
    'addEventListener':  'on',
    'onClick':           'on',
    'onEvent':           'on',
    'when':              'on',
    'handleClick':       'on',
    'handle':            'on',

    // ── Run / group ───────────────────────────────────────────────────────────
    'execute':           'run',
    'exec':              'run',
    'group':             'run',
    'sequence':          'run',
    'do':                'run'
  };

  // ── SECTION 3: Alias Rewriter ────────────────────────────────────────────────
  //
  // Walks the entire actions tree and rewrites any aliased op in-place.
  // Returns the count of rewrites made (used for logging).
  // Called BEFORE __webeditCollectUnknownActionOps so that successfully aliased
  // ops are NOT reported as unknown — only genuinely unrecognized names remain.

  function rewriteAliasedOps(arr, count) {
    if (!Array.isArray(arr)) return count;
    for (var i = 0; i < arr.length; i++) {
      var cmd = arr[i];
      if (!cmd || typeof cmd !== 'object') continue;

      var op = cmd.op;
      if (typeof op === 'string' && op) {
        var canonical = ALIASES[op];
        if (canonical) {
          cmd.op = canonical;
          count = (count || 0) + 1;
          console.log('[OpsAlias] Rewrote "' + op + '" -> "' + canonical + '"');
        }
      }

      if (Array.isArray(cmd.actions)) count = rewriteAliasedOps(cmd.actions, count);
      if (Array.isArray(cmd.then))    count = rewriteAliasedOps(cmd.then, count);
      if (Array.isArray(cmd.else))    count = rewriteAliasedOps(cmd.else, count);
    }
    return count || 0;
  }

  // ── SECTION 4: Unknown Op Collector ─────────────────────────────────────────
  //
  // Unchanged from original. Always run AFTER __webeditRewriteAliasedOps.

  function walkActions(arr, unknownList) {
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) {
      var cmd = arr[i];
      if (!cmd || typeof cmd !== 'object') continue;
      var op = cmd.op;
      if (typeof op === 'string' && op && !knownSet.has(op)) {
        unknownList.push(op);
      }
      if (Array.isArray(cmd.actions)) walkActions(cmd.actions, unknownList);
      if (Array.isArray(cmd.then))    walkActions(cmd.then, unknownList);
      if (Array.isArray(cmd.else))    walkActions(cmd.else, unknownList);
    }
  }

  // ── Expose on global scope ───────────────────────────────────────────────────

  var g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);

  g.__webeditKnownActionOps = KNOWN;

  // Step 1: rewrite aliases in-place. Call this first.
  g.__webeditRewriteAliasedOps = function (actions) {
    return rewriteAliasedOps(actions || [], 0);
  };

  // Step 2: collect any remaining unknowns. Call this after step 1.
  g.__webeditCollectUnknownActionOps = function (actions) {
    var raw = [];
    walkActions(actions || [], raw);
    var seen = {};
    var out = [];
    for (var j = 0; j < raw.length; j++) {
      var o = raw[j];
      if (!seen[o]) {
        seen[o] = true;
        out.push(o);
      }
    }
    return out;
  };

})();
