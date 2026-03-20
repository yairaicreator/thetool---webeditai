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

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 7: The Executor — applyAllBlueprints()
  // The CSS Muscle. Idempotent: Ghost Footprint IDs prevent duplicates.
  // Wrapped in Deaf Marker to prevent Watchdog loops.
  // ═══════════════════════════════════════════════════════════════════════════════

  function applyAllBlueprints() {
    pauseObserver();

    try {
      removeStaleStyleTags();

      var entries = Object.keys(activeBlueprints);
      for (var i = 0; i < entries.length; i++) {
        var editId = entries[i];
        var edit = activeBlueprints[editId];

        if (edit.action !== 'remove') continue;

        var styleId = STYLE_ID_PREFIX + editId;
        if (document.getElementById(styleId)) continue;

        var injection = getInjectionTarget(editId);

        var style = document.createElement('style');
        style.id = styleId;
        style.setAttribute('data-webedit-id', editId);
        style.textContent = edit.selector + ' { display: none !important; }';
        injection.target.appendChild(style);

        console.log('[Hands] Injected', styleId, '(Plan ' + injection.plan + ')');
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
