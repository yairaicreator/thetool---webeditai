'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Customize Feature — Panel Module
// Runs inside sidepanel.html after sidepanel.js.
// Manages the customization dashboard (CSS property controls, live preview,
// Apply / Cancel / Undo). Communication: JSON messages only (chrome.runtime).
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

  // ─── CSS Property Definitions ──────────────────────────────────────────────

  var CONTROL_SECTIONS = [
    {
      title: 'Colors',
      controls: [
        { prop: 'color', label: 'Text Color', type: 'color', initial: '' },
        { prop: 'background-color', label: 'Background', type: 'color', initial: '' },
        { prop: 'border-color', label: 'Border Color', type: 'color', initial: '' }
      ]
    },
    {
      title: 'Typography',
      controls: [
        { prop: 'font-size', label: 'Font Size', type: 'range', min: 0, max: 120, step: 1, unit: 'px', initial: '' },
        { prop: 'font-weight', label: 'Font Weight', type: 'select', options: ['', '100', '200', '300', '400', '500', '600', '700', '800', '900'], initial: '' },
        { prop: 'font-family', label: 'Font Family', type: 'select', options: ['', 'Arial, sans-serif', 'Helvetica, sans-serif', 'Georgia, serif', 'Times New Roman, serif', 'Courier New, monospace', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif', 'Impact, sans-serif', 'Comic Sans MS, cursive', 'system-ui, sans-serif'], initial: '' },
        { prop: 'text-align', label: 'Text Align', type: 'select', options: ['', 'left', 'center', 'right', 'justify'], initial: '' },
        { prop: 'line-height', label: 'Line Height', type: 'range', min: 0, max: 5, step: 0.1, unit: '', initial: '' },
        { prop: 'letter-spacing', label: 'Letter Spacing', type: 'range', min: -5, max: 20, step: 0.5, unit: 'px', initial: '' },
        { prop: 'text-decoration', label: 'Text Decoration', type: 'select', options: ['', 'none', 'underline', 'overline', 'line-through'], initial: '' },
        { prop: 'text-transform', label: 'Text Transform', type: 'select', options: ['', 'none', 'uppercase', 'lowercase', 'capitalize'], initial: '' }
      ]
    },
    {
      title: 'Spacing',
      controls: [
        { prop: 'padding', label: 'Padding', type: 'range', min: 0, max: 100, step: 1, unit: 'px', initial: '' },
        { prop: 'margin', label: 'Margin', type: 'range', min: -50, max: 100, step: 1, unit: 'px', initial: '' }
      ]
    },
    {
      title: 'Size',
      controls: [
        { prop: 'width', label: 'Width', type: 'text', placeholder: 'e.g. 200px, 50%, auto', initial: '' },
        { prop: 'height', label: 'Height', type: 'text', placeholder: 'e.g. 100px, auto', initial: '' },
        { prop: 'max-width', label: 'Max Width', type: 'text', placeholder: 'e.g. 600px, 100%', initial: '' },
        { prop: 'min-height', label: 'Min Height', type: 'text', placeholder: 'e.g. 50px', initial: '' }
      ]
    },
    {
      title: 'Border & Shape',
      controls: [
        { prop: 'border-width', label: 'Border Width', type: 'range', min: 0, max: 20, step: 1, unit: 'px', initial: '' },
        { prop: 'border-style', label: 'Border Style', type: 'select', options: ['', 'none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'], initial: '' },
        { prop: 'border-radius', label: 'Border Radius', type: 'range', min: 0, max: 100, step: 1, unit: 'px', initial: '' },
        { prop: 'outline', label: 'Outline', type: 'text', placeholder: 'e.g. 2px solid red', initial: '' }
      ]
    },
    {
      title: 'Effects',
      controls: [
        { prop: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.05, unit: '', initial: '' },
        { prop: 'box-shadow', label: 'Box Shadow', type: 'select', options: ['', 'none', '0 1px 3px rgba(0,0,0,0.12)', '0 4px 6px rgba(0,0,0,0.1)', '0 10px 25px rgba(0,0,0,0.15)', '0 20px 50px rgba(0,0,0,0.2)', 'inset 0 2px 4px rgba(0,0,0,0.1)'], initial: '' },
        { prop: 'overflow', label: 'Overflow', type: 'select', options: ['', 'visible', 'hidden', 'scroll', 'auto'], initial: '' }
      ]
    },
    {
      title: 'Layout',
      controls: [
        { prop: 'display', label: 'Display', type: 'select', options: ['', 'block', 'inline', 'inline-block', 'flex', 'grid', 'none'], initial: '' },
        { prop: 'position', label: 'Position', type: 'select', options: ['', 'static', 'relative', 'absolute', 'fixed', 'sticky'], initial: '' },
        { prop: 'z-index', label: 'Z-Index', type: 'text', placeholder: 'e.g. 10, auto', initial: '' },
        { prop: 'visibility', label: 'Visibility', type: 'select', options: ['', 'visible', 'hidden', 'collapse'], initial: '' }
      ]
    }
  ];

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function notify(text) {
    if (window.WebEditPanel && typeof window.WebEditPanel.showNotification === 'function') {
      window.WebEditPanel.showNotification(text);
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  // ─── Preview dispatch (debounced) ──────────────────────────────────────────

  function sendPreview() {
    var cssText = buildCssTextFromStyles(currentSelector, collectedStyles);
    chrome.runtime.sendMessage({
      type: 'PREVIEW_CSS',
      selector: currentSelector,
      cssText: cssText
    }, function () {
      if (chrome.runtime.lastError) {
        console.warn('[Customize-Panel] Preview send failed:', chrome.runtime.lastError.message);
      }
    });
  }

  function schedulePreview() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(sendPreview, PREVIEW_DEBOUNCE_MS);
  }

  function syncInputsFromCollectedStyles(dashboard) {
    var props = Object.keys(collectedStyles);
    for (var p = 0; p < props.length; p++) {
      var prop = props[p];
      var val = collectedStyles[prop];
      if (val === '' || val === undefined || val === null) continue;
      var inputs = dashboard.querySelectorAll('[data-prop]');
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (el.dataset.prop !== prop) continue;
        if (el.classList.contains('webedit-customize-color')) {
          var hex = String(val).trim();
          if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
            el.value = hex.length === 4 ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex;
            el.dataset.empty = 'false';
          }
        } else if (el.classList.contains('webedit-customize-range')) {
          var unit = el.dataset.unit || '';
          var num = parseFloat(String(val).replace(/[^\d.-]/g, ''));
          if (!isNaN(num)) {
            el.value = String(num);
            el.dataset.empty = 'false';
            var disp = el.parentElement && el.parentElement.querySelector('.webedit-customize-range-value');
            if (disp) disp.textContent = String(val);
          }
        } else if (el.tagName === 'SELECT') {
          el.value = String(val);
        } else if (el.classList.contains('webedit-customize-text')) {
          el.value = String(val);
        }
        break;
      }
    }
  }

  // ─── Control factory ──────────────────────────────────────────────────────

  function createControl(ctrl) {
    var row = document.createElement('div');
    row.className = 'webedit-customize-control';

    var label = document.createElement('label');
    label.className = 'webedit-customize-label';
    label.textContent = ctrl.label;
    row.appendChild(label);

    var inputWrap = document.createElement('div');
    inputWrap.className = 'webedit-customize-input-wrap';

    var input;

    if (ctrl.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
      input.className = 'webedit-customize-color';
      input.value = ctrl.initial || '#000000';
      input.dataset.prop = ctrl.prop;
      input.dataset.empty = 'true';

      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'webedit-customize-clear-btn';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', function () {
        input.dataset.empty = 'true';
        delete collectedStyles[ctrl.prop];
        schedulePreview();
      });

      input.addEventListener('input', function () {
        input.dataset.empty = 'false';
        collectedStyles[ctrl.prop] = input.value;
        schedulePreview();
      });

      inputWrap.appendChild(input);
      inputWrap.appendChild(clearBtn);

    } else if (ctrl.type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.className = 'webedit-customize-range';
      input.min = ctrl.min;
      input.max = ctrl.max;
      input.step = ctrl.step;
      input.value = ctrl.initial || ((ctrl.min + ctrl.max) / 2);
      input.dataset.prop = ctrl.prop;
      input.dataset.unit = ctrl.unit || '';
      input.dataset.empty = 'true';

      var valueDisplay = document.createElement('span');
      valueDisplay.className = 'webedit-customize-range-value';
      valueDisplay.textContent = '—';

      var clearRangeBtn = document.createElement('button');
      clearRangeBtn.type = 'button';
      clearRangeBtn.className = 'webedit-customize-clear-btn';
      clearRangeBtn.textContent = 'Clear';
      clearRangeBtn.addEventListener('click', function () {
        input.dataset.empty = 'true';
        valueDisplay.textContent = '—';
        delete collectedStyles[ctrl.prop];
        schedulePreview();
      });

      input.addEventListener('input', function () {
        input.dataset.empty = 'false';
        var val = input.value + (ctrl.unit || '');
        valueDisplay.textContent = val;
        collectedStyles[ctrl.prop] = val;
        schedulePreview();
      });

      inputWrap.appendChild(input);
      inputWrap.appendChild(valueDisplay);
      inputWrap.appendChild(clearRangeBtn);

    } else if (ctrl.type === 'select') {
      input = document.createElement('select');
      input.className = 'webedit-customize-select';
      input.dataset.prop = ctrl.prop;

      for (var i = 0; i < ctrl.options.length; i++) {
        var opt = document.createElement('option');
        opt.value = ctrl.options[i];
        opt.textContent = ctrl.options[i] || '(default)';
        input.appendChild(opt);
      }

      input.addEventListener('change', function () {
        if (input.value === '') {
          delete collectedStyles[ctrl.prop];
        } else {
          collectedStyles[ctrl.prop] = input.value;
        }
        schedulePreview();
      });

      inputWrap.appendChild(input);

    } else if (ctrl.type === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'webedit-customize-text';
      input.placeholder = ctrl.placeholder || '';
      input.dataset.prop = ctrl.prop;

      input.addEventListener('input', function () {
        var val = input.value.trim();
        if (val === '') {
          delete collectedStyles[ctrl.prop];
        } else {
          collectedStyles[ctrl.prop] = val;
        }
        schedulePreview();
      });

      inputWrap.appendChild(input);
    }

    row.appendChild(inputWrap);
    return row;
  }

  // ─── Build the dashboard DOM ───────────────────────────────────────────────

  function buildDashboard(selector, summary) {
    var dashboard = document.createElement('div');
    dashboard.className = 'webedit-customize-dashboard';
    dashboard.id = 'webedit-customize-dashboard';

    // Header
    var header = document.createElement('div');
    header.className = 'webedit-customize-header';

    var headerTitle = document.createElement('div');
    headerTitle.className = 'webedit-customize-header-title';
    var h3 = document.createElement('h3');
    h3.textContent = 'Customize Element';
    headerTitle.appendChild(h3);
    var selectorLabel = document.createElement('div');
    selectorLabel.className = 'webedit-customize-selector-label';
    selectorLabel.textContent = summary || selector;
    selectorLabel.title = selector;
    headerTitle.appendChild(selectorLabel);
    header.appendChild(headerTitle);

    dashboard.appendChild(header);

    // Scrollable controls area
    var controlsArea = document.createElement('div');
    controlsArea.className = 'webedit-customize-controls';

    for (var s = 0; s < CONTROL_SECTIONS.length; s++) {
      var section = CONTROL_SECTIONS[s];
      var sectionEl = document.createElement('div');
      sectionEl.className = 'webedit-customize-section';

      var sectionHeader = document.createElement('button');
      sectionHeader.type = 'button';
      sectionHeader.className = 'webedit-customize-section-header';
      sectionHeader.textContent = section.title;
      sectionHeader.setAttribute('aria-expanded', 'true');

      var sectionBody = document.createElement('div');
      sectionBody.className = 'webedit-customize-section-body';

      sectionHeader.addEventListener('click', (function (body, btn) {
        return function () {
          var expanded = body.classList.toggle('collapsed');
          btn.setAttribute('aria-expanded', !expanded);
        };
      })(sectionBody, sectionHeader));

      for (var c = 0; c < section.controls.length; c++) {
        sectionBody.appendChild(createControl(section.controls[c]));
      }

      sectionEl.appendChild(sectionHeader);
      sectionEl.appendChild(sectionBody);
      controlsArea.appendChild(sectionEl);
    }

    dashboard.appendChild(controlsArea);

    // Action buttons
    var actions = document.createElement('div');
    actions.className = 'webedit-customize-actions';

    var undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'webedit-customize-btn webedit-customize-undo-btn';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', function () {
      collectedStyles = {};
      resetAllInputs(dashboard);
      chrome.runtime.sendMessage({ type: 'PREVIEW_CSS', selector: currentSelector, cssText: '' }, function () {
        if (chrome.runtime.lastError) {}
      });
    });
    actions.appendChild(undoBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'webedit-customize-btn webedit-customize-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'CUSTOMIZE_CANCEL' }, function () {
        if (chrome.runtime.lastError) {
          console.warn('[Customize-Panel] CUSTOMIZE_CANCEL failed:', chrome.runtime.lastError.message);
        }
      });
      hideDashboard();
    });
    actions.appendChild(cancelBtn);

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'webedit-customize-btn webedit-customize-apply-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', function () {
      var styleCount = Object.keys(collectedStyles).length;
      if (styleCount === 0) {
        notify('No changes to apply. Adjust some properties first.');
        return;
      }

      var desc = buildDescription(collectedStyles);
      var applyPayload = {
        type: 'CUSTOMIZE_APPLY',
        selector: currentSelector,
        url: currentUrl,
        styles: collectedStyles,
        summary: currentSummary,
        description: desc
      };
      if (currentResumeEditId) {
        applyPayload.resumeEditId = currentResumeEditId;
      }
      chrome.runtime.sendMessage(applyPayload, function (resp) {
        if (chrome.runtime.lastError) {
          console.warn('[Customize-Panel] CUSTOMIZE_APPLY failed:', chrome.runtime.lastError.message);
          return;
        }
        if (resp && !resp.success) {
          notify('Apply failed: ' + (resp.error || 'unknown'));
        }
      });
    });
    actions.appendChild(applyBtn);

    dashboard.appendChild(actions);
    return dashboard;
  }

  function buildDescription(styles) {
    var keys = Object.keys(styles);
    if (!keys.length) return '';
    if (keys.length <= 3) return 'Changed ' + keys.join(', ');
    return 'Changed ' + keys.slice(0, 3).join(', ') + ' and ' + (keys.length - 3) + ' more';
  }

  function resetAllInputs(container) {
    var colors = container.querySelectorAll('.webedit-customize-color');
    for (var i = 0; i < colors.length; i++) {
      colors[i].dataset.empty = 'true';
    }
    var ranges = container.querySelectorAll('.webedit-customize-range');
    for (var j = 0; j < ranges.length; j++) {
      ranges[j].dataset.empty = 'true';
    }
    var displays = container.querySelectorAll('.webedit-customize-range-value');
    for (var k = 0; k < displays.length; k++) {
      displays[k].textContent = '—';
    }
    var selects = container.querySelectorAll('.webedit-customize-select');
    for (var l = 0; l < selects.length; l++) {
      selects[l].value = '';
    }
    var texts = container.querySelectorAll('.webedit-customize-text');
    for (var m = 0; m < texts.length; m++) {
      texts[m].value = '';
    }
  }

  // ─── Show / Hide ──────────────────────────────────────────────────────────

  function showDashboard(selector, summary, url, options) {
    hideDashboard();

    options = options || {};
    currentSelector = selector;
    currentUrl = url;
    currentSummary = summary;
    currentResumeEditId = options.resumeEditId || null;
    collectedStyles = Object.assign({}, options.initialStyles || {});

    dashboardEl = buildDashboard(selector, summary);
    syncInputsFromCollectedStyles(dashboardEl);
    schedulePreview();

    var mainContent = document.getElementById('webedit-main-content');
    if (mainContent) {
      mainContent.appendChild(dashboardEl);
    }

    var bottomControls = document.getElementById('webedit-bottom-controls');
    if (bottomControls) bottomControls.classList.add('hidden');
    var inputContainer = document.getElementById('webedit-input-container');
    if (inputContainer) inputContainer.classList.add('hidden');
    var chatMessages = document.getElementById('webedit-chat-messages');
    if (chatMessages) chatMessages.classList.add('hidden');
    var blueprintList = document.getElementById('webedit-blueprint-list');
    if (blueprintList) blueprintList.classList.add('hidden');
  }

  function hideDashboard() {
    if (dashboardEl) {
      try { dashboardEl.remove(); } catch (_) {}
      dashboardEl = null;
    }
    currentSelector = '';
    currentUrl = '';
    currentSummary = '';
    currentResumeEditId = null;
    collectedStyles = {};
    clearTimeout(previewDebounceTimer);

    var bottomControls = document.getElementById('webedit-bottom-controls');
    if (bottomControls) bottomControls.classList.remove('hidden');
    var inputContainer = document.getElementById('webedit-input-container');
    if (inputContainer) inputContainer.classList.remove('hidden');
    var chatMessages = document.getElementById('webedit-chat-messages');
    if (chatMessages) chatMessages.classList.remove('hidden');
    var blueprintList = document.getElementById('webedit-blueprint-list');
    if (blueprintList) blueprintList.classList.remove('hidden');
  }

  // ─── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'CUSTOMIZE_DASHBOARD_OPEN':
        showDashboard(message.selector, message.summary, message.url, {
          initialStyles: message.initialStyles || {},
          resumeEditId: message.resumeEditId || null
        });
        break;

      case 'CUSTOMIZE_COMPLETED': {
        hideDashboard();
        var text = 'Customization saved! You can review it in EditHistory.';
        if (message.syncFailed) {
          text = 'Customization saved locally — could not sync to cloud.';
        }
        notify(text);
        break;
      }

      case 'FLOW_STATE_CHANGED':
        if (message.state === 'IDLE' && dashboardEl) {
          hideDashboard();
        }
        if (message.state === 'PICKING' && message.feature === 'customize') {
          hideDashboard();
        }
        break;
    }
  });

  // ─── Expose API to sidepanel.js ────────────────────────────────────────────

  if (window.WebEditPanel) {
    window.WebEditPanel.openCustomizeDashboard = function (sel, sum, u, opts) {
      showDashboard(sel, sum, u, opts);
    };
    window.WebEditPanel.closeCustomizeDashboard = hideDashboard;
  }

})();
