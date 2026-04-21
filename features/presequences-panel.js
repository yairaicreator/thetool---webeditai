'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-sequences Panel  (file: features/presequences-panel.js)
//
// Pre-sequences are curated, ready-to-apply feature blueprints.
// Unlike user-generated "Add" features (which require picking an element and
// describing the feature), pre-sequences ship with a complete spec already
// written.  The user taps "Apply" once and the feature activates across every
// matching page — no element picking, no AI prompt required.
//
// HOW "APPLY ONCE" WORKS:
//   Pre-sequences store their blueprint under a URL pattern key
//   (e.g. "https://www.youtube.com/watch*") in chrome.storage.local under
//   "webedit_pattern_blueprints".  background.js merges pattern-matched
//   blueprints into the active blueprints for any tab whose URL matches the
//   pattern, so the feature appears automatically on every matching page
//   without the user having to do anything again.
//
// ADDING A NEW PRE-SEQUENCE:
//   1. Add an entry to PRE_SEQUENCES below.
//   2. If new ops are needed, add them to add-action-ops.js (KNOWN list) and
//      add-hands.js (execution case block) first.
//   3. If Chrome permissions are needed (e.g. clipboardWrite), declare them in
//      manifest.json before shipping.
// ═══════════════════════════════════════════════════════════════════════════════

