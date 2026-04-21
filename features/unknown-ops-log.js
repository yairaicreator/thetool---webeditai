'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// WebEdit AI — Pre-sequence Request Log  (file: features/unknown-ops-log.js)
//
// Imported by background.js BEFORE add-brain.js.
// Exports: WebeditUnknownOpsLog (also aliased as WebeditOpsLog, WebeditPresequenceLog)
//
// ── PURPOSE ──────────────────────────────────────────────────────────────────
//
// Every time the LLM generates a spec that contains unsupported op names, OR the
// user requests a feature that the extension cannot yet build, this module
// records the incident.  Over time, the log becomes a prioritized roadmap of:
//
//   MISSING OPS        — op names to add to add-action-ops.js KNOWN list and
//                        add-hands.js execution engine.
//   MISSING COMMANDS   — new actions beyond what LLM ops cover (e.g. fetch, WebSockets).
//   MISSING COMPONENTS — external requirements: Chrome permissions, Supabase tables,
//                        content-script injected APIs, etc.
//   FEATURE REQUESTS   — the user's original request and a plain-language
//                        description of what the feature is supposed to do.
//
// Each entry is a candidate Pre-sequence.  When the missing pieces are added,
// the entry can be promoted to a ready-to-ship pre-sequence in presequences-panel.js.
//
// ── HOW TO WRITE NEW OPS/COMMANDS DIRECTLY TO THE VOCABULARY ─────────────────
//
//   When the summary() output shows a frequently-invented op name, the fix is:
//
//   (a) ALIAS (no new behavior):
//       Open features/add-action-ops.js → ALIASES table → add the entry.
//       Example: 'scrollToTop': 'scrollTo'
//
//   (b) NEW OP (new behavior needed):
//       1. Add to features/add-action-ops.js → KNOWN array.
//       2. Add a case block to features/add-hands.js.
//       3. Add a vocabulary line to WEBEDIT_VOCAB_REFERENCE in features/add-brain.js.
//       That's it — the LLM will start using it in new feature requests.
//
//   (c) NEW CHROME PERMISSION:
//       Add to manifest.json "permissions" array and document in MISSING COMPONENTS.
//
// ── HOW TO READ THE LOG (in the service worker DevTools console) ──────────────
//
//   WebeditOpsLog.read().then(log => console.table(log))
//   WebeditOpsLog.summary().then(s => console.table(s))
//   WebeditOpsLog.exportJson().then(s => console.log(s))
//   WebeditOpsLog.clear()
//
// STORAGE KEY:  'webedit_unknown_ops_log'
// MAX ENTRIES:  500 (oldest dropped when cap is reached)
// ═══════════════════════════════════════════════════════════════════════════════

