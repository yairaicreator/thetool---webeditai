'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Add Feature — known action ops (single source for validation vs add-hands.js)
// Loaded before add-hands.js in manifest.
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
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
    'delay', 'interval', 'clearInterval',
    'scrollTo',
    'getValue', 'setValue',
    'pageAddClass', 'pageRemoveClass', 'pageToggleClass', 'pageSetStyle',
    'pageShow', 'pageHide', 'pageToggle', 'pageToggleAttr',
    'pageQueryText', 'pageQueryValue', 'pageClick', 'pageFocus',
    'copyText', 'copyFromSelector', 'pageCopyFromSelector', 'copyFromStorage', 'copyToClipboard'
  ];

  var knownSet = new Set(KNOWN);

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
      if (Array.isArray(cmd.then)) walkActions(cmd.then, unknownList);
      if (Array.isArray(cmd.else)) walkActions(cmd.else, unknownList);
    }
  }

  var g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
  g.__webeditKnownActionOps = KNOWN;
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
