'use strict';

(function () {

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 1: Local State (The Local Memory)
  // The Hands hold zero persistent state. Everything is a volatile mirror of
  // what the Brain pushes via Target Dispatches.
  // ═══════════════════════════════════════════════════════════════════════════════

  var activeBlueprints = {};
  var pickModeActive = false;
  var pickModeFeature = null;

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 2: Constants
  // ═══════════════════════════════════════════════════════════════════════════════

  var STYLE_ID_PREFIX = 'webedit-style-';
  var CUSTOM_STYLE_ID_PREFIX = 'webedit-custom-style-';
  var ADD_CONTAINER_PREFIX = 'webedit-node-';
  var ADD_SCRIPT_PREFIX = 'webedit-script-';
  var WEBEDIT_CONTAINER_ID = 'webedit-injected-container';
  var CIRCUIT_BREAKER_THRESHOLD = 3;
  var DEBOUNCE_DELAY = 50;

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 3: Debounce Utility
  // ═══════════════════════════════════════════════════════════════════════════════

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, delay);
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 4: The Deaf Marker (Observer Pause / Resume)
  // Before the Hands inject, they disconnect() the Watchdog so their own
  // mutations don't re-trigger it. After injection they observe() again.
  // ═══════════════════════════════════════════════════════════════════════════════

  var observerInstance = null;
  var observerPaused = false;

  function pauseObserver() {
    if (observerInstance && !observerPaused) {
      observerInstance.disconnect();
      observerPaused = true;
    }
  }

  function resumeObserver() {
    if (observerInstance && observerPaused && document.body) {
      observerInstance.observe(document.body, { childList: true, subtree: true });
      observerPaused = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 5: Injection Strategy — Plan A / Plan C / Plan B
  // Circuit Breaker: per-edit counter tracks how many times React wiped our tag.
  // ═══════════════════════════════════════════════════════════════════════════════

  var headWipeCount = {};

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function getBlueprintCategory(edit) {
    var action = String(edit && edit.action || '').toLowerCase();
    if (action === 'remove' || action === 'hide') return 'remove';
    if (action === 'add' || action === 'text') return 'add';
    return 'customize';
  }

  function getBlueprintPayload(edit) {
    return isPlainObject(edit && edit.payload) ? edit.payload : {};
  }

  function getInjectionTarget(editId) {
    var wipeCount = headWipeCount[editId] || 0;

    // Plan A — Safe Zone: inject into <head> where React doesn't control
    if (wipeCount < CIRCUIT_BREAKER_THRESHOLD) {
      return { target: document.head, plan: 'A' };
    }

    // Plan C — Body-End Blind Spot: hidden container at the bottom of <body>
    var container = document.getElementById(WEBEDIT_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = WEBEDIT_CONTAINER_ID;
      container.setAttribute('data-webedit-id', 'style-container');
      container.style.display = 'none';
      document.body.appendChild(container);
    }
    if (container && document.body.contains(container)) {
      return { target: container, plan: 'C' };
    }

    // Plan B — Emergency: inject into <html> root (may cause layout glitches)
    return { target: document.documentElement, plan: 'B' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 6: Garbage Collection
  // Removes stale style tags for edits the Brain no longer considers active.
  // ═══════════════════════════════════════════════════════════════════════════════

  function removeStaleStyleTags() {
    var allTags = document.querySelectorAll('style[id^="' + STYLE_ID_PREFIX + '"]');
    for (var i = 0; i < allTags.length; i++) {
      var editId = allTags[i].id.slice(STYLE_ID_PREFIX.length);
      if (!activeBlueprints[editId]) {
        allTags[i].remove();
      }
    }
  }

  function removeStaleCustomArtifacts() {
    var customTags = document.querySelectorAll('style[id^="' + CUSTOM_STYLE_ID_PREFIX + '"]');
    for (var i = 0; i < customTags.length; i++) {
      var styleEditId = customTags[i].id.slice(CUSTOM_STYLE_ID_PREFIX.length);
      if (!activeBlueprints[styleEditId]) {
        customTags[i].remove();
      }
    }

    var addContainers = document.querySelectorAll('[id^="' + ADD_CONTAINER_PREFIX + '"]');
    for (var j = 0; j < addContainers.length; j++) {
      var containerEditId = addContainers[j].id.slice(ADD_CONTAINER_PREFIX.length);
      if (!activeBlueprints[containerEditId]) {
        addContainers[j].remove();
      }
    }

    var addScripts = document.querySelectorAll('script[id^="' + ADD_SCRIPT_PREFIX + '"]');
    for (var k = 0; k < addScripts.length; k++) {
      var scriptEditId = addScripts[k].id.slice(ADD_SCRIPT_PREFIX.length);
      if (!activeBlueprints[scriptEditId]) {
        addScripts[k].remove();
      }
    }
  }

  function buildCssText(edit, payload, category) {
    if (payload.cssText) return String(payload.cssText);
    if (payload.css) return String(payload.css);
    if (payload.ruleText) return String(payload.ruleText);
    if (payload.style) return String(edit.selector || '') + ' { ' + String(payload.style) + ' }';
    if (isPlainObject(payload.styles) && edit.selector) {
      var declarations = Object.keys(payload.styles).map(function (key) {
        return key + ': ' + payload.styles[key] + ';';
      }).join(' ');
      return declarations ? String(edit.selector) + ' { ' + declarations + ' }' : '';
    }

    if (category === 'remove' && edit.selector) {
      return String(edit.selector) + ' { display: none !important; }';
    }

    return '';
  }

  function applyStyleBlueprint(editId, edit, stylePrefix, category) {
    var styleId = stylePrefix + editId;
    var style = document.getElementById(styleId);
    var injection = getInjectionTarget(editId);
    var payload = getBlueprintPayload(edit);
    var cssText = buildCssText(edit, payload, category);

    if (!cssText) return;

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.setAttribute('data-webedit-id', editId);
      injection.target.appendChild(style);
    } else if (style.parentNode !== injection.target) {
      injection.target.appendChild(style);
    }

    style.textContent = cssText;
  }

  function insertContainerAtTarget(container, target, position) {
    if (!target) {
      (document.body || document.documentElement).appendChild(container);
      return;
    }

    switch (position) {
      case 'prepend':
      case 'afterbegin':
        target.insertBefore(container, target.firstChild);
        break;
      case 'beforebegin':
        if (target.parentNode) {
          target.parentNode.insertBefore(container, target);
          break;
        }
        (document.body || document.documentElement).appendChild(container);
        break;
      case 'afterend':
        if (target.parentNode) {
          target.parentNode.insertBefore(container, target.nextSibling);
          break;
        }
        (document.body || document.documentElement).appendChild(container);
        break;
      case 'append':
      case 'beforeend':
      default:
        target.appendChild(container);
        break;
    }
  }

  function applyAddBlueprint(editId, edit) {
    var payload = getBlueprintPayload(edit);
    var containerId = ADD_CONTAINER_PREFIX + editId;
    var container = document.getElementById(containerId);
    var targetSelector = payload.targetSelector || edit.selector;
    var target = null;
    var position = String(payload.position || payload.placement || 'beforeend').toLowerCase();

    if (targetSelector) {
      try {
        target = document.querySelector(targetSelector);
      } catch (_) {
        target = null;
      }
    }

    if (!target) {
      target = document.body || document.documentElement;
    }

    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.setAttribute('data-webedit-id', editId);
      insertContainerAtTarget(container, target, position);
    } else if (!container.parentNode) {
      insertContainerAtTarget(container, target, position);
    }

    if (payload.html || payload.text) {
      container.innerHTML = payload.html || payload.text || '';
    }

    if (payload.css || payload.cssText || payload.ruleText || payload.style || payload.styles) {
      applyStyleBlueprint(editId, edit, CUSTOM_STYLE_ID_PREFIX, 'customize');
    }

    if (payload.js) {
      var scriptId = ADD_SCRIPT_PREFIX + editId;
      var script = document.getElementById(scriptId);
      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.setAttribute('data-webedit-id', editId);
        script.textContent = String(payload.js);
        (document.body || document.documentElement).appendChild(script);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 7: The Executor — applyAllBlueprints()
  // The CSS Muscle. Idempotent: Ghost Footprint IDs prevent duplicates.
  // Wrapped in Deaf Marker to prevent Watchdog loops.
  // ═══════════════════════════════════════════════════════════════════════════════

  function applyAllBlueprints() {
    pauseObserver();

    try {
      removeStaleStyleTags();
      removeStaleCustomArtifacts();

      var entries = Object.keys(activeBlueprints);
      for (var i = 0; i < entries.length; i++) {
        var editId = entries[i];
        var edit = activeBlueprints[editId];
        var category = getBlueprintCategory(edit);

        if (category === 'remove') {
          applyStyleBlueprint(editId, edit, STYLE_ID_PREFIX, 'remove');
          continue;
        }

        if (category === 'customize') {
          applyStyleBlueprint(editId, edit, CUSTOM_STYLE_ID_PREFIX, 'customize');
          continue;
        }

        if (category === 'add') {
          applyAddBlueprint(editId, edit);
        }
      }
    } finally {
      resumeObserver();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 8: The Watchdog — MutationObserver with Circuit Breaker
  // Watches document.body for DOM changes. When React wipes our style tags,
  // the debounced callback increments the Circuit Breaker counter and
  // re-applies (which may escalate from Plan A to Plan C or B).
  // ═══════════════════════════════════════════════════════════════════════════════

  var debouncedReapply = debounce(function () {
    var keys = Object.keys(activeBlueprints);
    for (var i = 0; i < keys.length; i++) {
      var editId = keys[i];
      var styleId = STYLE_ID_PREFIX + editId;
      if (!document.getElementById(styleId)) {
        headWipeCount[editId] = (headWipeCount[editId] || 0) + 1;
      }
    }
    applyAllBlueprints();
  }, DEBOUNCE_DELAY);

  function startWatchdog() {
    if (observerInstance) {
      observerInstance.disconnect();
    }
    observerInstance = new MutationObserver(debouncedReapply);
    if (document.body) {
      observerInstance.observe(document.body, { childList: true, subtree: true });
      observerPaused = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 9: Feature Hook Functions (Scaffolding for 3 Future Features)
  // These stubs are the attachment points for Pick Mode, Executor/Injector,
  // and Watchdog feature modules. They do minimal work now so the Listener
  // wiring is already in place when the modules are created.
  // ═══════════════════════════════════════════════════════════════════════════════

  function handleStartPickMode(feature) {
    pickModeActive = true;
    pickModeFeature = feature;
    // Future: feature module adds hover listeners, applies .webedit-hover-highlight
    // from contentStyles.css, and reports clicks via ELEMENT_PICKED to the Brain.
    console.log('[Hands] Pick mode started for:', feature);
  }

  function handleStopPickMode() {
    pickModeActive = false;
    pickModeFeature = null;
    // Future: feature module removes hover listeners and .webedit-hover-highlight,
    // clears any .webedit-selected markers.
    console.log('[Hands] Pick mode stopped');
  }

  function handleExecuteBlueprint(blueprints) {
    activeBlueprints = blueprints || {};
    headWipeCount = {};
    applyAllBlueprints();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 10: The Listener (Switch Statement)
  // Zero autonomous logic. The Hands only act when the Brain sends a
  // Target Dispatch through this listener.
  // ═══════════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'APPLY_BLUEPRINTS':
        handleExecuteBlueprint(message.blueprints);
        sendResponse({ success: true });
        break;

      case 'START_PICK_MODE':
        handleStartPickMode(message.feature);
        sendResponse({ success: true });
        break;

      case 'STOP_PICK_MODE':
        handleStopPickMode();
        sendResponse({ success: true });
        break;

      default:
        break;
    }

    return true;
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 11: Initialization (The Nervous System)
  // On load, the Hands ask the Brain "what should I do?" via GET_ACTIVE_BLUEPRINTS.
  // The Brain's Tab Lifecycle Listener (Section 12 of background.js) also pushes
  // APPLY_BLUEPRINTS when a tab finishes loading — belt and suspenders.
  // After init, the Watchdog starts observing.
  // ═══════════════════════════════════════════════════════════════════════════════

  chrome.runtime.sendMessage(
    { type: 'GET_ACTIVE_BLUEPRINTS', url: window.location.href },
    function (response) {
      if (chrome.runtime.lastError) {
        console.warn('[Hands] Init failed:', chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.success) return;

      activeBlueprints = response.blueprints || {};
      applyAllBlueprints();
    }
  );

  startWatchdog();

})();
