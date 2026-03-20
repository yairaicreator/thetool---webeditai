'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Remove Feature — Hands Module
// Runs in the content-script world alongside contentScript.js.
// Manages the cancel-popup overlay that appears during Remove pick mode.
// Communication with the Brain is JSON-message-only (chrome.runtime).
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  var POPUP_ID = 'webedit-remove-popup';
  var popupEl = null;

  // ─── Create / show the cancel popup ──────────────────────────────────────

  function showPopup() {
    if (popupEl) return;

    popupEl = document.createElement('div');
    popupEl.id = POPUP_ID;
    popupEl.className = 'webedit-remove-popup';
    popupEl.setAttribute('data-webedit-id', 'remove-popup');

    var label = document.createElement('span');
    label.className = 'webedit-remove-popup-label';
    label.textContent = 'Click an element to remove';
    popupEl.appendChild(label);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'webedit-remove-popup-close';
    closeBtn.setAttribute('data-webedit-id', 'remove-popup-close');
    closeBtn.setAttribute('aria-label', 'Cancel remove');
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      hidePopup();
      chrome.runtime.sendMessage({ type: 'CANCEL_FLOW' }, function () {
        if (chrome.runtime.lastError) {
          console.warn('[Remove-Hands] CANCEL_FLOW send failed:', chrome.runtime.lastError.message);
        }
      });
    }, true);
    popupEl.appendChild(closeBtn);

    (document.body || document.documentElement).appendChild(popupEl);
  }

  // ─── Hide / destroy the cancel popup ─────────────────────────────────────

  function hidePopup() {
    if (!popupEl) return;
    try { popupEl.remove(); } catch (_) {}
    popupEl = null;
  }

  // ─── Message listener ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'START_PICK_MODE':
        if (message.feature === 'remove') {
          showPopup();
        }
        break;

      case 'STOP_PICK_MODE':
        hidePopup();
        break;
    }
  });

})();