var WebeditUnknownOpsLog = (function () {

  var STORAGE_KEY = 'webedit_unknown_ops_log';
  var MAX_ENTRIES = 500;

  // ── record(unknownOps, context) ──────────────────────────────────────────────
  //
  // unknownOps — array of op name strings the LLM invented
  // context    — {
  //   userPrompt:        the text the user typed (the feature title / request)
  //   pageUrl:           URL of the page the feature was being added to
  //   fullActions:       the complete actions[] array from the generated spec
  //   featureDescription (optional): plain-language explanation of what the
  //                      feature should do (derived from userPrompt if omitted)
  //   missingCommands    (optional): string[] — capabilities beyond LLM ops
  //                      e.g. ['fetch API', 'WebSocket', 'DOM custom events']
  //   missingComponents  (optional): string[] — external requirements
  //                      e.g. ['chrome permission: clipboardWrite',
  //                            'Supabase table: user_bookmarks',
  //                            'content-script: YouTube API hook']
  // }

  async function record(unknownOps, context) {
    if (!Array.isArray(unknownOps) || unknownOps.length === 0) return;

    var ctx = context && typeof context === 'object' ? context : {};
    var prompt = String(ctx.userPrompt || '').trim().slice(0, 300);

    var entry = {
      // ISO timestamp — entries sort chronologically.
      timestamp: new Date().toISOString(),

      // ── Feature identity ─────────────────────────────────────────────────
      // "title" is the user's request, treated as the feature name.
      // "description" is what the feature is supposed to do — the LLM's intent.
      // Having both lets us later write a proper pre-sequence description.
      title: prompt,
      description: String(ctx.featureDescription || prompt).trim().slice(0, 500),

      // The page where this happened — helps identify site-specific patterns.
      pageUrl: String(ctx.pageUrl || '').trim().slice(0, 200),

      // ── Missing pieces ────────────────────────────────────────────────────
      // missingOps       — op names the LLM invented that don't exist in KNOWN.
      //                    These go into add-action-ops.js + add-hands.js.
      missingOps: unknownOps.slice(),

      // missingCommands  — runtime capabilities missing from the ops vocabulary.
      //                    Requires new code, not just a new alias.
      missingCommands: Array.isArray(ctx.missingCommands) ? ctx.missingCommands.slice() : [],

      // missingComponents — external requirements (Chrome permissions, DBs, etc.)
      //                    Must be resolved before a pre-sequence can be shipped.
      missingComponents: Array.isArray(ctx.missingComponents) ? ctx.missingComponents.slice() : [],

      // Full spec actions — see the complete context of how the op was being used.
      fullActions: Array.isArray(ctx.fullActions)
        ? JSON.stringify(ctx.fullActions).slice(0, 2000)
        : ''
    };

    try {
      var result = await chrome.storage.local.get([STORAGE_KEY]);
      var log = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

      // Prepend newest entry — read() returns newest-first.
      log.unshift(entry);

      if (log.length > MAX_ENTRIES) {
        log = log.slice(0, MAX_ENTRIES);
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: log });
    } catch (e) {
      console.warn('[OpsLog] Failed to write entry:', e && e.message);
    }
  }

  // ── read() ───────────────────────────────────────────────────────────────────

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
  //
  // Returns a list of feature request entries, each enriched with:
  //   count          — how many times the same feature was attempted
  //   missingOps     — deduplicated list of unknown ops across all attempts
  //   missingCommands / missingComponents — merged from all attempts
  //   exampleTitles  — up to 3 distinct user-typed titles for the feature
  //
  // Grouped by normalized feature title for easy review.
  // Highest-count entries = highest priority for building as a pre-sequence.

  async function summary() {
    var log = await read();
    var byTitle = {};

    log.forEach(function (entry) {
      // Normalize to a simple grouping key.
      var key = (entry.title || entry.prompt || 'unknown').toLowerCase().trim().slice(0, 80);
      if (!byTitle[key]) {
        byTitle[key] = {
          title: entry.title || entry.prompt || 'Unknown feature',
          description: entry.description || '',
          count: 0,
          missingOps: [],
          missingCommands: [],
          missingComponents: [],
          exampleTitles: []
        };
      }
      var g = byTitle[key];
      g.count += 1;

      // Merge missing ops (deduplicate).
      (entry.missingOps || []).forEach(function (op) {
        if (g.missingOps.indexOf(op) === -1) g.missingOps.push(op);
      });

      // Merge missing commands.
      (entry.missingCommands || []).forEach(function (cmd) {
        if (g.missingCommands.indexOf(cmd) === -1) g.missingCommands.push(cmd);
      });

      // Merge missing components.
      (entry.missingComponents || []).forEach(function (comp) {
        if (g.missingComponents.indexOf(comp) === -1) g.missingComponents.push(comp);
      });

      // Collect example user-typed titles.
      var t = (entry.title || '').trim();
      if (t && g.exampleTitles.indexOf(t) === -1 && g.exampleTitles.length < 3) {
        g.exampleTitles.push(t);
      }
    });

    return Object.values(byTitle).sort(function (a, b) { return b.count - a.count; });
  }

  // ── Legacy: per-op frequency ranking ─────────────────────────────────────────
  //
  // Returns [ { op, count, examplePrompts } ] — still useful for quickly seeing
  // which single ops to add as aliases.

  async function opFrequency() {
    var log = await read();
    var counts = {};
    var prompts = {};

    log.forEach(function (entry) {
      (entry.missingOps || entry.unknownOps || []).forEach(function (op) {
        counts[op] = (counts[op] || 0) + 1;
        if (!prompts[op]) prompts[op] = [];
        if (prompts[op].length < 3 && entry.title) {
          if (prompts[op].indexOf(entry.title) === -1) {
            prompts[op].push(entry.title);
          }
        }
      });
    });

    return Object.keys(counts)
      .map(function (op) {
        return { op: op, count: counts[op], examplePrompts: prompts[op] || [] };
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

  async function exportJson() {
    var log = await read();
    return JSON.stringify(log, null, 2);
  }

  return {
    record: record,
    read: read,
    summary: summary,
    opFrequency: opFrequency,
    clear: clear,
    exportJson: exportJson
  };

})();

// Shorter aliases for console use and panel module access.
var WebeditOpsLog = WebeditUnknownOpsLog;
var WebeditPresequenceLog = WebeditUnknownOpsLog;
