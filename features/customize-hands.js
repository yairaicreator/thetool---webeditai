'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Customize Feature — Hands Module
// Runs in the content-script world alongside contentScript.js.
// Handles the selection highlight on the element being customized and manages
// the temporary preview <style> tag for live CSS preview.
// The dashboard UI lives in the Panel zone (customize-panel.js).
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  var PREVIEW_STYLE_ID = 'webedit-preview-style';
  var highlightedSelector = null;

  function addSelectionHighlight(selector) {
    removeSelectionHighlight();
    if (!selector) return;
    highlightedSelector = selector;
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
    highlightedSelector = null;
  }

  function injectPreviewCss(cssText) {
    var style = document.getElementById(PREVIEW_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = PREVIEW_STYLE_ID;
      style.setAttribute('data-webedit-id', 'preview');
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = cssText || '';
  }

  function clearPreviewCss() {
    var style = document.getElementById(PREVIEW_STYLE_ID);
    if (style) {
      style.remove();
    }
    removeSelectionHighlight();
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
        injectPreviewCss(message.cssText);
        if (message.selector) {
          addSelectionHighlight(message.selector);
        }
        sendResponse({ success: true });
        return true;

      case 'CLEAR_PREVIEW_CSS':
        clearPreviewCss();
        sendResponse({ success: true });
        return true;
    }
  });

})();
