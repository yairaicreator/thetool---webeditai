'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Remove Feature — Panel Module
// Runs inside sidepanel.html after sidepanel.js.
// Manages the in-panel cancel bar (above the feature buttons) and listens
// for Remove-specific Brain broadcasts.
// Communication: JSON messages only (chrome.runtime).
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  var cancelBarEl = null;

  function notify(text) {
    if (window.WebEditPanel && typeof window.WebEditPanel.showNotification === 'function') {
      window.WebEditPanel.showNotification(text);
    }
  }

  // ─── Cancel bar: shown above the 3 feature buttons during Remove flow ────

  function showCancelBar() {
    if (cancelBarEl) return;

    var bottomControls = document.getElementById('webedit-bottom-controls');
    if (!bottomControls) return;

    cancelBarEl = document.createElement('div');
    cancelBarEl.className = 'webedit-remove-cancel-bar';
    cancelBarEl.id = 'webedit-remove-cancel-bar';

    var msg = document.createElement('span');
    msg.className = 'webedit-remove-cancel-bar-msg';
    msg.textContent = 'Remove Mode — pick an element on the page';
    cancelBarEl.appendChild(msg);

    var btn = document.createElement('button');
    btn.className = 'webedit-remove-cancel-bar-btn';
    btn.type = 'button';
    btn.textContent = 'Cancel';
    btn.addEventListener('click', function () {
      hideCancelBar();
      chrome.runtime.sendMessage({ type: 'CANCEL_FLOW' }, function () {
        if (chrome.runtime.lastError) {
          console.warn('[Remove-Panel] CANCEL_FLOW failed:', chrome.runtime.lastError.message);
        }
      });
    });
    cancelBarEl.appendChild(btn);

    bottomControls.parentNode.insertBefore(cancelBarEl, bottomControls);
  }

  function hideCancelBar() {
    if (!cancelBarEl) return;
    try { cancelBarEl.remove(); } catch (_) {}
    cancelBarEl = null;
  }

  // ─── Message listener ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'FLOW_STATE_CHANGED':
        if (message.state === 'PICKING' && message.feature === 'remove') {
          showCancelBar();
        } else if (message.state === 'IDLE') {
          hideCancelBar();
        }
        break;

      case 'REMOVE_COMPLETED': {
        hideCancelBar();
        var summary = message.summary || 'an element';
        notify('Element removed: ' + summary);
        break;
      }
    }
  });

})();
