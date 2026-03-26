'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Add Feature — Hands Module
// Runs in the content-script world alongside contentScript.js.
// Manages the Preview Lab: an in-place Shadow DOM sandbox at the picked
// element where AI-generated HTML/CSS and DOM command actions are rendered.
// The DOM Commands Vocabulary replaces raw JS with structured operations
// that execute as real DOM API calls, bypassing CSP on all websites.
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  var previewHost = null;
  var previewTarget = null;
  var namedIntervals = {};

  function webeditClipboardWrite(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text != null ? String(text) : '').catch(function (err) {
      console.warn('[Add-Hands] Clipboard write failed:', err && err.message ? err.message : err);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOM Commands Vocabulary — Interpreter Engine
  // Executes an array of structured action objects using real DOM API calls.
  // root: the container element to scope querySelector calls to.
  // ═══════════════════════════════════════════════════════════════════════════

  function executeActions(actions, root) {
    if (!Array.isArray(actions) || !root) return;
    for (var i = 0; i < actions.length; i++) {
      executeSingleAction(actions[i], root);
    }
  }

  function resolveEl(selector, root) {
    if (!selector) return null;
    try { return root.querySelector(selector); } catch (_) { return null; }
  }

  function resolveAll(selector, root) {
    if (!selector) return [];
    try { return Array.from(root.querySelectorAll(selector)); } catch (_) { return []; }
  }

  function executeSingleAction(cmd, root) {
    if (!cmd || !cmd.op) return;
    var op = cmd.op;
    var els, el;

    switch (op) {

      // ── Event Binding ────────────────────────────────────────────────────
      case 'on':
        els = resolveAll(cmd.selector, root);
        var evt = cmd.event || 'click';
        var nested = cmd.actions || [];
        els.forEach(function (target) {
          target.addEventListener(evt, function (e) {
            if (cmd.prevent) e.preventDefault();
            executeActions(nested, root);
          });
        });
        break;

      // ── Class Manipulation ───────────────────────────────────────────────
      case 'addClass':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) { if (cmd['class']) el.classList.add(cmd['class']); });
        break;

      case 'removeClass':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) { if (cmd['class']) el.classList.remove(cmd['class']); });
        break;

      case 'toggleClass':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) { if (cmd['class']) el.classList.toggle(cmd['class']); });
        break;

      // ── Style Manipulation ───────────────────────────────────────────────
      case 'setStyle':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) {
          if (cmd.property) el.style[cmd.property] = cmd.value || '';
        });
        break;

      // ── Content Manipulation ─────────────────────────────────────────────
      case 'setText':
        el = resolveEl(cmd.selector, root);
        if (el) el.textContent = cmd.text != null ? cmd.text : '';
        break;

      case 'setHTML':
        el = resolveEl(cmd.selector, root);
        if (el) el.innerHTML = cmd.html != null ? cmd.html : '';
        break;

      case 'setAttr':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) {
          if (cmd.attr) el.setAttribute(cmd.attr, cmd.value != null ? cmd.value : '');
        });
        break;

      case 'appendText':
        el = resolveEl(cmd.selector, root);
        if (el) el.textContent = (el.textContent || '') + (cmd.text != null ? cmd.text : '');
        break;

      case 'prependText':
        el = resolveEl(cmd.selector, root);
        if (el) el.textContent = (cmd.text != null ? cmd.text : '') + (el.textContent || '');
        break;

      case 'removeAttr':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) {
          if (cmd.attr) el.removeAttribute(cmd.attr);
        });
        break;

      case 'toggleAttr':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (node) {
          if (!cmd.attr) return;
          if (cmd.onValue !== undefined && cmd.offValue !== undefined) {
            var cur = node.getAttribute(cmd.attr);
            var onS = String(cmd.onValue);
            var offS = String(cmd.offValue);
            node.setAttribute(cmd.attr, cur === onS ? offS : onS);
          } else if (node.hasAttribute(cmd.attr)) {
            node.removeAttribute(cmd.attr);
          } else {
            node.setAttribute(cmd.attr, cmd.value != null ? String(cmd.value) : '');
          }
        });
        break;

      // ── Visibility ───────────────────────────────────────────────────────
      case 'show':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) { el.style.display = ''; });
        break;

      case 'hide':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) { el.style.display = 'none'; });
        break;

      case 'toggle':
        els = resolveAll(cmd.selector, root);
        els.forEach(function (el) {
          el.style.display = (el.style.display === 'none') ? '' : 'none';
        });
        break;

      // ── Element Creation / Removal ───────────────────────────────────────
      case 'createElement': {
        var tag = cmd.tag || 'div';
        var newEl = document.createElement(tag);
        if (cmd.id) newEl.id = cmd.id;
        if (cmd.classes) {
          var clsList = Array.isArray(cmd.classes) ? cmd.classes : cmd.classes.split(' ');
          clsList.forEach(function (c) { if (c) newEl.classList.add(c); });
        }
        if (cmd.text) newEl.textContent = cmd.text;
        if (cmd.html) newEl.innerHTML = cmd.html;
        var parent = cmd.parent ? resolveEl(cmd.parent, root) : root;
        if (parent) {
          insertContainerAtTarget(newEl, parent, cmd.position || 'beforeend');
        }
        break;
      }

      case 'removeElement':
        el = resolveEl(cmd.selector, root);
        if (el) el.remove();
        break;

      // ── State Persistence (localStorage) ─────────────────────────────────
      case 'setStorage':
        if (cmd.key) {
          try { localStorage.setItem(cmd.key, cmd.value != null ? String(cmd.value) : ''); } catch (_) {}
        }
        break;

      case 'getStorage': {
        if (!cmd.key) break;
        var stored = null;
        try { stored = localStorage.getItem(cmd.key); } catch (_) {}
        if (stored != null && cmd.selector) {
          el = resolveEl(cmd.selector, root);
          if (el) {
            if (cmd.attr) {
              el.setAttribute(cmd.attr, stored);
            } else {
              el.textContent = stored;
            }
          }
        }
        break;
      }

      case 'removeStorage':
        if (cmd.key) {
          try { localStorage.removeItem(cmd.key); } catch (_) {}
        }
        break;

      // ── Conditional Logic ────────────────────────────────────────────────
      case 'ifStorage': {
        var val = null;
        try { val = localStorage.getItem(cmd.key); } catch (_) {}
        if (val === cmd.equals || (cmd.equals === true && val != null) || (cmd.equals === false && val == null)) {
          executeActions(cmd['then'] || [], root);
        } else {
          executeActions(cmd['else'] || [], root);
        }
        break;
      }

      case 'ifHasClass':
        el = resolveEl(cmd.selector, root);
        if (el && el.classList.contains(cmd['class'])) {
          executeActions(cmd['then'] || [], root);
        } else {
          executeActions(cmd['else'] || [], root);
        }
        break;

      case 'ifVisible':
        el = resolveEl(cmd.selector, root);
        if (el && el.style.display !== 'none') {
          executeActions(cmd['then'] || [], root);
        } else {
          executeActions(cmd['else'] || [], root);
        }
        break;

      // ── Timers ───────────────────────────────────────────────────────────
      case 'delay':
        if (cmd.ms && cmd.actions) {
          var delayActions = cmd.actions;
          var delayRoot = root;
          setTimeout(function () { executeActions(delayActions, delayRoot); }, cmd.ms);
        }
        break;

      case 'interval':
        if (cmd.ms && cmd.actions && cmd.id) {
          if (namedIntervals[cmd.id]) clearInterval(namedIntervals[cmd.id]);
          var ivActions = cmd.actions;
          var ivRoot = root;
          namedIntervals[cmd.id] = setInterval(function () { executeActions(ivActions, ivRoot); }, cmd.ms);
        }
        break;

      case 'clearInterval':
        if (cmd.id && namedIntervals[cmd.id]) {
          clearInterval(namedIntervals[cmd.id]);
          delete namedIntervals[cmd.id];
        }
        break;

      // ── Scroll ───────────────────────────────────────────────────────────
      case 'scrollTo':
        el = resolveEl(cmd.selector, root);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;

      // ── Form ─────────────────────────────────────────────────────────────
      case 'getValue':
        el = resolveEl(cmd.selector, root);
        if (el && cmd.storageKey) {
          try { localStorage.setItem(cmd.storageKey, el.value || ''); } catch (_) {}
        }
        break;

      case 'setValue':
        el = resolveEl(cmd.selector, root);
        if (el) el.value = cmd.value != null ? cmd.value : '';
        break;

      // ── Page-Scoped Ops (target the host page, not the feature container) ─
      case 'pageAddClass':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && cmd['class']) el.classList.add(cmd['class']);
        break;

      case 'pageRemoveClass':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && cmd['class']) el.classList.remove(cmd['class']);
        break;

      case 'pageToggleClass':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && cmd['class']) el.classList.toggle(cmd['class']);
        break;

      case 'pageSetStyle':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && cmd.property) el.style[cmd.property] = cmd.value || '';
        break;

      case 'pageShow':
        try { els = Array.from(document.querySelectorAll(cmd.selector || '')); } catch (_) { els = []; }
        els.forEach(function (node) { node.style.display = ''; });
        break;

      case 'pageHide':
        try { els = Array.from(document.querySelectorAll(cmd.selector || '')); } catch (_) { els = []; }
        els.forEach(function (node) { node.style.display = 'none'; });
        break;

      case 'pageToggle':
        try { els = Array.from(document.querySelectorAll(cmd.selector || '')); } catch (_) { els = []; }
        els.forEach(function (node) {
          node.style.display = (node.style.display === 'none') ? '' : 'none';
        });
        break;

      case 'pageToggleAttr':
        try { els = Array.from(document.querySelectorAll(cmd.selector || '')); } catch (_) { els = []; }
        els.forEach(function (node) {
          if (!cmd.attr) return;
          if (cmd.onValue !== undefined && cmd.offValue !== undefined) {
            var curP = node.getAttribute(cmd.attr);
            var onP = String(cmd.onValue);
            var offP = String(cmd.offValue);
            node.setAttribute(cmd.attr, curP === onP ? offP : onP);
          } else if (node.hasAttribute(cmd.attr)) {
            node.removeAttribute(cmd.attr);
          } else {
            node.setAttribute(cmd.attr, cmd.value != null ? String(cmd.value) : '');
          }
        });
        break;

      case 'pageClick':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && typeof el.click === 'function') el.click();
        break;

      case 'pageFocus':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && typeof el.focus === 'function') {
          try {
            el.focus({ preventScroll: false });
          } catch (_) {
            try { el.focus(); } catch (_) {}
          }
        }
        break;

      case 'pageQueryText': {
        var mode = cmd.mode === 'all' ? 'all' : 'first';
        var parts = [];
        try {
          var list = document.querySelectorAll(cmd.selector || '');
          for (var qi = 0; qi < list.length; qi++) {
            var t = (list[qi].textContent || '').trim();
            if (t) parts.push(t);
            if (mode === 'first' && parts.length) break;
          }
        } catch (_) {}
        var joined = mode === 'all' ? parts.join('\n') : (parts[0] || '');
        if (cmd.storageKey) {
          try { localStorage.setItem(cmd.storageKey, joined); } catch (_) {}
        }
        break;
      }

      case 'pageQueryValue':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && cmd.storageKey && 'value' in el) {
          try {
            localStorage.setItem(cmd.storageKey, el.value != null ? String(el.value) : '');
          } catch (_) {}
        }
        break;

      // Same as pageQueryValue — LLMs often emit this name for "read host input into storage".
      case 'pageGetValue':
        try { el = document.querySelector(cmd.selector); } catch (_) { el = null; }
        if (el && cmd.storageKey && 'value' in el) {
          try {
            localStorage.setItem(cmd.storageKey, el.value != null ? String(el.value) : '');
          } catch (_) {}
        }
        break;

      case 'copyToClipboard': {
        var clip = '';
        if (cmd.storageKey) {
          try {
            var got = localStorage.getItem(cmd.storageKey);
            if (got != null && got !== '') clip = String(got);
          } catch (_) {}
        }
        if (clip === '' && cmd.text != null) clip = String(cmd.text);
        webeditClipboardWrite(clip);
        break;
      }

      case 'copyText':
        webeditClipboardWrite(cmd.text != null ? cmd.text : '');
        break;

      case 'copyFromSelector': {
        var csel = resolveEl(cmd.selector, root);
        if (!csel) break;
        var cstr = cmd.useValue && 'value' in csel
          ? String(csel.value != null ? csel.value : '')
          : String(csel.textContent || '');
        webeditClipboardWrite(cstr);
        break;
      }

      case 'pageCopyFromSelector': {
        var pcsel = null;
        try { pcsel = document.querySelector(cmd.selector); } catch (_) { pcsel = null; }
        if (!pcsel) break;
        var pcstr = cmd.useValue && 'value' in pcsel
          ? String(pcsel.value != null ? pcsel.value : '')
          : String(pcsel.textContent || '');
        webeditClipboardWrite(pcstr);
        break;
      }

      case 'copyFromStorage':
        if (cmd.key) {
          var cstor = '';
          try { cstor = localStorage.getItem(cmd.key) || ''; } catch (_) {}
          webeditClipboardWrite(cstor);
        }
        break;

      case 'pageCreateElement': {
        var ptag = cmd.tag || 'div';
        var pnew = document.createElement(ptag);
        if (cmd.id) pnew.id = cmd.id;
        if (cmd.classes) {
          var pcl = Array.isArray(cmd.classes) ? cmd.classes : String(cmd.classes).split(/\s+/);
          pcl.forEach(function (c) { if (c) pnew.classList.add(c); });
        }
        if (cmd.text) pnew.textContent = cmd.text;
        if (cmd.html) pnew.innerHTML = cmd.html;
        var pparent = null;
        var pp = cmd.parent;
        if (pp === 'body' || pp === 'document.body') {
          pparent = document.body || document.documentElement;
        } else if (pp) {
          try { pparent = document.querySelector(pp); } catch (_) { pparent = null; }
        }
        if (pparent) {
          insertContainerAtTarget(pnew, pparent, cmd.position || 'beforeend');
        }
        break;
      }

      default:
        console.warn('[Add-Hands] Unknown action op:', op);
        break;
    }
  }

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

  // ── Spec injection: injects CSS/HTML/actions into the Shadow Root ────────

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

    if (Array.isArray(spec.actions) && spec.actions.length > 0) {
      executeActions(spec.actions, container);
    }
    if (typeof window.__webeditCollectUnknownActionOps === 'function') {
      var unk = window.__webeditCollectUnknownActionOps(spec.actions || []);
      if (unk.length) {
        console.warn('[Add-Hands] Unsupported ops in spec (showing up to 12):', unk.slice(0, 12).join(', '));
      }
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

  // ── Expose interpreter for use by contentScript.js blueprint Apply path ────

  window.__webeditActions = { execute: executeActions };

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
