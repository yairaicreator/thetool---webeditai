'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Remove Feature — Hands Module
// Runs in the content-script world alongside contentScript.js.
// The cancel UI lives in the Panel zone (remove-panel.js) so it is not
// affected by Pick Mode's crosshair / hover outlines.
// This file is kept as the Hands-zone hook for any future Remove-specific
// DOM-side behaviour (e.g. removal animations, undo toast on the page).
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'START_PICK_MODE':
        if (message.feature === 'remove') {
          console.log('[Remove-Hands] Remove pick mode started');
        }
        break;

      case 'STOP_PICK_MODE':
        console.log('[Remove-Hands] Pick mode stopped');
        break;
    }
  });

})();
