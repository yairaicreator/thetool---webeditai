'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Customize Feature — Element Editor (Colors / Font / Size tabs)
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  var dashboardEl = null;
  var currentSelector = '';
  var currentUrl = '';
  var currentSummary = '';
  var currentResumeEditId = null;
  var collectedStyles = {};
  var previewDebounceTimer = null;
  var PREVIEW_DEBOUNCE_MS = 50;
  var textBaseline = '';
  var textInputEl = null;
  var tabPanels = {};
  var cardHistories = {};
  var decorationHist = null;
  var alignHist = null;
  var visibilityHist = null;
  var colorPickerSyncers = [];
  var textPreviousValue = '';

  function notify(text) {
    if (window.WebEditPanel && typeof window.WebEditPanel.showNotification === 'function') {
      window.WebEditPanel.showNotification(text);
    }
  }

  function buildCssTextFromStyles(selector, styles) {
    var props = Object.keys(styles);
    if (!props.length || !selector) return '';
    var declarations = [];
    for (var i = 0; i < props.length; i++) {
      var val = styles[props[i]];
      if (val !== '' && val !== undefined && val !== null) {
        declarations.push(props[i] + ': ' + val + ' !important;');
      }
    }
    if (!declarations.length) return '';
    return selector + ' { ' + declarations.join(' ') + ' }';
  }

  function sendPreview() {
    var cssText = buildCssTextFromStyles(currentSelector, collectedStyles);
    var msg = {
      type: 'PREVIEW_CSS',
      selector: currentSelector,
      cssText: cssText
    };
    var t = textInputEl ? textInputEl.value : '';
    if (t !== textBaseline) {
      msg.textContent = t;
    }
    chrome.runtime.sendMessage(msg, function () {
      if (chrome.runtime.lastError) {
        console.warn('[ElementEditor] Preview failed:', chrome.runtime.lastError.message);
      }
    });
  }

  function schedulePreview() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(sendPreview, PREVIEW_DEBOUNCE_MS);
  }

  function createCardHistory(cardId, getPropKeys) {
    var past = [];
    var future = [];
    function snap() {
      var keys = getPropKeys();
      var o = { styles: {} };
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (collectedStyles[k] !== undefined) o.styles[k] = collectedStyles[k];
      }
      return o;
    }
    function apply(o) {
      var keys = getPropKeys();
      for (var j = 0; j < keys.length; j++) {
        delete collectedStyles[keys[j]];
      }
      if (o.styles) {
        Object.keys(o.styles).forEach(function (k) {
          collectedStyles[k] = o.styles[k];
        });
      }
    }
    return {
      beforeChange: function () {
        past.push(snap());
        future = [];
      },
      undo: function () {
        if (!past.length) return;
        future.push(snap());
        apply(past.pop());
        schedulePreview();
        refreshAllInputs();
      },
      redo: function () {
        if (!future.length) return;
        past.push(snap());
        apply(future.pop());
        schedulePreview();
        refreshAllInputs();
      }
    };
  }

  function cardToolbar(hist) {
    var wrap = document.createElement('div');
    wrap.className = 'webedit-ee-card-toolbar';
    var u = document.createElement('button');
    u.type = 'button';
    u.className = 'webedit-ee-icon-btn';
    u.setAttribute('aria-label', 'Undo');
    u.innerHTML = '&#x21B6;';
    u.addEventListener('click', function () { hist.undo(); });
    var r = document.createElement('button');
    r.type = 'button';
    r.className = 'webedit-ee-icon-btn';
    r.setAttribute('aria-label', 'Redo');
    r.innerHTML = '&#x21B7;';
    r.addEventListener('click', function () { hist.redo(); });
    wrap.appendChild(u);
    wrap.appendChild(r);
    return wrap;
  }

  function hexToInput(hex) {
    if (!hex || typeof hex !== 'string') return '#000000';
    var h = hex.trim();
    if (/^#[0-9a-f]{3}$/i.test(h)) {
      return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    if (/^#[0-9a-f]{6}$/i.test(h)) return h;
    return '#000000';
  }

  function attachEyedropper(btn, onPick) {
    if (!window.EyeDropper) {
      btn.style.display = 'none';
      return;
    }
    btn.addEventListener('click', function () {
      try {
        new window.EyeDropper().open().then(function (res) {
          if (res && res.sRGBHex) onPick(res.sRGBHex);
        }).catch(function () {});
      } catch (_) {
        notify('Eyedropper is not available.');
      }
    });
  }

  function bindHistPointerDown(el, hist) {
    if (!el || !hist) return;
    el.addEventListener('pointerdown', function () {
      hist.beforeChange();
    });
  }

  function tryCssColorToHex(val) {
    if (val === undefined || val === null || val === '') return null;
    var t = String(val).trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return hexToInput(t);
    var m = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
      return rgbToHex(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    }
    return null;
  }

  function rgbToHexPart(n) {
    var h = Math.round(Math.max(0, Math.min(255, n))).toString(16);
    return h.length === 1 ? '0' + h : h;
  }

  function rgbToHex(r, g, b) {
    return '#' + rgbToHexPart(r) + rgbToHexPart(g) + rgbToHexPart(b);
  }

  function hexToRgb(hex) {
    var h = hexToInput(hex).slice(1);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    var hh = 0;
    if (d !== 0) {
      if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) hh = ((b - r) / d + 2) / 6;
      else hh = ((r - g) / d + 4) / 6;
    }
    hh *= 360;
    var s = max === 0 ? 0 : d / max;
    var v = max;
    return { h: hh, s: s, v: v };
  }

  function hsvToRgb(hh, s, v) {
    hh = ((hh % 360) + 360) % 360;
    var c = v * s;
    var x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    var m = v - c;
    var rp = 0;
    var gp = 0;
    var bp = 0;
    if (hh < 60) {
      rp = c;
      gp = x;
    } else if (hh < 120) {
      rp = x;
      gp = c;
    } else if (hh < 180) {
      gp = c;
      bp = x;
    } else if (hh < 240) {
      gp = x;
      bp = c;
    } else if (hh < 300) {
      rp = x;
      bp = c;
    } else {
      rp = c;
      bp = x;
    }
    return {
      r: Math.round((rp + m) * 255),
      g: Math.round((gp + m) * 255),
      b: Math.round((bp + m) * 255)
    };
  }

  function syncColorPickersFromStyles() {
    for (var i = 0; i < colorPickerSyncers.length; i++) {
      try {
        colorPickerSyncers[i]();
      } catch (e) {}
    }
  }

  /**
   * @param {HTMLElement} card
   * @param {string} keyForHex
   * @param {{ beforeChange: Function }} hist
   * @param {string[]} swatches
   * @param {boolean} borderRing
   */
  function mountColorPicker(card, keyForHex, hist, swatches, borderRing) {
    var hsv = { h: 200, s: 0.6, v: 0.55 };
    var wrap = document.createElement('div');
    wrap.className = 'webedit-ee-cpicker';
    wrap.dataset.webeditCpicker = keyForHex;

    var main = document.createElement('div');
    main.className = 'webedit-ee-cpicker-main';
    var preview = document.createElement('div');
    preview.className = 'webedit-ee-cpicker-preview';
    preview.setAttribute('aria-hidden', 'true');

    var svOuter = document.createElement('div');
    svOuter.className = 'webedit-ee-cpicker-sv-outer';
    var svCanvas = document.createElement('canvas');
    svCanvas.className = 'webedit-ee-cpicker-sv';
    svCanvas.width = 200;
    svCanvas.height = 160;
    var svCursor = document.createElement('div');
    svCursor.className = 'webedit-ee-cpicker-sv-cursor';
    svOuter.appendChild(svCanvas);
    svOuter.appendChild(svCursor);

    main.appendChild(preview);
    main.appendChild(svOuter);
    wrap.appendChild(main);

    var hueOuter = document.createElement('div');
    hueOuter.className = 'webedit-ee-cpicker-hue-outer';
    var hueCanvas = document.createElement('canvas');
    hueCanvas.className = 'webedit-ee-cpicker-hue';
    hueCanvas.width = 280;
    hueCanvas.height = 22;
    var hueThumb = document.createElement('div');
    hueThumb.className = 'webedit-ee-cpicker-hue-thumb';
    hueOuter.appendChild(hueCanvas);
    hueOuter.appendChild(hueThumb);
    wrap.appendChild(hueOuter);

    function drawHueStrip() {
      var ctx = hueCanvas.getContext('2d');
      var w = hueCanvas.width;
      var h = hueCanvas.height;
      var img = ctx.createImageData(w, h);
      var d = img.data;
      for (var x = 0; x < w; x++) {
        var hh = (x / (w - 1 || 1)) * 360;
        var rgb = hsvToRgb(hh, 1, 1);
        for (var y = 0; y < h; y++) {
          var i = (y * w + x) * 4;
          d[i] = rgb.r;
          d[i + 1] = rgb.g;
          d[i + 2] = rgb.b;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    function drawSV() {
      var ctx = svCanvas.getContext('2d');
      var w = svCanvas.width;
      var h = svCanvas.height;
      var img = ctx.createImageData(w, h);
      var d = img.data;
      var hh = hsv.h;
      for (var y = 0; y < h; y++) {
        var vv = 1 - y / (h - 1 || 1);
        for (var x = 0; x < w; x++) {
          var ss = x / (w - 1 || 1);
          var rgb = hsvToRgb(hh, ss, vv);
          var i = (y * w + x) * 4;
          d[i] = rgb.r;
          d[i + 1] = rgb.g;
          d[i + 2] = rgb.b;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    function positionSVCursor() {
      svCursor.style.left = (hsv.s * 100) + '%';
      svCursor.style.top = ((1 - hsv.v) * 100) + '%';
    }

    function positionHueThumb() {
      hueThumb.style.left = (hsv.h / 360 * 100) + '%';
      var th = hsvToRgb(hsv.h, 1, 1);
      hueThumb.style.background = rgbToHex(th.r, th.g, th.b);
    }

    function updatePreviewFromHSV() {
      var rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      var hx = rgbToHex(rgb.r, rgb.g, rgb.b);
      preview.classList.remove('webedit-ee-cpicker-preview-empty');
      preview.style.background = hx;
    }

    function applyFromHSV(skipHist) {
      if (!skipHist) hist.beforeChange();
      var rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      var hx = rgbToHex(rgb.r, rgb.g, rgb.b);
      collectedStyles[keyForHex] = hx;
      hexInput.value = hx;
      updatePreviewFromHSV();
      schedulePreview();
    }

    drawHueStrip();

    var hexRow = document.createElement('div');
    hexRow.className = 'webedit-ee-cpicker-hex-row';
    var hexLab = document.createElement('span');
    hexLab.className = 'webedit-ee-hex-lab';
    hexLab.textContent = 'HEX';
    var hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'webedit-ee-hex-input webedit-ee-cpicker-hex-input';
    hexInput.placeholder = '#000000';
    hexInput.dataset.styleKey = keyForHex;
    hexInput.addEventListener('change', function () {
      var raw = hexInput.value.trim();
      if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) {
        hist.beforeChange();
        var norm = hexToInput(raw);
        collectedStyles[keyForHex] = norm;
        var rgb = hexToRgb(norm);
        var o = rgbToHsv(rgb.r, rgb.g, rgb.b);
        hsv.h = o.h;
        hsv.s = o.s;
        hsv.v = o.v;
        hexInput.value = norm;
        drawSV();
        positionSVCursor();
        positionHueThumb();
        updatePreviewFromHSV();
        schedulePreview();
      }
    });

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'webedit-ee-cpicker-copy';
    copyBtn.setAttribute('aria-label', 'Copy hex');
    copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', function () {
      var t = hexInput.value.trim();
      if (!/^#[0-9a-f]{3,6}$/i.test(t)) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(hexToInput(t)).catch(function () {
          notify('Could not copy');
        });
      } else {
        notify('Could not copy');
      }
    });

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'webedit-ee-cpicker-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', function () {
      hist.beforeChange();
      delete collectedStyles[keyForHex];
      hexInput.value = '';
      preview.classList.add('webedit-ee-cpicker-preview-empty');
      preview.style.background = '';
      schedulePreview();
      updateBorderStatusIfAny();
    });

    var eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'webedit-ee-eyedropper';
    eye.setAttribute('aria-label', 'Pick color');
    eye.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><circle cx="12" cy="12" r="3"/></svg>';
    attachEyedropper(eye, function (hex) {
      hist.beforeChange();
      var norm = hexToInput(hex);
      collectedStyles[keyForHex] = norm;
      var rgb = hexToRgb(norm);
      var o = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hsv.h = o.h;
      hsv.s = o.s;
      hsv.v = o.v;
      hexInput.value = norm;
      drawSV();
      positionSVCursor();
      positionHueThumb();
      updatePreviewFromHSV();
      schedulePreview();
      updateBorderStatusIfAny();
    });

    hexRow.appendChild(hexLab);
    hexRow.appendChild(hexInput);
    hexRow.appendChild(copyBtn);
    hexRow.appendChild(clearBtn);
    hexRow.appendChild(eye);
    wrap.appendChild(hexRow);

    function updateBorderStatusIfAny() {
      if (typeof window._webeditUpdateBorderStatus === 'function') {
        window._webeditUpdateBorderStatus();
      }
    }

    var sw = document.createElement('div');
    sw.className = 'webedit-ee-swatches';
    swatches.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'webedit-ee-swatch' + (c === '' ? ' webedit-ee-swatch-none' : '');
      if (c === '') {
        b.innerHTML = '<span class="webedit-ee-swatch-slash"></span>';
      } else {
        b.style.background = c;
        if (borderRing) b.style.boxShadow = 'inset 0 0 0 2px ' + c;
      }
      b.addEventListener('click', function () {
        hist.beforeChange();
        if (c === '') {
          delete collectedStyles[keyForHex];
          hexInput.value = '';
          preview.classList.add('webedit-ee-cpicker-preview-empty');
          preview.style.background = '';
        } else {
          var norm = hexToInput(c);
          collectedStyles[keyForHex] = norm;
          var rgb = hexToRgb(norm);
          var o = rgbToHsv(rgb.r, rgb.g, rgb.b);
          hsv.h = o.h;
          hsv.s = o.s;
          hsv.v = o.v;
          hexInput.value = norm;
          drawSV();
          positionSVCursor();
          positionHueThumb();
          updatePreviewFromHSV();
        }
        schedulePreview();
        updateBorderStatusIfAny();
      });
      sw.appendChild(b);
    });
    wrap.appendChild(sw);

    function syncFromCollected() {
      var hx = tryCssColorToHex(collectedStyles[keyForHex]);
      if (!hx) {
        hexInput.value = '';
        preview.classList.add('webedit-ee-cpicker-preview-empty');
        preview.style.background = '';
        drawSV();
        positionSVCursor();
        positionHueThumb();
        return;
      }
      hexInput.value = hx;
      var rgb = hexToRgb(hx);
      var o = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hsv.h = o.h;
      hsv.s = o.s;
      hsv.v = o.v;
      drawSV();
      positionSVCursor();
      positionHueThumb();
      updatePreviewFromHSV();
    }

    function onHuePointer(ev) {
      var rect = hueOuter.getBoundingClientRect();
      var x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      hsv.h = (x / (rect.width || 1)) * 360;
      positionHueThumb();
      drawSV();
      applyFromHSV(true);
      updateBorderStatusIfAny();
    }

    hueOuter.addEventListener('pointerdown', function (ev) {
      hist.beforeChange();
      hueOuter.setPointerCapture(ev.pointerId);
      onHuePointer(ev);
      function move(e) {
        onHuePointer(e);
      }
      function up(e) {
        hueOuter.releasePointerCapture(e.pointerId);
        hueOuter.removeEventListener('pointermove', move);
        hueOuter.removeEventListener('pointerup', up);
        hueOuter.removeEventListener('pointercancel', up);
      }
      hueOuter.addEventListener('pointermove', move);
      hueOuter.addEventListener('pointerup', up);
      hueOuter.addEventListener('pointercancel', up);
    });

    function onSVPointer(ev) {
      var rect = svOuter.getBoundingClientRect();
      var x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      var y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      hsv.s = x / (rect.width || 1);
      hsv.v = 1 - y / (rect.height || 1);
      positionSVCursor();
      applyFromHSV(true);
      updateBorderStatusIfAny();
    }

    svOuter.addEventListener('pointerdown', function (ev) {
      hist.beforeChange();
      svOuter.setPointerCapture(ev.pointerId);
      onSVPointer(ev);
      function move(e) {
        onSVPointer(e);
      }
      function up(e) {
        svOuter.releasePointerCapture(e.pointerId);
        svOuter.removeEventListener('pointermove', move);
        svOuter.removeEventListener('pointerup', up);
        svOuter.removeEventListener('pointercancel', up);
      }
      svOuter.addEventListener('pointermove', move);
      svOuter.addEventListener('pointerup', up);
      svOuter.addEventListener('pointercancel', up);
    });

    colorPickerSyncers.push(syncFromCollected);
    card.appendChild(wrap);
    syncFromCollected();
  }

  function refreshAllInputs() {
    if (!dashboardEl) return;
    dashboardEl.querySelectorAll('[data-style-key]').forEach(function (el) {
      var key = el.dataset.styleKey;
      var v = collectedStyles[key];
      if (el.type === 'range') {
        if (key === 'opacity') {
          var opn = v != null ? Math.round(parseFloat(v) * 100) : 100;
          if (isNaN(opn)) opn = 100;
          el.value = String(opn);
          return;
        }
        var num = parseFloat(String(v || '').replace(/[^\d.-]/g, ''));
        if (!isNaN(num)) el.value = String(num);
        var row = el.closest('.webedit-ee-slider-row') || el.closest('.webedit-ee-mini-row') || el.closest('.webedit-ee-dim-label-row');
        var disp = row && row.querySelector('.webedit-ee-slider-val');
        if (disp) disp.textContent = v != null ? String(v) : '—';
        var dimVal = row && row.querySelector('.webedit-ee-dim-val');
        if (dimVal && dimVal.dataset.dimVal === key) dimVal.textContent = v != null ? String(v) : '—';
        return;
      }
      if (el.tagName === 'SELECT') {
        el.value = v != null ? String(v) : '';
        return;
      }
      if (el.type === 'color') {
        if (v) {
          el.value = hexToInput(v);
          el.dataset.empty = 'false';
        } else {
          el.dataset.empty = 'true';
        }
        return;
      }
      if (el.type === 'text' || el.tagName === 'TEXTAREA') {
        el.value = v != null ? String(v) : '';
      }
    });
    syncDecorationToggles();
    syncAlignToggles();
    syncVisibilityToggle();
    syncColorPickersFromStyles();
  }

  function syncDecorationToggles() {
    if (!dashboardEl) return;
    var dec = (collectedStyles['text-decoration'] || 'none').toLowerCase();
    var fs = (collectedStyles['font-style'] || 'normal').toLowerCase();
    var u = dashboardEl.querySelector('[data-deco="underline"]');
    var s = dashboardEl.querySelector('[data-deco="strike"]');
    var i = dashboardEl.querySelector('[data-deco="italic"]');
    if (u) u.classList.toggle('active', dec.indexOf('underline') !== -1);
    if (s) s.classList.toggle('active', dec.indexOf('line-through') !== -1);
    if (i) i.classList.toggle('active', fs === 'italic');
  }

  function syncAlignToggles() {
    if (!dashboardEl) return;
    var ta = collectedStyles['text-align'] || 'left';
    dashboardEl.querySelectorAll('[data-align]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.align === ta);
    });
  }

  function syncVisibilityToggle() {
    if (!dashboardEl) return;
    var vis = collectedStyles['visibility'];
    var on = vis !== 'hidden';
    var inp = dashboardEl.querySelector('#webedit-ee-visibility-toggle');
    if (inp) inp.checked = on;
  }

  function setDecoration(parts) {
    decorationHist.beforeChange();
    var hasU = parts.underline;
    var hasS = parts.strike;
    var hasI = parts.italic;
    var td = [];
    if (hasU) td.push('underline');
    if (hasS) td.push('line-through');
    if (td.length) collectedStyles['text-decoration'] = td.join(' ');
    else delete collectedStyles['text-decoration'];
    if (hasI) collectedStyles['font-style'] = 'italic';
    else delete collectedStyles['font-style'];
    schedulePreview();
    syncDecorationToggles();
  }

  function buildColorsTab(hists) {
    colorPickerSyncers.length = 0;
    var root = document.createElement('div');
    root.className = 'webedit-ee-tab-panel';
    root.dataset.tabPanel = 'colors';
    root.hidden = false;

    var title = document.createElement('div');
    title.className = 'webedit-ee-tab-title';
    title.innerHTML = '<h2>Colors</h2><p>Refine the visual signature of your selected component.</p>';
    root.appendChild(title);

    var swatchesBg = ['#4648D4', '#374151', '#ffffff', ''];
    var swatchesTx = ['#111C2D', '#ffffff', '#4648D4', ''];
    var swatchesBr = ['#6063EE', '#e5e7eb', '#000000', '#6063EE'];

    function colorCard(label, prop, swatches, hist, borderRing) {
      var keyForHex = prop === 'border' ? 'border-color' : prop;
      var card = document.createElement('div');
      card.className = 'webedit-ee-card';
      var head = document.createElement('div');
      head.className = 'webedit-ee-card-head';
      var lab = document.createElement('span');
      lab.className = 'webedit-ee-card-label';
      lab.textContent = label;
      head.appendChild(lab);
      if (prop === 'border') {
        var status = document.createElement('span');
        status.className = 'webedit-ee-card-status';
        status.id = 'webedit-ee-border-status';
        head.appendChild(status);
      }
      head.appendChild(cardToolbar(hist));
      card.appendChild(head);
      mountColorPicker(card, keyForHex, hist, swatches, borderRing);

      if (prop === 'border') {
        var metaWrap = document.createElement('div');
        metaWrap.className = 'webedit-ee-border-meta';
        var metaHead = document.createElement('div');
        metaHead.className = 'webedit-ee-card-head webedit-ee-card-head-sub';
        var metaLab = document.createElement('span');
        metaLab.className = 'webedit-ee-card-label';
        metaLab.textContent = 'BORDER SIZE';
        metaHead.appendChild(metaLab);
        metaHead.appendChild(cardToolbar(hists.borderMeta));
        metaWrap.appendChild(metaHead);

        var bwRow = document.createElement('div');
        bwRow.className = 'webedit-ee-mini-row';
        var bwLbl = document.createElement('label');
        bwLbl.className = 'webedit-ee-mini-label';
        bwLbl.textContent = 'Border width';
        bwRow.appendChild(bwLbl);
        var bw = document.createElement('input');
        bw.type = 'range';
        bw.min = '0';
        bw.max = '12';
        bw.step = '1';
        bw.className = 'webedit-ee-range';
        bw.dataset.styleKey = 'border-width';
        bindHistPointerDown(bw, hists.borderMeta);
        bw.addEventListener('input', function () {
          collectedStyles['border-width'] = bw.value + 'px';
          schedulePreview();
          updateBorderStatus();
          var dr = bwRow.querySelector('.webedit-ee-slider-val');
          if (dr) dr.textContent = collectedStyles['border-width'];
        });
        var bwVal = document.createElement('span');
        bwVal.className = 'webedit-ee-slider-val';
        bwRow.appendChild(bw);
        bwRow.appendChild(bwVal);
        metaWrap.appendChild(bwRow);

        var bsLab = document.createElement('label');
        bsLab.className = 'webedit-ee-mini-label';
        bsLab.textContent = 'Border style';
        var bs = document.createElement('select');
        bs.className = 'webedit-ee-select';
        bs.dataset.styleKey = 'border-style';
        ['solid', 'dashed', 'dotted', 'double', 'none'].forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o;
          bs.appendChild(opt);
        });
        bs.addEventListener('change', function () {
          hists.borderMeta.beforeChange();
          collectedStyles['border-style'] = bs.value;
          schedulePreview();
          updateBorderStatus();
        });
        metaWrap.appendChild(bsLab);
        metaWrap.appendChild(bs);
        card.appendChild(metaWrap);
      }

      return card;
    }

    function updateBorderStatus() {
      var el = dashboardEl && dashboardEl.querySelector('#webedit-ee-border-status');
      if (!el) return;
      var w = collectedStyles['border-width'] || '0px';
      var s = collectedStyles['border-style'] || 'solid';
      el.textContent = w + ' ' + s.charAt(0).toUpperCase() + s.slice(1);
    }
    window._webeditUpdateBorderStatus = updateBorderStatus;

    hists.bg = createCardHistory('bg', function () { return ['background-color']; });
    hists.fg = createCardHistory('fg', function () { return ['color']; });
    hists.border = createCardHistory('border', function () { return ['border-color']; });
    hists.borderMeta = createCardHistory('borderMeta', function () {
      return ['border-width', 'border-style'];
    });
    hists.op = createCardHistory('op', function () { return ['opacity']; });

    root.appendChild(colorCard('BACKGROUND COLOR', 'background-color', swatchesBg, hists.bg, false));
    root.appendChild(colorCard('TEXT COLOR', 'color', swatchesTx, hists.fg, false));
    root.appendChild(colorCard('BORDER COLOR', 'border', swatchesBr, hists.border, true));

    var opCard = document.createElement('div');
    opCard.className = 'webedit-ee-card';
    var opHead = document.createElement('div');
    opHead.className = 'webedit-ee-card-head';
    opHead.innerHTML = '<span class="webedit-ee-card-label">OVERALL OPACITY</span>';
    var opPct = document.createElement('span');
    opPct.className = 'webedit-ee-card-status';
    opPct.id = 'webedit-ee-opacity-pct';
    opHead.appendChild(opPct);
    opHead.appendChild(cardToolbar(hists.op));
    opCard.appendChild(opHead);
    var opSlider = document.createElement('input');
    opSlider.type = 'range';
    opSlider.min = '0';
    opSlider.max = '100';
    opSlider.step = '1';
    opSlider.className = 'webedit-ee-range webedit-ee-range-wide';
    opSlider.dataset.styleKey = 'opacity';
    bindHistPointerDown(opSlider, hists.op);
    opSlider.addEventListener('input', function () {
      var p = parseInt(opSlider.value, 10);
      collectedStyles['opacity'] = String(p / 100);
      opPct.textContent = p + '%';
      schedulePreview();
    });
    opCard.appendChild(opSlider);
    var opTicks = document.createElement('div');
    opTicks.className = 'webedit-ee-range-ticks';
    opTicks.innerHTML = '<span>0%</span><span>50%</span><span>100%</span>';
    opCard.appendChild(opTicks);
    root.appendChild(opCard);

    return root;
  }

  function buildFontTab(hists) {
    var root = document.createElement('div');
    root.className = 'webedit-ee-tab-panel';
    root.dataset.tabPanel = 'font';
    root.hidden = true;

    var textHist = {
      beforeChange: function () {},
      undo: function () {},
      redo: function () {}
    };
    var textPast = [];
    var textFuture = [];
    textHist.beforeChange = function () {};
    textHist.undo = function () {
      if (!textPast.length || !textInputEl) return;
      textFuture.push(textInputEl.value);
      textInputEl.value = textPast.pop();
      textPreviousValue = textInputEl.value;
      schedulePreview();
    };
    textHist.redo = function () {
      if (!textFuture.length || !textInputEl) return;
      textPast.push(textInputEl.value);
      textInputEl.value = textFuture.pop();
      textPreviousValue = textInputEl.value;
      schedulePreview();
    };

    var textCard = document.createElement('div');
    textCard.className = 'webedit-ee-card';
    var th = document.createElement('div');
    th.className = 'webedit-ee-card-head';
    th.innerHTML = '<span class="webedit-ee-card-label">TEXT</span>';
    th.appendChild(cardToolbar(textHist));
    textCard.appendChild(th);
    var tin = document.createElement('input');
    tin.type = 'text';
    tin.className = 'webedit-ee-text-lg';
    tin.id = 'webedit-editor-text-input';
    tin.placeholder = 'Enter custom label…';
    tin.addEventListener('input', function () {
      textPast.push(textPreviousValue);
      textFuture = [];
      textPreviousValue = tin.value;
      schedulePreview();
    });
    textCard.appendChild(tin);
    root.appendChild(textCard);
    textInputEl = tin;

    hists.ff = createCardHistory('ff', function () { return ['font-family', 'font-weight']; });
    hists.fd = createCardHistory('fd', function () { return ['font-size', 'line-height', 'letter-spacing']; });

    var typo = document.createElement('div');
    typo.className = 'webedit-ee-subsection';
    typo.innerHTML = '<h3 class="webedit-ee-subtitle">Typography Basis</h3>';

    var ffRow = document.createElement('div');
    ffRow.className = 'webedit-ee-card';
    var ffH = document.createElement('div');
    ffH.className = 'webedit-ee-card-head';
    ffH.innerHTML = '<span class="webedit-ee-card-label">FONT FAMILY</span>';
    ffH.appendChild(cardToolbar(hists.ff));
    ffRow.appendChild(ffH);
    var ffSel = document.createElement('select');
    ffSel.className = 'webedit-ee-select';
    ffSel.dataset.styleKey = 'font-family';
    [
      ['Inter', 'Inter, system-ui, sans-serif'],
      ['System UI', 'system-ui, sans-serif'],
      ['Georgia', 'Georgia, serif'],
      ['Times', '"Times New Roman", serif'],
      ['Monospace', 'ui-monospace, monospace']
    ].forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[1];
      o.textContent = pair[0];
      ffSel.appendChild(o);
    });
    ffSel.addEventListener('change', function () {
      hists.ff.beforeChange();
      collectedStyles['font-family'] = ffSel.value;
      schedulePreview();
    });
    ffRow.appendChild(ffSel);
    typo.appendChild(ffRow);

    var fwRow = document.createElement('div');
    fwRow.className = 'webedit-ee-card';
    var fwH = document.createElement('div');
    fwH.className = 'webedit-ee-card-head';
    fwH.innerHTML = '<span class="webedit-ee-card-label">FONT WEIGHT</span>';
    fwH.appendChild(cardToolbar(hists.ff));
    fwRow.appendChild(fwH);
    var fwSel = document.createElement('select');
    fwSel.className = 'webedit-ee-select';
    fwSel.dataset.styleKey = 'font-weight';
    [['Regular (400)', '400'], ['Medium (500)', '500'], ['Semibold (600)', '600'], ['Bold (700)', '700']].forEach(function (p) {
      var o = document.createElement('option');
      o.value = p[1];
      o.textContent = p[0];
      fwSel.appendChild(o);
    });
    fwSel.addEventListener('change', function () {
      hists.ff.beforeChange();
      collectedStyles['font-weight'] = fwSel.value;
      schedulePreview();
    });
    fwRow.appendChild(fwSel);
    typo.appendChild(fwRow);
    root.appendChild(typo);

    var dim = document.createElement('div');
    dim.className = 'webedit-ee-subsection';
    dim.innerHTML = '<h3 class="webedit-ee-subtitle">Dimensions</h3>';

    function sliderCard(label, key, min, max, step, fmt) {
      var card = document.createElement('div');
      card.className = 'webedit-ee-card';
      var h = document.createElement('div');
      h.className = 'webedit-ee-card-head';
      h.innerHTML = '<span class="webedit-ee-card-label">' + label + '</span>';
      var val = document.createElement('span');
      val.className = 'webedit-ee-slider-val webedit-ee-accent';
      h.appendChild(val);
      h.appendChild(cardToolbar(hists.fd));
      card.appendChild(h);
      var row = document.createElement('div');
      row.className = 'webedit-ee-slider-row';
      var rng = document.createElement('input');
      rng.type = 'range';
      rng.min = min;
      rng.max = max;
      rng.step = step;
      rng.className = 'webedit-ee-range webedit-ee-range-wide';
      rng.dataset.styleKey = key;
      bindHistPointerDown(rng, hists.fd);
      rng.addEventListener('input', function () {
        var n = parseFloat(rng.value);
        var out = fmt(n);
        collectedStyles[key] = out;
        val.textContent = out;
        schedulePreview();
      });
      row.appendChild(rng);
      card.appendChild(row);
      return card;
    }

    dim.appendChild(sliderCard('FONT SIZE', 'font-size', 8, 72, 1, function (n) { return n + 'px'; }));
    dim.appendChild(sliderCard('LINE HEIGHT', 'line-height', 0.8, 2.5, 0.05, function (n) { return String(n); }));
    dim.appendChild(sliderCard('LETTER SPACING', 'letter-spacing', -5, 20, 0.5, function (n) { return n + '%'; }));
    root.appendChild(dim);

    decorationHist = createCardHistory('deco', function () { return ['text-decoration', 'font-style']; });
    alignHist = createCardHistory('align', function () { return ['text-align']; });

    var alignCard = document.createElement('div');
    alignCard.className = 'webedit-ee-card';
    var ah = document.createElement('div');
    ah.className = 'webedit-ee-card-head';
    ah.innerHTML = '<span class="webedit-ee-card-label">Alignment</span>';
    ah.appendChild(cardToolbar(alignHist));
    alignCard.appendChild(ah);
    var seg = document.createElement('div');
    seg.className = 'webedit-ee-segmented';
    ['left', 'center', 'right', 'justify'].forEach(function (al) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'webedit-ee-seg-btn';
      b.dataset.align = al;
      b.textContent = al.charAt(0).toUpperCase();
      b.addEventListener('click', function () {
        alignHist.beforeChange();
        collectedStyles['text-align'] = al;
        schedulePreview();
        syncAlignToggles();
      });
      seg.appendChild(b);
    });
    alignCard.appendChild(seg);
    root.appendChild(alignCard);

    var decoCard = document.createElement('div');
    decoCard.className = 'webedit-ee-card';
    var dh = document.createElement('div');
    dh.className = 'webedit-ee-card-head';
    dh.innerHTML = '<span class="webedit-ee-card-label">Decoration</span>';
    dh.appendChild(cardToolbar(decorationHist));
    decoCard.appendChild(dh);
    var decoRow = document.createElement('div');
    decoRow.className = 'webedit-ee-toggle-row';
    ['underline', 'strike', 'italic'].forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'webedit-ee-toggle-pill';
      b.dataset.deco = name === 'strike' ? 'strike' : name;
      b.textContent = name === 'strike' ? 'Strike' : name.charAt(0).toUpperCase() + name.slice(1);
      b.addEventListener('click', function () {
        var dec = (collectedStyles['text-decoration'] || 'none').toLowerCase();
        var fs = (collectedStyles['font-style'] || 'normal').toLowerCase();
        var u = dec.indexOf('underline') !== -1;
        var s = dec.indexOf('line-through') !== -1;
        var it = fs === 'italic';
        if (name === 'underline') u = !u;
        if (name === 'strike') s = !s;
        if (name === 'italic') it = !it;
        setDecoration({ underline: u, strike: s, italic: it });
      });
      decoRow.appendChild(b);
    });
    decoCard.appendChild(decoRow);
    root.appendChild(decoCard);

    return root;
  }

  var SIZE_PRESETS = {
    hero: { width: '100%', 'min-height': '360px', padding: '48px 24px', 'text-align': 'center' },
    sidebar: { width: '280px', 'min-height': '200px', padding: '16px' },
    card: { width: '320px', padding: '16px', 'border-radius': '12px', 'box-shadow': '0 10px 25px rgba(0,0,0,0.12)' }
  };

  function buildSizeTab(hists) {
    var root = document.createElement('div');
    root.className = 'webedit-ee-tab-panel';
    root.dataset.tabPanel = 'size';
    root.hidden = true;

    hists.wh = createCardHistory('wh', function () {
      return ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'];
    });
    hists.pos = createCardHistory('pos', function () {
      return ['position', 'top', 'right', 'bottom', 'left'];
    });
    hists.z = createCardHistory('z', function () { return ['z-index']; });
    hists.disp = createCardHistory('disp', function () { return ['display']; });
    visibilityHist = createCardHistory('vis', function () { return ['visibility']; });
    hists.presets = createCardHistory('presets', function () {
      return ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'padding', 'text-align', 'border-radius', 'box-shadow'];
    });

    function dimCard(title, iconClass, hist) {
      var card = document.createElement('div');
      card.className = 'webedit-ee-card webedit-ee-card-icon';
      var head = document.createElement('div');
      head.className = 'webedit-ee-card-head';
      head.innerHTML = '<span class="webedit-ee-card-icon-slot" aria-hidden="true"></span><span class="webedit-ee-card-label">' + title + '</span>';
      head.appendChild(cardToolbar(hist));
      card.appendChild(head);
      return card;
    }

    var dCard = dimCard('Dimensions', '', hists.wh);
    [['WIDTH', 'width', 0, 800, 1, 'px'], ['HEIGHT', 'height', 0, 600, 1, 'px']].forEach(function (spec) {
      var lab = document.createElement('div');
      lab.className = 'webedit-ee-dim-label-row';
      lab.innerHTML = '<span>' + spec[0] + '</span><span class="webedit-ee-accent webedit-ee-dim-val" data-dim-val="' + spec[1] + '">—</span>';
      var rng = document.createElement('input');
      rng.type = 'range';
      rng.min = spec[2];
      rng.max = spec[3];
      rng.step = spec[4];
      rng.className = 'webedit-ee-range webedit-ee-range-wide';
      rng.dataset.styleKey = spec[1];
      bindHistPointerDown(rng, hists.wh);
      rng.addEventListener('input', function () {
        collectedStyles[spec[1]] = rng.value + spec[5];
        lab.querySelector('.webedit-ee-dim-val').textContent = collectedStyles[spec[1]];
        schedulePreview();
      });
      dCard.appendChild(lab);
      dCard.appendChild(rng);
    });
    var mm = document.createElement('div');
    mm.className = 'webedit-ee-mm-grid';
    ['min-width', 'max-width', 'min-height', 'max-height'].forEach(function (k) {
      var wrap = document.createElement('label');
      wrap.className = 'webedit-ee-mm-cell';
      wrap.innerHTML = '<span class="webedit-ee-mm-lab">' + k.replace(/-/g, ' ') + '</span>';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'webedit-ee-mm-input';
      inp.placeholder = 'unset';
      inp.dataset.styleKey = k;
      inp.addEventListener('change', function () {
        hists.wh.beforeChange();
        var v = inp.value.trim();
        if (!v) delete collectedStyles[k];
        else collectedStyles[k] = v;
        schedulePreview();
      });
      wrap.appendChild(inp);
      mm.appendChild(wrap);
    });
    dCard.appendChild(mm);
    root.appendChild(dCard);

    var pCard = document.createElement('div');
    pCard.className = 'webedit-ee-card';
    var ph = document.createElement('div');
    ph.className = 'webedit-ee-card-head';
    ph.innerHTML = '<span class="webedit-ee-card-label">POSITIONING</span>';
    ph.appendChild(cardToolbar(hists.pos));
    pCard.appendChild(ph);
    var posLab = document.createElement('label');
    posLab.className = 'webedit-ee-mini-label';
    posLab.textContent = 'POSITION TYPE';
    var posSel = document.createElement('select');
    posSel.className = 'webedit-ee-select';
    posSel.dataset.styleKey = 'position';
    ['static', 'relative', 'absolute', 'fixed', 'sticky'].forEach(function (p) {
      var o = document.createElement('option');
      o.value = p;
      o.textContent = p;
      posSel.appendChild(o);
    });
    posSel.addEventListener('change', function () {
      hists.pos.beforeChange();
      collectedStyles['position'] = posSel.value;
      schedulePreview();
    });
    pCard.appendChild(posLab);
    pCard.appendChild(posSel);
    var grid = document.createElement('div');
    grid.className = 'webedit-ee-trbl-grid';
    grid.innerHTML = '<span class="webedit-ee-trbl-title">Coordinates (PX)</span>';
    ['top', 'right', 'bottom', 'left'].forEach(function (edge) {
      var cell = document.createElement('div');
      cell.className = 'webedit-ee-trbl-cell';
      cell.innerHTML = '<span>' + edge + '</span>';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = '0';
      inp.dataset.styleKey = edge;
      inp.addEventListener('change', function () {
        hists.pos.beforeChange();
        collectedStyles[edge] = inp.value.trim() ? inp.value.trim() + 'px' : '0';
        schedulePreview();
      });
      cell.appendChild(inp);
      grid.appendChild(cell);
    });
    pCard.appendChild(grid);
    root.appendChild(pCard);

    var zCard = document.createElement('div');
    zCard.className = 'webedit-ee-card';
    var zh = document.createElement('div');
    zh.className = 'webedit-ee-card-head';
    zh.innerHTML = '<span class="webedit-ee-card-label">Z-INDEX</span><span class="webedit-ee-accent webedit-ee-slider-val" id="webedit-ee-z-val">10</span>';
    zh.appendChild(cardToolbar(hists.z));
    zCard.appendChild(zh);
    var zInp = document.createElement('input');
    zInp.type = 'text';
    zInp.className = 'webedit-ee-text-lg';
    zInp.placeholder = 'Value';
    zInp.dataset.styleKey = 'z-index';
    zInp.addEventListener('change', function () {
      hists.z.beforeChange();
      collectedStyles['z-index'] = zInp.value.trim() || 'auto';
      document.getElementById('webedit-ee-z-val').textContent = collectedStyles['z-index'];
      schedulePreview();
    });
    zCard.appendChild(zInp);
    root.appendChild(zCard);

    var dispCard = document.createElement('div');
    dispCard.className = 'webedit-ee-card';
    var dph = document.createElement('div');
    dph.className = 'webedit-ee-card-head';
    dph.innerHTML = '<span class="webedit-ee-card-label">DISPLAY</span>';
    dph.appendChild(cardToolbar(hists.disp));
    dispCard.appendChild(dph);
    var dLab = document.createElement('label');
    dLab.className = 'webedit-ee-mini-label';
    dLab.textContent = 'LAYOUT MODE';
    var dSel = document.createElement('select');
    dSel.className = 'webedit-ee-select';
    dSel.dataset.styleKey = 'display';
    ['block', 'flex', 'grid', 'inline-block', 'inline', 'none'].forEach(function (d) {
      var o = document.createElement('option');
      o.value = d;
      o.textContent = d;
      dSel.appendChild(o);
    });
    dSel.addEventListener('change', function () {
      hists.disp.beforeChange();
      collectedStyles['display'] = dSel.value;
      schedulePreview();
    });
    dispCard.appendChild(dLab);
    dispCard.appendChild(dSel);
    root.appendChild(dispCard);

    var visCard = document.createElement('div');
    visCard.className = 'webedit-ee-card';
    var vh = document.createElement('div');
    vh.className = 'webedit-ee-card-head';
    vh.innerHTML = '<span class="webedit-ee-card-label">VISIBILITY</span>';
    vh.appendChild(cardToolbar(visibilityHist));
    visCard.appendChild(vh);
    var vRow = document.createElement('label');
    vRow.className = 'webedit-ee-switch-row';
    vRow.innerHTML = '<span>Element visible</span>';
    var vInp = document.createElement('input');
    vInp.type = 'checkbox';
    vInp.id = 'webedit-ee-visibility-toggle';
    vInp.checked = true;
    vInp.addEventListener('change', function () {
      visibilityHist.beforeChange();
      if (vInp.checked) delete collectedStyles['visibility'];
      else collectedStyles['visibility'] = 'hidden';
      schedulePreview();
    });
    vRow.appendChild(vInp);
    visCard.appendChild(vRow);
    root.appendChild(visCard);

    var preCard = document.createElement('div');
    preCard.className = 'webedit-ee-card';
    preCard.innerHTML = '<div class="webedit-ee-card-head"><span class="webedit-ee-card-label">Quick Presets</span></div>';
    var prow = document.createElement('div');
    prow.className = 'webedit-ee-preset-row';
    [['Hero Unit', 'hero'], ['Sidebar', 'sidebar'], ['Card Element', 'card']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'webedit-ee-preset-btn';
      b.textContent = pair[0];
      b.dataset.preset = pair[1];
      b.addEventListener('click', function () {
        hists.presets.beforeChange();
        var preset = SIZE_PRESETS[pair[1]];
        Object.keys(preset).forEach(function (k) {
          collectedStyles[k] = preset[k];
        });
        prow.querySelectorAll('.webedit-ee-preset-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        schedulePreview();
        refreshAllInputs();
      });
      prow.appendChild(b);
    });
    preCard.appendChild(prow);
    root.appendChild(preCard);

    return root;
  }

  function setActiveTab(name) {
    if (!dashboardEl) return;
    dashboardEl.querySelectorAll('.webedit-ee-tab-panel').forEach(function (p) {
      p.hidden = p.dataset.tabPanel !== name;
    });
    dashboardEl.querySelectorAll('.webedit-ee-bottom-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
  }

  function buildDashboard() {
    var dash = document.createElement('div');
    dash.className = 'webedit-ee-root';
    dash.id = 'webedit-customize-dashboard';

    var top = document.createElement('div');
    top.className = 'webedit-ee-topbar';
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'webedit-ee-back';
    back.setAttribute('aria-label', 'Back');
    back.innerHTML = '&#8592;';
    back.addEventListener('click', cancelFlow);
    var ttl = document.createElement('div');
    ttl.className = 'webedit-ee-topbar-title';
    ttl.textContent = 'Element Editor';
    var actions = document.createElement('div');
    actions.className = 'webedit-ee-topbar-actions';
    var cxl = document.createElement('button');
    cxl.type = 'button';
    cxl.className = 'webedit-ee-btn-text';
    cxl.textContent = 'Cancel';
    cxl.addEventListener('click', cancelFlow);
    var app = document.createElement('button');
    app.type = 'button';
    app.className = 'webedit-ee-btn-apply';
    app.textContent = 'Apply';
    app.addEventListener('click', applyFlow);
    actions.appendChild(cxl);
    actions.appendChild(app);
    top.appendChild(back);
    top.appendChild(ttl);
    top.appendChild(actions);
    dash.appendChild(top);

    var body = document.createElement('div');
    body.className = 'webedit-ee-body';

    var hists = {};
    body.appendChild(buildColorsTab(hists));
    body.appendChild(buildFontTab(hists));
    body.appendChild(buildSizeTab(hists));
    dash.appendChild(body);

    var nav = document.createElement('nav');
    nav.className = 'webedit-ee-bottom-tabs';
    nav.setAttribute('aria-label', 'Editor sections');
    [
      ['colors', 'COLORS', '<circle cx="12" cy="12" r="3"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/>'],
      ['font', 'FONT', '<path d="M4 7V5h16v2M9 20h6M12 4v16"/>'],
      ['size', 'SIZE', '<path d="M21 16V8H3v8h18zM1 6h22v12H1z"/><path d="M8 12h8"/>']
    ].forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'webedit-ee-bottom-tab';
      btn.dataset.tab = t[0];
      btn.innerHTML = '<svg class="webedit-ee-tab-svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' + t[2] + '</svg><span>' + t[1] + '</span>';
      btn.addEventListener('click', function () { setActiveTab(t[0]); });
      nav.appendChild(btn);
    });
    dash.appendChild(nav);

    return dash;
  }

  function cancelFlow() {
    chrome.runtime.sendMessage({ type: 'CUSTOMIZE_CANCEL' }, function () {
      if (chrome.runtime.lastError) {
        console.warn('[ElementEditor] Cancel failed:', chrome.runtime.lastError.message);
      }
    });
    hideDashboard();
  }

  function applyFlow() {
    var keys = Object.keys(collectedStyles);
    var t = textInputEl ? textInputEl.value : '';
    var textChanged = t !== textBaseline;
    if (!keys.length && !textChanged) {
      notify('No changes to apply.');
      return;
    }
    var desc = keys.length ? ('Changed ' + keys.slice(0, 4).join(', ') + (keys.length > 4 ? '…' : '')) : 'Text update';
    var applyPayload = {
      type: 'CUSTOMIZE_APPLY',
      selector: currentSelector,
      url: currentUrl,
      styles: collectedStyles,
      summary: currentSummary,
      description: desc
    };
    if (textChanged) {
      applyPayload.textContent = t;
    }
    if (currentResumeEditId) {
      applyPayload.resumeEditId = currentResumeEditId;
    }
    chrome.runtime.sendMessage(applyPayload, function (resp) {
      if (chrome.runtime.lastError) {
        console.warn('[ElementEditor] Apply failed:', chrome.runtime.lastError.message);
        return;
      }
      if (resp && !resp.success) {
        notify('Apply failed: ' + (resp.error || 'unknown'));
      }
    });
  }

  function syncFromState() {
    refreshAllInputs();
    if (textInputEl && textBaseline !== undefined) {
      textInputEl.value = textBaseline;
      textPreviousValue = textBaseline;
    }
    var op = dashboardEl && dashboardEl.querySelector('[data-style-key="opacity"]');
    if (op) {
      var o = collectedStyles['opacity'];
      var pct = o != null ? Math.round(parseFloat(o) * 100) : 100;
      if (isNaN(pct)) pct = 100;
      op.value = String(pct);
      var opEl = dashboardEl.querySelector('#webedit-ee-opacity-pct');
      if (opEl) opEl.textContent = pct + '%';
    }
    if (typeof window._webeditUpdateBorderStatus === 'function') {
      window._webeditUpdateBorderStatus();
    }
  }

  function showDashboard(selector, summary, url, options) {
    hideDashboard();
    options = options || {};
    currentSelector = selector;
    currentUrl = url;
    currentSummary = summary;
    currentResumeEditId = options.resumeEditId || null;
    collectedStyles = Object.assign({}, options.initialStyles || {});
    textBaseline = options.initialTextContent != null ? String(options.initialTextContent) : '';

    dashboardEl = buildDashboard();
    textInputEl = dashboardEl.querySelector('#webedit-editor-text-input');
    if (textInputEl) textInputEl.value = textBaseline;
    textPreviousValue = textBaseline;

    var mainContent = document.getElementById('webedit-main-content');
    if (mainContent) mainContent.appendChild(dashboardEl);

    document.getElementById('webedit-bottom-controls') && document.getElementById('webedit-bottom-controls').classList.add('hidden');
    document.getElementById('webedit-input-container') && document.getElementById('webedit-input-container').classList.add('hidden');
    document.getElementById('webedit-chat-messages') && document.getElementById('webedit-chat-messages').classList.add('hidden');
    document.getElementById('webedit-blueprint-list') && document.getElementById('webedit-blueprint-list').classList.add('hidden');

    syncFromState();
    setActiveTab('colors');
    schedulePreview();
  }

  function hideDashboard() {
    if (dashboardEl) {
      try { dashboardEl.remove(); } catch (_) {}
      dashboardEl = null;
    }
    textInputEl = null;
    window._webeditUpdateBorderStatus = null;
    currentSelector = '';
    currentUrl = '';
    currentSummary = '';
    currentResumeEditId = null;
    collectedStyles = {};
    textBaseline = '';
    textPreviousValue = '';
    colorPickerSyncers.length = 0;
    clearTimeout(previewDebounceTimer);

    document.getElementById('webedit-bottom-controls') && document.getElementById('webedit-bottom-controls').classList.remove('hidden');
    document.getElementById('webedit-input-container') && document.getElementById('webedit-input-container').classList.remove('hidden');
    document.getElementById('webedit-chat-messages') && document.getElementById('webedit-chat-messages').classList.remove('hidden');
    document.getElementById('webedit-blueprint-list') && document.getElementById('webedit-blueprint-list').classList.remove('hidden');
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;
    switch (message.type) {
      case 'CUSTOMIZE_DASHBOARD_OPEN':
        showDashboard(message.selector, message.summary, message.url, {
          initialStyles: message.initialStyles || {},
          initialTextContent: message.initialTextContent != null ? message.initialTextContent : '',
          resumeEditId: message.resumeEditId || null
        });
        break;
      case 'CUSTOMIZE_COMPLETED':
        hideDashboard();
        notify(message.syncFailed
          ? 'Customization saved locally — could not sync to cloud.'
          : 'Customization saved! You can review it in EditHistory.');
        break;
      case 'FLOW_STATE_CHANGED':
        if (message.state === 'IDLE' && dashboardEl) hideDashboard();
        if (message.state === 'PICKING' && message.feature === 'customize') hideDashboard();
        break;
    }
  });

  if (window.WebEditPanel) {
    window.WebEditPanel.openCustomizeDashboard = function (sel, sum, u, opts) {
      showDashboard(sel, sum, u, opts || {});
    };
    window.WebEditPanel.closeCustomizeDashboard = hideDashboard;
  }
})();
