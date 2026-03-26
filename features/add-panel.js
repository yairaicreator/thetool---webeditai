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

  function showPickBar(isSecondary) {
    if (pickBarEl) {
      try { pickBarEl.remove(); } catch (_) {}
      pickBarEl = null;
    }

    var bottomControls = document.getElementById('webedit-bottom-controls');
    if (!bottomControls) return;

    pickBarEl = document.createElement('div');
    pickBarEl.className = 'webedit-remove-cancel-bar';
    pickBarEl.id = 'webedit-add-pick-bar';

    var msg = document.createElement('span');
    msg.className = 'webedit-remove-cancel-bar-msg';
    msg.textContent = isSecondary
      ? 'Add Mode \u2014 second pick: choose the related section on the page'
      : 'Add Mode \u2014 pick where you want the feature';
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
          showPickBar(message.pickPhase === 'secondary');
        } else if (message.state === 'IDLE') {
          hidePickBar();
          hideActionBar();
        }
        break;

      case 'ADD_PICK_COMPLETED': {
        hidePickBar();
        var label = message.summary || 'an element';
        chat('system', 'Element selected: ' + label);
        chat('assistant', 'Now describe what this feature should do. Include: the one main action users take, what success looks like, what must not change elsewhere on the page, whether state should be remembered after refresh, and if it matters on mobile. If the feature must read or control another part of the page, say which area.');
        break;
      }

      case 'ADD_NEED_SECONDARY_PICK':
      case 'ADD_SECONDARY_PICK_NEEDED': {
        var why = (message.secondaryContextPrompt || message.message || '').trim();
        chat('assistant', why || 'This feature needs another section of the page. Pick the related area on the website (second pick).');
        break;
      }

      case 'ADD_SECONDARY_PICK_COMPLETED': {
        hidePickBar();
        var p = message.primarySummary || 'first region';
        var s = message.summary || 'second region';
        chat('system', 'Related section selected: ' + s);
        chat('assistant', 'Generating the feature using both regions. If anything about how ' + p + ' and ' + s + ' should interact is wrong, use Refine after preview.');
        break;
      }

      case 'ADD_SPEC_VALIDATION_WARNING': {
        if (message.reason === 'unknown_ops' && Array.isArray(message.unknownOps) && message.unknownOps.length) {
          chat('assistant', 'Note: The preview may be incomplete. These commands are not supported yet: ' + message.unknownOps.join(', ') + '. Try Refine and ask for supported actions only.');
        } else if (message.reason === 'empty_actions') {
          chat('assistant', 'Note: The HTML looks interactive but the generated actions list is empty, so clicks may do nothing. Try Refine and ask for explicit button or control behavior.');
        }
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
