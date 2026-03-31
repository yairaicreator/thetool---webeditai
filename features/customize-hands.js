'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Customize Feature — Hands Module
// Selection highlight only. Preview <style> and text live in contentScript.js
// to avoid duplicate listeners and to use the observer pause/resume path.
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  function addSelectionHighlight(selector) {
    removeSelectionHighlight();
    if (!selector) return;
    try {
      var els = document.querySelectorAll(selector);
      for (var i = 0; i < els.length; i++) {
        els[i].classList.add('webedit-customize-selected');
      }
    } catch (_) {}
  }

  function removeSelectionHighlight() {
    var highlighted = document.querySelectorAll('.webedit-customize-selected');
    for (var i = 0; i < highlighted.length; i++) {
      highlighted[i].classList.remove('webedit-customize-selected');
    }
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'START_PICK_MODE':
        if (message.feature === 'customize') {
          console.log('[Customize-Hands] Customize pick mode started');
        }
        break;

      case 'STOP_PICK_MODE':
        console.log('[Customize-Hands] Pick mode stopped');
        break;

      case 'INJECT_PREVIEW_CSS':
        if (message.selector) {
          addSelectionHighlight(message.selector);
        }
        sendResponse({ success: true });
        return true;

      case 'CLEAR_PREVIEW_CSS':
        removeSelectionHighlight();
        sendResponse({ success: true });
        return true;
    }
  });

})();
