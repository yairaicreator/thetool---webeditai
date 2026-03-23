'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Add Feature — Panel Module
// Runs inside sidepanel.html after sidepanel.js.
// Manages the Add flow chat messages: pick confirmation, description prompt,
// spec-ready confirmation with Apply/Cancel action bar, and completion.
// Communication: JSON messages only (chrome.runtime).
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  var actionBarEl = null;
  var pickBarEl = null;

  function notify(text) {
    if (window.WebEditPanel && typeof window.WebEditPanel.showNotification === 'function') {
      window.WebEditPanel.showNotification(text);
    }
  }

  function chat(type, content, extra) {
    if (window.WebEditPanel && typeof window.WebEditPanel.addChatMessage === 'function') {
      window.WebEditPanel.addChatMessage(type, content, extra);
    }
  }

  // ─── Pick bar: shown above the feature buttons during Add pick ─────────

  function showPickBar() {
    if (pickBarEl) return;

    var bottomControls = document.getElementById('webedit-bottom-controls');
    if (!bottomControls) return;

    pickBarEl = document.createElement('div');
    pickBarEl.className = 'webedit-remove-cancel-bar';
    pickBarEl.id = 'webedit-add-pick-bar';

    var msg = document.createElement('span');
    msg.className = 'webedit-remove-cancel-bar-msg';
    msg.textContent = 'Add Mode \u2014 pick where you want the feature';
    pickBarEl.appendChild(msg);

    var btn = document.createElement('button');
    btn.className = 'webedit-remove-cancel-bar-btn';
    btn.type = 'button';
    btn.textContent = 'Cancel';
    btn.addEventListener('click', function () {
      hidePickBar();
      chrome.runtime.sendMessage({ type: 'CANCEL_FLOW' }, function () {
        if (chrome.runtime.lastError) {
          console.warn('[Add-Panel] CANCEL_FLOW failed:', chrome.runtime.lastError.message);
        }
      });
    });
    pickBarEl.appendChild(btn);

    bottomControls.parentNode.insertBefore(pickBarEl, bottomControls);
  }

  function hidePickBar() {
    if (!pickBarEl) return;
    try { pickBarEl.remove(); } catch (_) {}
    pickBarEl = null;
  }

  // ─── Apply / Cancel action bar: inserted in the chat area ──────────────

  function showActionBar() {
    hideActionBar();

    var chatContainer = document.getElementById('webedit-chat-messages');
    if (!chatContainer) return;

    actionBarEl = document.createElement('div');
    actionBarEl.className = 'webedit-add-action-bar';
    actionBarEl.id = 'webedit-add-action-bar';

    var applyBtn = document.createElement('button');
    applyBtn.className = 'webedit-add-action-btn webedit-add-apply-btn';
    applyBtn.type = 'button';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', function () {
      applyBtn.disabled = true;
      cancelBtn.disabled = true;
      chat('system', 'Applying feature...');
      chrome.runtime.sendMessage({ type: 'ADD_APPLY' }, function (resp) {
        if (chrome.runtime.lastError) {
          console.warn('[Add-Panel] ADD_APPLY failed:', chrome.runtime.lastError.message);
        }
        if (resp && !resp.success) {
          notify('Could not apply feature: ' + (resp.error || 'unknown'));
          applyBtn.disabled = false;
          cancelBtn.disabled = false;
        }
      });
    });

    var refineBtn = document.createElement('button');
    refineBtn.className = 'webedit-add-action-btn webedit-add-refine-btn';
    refineBtn.type = 'button';
    refineBtn.textContent = 'Refine';
    refineBtn.addEventListener('click', function () {
      chat('assistant', 'Describe what you\u2019d like to improve and send it.');
      var chatInput = document.getElementById('webedit-chat-input');
      if (chatInput) {
        chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        chatInput.focus();
        chatInput.setAttribute('placeholder', 'Describe what to improve...');
      }
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'webedit-add-action-btn webedit-add-cancel-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () {
      hideActionBar();
      chat('system', 'Feature cancelled.');
      chrome.runtime.sendMessage({ type: 'ADD_CANCEL' }, function () {
        if (chrome.runtime.lastError) {
          console.warn('[Add-Panel] ADD_CANCEL failed:', chrome.runtime.lastError.message);
        }
      });
    });

    actionBarEl.appendChild(applyBtn);
    actionBarEl.appendChild(refineBtn);
    actionBarEl.appendChild(cancelBtn);
    chatContainer.appendChild(actionBarEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function hideActionBar() {
    if (!actionBarEl) return;
    try { actionBarEl.remove(); } catch (_) {}
    actionBarEl = null;
  }

  // ─── Message listener ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'FLOW_STATE_CHANGED':
        if (message.state === 'PICKING' && message.feature === 'add') {
          showPickBar();
        } else if (message.state === 'IDLE') {
          hidePickBar();
          hideActionBar();
        }
        break;

      case 'ADD_PICK_COMPLETED': {
        hidePickBar();
        var label = message.summary || 'an element';
        chat('system', 'Element selected: ' + label);
        chat('assistant', 'Describe the feature you want to add to this section.');
        break;
      }

      case 'ADD_SPEC_READY': {
        chat('assistant', 'Feature generated! Review the preview on the page. Click Apply to keep it, Refine to improve it, or Cancel to discard.');
        showActionBar();
        break;
      }

      case 'ADD_COMPLETED': {
        hideActionBar();
        var text = 'Feature added! You can review it in EditHistory.';
        if (message.syncFailed) {
          text = 'Feature added locally \u2014 could not sync to cloud.';
        }
        notify(text);
        break;
      }
    }
  });

})();
