'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Add Feature — Panel Module
// Runs inside sidepanel.html after sidepanel.js.
// Manages the Add flow chat messages: pick confirmation, description prompt,
// spec-ready confirmation (Apply / Refine / Cancel on the assistant message),
// and completion.
// Communication: JSON messages only (chrome.runtime).
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

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

  // ─── Message listener ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'FLOW_STATE_CHANGED':
        if (message.state === 'PICKING' && message.feature === 'add') {
          showPickBar(message.pickPhase === 'secondary');
        } else if (message.state === 'IDLE') {
          hidePickBar();
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
        // Strip any "Processing…" placeholder before showing the spec-ready message.
        // This prevents "Processing…" from persisting alongside the preview buttons.
        if (window.WebEditPanel && typeof window.WebEditPanel.stripProcessingMessages === 'function') {
          window.WebEditPanel.stripProcessingMessages();
        }
        chat(
          'assistant',
          'Feature generated! Review the preview on the page. Click Apply to keep it, Refine to improve it, or Cancel to discard.',
          { addSpecPending: true }
        );
        break;
      }

      case 'ADD_COMPLETED': {
        // Sync principle: this message fires ONLY when the Brain has actually
        // committed the feature — so it is always truthful.
        var text = message.syncFailed
          ? '\u2713 Feature applied locally \u2014 cloud sync will retry automatically.'
          : '\u2713 Feature applied successfully. You can review it in Edit History.';
        notify(text);
        break;
      }
    }
  });

})();
