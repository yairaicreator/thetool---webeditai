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

  /** Live preview text: restore original on CLEAR or empty preview value */
  var previewTextSession = null;

  // ── NEW: CSSOM-only style registries (replace all <style> element injection) ──
  //
  // adoptedSheets  — Map<editId, CSSStyleSheet>
  //   One CSSStyleSheet per active edit. Lives in document.adoptedStyleSheets.
  //   Never touches the DOM. Never triggers CSP. Never gets wiped by React.
  //
  // directPropertyEdits — Map<editId, {selector, declarations}>
  //   Fallback only: used when CSSStyleSheet() throws (extremely rare).
  //   Applies styles directly via element.style.setProperty().
  //
  // previewSheet — CSSStyleSheet | null
  //   The single live-preview sheet for the Customize dashboard.
  //   Adopted/removed on INJECT_PREVIEW_CSS / CLEAR_PREVIEW_CSS.

  var adoptedSheets = new Map();
  var directPropertyEdits = new Map();
  var previewSheet = null;

  // ── Clipboard relay listener ─────────────────────────────────────────────────
  // add-hands.js dispatches a CustomEvent('webedit-clipboard-write') instead of
  // calling navigator.clipboard.writeText() directly. This is because Shadow DOM
  // click events do not always qualify as a user gesture for clipboard access.
  // Listening here (in the real document context) guarantees the write always
  // has the correct gesture state. Works for both preview (Shadow DOM) and
  // committed blueprint execution (real DOM).
  window.addEventListener('webedit-clipboard-write', function (e) {
    var text = e && e.detail && typeof e.detail.text === 'string' ? e.detail.text : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function (err) {
        console.warn('[Hands] Clipboard relay write failed:', err && err.message ? err.message : err);
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 2: Constants
  // Only ADD_CONTAINER_PREFIX remains — the HTML container div for injected
  // Add features still needs an ID for idempotency checks.
  // All style-element-related constants have been removed.
  // ═══════════════════════════════════════════════════════════════════════════════

  var ADD_CONTAINER_PREFIX = 'webedit-node-';
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
  // Before the Hands inject HTML nodes, they disconnect() the Watchdog so their
  // own DOM mutations don't re-trigger it. After injection they observe() again.
  //
  // NOTE: CSS is now CSSOM-only (adoptedStyleSheets). The observer no longer
  // needs to detect wiped <style> tags — that problem no longer exists.
  // The observer's only remaining job is to re-apply HTML node injections
  // (Add feature containers) after SPA re-renders wipe them.
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
  // SECTION 5: CSSOM Style Engine
  //
  // This section replaces the old <style>-element injection (applyStyleBlueprint,
  // getInjectionTarget, headWipeCount, Plan A/B/C). Everything here operates
  // entirely inside the browser's CSS Object Model — zero DOM mutations,
  // zero CSP exposure.
  //
  // PRIMARY PATH — upsertAdoptedSheet(editId, cssText)
  //   Creates or updates a CSSStyleSheet in document.adoptedStyleSheets.
  //   On update, replaceSync() patches the existing sheet in-place: no flicker,
  //   no array churn, no re-adoption needed.
  //
  // FALLBACK PATH — applyDirectProperty(editId, cssText)
  //   If CSSStyleSheet() throws (e.g. on a very old Chromium build), we parse
  //   the CSS string manually and call element.style.setProperty() on every
  //   matching element. This is also 100% CSP-safe because it mutates an
  //   existing JS object property rather than injecting content.
  //
  // REMOVAL — removeAdoptedSheet(editId)
  //   Filters the sheet out of document.adoptedStyleSheets and deletes the
  //   Map entry. If the edit was on the fallback path, reverts inline styles.
  //
  // GARBAGE COLLECTION — removeStaleAdoptedSheets()
  //   Compares Map keys against activeBlueprints and removes any orphans.
  //   Pure JS — no DOM queries needed.
  // ═══════════════════════════════════════════════════════════════════════════════

  function upsertAdoptedSheet(editId, cssText) {
    if (!cssText) return;
    try {
      if (adoptedSheets.has(editId)) {
        // Sheet already adopted — patch rules in-place, no re-adoption needed.
        adoptedSheets.get(editId).replaceSync(cssText);
      } else {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        document.adoptedStyleSheets.push(sheet);
        adoptedSheets.set(editId, sheet);
      }
    } catch (e) {
      // CSSStyleSheet() not available or replaceSync() threw — use fallback.
      console.warn('[Hands] adoptedStyleSheets unavailable, using fallback:', e.message);
      applyDirectProperty(editId, cssText);
    }
  }

  /**
   * Fallback: parse a CSS rule string and apply each declaration directly to
   * all matching elements via element.style.setProperty().
   *
   * Handles the two patterns buildCssText() can produce:
   *   1.  selector { prop: val; prop2: val2 !important; }
   *   2.  selector { display: none !important; }
   */
  function applyDirectProperty(editId, cssText) {
    try {
      // Extract: everything before the first '{' is the selector,
      // everything inside the braces is the declarations block.
      var braceOpen = cssText.indexOf('{');
      var braceClose = cssText.lastIndexOf('}');
      if (braceOpen === -1 || braceClose === -1) return;

      var selector = cssText.substring(0, braceOpen).trim();
      var declarationsBlock = cssText.substring(braceOpen + 1, braceClose).trim();

      if (!selector || !declarationsBlock) return;

      var elements;
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        return;
      }

      // Split declarations on ';', parse each into property + value + priority.
      var declarations = declarationsBlock.split(';').map(function (d) { return d.trim(); }).filter(Boolean);

      declarations.forEach(function (decl) {
        var colonIdx = decl.indexOf(':');
        if (colonIdx === -1) return;
        var property = decl.substring(0, colonIdx).trim();
        var valueRaw = decl.substring(colonIdx + 1).trim();
        var priority = '';
        if (valueRaw.toLowerCase().endsWith('!important')) {
          priority = 'important';
          valueRaw = valueRaw.slice(0, -10).trim();
        }
        elements.forEach(function (el) {
          try {
            el.style.setProperty(property, valueRaw, priority);
          } catch (_) {}
        });
      });

      // Store what we applied so we can reverse it in removeAdoptedSheet.
      directPropertyEdits.set(editId, { selector: selector, declarations: declarations });
    } catch (e) {
      console.warn('[Hands] applyDirectProperty failed:', e.message);
    }
  }

  function removeAdoptedSheet(editId) {
    if (adoptedSheets.has(editId)) {
      var sheet = adoptedSheets.get(editId);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (s) {
        return s !== sheet;
      });
      adoptedSheets.delete(editId);
    }

    // Also clean up any fallback direct-property styles.
    if (directPropertyEdits.has(editId)) {
      var record = directPropertyEdits.get(editId);
      try {
        var els = Array.from(document.querySelectorAll(record.selector));
        record.declarations.forEach(function (decl) {
          var colonIdx = decl.indexOf(':');
          if (colonIdx === -1) return;
          var property = decl.substring(0, colonIdx).trim();
          els.forEach(function (el) {
            try { el.style.removeProperty(property); } catch (_) {}
          });
        });
      } catch (_) {}
      directPropertyEdits.delete(editId);
    }
  }

  function removeStaleAdoptedSheets() {
    // Remove any adopted sheet whose editId is no longer in activeBlueprints.
    adoptedSheets.forEach(function (_sheet, editId) {
      if (!activeBlueprints[editId]) {
        removeAdoptedSheet(editId);
      }
    });
    // Also clean up stale fallback entries.
    directPropertyEdits.forEach(function (_record, editId) {
      if (!activeBlueprints[editId]) {
        removeAdoptedSheet(editId); // handles both maps
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 6: CSS Text Builder
  // Unchanged — still assembles the CSS rule string for a given edit.
  // The output feeds into upsertAdoptedSheet() instead of style.textContent.
  // ═══════════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 7: Blueprint Applicators
  // applyRemoveBlueprint — hides element via CSSOM sheet
  // applyCustomizeBlueprint — applies CSS overrides + optional text via CSSOM
  // applyAddBlueprint — injects HTML container node + CSSOM CSS + DOM Commands
  //
  // All CSS paths now call upsertAdoptedSheet() instead of creating <style> tags.
  // All non-CSS paths (textContent mutation, DOM node injection, action execution)
  // are IDENTICAL to the original — zero behaviour change for those connectors.
  // ═══════════════════════════════════════════════════════════════════════════════

  function applyCommittedCustomizeText(selector, text) {
    if (!selector) return;
    try {
      var el = document.querySelector(selector);
      if (el) el.textContent = text;
    } catch (_) {}
  }

  function restoreCustomizeElementText(selector, originalText) {
    if (!selector) return;
    try {
      var el = document.querySelector(selector);
      if (el) el.textContent = (originalText === undefined || originalText === null) ? '' : String(originalText);
    } catch (_) {}
  }

  function applyRemoveBlueprint(editId, edit) {
    var cssText = buildCssText(edit, getBlueprintPayload(edit), 'remove');
    if (cssText) {
      upsertAdoptedSheet(editId, cssText);
    }
  }

  function applyCustomizeBlueprint(editId, edit) {
    var payload = getBlueprintPayload(edit);
    var cssText = buildCssText(edit, payload, 'customize');

    if (cssText) {
      upsertAdoptedSheet(editId, cssText);
    } else {
      // No CSS for this edit — make sure we don't leave a stale sheet.
      removeAdoptedSheet(editId);
    }

    // Text override — identical to original behaviour.
    if (payload.textContent !== undefined && payload.textContent !== null && edit.selector) {
      applyCommittedCustomizeText(edit.selector, String(payload.textContent));
    }
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

  // ── HTML fingerprint helper ─────────────────────────────────────────────────
  // Produces a lightweight integer hash of a string.
  // Used to detect whether a spec's HTML has changed between re-applies.
  // Not a cryptographic hash — collisions are acceptable; false positives
  // (rebuild when not needed) are harmless; false negatives are impossible
  // because we always store the hash immediately after writing innerHTML.
  function simpleHash(str) {
    var h = 0;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return String(h);
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

    // ── Step 1: Ensure the container div exists in the DOM ───────────────────
    // This is the idempotency guard for the container shell itself.
    // Only the outer wrapper div is created/re-inserted here.
    // Its inner content is managed separately below.
    var isNewContainer = false;
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.setAttribute('data-webedit-id', editId);
      insertContainerAtTarget(container, target, position);
      isNewContainer = true;
    } else if (!container.parentNode) {
      insertContainerAtTarget(container, target, position);
      isNewContainer = true;
    }

    // ── Step 2: CSS — always idempotent via CSSOM ────────────────────────────
    // upsertAdoptedSheet patches the sheet in-place if it already exists.
    // This never touches the DOM, never wipes event listeners.
    if (payload.css || payload.cssText || payload.ruleText || payload.style || payload.styles) {
      var cssText = buildCssText(edit, payload, 'add');
      if (cssText) {
        upsertAdoptedSheet(editId, cssText);
      }
    }

    // ── Step 3: HTML fingerprint guard ───────────────────────────────────────
    // On the first build (isNewContainer) OR whenever the spec's HTML has
    // genuinely changed (hash mismatch), rebuild inner content and re-run
    // actions. On a plain SPA navigation where the spec hasn't changed, skip
    // both steps — the container's existing DOM, event listeners, input values,
    // and visible state are all preserved untouched.
    var specHtml = payload.html || payload.text || '';
    var currentHash = container.getAttribute('data-webedit-html-hash');
    var newHash = simpleHash(specHtml + JSON.stringify(payload.actions || []));
    var specChanged = isNewContainer || (currentHash !== newHash);

    if (specChanged) {
      // Write HTML fresh.
      if (specHtml) {
        container.innerHTML = specHtml;
      }
      // Stamp the hash so future re-applies can skip this work.
      container.setAttribute('data-webedit-html-hash', newHash);

      // ── Step 4: Execute DOM Commands ───────────────────────────────────────
      // Wrapped in requestAnimationFrame so page* ops that target host-page
      // elements (pageAddClass, pageQueryText, pageCopyFromSelector, etc.) fire
      // AFTER the host page's own SPA re-render and initialization timers have
      // completed. This eliminates the timing race where document.querySelector
      // returns null because the framework hasn't rebuilt its DOM yet.
      if (Array.isArray(payload.actions) && payload.actions.length > 0) {
        var actionsToRun = payload.actions;
        var containerRef  = container;
        requestAnimationFrame(function () {
          if (!containerRef.parentNode) return; // container was removed before frame fired
          if (window.__webeditActions && typeof window.__webeditActions.execute === 'function') {
            window.__webeditActions.execute(actionsToRun, containerRef);
          }
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 8: Stale Artifact Cleanup
  // removeStaleAdoptedSheets() replaces removeStaleStyleTags() for CSS cleanup.
  // removeStaleAddContainers() handles HTML node cleanup for Add features.
  // Both are called by applyAllBlueprints() before re-applying.
  // ═══════════════════════════════════════════════════════════════════════════════

  function removeStaleAddContainers() {
    // Remove Add HTML containers whose edit is no longer active.
    var addContainers = document.querySelectorAll('[id^="' + ADD_CONTAINER_PREFIX + '"]');
    for (var j = 0; j < addContainers.length; j++) {
      var containerEditId = addContainers[j].id.slice(ADD_CONTAINER_PREFIX.length);
      if (!activeBlueprints[containerEditId]) {
        addContainers[j].remove();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 9: The Executor — applyAllBlueprints()
  // Idempotent. Wrapped in Deaf Marker to prevent Watchdog loops on HTML nodes.
  // CSS sheets live in CSSOM and are NOT affected by the observer pause/resume.
  // ═══════════════════════════════════════════════════════════════════════════════

  function applyAllBlueprints() {
    pauseObserver();

    try {
      removeStaleAdoptedSheets();
      removeStaleAddContainers();

      var entries = Object.keys(activeBlueprints);
      for (var i = 0; i < entries.length; i++) {
        var editId = entries[i];
        var edit = activeBlueprints[editId];
        var category = getBlueprintCategory(edit);

        if (category === 'remove') {
          applyRemoveBlueprint(editId, edit);
          continue;
        }

        if (category === 'customize') {
          applyCustomizeBlueprint(editId, edit);
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
  // SECTION 10: The Watchdog — MutationObserver
  //
  // SIMPLIFIED vs. original:
  //   • headWipeCount and the Circuit Breaker are removed. They existed solely
  //     to detect when React wiped our <style> tags. Since CSS now lives in
  //     document.adoptedStyleSheets (which React cannot touch), that detection
  //     logic is no longer needed.
  //   • The observer still fires on DOM mutations. Its job is now limited to
  //     re-injecting Add feature HTML containers if a SPA navigation removes them.
  //   • The debounce delay is unchanged (50 ms).
  // ═══════════════════════════════════════════════════════════════════════════════

  var debouncedReapply = debounce(function () {
    // Re-apply only Add HTML containers that may have been wiped by SPA re-render.
    // CSS sheets are self-persistent in CSSOM — they never need re-adoption.
    var keys = Object.keys(activeBlueprints);
    var needsReapply = false;
    for (var i = 0; i < keys.length; i++) {
      var editId = keys[i];
      var edit = activeBlueprints[editId];
      if (getBlueprintCategory(edit) === 'add') {
        var containerId = ADD_CONTAINER_PREFIX + editId;
        if (!document.getElementById(containerId)) {
          needsReapply = true;
          break;
        }
      }
    }
    if (needsReapply) {
      applyAllBlueprints();
    }
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
  // SECTION 11: Preview Text Helpers
  // Unchanged — used by the Customize live-preview text override.
  // ═══════════════════════════════════════════════════════════════════════════════

  function handlePreviewText(message) {
    var sel = message.selector || '';
    if (!sel || !Object.prototype.hasOwnProperty.call(message, 'textContent')) return;
    var textVal = message.textContent;
    try {
      var el = document.querySelector(sel);
      if (!el) return;
      if (!previewTextSession || previewTextSession.selector !== sel) {
        previewTextSession = { selector: sel, original: el.textContent };
      }
      if (textVal === '' || textVal === null) {
        if (previewTextSession.original !== null && previewTextSession.original !== undefined) {
          el.textContent = previewTextSession.original;
        }
        return;
      }
      el.textContent = String(textVal);
    } catch (_) {}
  }

  function clearPreviewText() {
    if (!previewTextSession) return;
    try {
      var el = document.querySelector(previewTextSession.selector);
      if (el && previewTextSession.original !== null && previewTextSession.original !== undefined) {
        el.textContent = previewTextSession.original;
      }
    } catch (_) {}
    previewTextSession = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 12: Pick Mode (Shared across Remove / Customize / Add)
  // IDENTICAL to original — activates hover highlighting + crosshair cursor.
  // On click, generates a CSS selector and reports to Brain via ELEMENT_PICKED.
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
    return s.substring(0, Math.max(0, max - 1)) + '\u2026';
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
      if (ph) return 'Input ("' + clampPickLabel(ph, 40) + '")';
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
      return inner.substring(0, 57) + '\u2026';
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

  // ── Pick Mode Activation / Deactivation ──────────────────────────────────────
  // IDENTICAL to original.

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 13: handleExecuteBlueprint
  // Called when APPLY_BLUEPRINTS arrives from the Brain.
  //
  // Change vs. original:
  //   • headWipeCount reset removed (that variable no longer exists).
  //   • Undo restore path for customize textContent is IDENTICAL to original.
  // ═══════════════════════════════════════════════════════════════════════════════

  function handleExecuteBlueprint(blueprints) {
    var prev = activeBlueprints;
    var next = blueprints || {};

    // Restore original text for any customize edit that is being removed.
    var removedIds = Object.keys(prev).filter(function (id) { return !next[id]; });
    for (var r = 0; r < removedIds.length; r++) {
      var oldEdit = prev[removedIds[r]];
      if (getBlueprintCategory(oldEdit) === 'customize') {
        var pl = getBlueprintPayload(oldEdit);
        if (pl && Object.prototype.hasOwnProperty.call(pl, 'originalTextContent') && oldEdit.selector) {
          restoreCustomizeElementText(oldEdit.selector, pl.originalTextContent);
        }
      }
    }

    activeBlueprints = next;
    applyAllBlueprints();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 14: The Listener (Switch Statement)
  // IDENTICAL to original except:
  //   • INJECT_PREVIEW_CSS: uses previewSheet (CSSStyleSheet) instead of
  //     a <style id="webedit-preview-style"> element.
  //   • CLEAR_PREVIEW_CSS: removes previewSheet from adoptedStyleSheets instead
  //     of finding and removing a DOM element.
  //   • All other cases are UNCHANGED.
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

      // ── Live CSS preview for the Customize dashboard ─────────────────────
      case 'INJECT_PREVIEW_CSS': {
        pauseObserver();
        try {
          if (!previewSheet) {
            previewSheet = new CSSStyleSheet();
            document.adoptedStyleSheets.push(previewSheet);
          }
          previewSheet.replaceSync(message.cssText || '');
          // Text override (unchanged).
          handlePreviewText(message);
        } catch (e) {
          // Fallback: if CSSStyleSheet unavailable, fall back to inline element.
          console.warn('[Hands] previewSheet unavailable, using <style> fallback:', e.message);
          var previewStyleId = 'webedit-preview-style';
          var previewStyle = document.getElementById(previewStyleId);
          if (!previewStyle) {
            previewStyle = document.createElement('style');
            previewStyle.id = previewStyleId;
            previewStyle.setAttribute('data-webedit-id', 'preview');
            (document.head || document.documentElement).appendChild(previewStyle);
          }
          previewStyle.textContent = message.cssText || '';
          handlePreviewText(message);
        } finally {
          resumeObserver();
        }
        sendResponse({ success: true });
        return true;
      }

      // ── Clear live CSS preview ────────────────────────────────────────────
      case 'CLEAR_PREVIEW_CSS': {
        pauseObserver();
        try {
          clearPreviewText();

          // Primary: remove CSSOM preview sheet.
          if (previewSheet) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (s) {
              return s !== previewSheet;
            });
            previewSheet = null;
          }

          // Fallback cleanup: remove any legacy <style> preview element that
          // may have been inserted by the fallback path above.
          var legacyPreview = document.getElementById('webedit-preview-style');
          if (legacyPreview) {
            legacyPreview.remove();
          }
        } finally {
          resumeObserver();
        }
        sendResponse({ success: true });
        return true;
      }

      // ── Snapshot element text for Customize apply (unchanged) ─────────────
      case 'SNAPSHOT_ELEMENT_TEXT': {
        var out = { originalText: '' };
        try {
          if (message.selector) {
            var snapEl = document.querySelector(message.selector);
            if (snapEl) out.originalText = snapEl.textContent;
          }
        } catch (_) {}
        sendResponse(out);
        return true;
      }

      // ── Initial blueprint fetch on page load ─────────────────────────────
      case 'GET_ACTIVE_BLUEPRINTS': {
        sendResponse({ success: true, blueprints: activeBlueprints });
        return true;
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 15: Initialization (The Nervous System)
  // IDENTICAL to original:
  //   On load, ask the Brain for active blueprints, apply them, then start
  //   the Watchdog. The Brain's Tab Lifecycle Listener also pushes
  //   APPLY_BLUEPRINTS when a tab finishes loading — belt and suspenders.
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
