'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Remove Feature — Panel Module
// Runs inside sidepanel.html after sidepanel.js.
// Listens for Remove-specific Brain broadcasts and shows enhanced
// notifications via window.WebEditPanel (exposed by sidepanel.js).
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  function notify(text) {
    if (window.WebEditPanel && typeof window.WebEditPanel.showNotification === 'function') {
      window.WebEditPanel.showNotification(text);
    }
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;

    if (message.type === 'REMOVE_COMPLETED') {
      var summary = message.summary || 'an element';
      notify('Element removed: ' + summary);
    }
  });

})();
