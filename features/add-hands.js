'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Add Feature — Hands Module
// Runs in the content-script world alongside contentScript.js.
// Manages the Preview Lab: an in-place Shadow DOM sandbox at the picked
// element where AI-generated HTML/CSS/JS is rendered for user review.
// Style cloning ensures visual consistency with the host page.
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  var previewHost = null;
  var previewTarget = null;

  // ── DOM insertion utility ──────────────────────────────────────────────────

  function insertContainerAtTarget(container, target, position) {
    if (!target) {
      (document.body || document.documentElement).appendChild(container);
      return;
    }

    switch (position) {
      case 'prepend':
      case 'afterbegin':
        target.insertBefore(container, target.firstChild);
        break;
      case 'beforebegin':
        if (target.parentNode) {
          target.parentNode.insertBefore(container, target);
          break;
        }
        (document.body || document.documentElement).appendChild(container);
        break;
      case 'afterend':
        if (target.parentNode) {
          target.parentNode.insertBefore(container, target.nextSibling);
          break;
        }
        (document.body || document.documentElement).appendChild(container);
        break;
      case 'append':
      case 'beforeend':
      default:
        target.appendChild(container);
        break;
    }
  }

  // ── Style cloning: copies host page styles into Shadow DOM ─────────────────

  function cloneHostStyles(shadowRoot) {
    var styleClone = document.createElement('div');
    styleClone.setAttribute('data-webedit-cloned-styles', '1');
    document.querySelectorAll('style').forEach(function (s) {
      if (s.getAttribute('data-webedit-id')) return;
      styleClone.appendChild(s.cloneNode(true));
    });
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      styleClone.appendChild(l.cloneNode(false));
    });
    shadowRoot.insertBefore(styleClone, shadowRoot.firstChild);
  }

  // ── Scoped JS executor: redirects document queries into Shadow Root ────────

  function runScopedScript(js, shadowRoot) {
    if (!js) return;
    try {
      var scopedDoc = new Proxy(document, {
        get: function (target, prop) {
          if (prop === 'querySelector') return shadowRoot.querySelector.bind(shadowRoot);
          if (prop === 'querySelectorAll') return shadowRoot.querySelectorAll.bind(shadowRoot);
          if (prop === 'getElementById') return function (id) {
            return shadowRoot.querySelector('#' + id);
          };
          if (prop === 'getElementsByClassName') return function (cls) {
            return shadowRoot.querySelectorAll('.' + cls);
          };
          var val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
      var fn = new Function('document', 'shadowRoot', '"use strict";\n' + js);
      fn(scopedDoc, shadowRoot);
    } catch (e) {
      console.warn('[Add-Hands] Preview script error:', e.message);
    }
  }

  // ── Spec injection: injects CSS/HTML/JS into the Shadow Root ───────────────

  function injectSpecIntoShadow(shadowRoot, spec) {
    var existing = shadowRoot.querySelector('[data-webedit-preview-content]');
    if (existing) existing.remove();
    var existingStyle = shadowRoot.querySelector('[data-webedit-preview-css]');
    if (existingStyle) existingStyle.remove();

    if (spec.css) {
      var style = document.createElement('style');
      style.setAttribute('data-webedit-preview-css', '1');
      style.textContent = spec.css;
      shadowRoot.appendChild(style);
    }

    var container = document.createElement('div');
    container.setAttribute('data-webedit-preview-content', '1');
    if (spec.html) {
      container.innerHTML = spec.html;
    }
    shadowRoot.appendChild(container);

    if (spec.js) {
      runScopedScript(spec.js, shadowRoot);
    }
  }

  // ── Preview handlers ───────────────────────────────────────────────────────

  function handleInjectPreview(message) {
    handleClosePreview();

    var selector = message.selector || '';
    var spec = message.spec || {};
    var target = null;

    if (selector) {
      try { target = document.querySelector(selector); } catch (_) {}
    }
    if (!target) {
      target = document.body || document.documentElement;
    }

    previewTarget = target;
    previewTarget.classList.add('webedit-ghost-highlight');

    previewHost = document.createElement('div');
    previewHost.setAttribute('data-webedit-preview', '1');
    previewHost.setAttribute('data-webedit-id', 'preview-lab');
    insertContainerAtTarget(previewHost, target, 'beforeend');

    var shadow = previewHost.attachShadow({ mode: 'open' });
    cloneHostStyles(shadow);
    injectSpecIntoShadow(shadow, spec);
  }

  function handleUpdatePreview(message) {
    if (!previewHost || !previewHost.shadowRoot) return;
    var spec = message.spec || {};
    injectSpecIntoShadow(previewHost.shadowRoot, spec);
  }

  function handleClosePreview() {
    if (previewTarget) {
      previewTarget.classList.remove('webedit-ghost-highlight');
      previewTarget = null;
    }
    if (previewHost) {
      previewHost.remove();
      previewHost = null;
    }
  }

  // ── Message listener ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'INJECT_PREVIEW':
        handleInjectPreview(message);
        sendResponse({ success: true });
        return true;

      case 'UPDATE_PREVIEW':
        handleUpdatePreview(message);
        sendResponse({ success: true });
        return true;

      case 'CLOSE_PREVIEW':
        handleClosePreview();
        sendResponse({ success: true });
        return true;
    }
  });

})();