(function () {

  // ── Pre-sequence definitions ─────────────────────────────────────────────────
  //
  // Each entry must have:
  //   id          — unique string (used as storage key)
  //   title       — short display name
  //   description — what it does, one sentence
  //   tags        — e.g. ['YouTube', 'Transcript']
  //   urlPattern  — glob-style pattern matched against tab URLs
  //                 (supports * as wildcard, e.g. "https://www.youtube.com/watch*")
  //   targetSelector — CSS selector on the host page to anchor the feature near
  //   position    — 'beforebegin' | 'afterend' | 'beforeend' | 'afterbegin'
  //   spec        — { html, css, actions } — identical to what the Add LLM produces

  var PRE_SEQUENCES = [
    {
      id: 'yt-transcript-copy',
      title: 'YouTube Transcript Copy Button',
      description: 'Adds a one-click Copy button to every YouTube transcript panel so you can copy the full transcript text instantly.',
      tags: ['YouTube', 'Transcript', 'Clipboard'],
      urlPattern: 'https://www.youtube.com/watch*',
      // Anchored next to the transcript container header
      targetSelector: 'ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      position: 'afterbegin',
      requiredComponents: [
        { type: 'chrome_permission', name: 'clipboardWrite', description: 'Required to write transcript text to the clipboard.' }
      ],
      spec: {
        html: [
          '<div class="we-yt-copy-bar">',
          '  <button class="we-yt-copy-btn" aria-label="Copy transcript">',
          '    <svg class="we-yt-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
          '    Copy transcript',
          '  </button>',
          '  <span class="we-yt-copy-status"></span>',
          '</div>'
        ].join(''),
        css: [
          '.we-yt-copy-bar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(0,0,0,0.03);border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0}',
          '.we-yt-copy-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid #c8c8c8;border-radius:18px;background:#fff;color:#0f0f0f;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:background 0.15s,border-color 0.15s}',
          '.we-yt-copy-btn:hover{background:#f2f2f2;border-color:#aaa}',
          '.we-yt-copy-btn:active{background:#e5e5e5}',
          '.we-yt-copy-icon{flex-shrink:0;pointer-events:none}',
          '.we-yt-copy-status{font-size:12px;color:#606060;min-width:48px}'
        ].join(''),
        actions: [
          {
            op: 'on',
            selector: '.we-yt-copy-btn',
            event: 'click',
            actions: [
              // Gather all transcript segment text lines from the host page.
              { op: 'pageQueryText', selector: 'ytd-transcript-segment-renderer yt-formatted-string', storageKey: 'we_yt_transcript', mode: 'all' },
              { op: 'copyFromStorage', key: 'we_yt_transcript' },
              { op: 'setText', selector: '.we-yt-copy-status', text: 'Copied!' },
              { op: 'delay', ms: 2500, actions: [
                { op: 'setText', selector: '.we-yt-copy-status', text: '' }
              ]}
            ]
          }
        ]
      }
    }
  ];

  // ── Storage helpers ───────────────────────────────────────────────────────────

  var PATTERN_STORAGE_KEY = 'webedit_pattern_blueprints';

  async function loadPatternBlueprints() {
    try {
      var result = await chrome.storage.local.get([PATTERN_STORAGE_KEY]);
      return result[PATTERN_STORAGE_KEY] || {};
    } catch (e) {
      console.warn('[Presequences] Failed to read pattern blueprints:', e.message);
      return {};
    }
  }

  async function savePatternBlueprints(store) {
    try {
      await chrome.storage.local.set({ [PATTERN_STORAGE_KEY]: store });
    } catch (e) {
      console.warn('[Presequences] Failed to save pattern blueprints:', e.message);
    }
  }

  async function isApplied(pseqId) {
    var store = await loadPatternBlueprints();
    return !!store[pseqId];
  }

  async function applyPresequence(pseq) {
    var store = await loadPatternBlueprints();
    store[pseq.id] = {
      id: pseq.id,
      title: pseq.title,
      urlPattern: pseq.urlPattern,
      targetSelector: pseq.targetSelector,
      position: pseq.position,
      action: 'add',
      status: 'active',
      payload: {
        targetSelector: pseq.targetSelector,
        html: pseq.spec.html,
        css: pseq.spec.css,
        actions: pseq.spec.actions,
        position: pseq.position || 'afterbegin',
        summary: pseq.title,
        description: pseq.description,
        isPresequence: true
      },
      appliedAt: new Date().toISOString()
    };
    await savePatternBlueprints(store);

    // Tell the Brain to re-dispatch blueprints for all matching open tabs.
    try {
      await chrome.runtime.sendMessage({ type: 'REAPPLY_PATTERN_BLUEPRINTS', pattern: pseq.urlPattern });
    } catch (_) {}
  }

  async function removePresequence(pseqId) {
    var store = await loadPatternBlueprints();
    delete store[pseqId];
    await savePatternBlueprints(store);
    try {
      await chrome.runtime.sendMessage({ type: 'REAPPLY_PATTERN_BLUEPRINTS', pattern: null });
    } catch (_) {}
  }

  // ── Render helpers ────────────────────────────────────────────────────────────

  function renderTag(text) {
    return '<span class="we-pseq-tag">' + escapeHtml(text) + '</span>';
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusIcon(applied) {
    return applied
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
      : '';
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  async function render() {
    var container = document.getElementById('webedit-presequences-view');
    if (!container) return;

    container.innerHTML = '<div class="we-pseq-loading">Loading pre-sequences…</div>';

    var store = await loadPatternBlueprints();

    var html = '';
    html += '<div class="we-pseq-shell">';
    html += '<div class="we-pseq-header">';
    html += '<h2 class="we-pseq-title">Pre-sequences</h2>';
    html += '<p class="we-pseq-subtitle">Ready-made features you apply once. They activate automatically on every matching page — no element picking, no AI prompt needed.</p>';
    html += '</div>';

    html += '<div class="we-pseq-list">';
    for (var i = 0; i < PRE_SEQUENCES.length; i++) {
      var p = PRE_SEQUENCES[i];
      var applied = !!store[p.id];
      html += '<div class="we-pseq-card' + (applied ? ' we-pseq-card-applied' : '') + '" data-pseq-id="' + escapeHtml(p.id) + '">';
      html += '<div class="we-pseq-card-top">';
      html += '<div class="we-pseq-card-info">';
      html += '<div class="we-pseq-card-title">' + escapeHtml(p.title) + '</div>';
      html += '<div class="we-pseq-card-tags">';
      for (var t = 0; t < p.tags.length; t++) html += renderTag(p.tags[t]);
      html += '</div>';
      html += '<p class="we-pseq-card-desc">' + escapeHtml(p.description) + '</p>';
      html += '</div>';
      html += '</div>';

      if (p.requiredComponents && p.requiredComponents.length) {
        html += '<div class="we-pseq-components">';
        html += '<span class="we-pseq-comp-label">Required:</span>';
        for (var c = 0; c < p.requiredComponents.length; c++) {
          var comp = p.requiredComponents[c];
          html += '<span class="we-pseq-comp-item" title="' + escapeHtml(comp.description) + '">';
          html += escapeHtml(comp.type === 'chrome_permission' ? '🔑 ' + comp.name : comp.name);
          html += '</span>';
        }
        html += '</div>';
      }

      html += '<div class="we-pseq-card-actions">';
      if (applied) {
        html += '<div class="we-pseq-applied-badge">' + statusIcon(true) + ' Applied</div>';
        html += '<button type="button" class="we-pseq-remove-btn" data-remove-id="' + escapeHtml(p.id) + '">Remove</button>';
      } else {
        html += '<button type="button" class="we-pseq-apply-btn" data-apply-id="' + escapeHtml(p.id) + '">';
        html += 'Apply once';
        html += '</button>';
      }
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';

    // ── Requested Features Log ────────────────────────────────────────────────
    html += '<div class="we-pseq-log-section">';
    html += '<h3 class="we-pseq-log-title">Requested Features</h3>';
    html += '<p class="we-pseq-log-desc">Features users tried to create that are not yet in a pre-sequence. Review the log to prioritize what to build next.</p>';
    html += '<button type="button" class="we-pseq-log-btn" id="we-pseq-show-log">View requested-feature log</button>';
    html += '<div class="we-pseq-log-output hidden" id="we-pseq-log-output"></div>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;

    // Event delegation
    container.addEventListener('click', function (e) {
      var applyBtn = e.target.closest('[data-apply-id]');
      if (applyBtn) {
        var id = applyBtn.getAttribute('data-apply-id');
        var pseq = PRE_SEQUENCES.find(function (p) { return p.id === id; });
        if (pseq) handleApply(pseq, applyBtn);
        return;
      }

      var removeBtn = e.target.closest('[data-remove-id]');
      if (removeBtn) {
        var rid = removeBtn.getAttribute('data-remove-id');
        handleRemove(rid, removeBtn);
        return;
      }

      var logBtn = e.target.closest('#we-pseq-show-log');
      if (logBtn) {
        showRequestedLog();
        return;
      }
    });
  }

  async function handleApply(pseq, btn) {
    btn.disabled = true;
    btn.textContent = 'Applying…';
    try {
      await applyPresequence(pseq);
      render(); // re-render to show applied state
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Apply once';
      console.error('[Presequences] Apply failed:', e.message);
    }
  }

  async function handleRemove(id, btn) {
    btn.disabled = true;
    try {
      await removePresequence(id);
      render();
    } catch (e) {
      btn.disabled = false;
    }
  }

  async function showRequestedLog() {
    var output = document.getElementById('we-pseq-log-output');
    var showBtn = document.getElementById('we-pseq-show-log');
    if (!output) return;

    output.classList.remove('hidden');
    if (showBtn) showBtn.classList.add('hidden');
    output.textContent = 'Loading log…';

    try {
      var log = await WebeditPresequenceLog.summary();
      if (!log || !log.length) {
        output.textContent = 'No requested features logged yet. When users try to describe features the AI cannot build, they appear here.';
        return;
      }
      var html = '<div class="we-pseq-log-entries">';
      for (var i = 0; i < log.length; i++) {
        var entry = log[i];
        html += '<div class="we-pseq-log-entry">';
        html += '<div class="we-pseq-log-entry-title">' + escapeHtml(entry.title || entry.prompt || 'Untitled feature') + '</div>';
        if (entry.description) {
          html += '<p class="we-pseq-log-entry-desc">' + escapeHtml(entry.description) + '</p>';
        }
        if (entry.missingOps && entry.missingOps.length) {
          html += '<div class="we-pseq-log-entry-missing"><strong>Missing ops:</strong> ' + entry.missingOps.map(function (o) { return '<code>' + escapeHtml(o) + '</code>'; }).join(', ') + '</div>';
        }
        if (entry.missingComponents && entry.missingComponents.length) {
          html += '<div class="we-pseq-log-entry-missing"><strong>Missing components:</strong> ' + entry.missingComponents.map(escapeHtml).join(', ') + '</div>';
        }
        if (entry.count > 1) {
          html += '<div class="we-pseq-log-entry-count">Requested ' + entry.count + ' times</div>';
        }
        html += '</div>';
      }
      html += '</div>';
      output.innerHTML = html;
    } catch (e) {
      output.textContent = 'Could not load log: ' + (e.message || 'unknown error');
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  window.WebEditPresequences = {
    render: render,
    getAll: function () { return PRE_SEQUENCES.slice(); },
    loadStore: loadPatternBlueprints
  };

})();
