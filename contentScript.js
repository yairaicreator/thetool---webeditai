'use strict';

(function () {

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 1: Local State (The Local Memory)
  // The Hands hold zero persistent state. Everything is a volatile mirror of
  // what the Brain pushes via Target Dispatches.
  // ═══════════════════════════════════════════════════════════════════════════════

  var activeBlueprints = {};
  var pickModeActive = false;
  var pickModeFeature = null;
  var pickModePhase = 'primary';

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 2: Constants
  // ═══════════════════════════════════════════════════════════════════════════════

  var STYLE_ID_PREFIX = 'webedit-style-';
  var CUSTOM_STYLE_ID_PREFIX = 'webedit-custom-style-';
  var ADD_CONTAINER_PREFIX = 'webedit-node-';
  var ADD_SCRIPT_PREFIX = 'webedit-script-';
  var WEBEDIT_CONTAINER_ID = 'webedit-injected-container';
  var CIRCUIT_BREAKER_THRESHOLD = 3;
  var DEBOUNCE_DELAY = 50;

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 3: Debounce Utility
  // ═══════════════════════════════════════════════════════════════════════════════

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, delay);
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 4: The Deaf Marker (Observer Pause / Resume)
  // Before the Hands inject, they disconnect() the Watchdog so their own
  // mutations don't re-trigger it. After injection they observe() again.
  // ═══════════════════════════════════════════════════════════════════════════════

  var observerInstance = null;
  var observerPaused = false;

  function pauseObserver() {
    if (observerInstance && !observerPaused) {
      observerInstance.disconnect();
      observerPaused = true;
    }
  }

  function resumeObserver() {
    if (observerInstance && observerPaused && document.body) {
      observerInstance.observe(document.body, { childList: true, subtree: true });
      observerPaused = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 5: Injection Strategy — Plan A / Plan C / Plan B
  // Circuit Breaker: per-edit counter tracks how many times React wiped our tag.
  // ═══════════════════════════════════════════════════════════════════════════════

  var headWipeCount = {};

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function getBlueprintCategory(edit) {
    var action = String(edit && edit.action || '').toLowerCase();
    if (action === 'remove' || action === 'hide') return 'remove';
    if (action === 'add' || action === 'text') return 'add';
    return 'customize';
  }

  function getBlueprintPayload(edit) {
    return isPlainObject(edit && edit.payload) ? edit.payload : {};
  }

  function getInjectionTarget(editId) {
    var wipeCount = headWipeCount[editId] || 0;

    // Plan A — Safe Zone: inject into <head> where React doesn't control
    if (wipeCount < CIRCUIT_BREAKER_THRESHOLD) {
      return { target: document.head, plan: 'A' };
    }

    // Plan C — Body-End Blind Spot: hidden container at the bottom of <body>
    var container = document.getElementById(WEBEDIT_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = WEBEDIT_CONTAINER_ID;
      container.setAttribute('data-webedit-id', 'style-container');
      container.style.display = 'none';
      document.body.appendChild(container);
    }
    if (container && document.body.contains(container)) {
      return { target: container, plan: 'C' };
    }

    // Plan B — Emergency: inject into <html> root (may cause layout glitches)
    return { target: document.documentElement, plan: 'B' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 6: Garbage Collection
  // Removes stale style tags for edits the Brain no longer considers active.
  // ═══════════════════════════════════════════════════════════════════════════════

  function removeStaleStyleTags() {
    var allTags = document.querySelectorAll('style[id^="' + STYLE_ID_PREFIX + '"]');
    for (var i = 0; i < allTags.length; i++) {
      var editId = allTags[i].id.slice(STYLE_ID_PREFIX.length);
      if (!activeBlueprints[editId]) {
        allTags[i].remove();
      }
    }
  }

  function removeStaleCustomArtifacts() {
    var customTags = document.querySelectorAll('style[id^="' + CUSTOM_STYLE_ID_PREFIX + '"]');
    for (var i = 0; i < customTags.length; i++) {
      var styleEditId = customTags[i].id.slice(CUSTOM_STYLE_ID_PREFIX.length);
      if (!activeBlueprints[styleEditId]) {
        customTags[i].remove();
      }
    }

    var addContainers = document.querySelectorAll('[id^="' + ADD_CONTAINER_PREFIX + '"]');
    for (var j = 0; j < addContainers.length; j++) {
      var containerEditId = addContainers[j].id.slice(ADD_CONTAINER_PREFIX.length);
      if (!activeBlueprints[containerEditId]) {
        addContainers[j].remove();
      }
    }

    var addScripts = document.querySelectorAll('script[id^="' + ADD_SCRIPT_PREFIX + '"]');
    for (var k = 0; k < addScripts.length; k++) {
      var scriptEditId = addScripts[k].id.slice(ADD_SCRIPT_PREFIX.length);
      if (!activeBlueprints[scriptEditId]) {
        addScripts[k].remove();
      }
    }
  }

  function buildCssText(edit, payload, category) {
    if (payload.cssText) return String(payload.cssText);
    if (payload.css) return String(payload.css);
    if (payload.ruleText) return String(payload.ruleText);
    if (payload.style) return String(edit.selector || '') + ' { ' + String(payload.style) + ' }';
    if (isPlainObject(payload.styles) && edit.selector) {
      var declarations = Object.keys(payload.styles).map(function (key) {
        return key + ': ' + payload.styles[key] + ';';
      }).join(' ');
      return declarations ? String(edit.selector) + ' { ' + declarations + ' }' : '';
    }

    if (category === 'remove' && edit.selector) {
      return String(edit.selector) + ' { display: none !important; }';
    }

    return '';
  }

  function applyStyleBlueprint(editId, edit, stylePrefix, category) {
    var styleId = stylePrefix + editId;
    var style = document.getElementById(styleId);
    var injection = getInjectionTarget(editId);
    var payload = getBlueprintPayload(edit);
    var cssText = buildCssText(edit, payload, category);

    if (!cssText) return;

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.setAttribute('data-webedit-id', editId);
      injection.target.appendChild(style);
    } else if (style.parentNode !== injection.target) {
      injection.target.appendChild(style);
    }

    style.textContent = cssText;
  }

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

  function applyAddBlueprint(editId, edit) {
    var payload = getBlueprintPayload(edit);
    var containerId = ADD_CONTAINER_PREFIX + editId;
    var container = document.getElementById(containerId);
    var targetSelector = payload.targetSelector || edit.selector;
    var target = null;
    var position = String(payload.position || payload.placement || 'beforeend').toLowerCase();

    if (targetSelector) {
      try {
        target = document.querySelector(targetSelector);
      } catch (_) {
        target = null;
      }
    }

    if (!target) {
      target = document.body || document.documentElement;
    }

    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.setAttribute('data-webedit-id', editId);
      insertContainerAtTarget(container, target, position);
    } else if (!container.parentNode) {
      insertContainerAtTarget(container, target, position);
    }

    if (payload.html || payload.text) {
      container.innerHTML = payload.html || payload.text || '';
    }

    if (payload.css || payload.cssText || payload.ruleText || payload.style || payload.styles) {
      applyStyleBlueprint(editId, edit, CUSTOM_STYLE_ID_PREFIX, 'customize');
    }

    if (Array.isArray(payload.actions) && payload.actions.length > 0) {
      if (window.__webeditActions && typeof window.__webeditActions.execute === 'function') {
        window.__webeditActions.execute(payload.actions, container);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 7: The Executor — applyAllBlueprints()
  // The CSS Muscle. Idempotent: Ghost Footprint IDs prevent duplicates.
  // Wrapped in Deaf Marker to prevent Watchdog loops.
  // ═══════════════════════════════════════════════════════════════════════════════

  function applyAllBlueprints() {
    pauseObserver();

    try {
      removeStaleStyleTags();
      removeStaleCustomArtifacts();

      var entries = Object.keys(activeBlueprints);
      for (var i = 0; i < entries.length; i++) {
        var editId = entries[i];
        var edit = activeBlueprints[editId];
        var category = getBlueprintCategory(edit);

        if (category === 'remove') {
          applyStyleBlueprint(editId, edit, STYLE_ID_PREFIX, 'remove');
          continue;
        }

        if (category === 'customize') {
          applyStyleBlueprint(editId, edit, CUSTOM_STYLE_ID_PREFIX, 'customize');
          continue;
        }

        if (category === 'add') {
          applyAddBlueprint(editId, edit);
        }
      }
    } finally {
      resumeObserver();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 8: The Watchdog — MutationObserver with Circuit Breaker
  // Watches document.body for DOM changes. When React wipes our style tags,
  // the debounced callback increments the Circuit Breaker counter and
  // re-applies (which may escalate from Plan A to Plan C or B).
  // ═══════════════════════════════════════════════════════════════════════════════

  var debouncedReapply = debounce(function () {
    var keys = Object.keys(activeBlueprints);
    for (var i = 0; i < keys.length; i++) {
      var editId = keys[i];
      var styleId = STYLE_ID_PREFIX + editId;
      if (!document.getElementById(styleId)) {
        headWipeCount[editId] = (headWipeCount[editId] || 0) + 1;
      }
    }
    applyAllBlueprints();
  }, DEBOUNCE_DELAY);

  function startWatchdog() {
    if (observerInstance) {
      observerInstance.disconnect();
    }
    observerInstance = new MutationObserver(debouncedReapply);
    if (document.body) {
      observerInstance.observe(document.body, { childList: true, subtree: true });
      observerPaused = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 9: Pick Mode (Shared across Remove / Customize / Add)
  // Activates purple-border hover highlighting + crosshair cursor.
  // On click, generates a CSS selector for the picked element and reports
  // it to the Brain via ELEMENT_PICKED. Auto-deactivates after one pick.
  // ═══════════════════════════════════════════════════════════════════════════════

  var pickListeners = {
    mouseover: null,
    mouseout: null,
    click: null
  };

  function isWebeditElement(el) {
    if (!el || !(el instanceof Element)) return true;
    if (el.closest('[data-webedit-id]')) return true;
    if (el.id && el.id.indexOf('webedit') !== -1) return true;
    return false;
  }

  // ── CSS Selector Generator (Sensor work — extracting DOM data) ──

  function escapeForSelector(str) {
    return str.replace(/([^\w-])/g, '\\$1');
  }

  function buildElementSegment(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id && el.id.indexOf('webedit') === -1) {
      return '#' + escapeForSelector(el.id);
    }

    var segment = tag;
    var validClasses = [];
    for (var i = 0; i < el.classList.length; i++) {
      var cls = el.classList[i];
      if (cls.indexOf('webedit') === -1) {
        validClasses.push('.' + escapeForSelector(cls));
      }
    }
    if (validClasses.length > 0) {
      segment += validClasses.slice(0, 3).join('');
    }

    return segment;
  }

  function getNthOfType(el) {
    var parent = el.parentElement;
    if (!parent) return 1;
    var tag = el.tagName;
    var index = 0;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === tag) {
        index++;
        if (parent.children[i] === el) return index;
      }
    }
    return 1;
  }

  function generateCssSelector(el) {
    if (!el || !(el instanceof Element)) return '';

    if (el.id && el.id.indexOf('webedit') === -1) {
      var idSel = '#' + escapeForSelector(el.id);
      try {
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      } catch (_) {}
    }

    var parts = [];
    var current = el;
    var maxDepth = 6;

    while (current && current !== document.documentElement && parts.length < maxDepth) {
      var segment = buildElementSegment(current);

      if (segment.charAt(0) === '#') {
        parts.unshift(segment);
      break;
    }

      var nth = getNthOfType(current);
      var siblingsOfType = 0;
    if (current.parentElement) {
        for (var i = 0; i < current.parentElement.children.length; i++) {
          if (current.parentElement.children[i].tagName === current.tagName) {
            siblingsOfType++;
          }
        }
      }
      if (siblingsOfType > 1) {
        segment += ':nth-of-type(' + nth + ')';
      }

      parts.unshift(segment);

      var candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) break;
      } catch (_) {}

      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function clampPickLabel(s, max) {
    s = String(s || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    if (s.length <= max) return s;
    return s.substring(0, Math.max(0, max - 1)) + '…';
  }

  function labelFromInteractiveAncestors(el) {
    var cur = el;
    for (var d = 0; d < 8 && cur; d++) {
      if (cur.getAttribute) {
        var a = (cur.getAttribute('aria-label') || '').trim();
        if (a) return clampPickLabel(a, 70);
        var t = (cur.getAttribute('title') || '').trim();
        if (t && t.length < 100) return clampPickLabel(t, 70);
      }
      var tn = cur.tagName ? cur.tagName.toLowerCase() : '';
      if (tn === 'button' || tn === 'a' || (cur.getAttribute && cur.getAttribute('role') === 'button')) {
        var it = clampPickLabel((cur.innerText || '').trim().replace(/\s+/g, ' '), 60);
        if (it) return it;
      }
      cur = cur.parentElement;
    }
    return '';
  }

  function deriveHumanLabelForPickTarget(target) {
    if (!target || !(target instanceof Element)) return 'Element';

    var tag = target.tagName ? target.tagName.toLowerCase() : '';

    if (tag === 'input' || tag === 'textarea') {
      var val = (target.value && String(target.value).trim()) || '';
      if (val) return clampPickLabel(val, 50);
      var ph = (target.getAttribute('placeholder') || '').trim();
      if (ph) return 'Input (“' + clampPickLabel(ph, 40) + '”)';
      var typ = (target.getAttribute('type') || 'text').toLowerCase();
      return 'Input (' + typ + ')';
    }

    if (tag === 'img') {
      var alt = (target.getAttribute('alt') || '').trim();
      if (alt) return 'Image: ' + clampPickLabel(alt, 50);
      return 'Image';
    }

    var fromDirect = (target.getAttribute('aria-label') || '').trim()
      || (target.getAttribute('alt') || '').trim()
      || (target.getAttribute('title') || '').trim();
    if (fromDirect) return clampPickLabel(fromDirect, 70);

    var tid = (target.getAttribute('data-testid') || target.getAttribute('data-label') || '').trim();
    if (tid) {
      var pretty = tid.replace(/[-_]/g, ' ');
      return clampPickLabel(pretty.charAt(0).toUpperCase() + pretty.slice(1), 60);
    }

    var labelledBy = target.getAttribute('aria-labelledby');
    if (labelledBy && document.getElementById) {
      var ids = labelledBy.split(/\s+/).filter(Boolean);
      var chunks = [];
      for (var i = 0; i < ids.length; i++) {
        var node = document.getElementById(ids[i]);
        if (node && node.textContent) chunks.push(node.textContent.trim());
      }
      var merged = clampPickLabel(chunks.join(' ').replace(/\s+/g, ' '), 70);
      if (merged) return merged;
    }

    var role = (target.getAttribute('role') || '').toLowerCase();
    var inner = clampPickLabel((target.innerText || '').trim().replace(/\s+/g, ' '), 100);

    if (inner) {
      if (inner.length <= 60) return inner;
      var fromBtn = labelFromInteractiveAncestors(target);
      if (fromBtn) return fromBtn;
      return inner.substring(0, 57) + '…';
    }

    var svgRoot = tag === 'svg' ? target : (target.closest ? target.closest('svg') : null);
    if (svgRoot) {
      var titleEl = svgRoot.querySelector && svgRoot.querySelector('title');
      var st = titleEl && titleEl.textContent ? titleEl.textContent.trim() : '';
      if (st) return clampPickLabel(st, 60);
      var btn = target.closest && target.closest('button, a, [role="button"]');
      if (btn) {
        var bl = (btn.getAttribute('aria-label') || '').trim();
        if (bl) return clampPickLabel(bl, 70);
        var bt = clampPickLabel((btn.innerText || '').trim().replace(/\s+/g, ' '), 50);
        if (bt) return 'Icon: ' + bt;
      }
      return 'Icon';
    }

    var inherited = labelFromInteractiveAncestors(target);
    if (inherited) return inherited;

    var friendly = {
      nav: 'Navigation', header: 'Header', footer: 'Footer',
      aside: 'Sidebar', section: 'Section', main: 'Main content', article: 'Article',
      button: 'Button', a: 'Link', form: 'Form', ul: 'List', ol: 'List',
      li: 'List item', table: 'Table', canvas: 'Canvas', select: 'Dropdown',
      textarea: 'Text field', label: 'Label', h1: 'Heading', h2: 'Heading',
      h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
      p: 'Paragraph', span: 'Text', div: 'Section', iframe: 'Embedded frame',
      video: 'Video', audio: 'Audio', time: 'Time', figure: 'Figure',
    };
    var roleMap = {
      navigation: 'Navigation', banner: 'Header', contentinfo: 'Footer',
      menu: 'Menu', menubar: 'Menu bar', tablist: 'Tabs', dialog: 'Dialog',
      search: 'Search', img: 'Image', link: 'Link', button: 'Button',
    };
    if (role && roleMap[role]) return roleMap[role];

    return friendly[tag] || (tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : 'Element');
  }

  // ── Pick Mode Activation / Deactivation ──

  function handleStartPickMode(message) {
    if (pickModeActive) {
      handleStopPickMode();
    }

    var feature = message && message.feature;
    pickModePhase = message && message.pickPhase === 'secondary' ? 'secondary' : 'primary';
    pickModeActive = true;
    pickModeFeature = feature;

    document.body.classList.add('webedit-pick-active');

    pickListeners.mouseover = function (e) {
      var target = e.target;
      if (!target || !(target instanceof Element)) return;
      if (isWebeditElement(target)) return;
      target.classList.add('webedit-hover-highlight');
    };

    pickListeners.mouseout = function (e) {
      var target = e.target;
      if (!target || !(target instanceof Element)) return;
      target.classList.remove('webedit-hover-highlight');
    };

    pickListeners.click = function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      var target = e.target;
      if (!target || !(target instanceof Element)) return;
      if (isWebeditElement(target)) return;

      target.classList.remove('webedit-hover-highlight');

      var selector = generateCssSelector(target);
      if (!selector) {
        console.warn('[Hands] Could not generate selector for picked element');
        return;
      }

      var humanLabel = deriveHumanLabelForPickTarget(target);

      var htmlContext = '';
      if (pickModeFeature === 'add') {
        var rawHtml = target.outerHTML || '';
        htmlContext = rawHtml.length > 10000 ? rawHtml.substring(0, 10000) : rawHtml;
      }

      handleStopPickMode();

      chrome.runtime.sendMessage({
        type: 'ELEMENT_PICKED',
        selector: selector,
        url: window.location.href,
        humanLabel: humanLabel,
        htmlContext: htmlContext,
        pickPhase: pickModePhase
      }, function (response) {
        if (chrome.runtime.lastError) {
          console.warn('[Hands] ELEMENT_PICKED send failed:', chrome.runtime.lastError.message);
        }
      });
    };

    document.addEventListener('mouseover', pickListeners.mouseover, true);
    document.addEventListener('mouseout', pickListeners.mouseout, true);
    document.addEventListener('click', pickListeners.click, true);

    console.log('[Hands] Pick mode started for:', feature);
  }

  function handleStopPickMode() {
    if (pickListeners.mouseover) {
      document.removeEventListener('mouseover', pickListeners.mouseover, true);
    }
    if (pickListeners.mouseout) {
      document.removeEventListener('mouseout', pickListeners.mouseout, true);
    }
    if (pickListeners.click) {
      document.removeEventListener('click', pickListeners.click, true);
    }

    pickListeners.mouseover = null;
    pickListeners.mouseout = null;
    pickListeners.click = null;

    var highlighted = document.querySelectorAll('.webedit-hover-highlight');
    for (var i = 0; i < highlighted.length; i++) {
      highlighted[i].classList.remove('webedit-hover-highlight');
    }

    document.body.classList.remove('webedit-pick-active');

    pickModeActive = false;
    pickModeFeature = null;
    pickModePhase = 'primary';

    console.log('[Hands] Pick mode stopped');
  }

  function handleExecuteBlueprint(blueprints) {
    activeBlueprints = blueprints || {};
    headWipeCount = {};
    applyAllBlueprints();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 10: The Listener (Switch Statement)
  // Zero autonomous logic. The Hands only act when the Brain sends a
  // Target Dispatch through this listener.
  // ═══════════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'APPLY_BLUEPRINTS':
        handleExecuteBlueprint(message.blueprints);
        sendResponse({ success: true });
        return true;

      case 'START_PICK_MODE':
        handleStartPickMode(message);
        sendResponse({ success: true });
        return true;

      case 'STOP_PICK_MODE':
        handleStopPickMode();
        sendResponse({ success: true });
        return true;

      case 'INJECT_PREVIEW_CSS': {
        pauseObserver();
        try {
          var previewStyleId = 'webedit-preview-style';
          var previewStyle = document.getElementById(previewStyleId);
          if (!previewStyle) {
            previewStyle = document.createElement('style');
            previewStyle.id = previewStyleId;
            previewStyle.setAttribute('data-webedit-id', 'preview');
            (document.head || document.documentElement).appendChild(previewStyle);
          }
          previewStyle.textContent = message.cssText || '';
        } finally {
          resumeObserver();
        }
        sendResponse({ success: true });
    return true;
  }

      case 'CLEAR_PREVIEW_CSS': {
        pauseObserver();
        try {
          var previewEl = document.getElementById('webedit-preview-style');
          if (previewEl) {
            previewEl.remove();
          }
        } finally {
          resumeObserver();
        }
        sendResponse({ success: true });
      return true;
      }

    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 11: Initialization (The Nervous System)
  // On load, the Hands ask the Brain "what should I do?" via GET_ACTIVE_BLUEPRINTS.
  // The Brain's Tab Lifecycle Listener (Section 12 of background.js) also pushes
  // APPLY_BLUEPRINTS when a tab finishes loading — belt and suspenders.
  // After init, the Watchdog starts observing.
  // ═══════════════════════════════════════════════════════════════════════════════

  chrome.runtime.sendMessage(
    { type: 'GET_ACTIVE_BLUEPRINTS', url: window.location.href },
    function (response) {
      if (chrome.runtime.lastError) {
        console.warn('[Hands] Init failed:', chrome.runtime.lastError.message);
            return;
          }
      if (!response || !response.success) return;

      activeBlueprints = response.blueprints || {};
      applyAllBlueprints();
    }
  );

  startWatchdog();

    })();
