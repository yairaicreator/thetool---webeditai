'use strict';

(function () {

  // ─── Local State (The Local Memory) ─────────────────────────────────────────
  let activeBlueprints = {};

  // ─── Utility: Debounce ──────────────────────────────────────────────────────
  function blueprintsToMap(blueprints) {
    if (!Array.isArray(blueprints)) return blueprints || {};
    var map = {};
    for (var i = 0; i < blueprints.length; i++) {
      map[blueprints[i].editId] = blueprints[i];
    }
    return map;
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ─── The CSS Muscle: Idempotent Blueprint Executor ──────────────────────────
  function applyAllBlueprints() {
    // Garbage Collection: tear down style tags for edits the Brain no longer considers active
    const existingTags = document.querySelectorAll('style[id^="webedit-style-"]');
    existingTags.forEach((tag) => {
      const editId = tag.id.slice('webedit-style-'.length);
      if (!activeBlueprints[editId]) {
        tag.remove();
      }
    });

    for (const [editId, edit] of Object.entries(activeBlueprints)) {
      if (edit.action !== 'remove') continue;

      const styleId = 'webedit-style-' + editId;
      if (document.getElementById(styleId)) continue;

      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = edit.selector + ' { display: none !important; }';
      document.head.appendChild(style);
    }
  }

  // ─── The Nervous System: Initialization ─────────────────────────────────────
  chrome.runtime.sendMessage(
    { command: 'GET_ACTIVE_BLUEPRINTS', url: window.location.href },
    function (response) {
      if (chrome.runtime.lastError) {
        console.warn('[Hands] Init failed:', chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.success) {
        console.warn('[Hands] Brain returned no active blueprints.');
        return;
      }
      activeBlueprints = blueprintsToMap(response.blueprints);
      applyAllBlueprints();
    }
  );

  // ─── The Spinal Listener: Live Updates from the Brain ───────────────────────
  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message.command === 'BLUEPRINTS_UPDATED') {
      activeBlueprints = blueprintsToMap(message.blueprints);
      applyAllBlueprints();
      sendResponse({ success: true });
    }
    return true;
  });

  // ─── The Watchdog: Debounced MutationObserver ───────────────────────────────
  const debouncedApply = debounce(applyAllBlueprints, 50);
  const observer = new MutationObserver(debouncedApply);

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

})();
