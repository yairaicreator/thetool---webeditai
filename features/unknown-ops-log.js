'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// WebEdit AI — Unknown Ops Logger  (file: unknown-ops-log.js)
//
// Imported by background.js BEFORE add-brain.js.
// Exports: WebeditUnknownOpsLog (also aliased as WebeditOpsLog)
//
// PURPOSE:
//   Every time the LLM generates a spec containing op names that do not exist
//   in the vocabulary, this module records the incident to chrome.storage.local.
//   Over time this builds a complete picture of which ops the LLM keeps trying
//   to invent — telling you exactly which aliases to add to add-action-ops.js
//   or which new case blocks to write in add-hands.js.
//
// HOW TO READ THE LOG (run in service worker DevTools console):
//
//   // See all entries, newest first:
//   WebeditOpsLog.read().then(log => console.table(log))
//
//   // See frequency ranking — which ops are invented most often:
//   WebeditOpsLog.summary().then(s => console.table(s))
//
//   // Export as JSON string to share with a developer:
//   WebeditOpsLog.exportJson().then(s => console.log(s))
//
//   // Clear the log:
//   WebeditOpsLog.clear()
//
// STORAGE KEY:  'webedit_unknown_ops_log'
// MAX ENTRIES:  500 (oldest entries are dropped when the cap is reached)
// ═══════════════════════════════════════════════════════════════════════════════

var WebeditUnknownOpsLog = (function () {

  var STORAGE_KEY = 'webedit_unknown_ops_log';
  var MAX_ENTRIES = 500;

  // ── record(unknownOps, context) ──────────────────────────────────────────────
  // Called by webeditEmitSpecValidationWarnings in add-brain.js.
  //
  // unknownOps — array of op name strings the LLM invented
  // context    — object with:
  //   userPrompt:  the text the user typed when requesting the feature
  //   pageUrl:     the URL of the page the feature was being added to
  //   fullActions: the complete actions array from the spec (for deeper analysis)

  async function record(unknownOps, context) {
    if (!Array.isArray(unknownOps) || unknownOps.length === 0) return;

    var ctx = context && typeof context === 'object' ? context : {};
    var entry = {
      // ISO timestamp so entries sort chronologically in the log.
      timestamp: new Date().toISOString(),

      // The user's original request. Seeing "make a copy button" next to the
      // invented op "copyElement" tells you users need copy and the LLM calls
      // it "copyElement" — so that is the alias to add.
      prompt: String(ctx.userPrompt || '').trim().slice(0, 300),

      // The page where this happened — helps identify site-specific patterns.
      pageUrl: String(ctx.pageUrl || '').trim().slice(0, 200),

      // The exact op names the LLM invented. These are what need either an
      // alias entry in add-action-ops.js or a new case block in add-hands.js.
      unknownOps: unknownOps.slice(),

      // The full actions array — useful for seeing the complete context of how
      // the LLM was trying to use the unknown op.
      fullActions: Array.isArray(ctx.fullActions)
        ? JSON.stringify(ctx.fullActions).slice(0, 2000)
        : ''
    };

    try {
      var result = await chrome.storage.local.get([STORAGE_KEY]);
      var log = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

      // Prepend newest entry at the front — read() returns newest-first.
      log.unshift(entry);

      // Cap at MAX_ENTRIES — drop oldest entries from the tail.
      if (log.length > MAX_ENTRIES) {
        log = log.slice(0, MAX_ENTRIES);
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: log });
    } catch (e) {
      // Never crash the main flow over a logging failure.
      console.warn('[OpsLog] Failed to write entry:', e && e.message);
    }
  }

  // ── read() ───────────────────────────────────────────────────────────────────
  // Returns the full log array, newest-first.

  async function read() {
    try {
      var result = await chrome.storage.local.get([STORAGE_KEY]);
      return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    } catch (e) {
      console.warn('[OpsLog] Failed to read log:', e && e.message);
      return [];
    }
  }

  // ── summary() ────────────────────────────────────────────────────────────────
  // Returns frequency ranking of invented ops, highest count first.
  // Format: [{ op: 'setClassName', count: 14, examplePrompts: ['...', '...'] }]
  //
  // This is the most useful view. The top 5 entries tell you exactly which
  // aliases or new ops to prioritize adding next.

  async function summary() {
    var log = await read();
    var counts = {};
    var prompts = {};

    log.forEach(function (entry) {
      (entry.unknownOps || []).forEach(function (op) {
        counts[op] = (counts[op] || 0) + 1;
        if (!prompts[op]) prompts[op] = [];
        if (prompts[op].length < 3 && entry.prompt) {
          if (prompts[op].indexOf(entry.prompt) === -1) {
            prompts[op].push(entry.prompt);
          }
        }
      });
    });

    return Object.keys(counts)
      .map(function (op) {
        return {
          op: op,
          count: counts[op],
          examplePrompts: prompts[op] || []
        };
      })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // ── clear() ──────────────────────────────────────────────────────────────────

  async function clear() {
    try {
      await chrome.storage.local.remove(STORAGE_KEY);
      console.log('[OpsLog] Log cleared.');
    } catch (e) {
      console.warn('[OpsLog] Failed to clear log:', e && e.message);
    }
  }

  // ── exportJson() ─────────────────────────────────────────────────────────────
  // Returns the full log as a formatted JSON string for sharing.

  async function exportJson() {
    var log = await read();
    return JSON.stringify(log, null, 2);
  }

  return {
    record: record,
    read: read,
    summary: summary,
    clear: clear,
    exportJson: exportJson
  };

})();

// Also expose as WebeditOpsLog — shorter alias for console use.
var WebeditOpsLog = WebeditUnknownOpsLog;
