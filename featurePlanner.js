// WebEdit AI - Client-only Feature Planner (no-build safe)
// Returns {feature_type, targetSelector, parameters, confidence, warnings}

const FeaturePlanner = (() => {
  function normalizePrompt(prompt) {
    return String(prompt || "").trim();
  }

  function normalizePlannerString(value) {
    return String(value || "").trim();
  }

  // Backward-compatible alias for any legacy planner path that still calls normalizeString.
  function normalizeString(value) {
    return normalizePlannerString(value);
  }

  function classifyComplexity(prompt, context, capability) {
    const text = normalizePrompt(prompt).toLowerCase();
    const reasons = [];
    const score = capability?.capabilityScore || 0;
    const isFolderRequest = /folder|organize chat|group chat|chat folder|new folder/.test(text);
    const parityHints = /(chatgpt projects|projects parity|same as chatgpt|native app parity|full parity|exact clone)/i;
    const serverSyncHints = /(sync across devices|server sync|account-wide|backend sync|database sync)/i;

    const crossSurfaceHints = /(sidebar|header|footer|multiple sections|across page|across tabs|cross page|different areas)/i;
    const deepIntegrationHints = /(integrate|sync with|gemini internals|existing app state|server state|api integration|backend)/i;
    const dragDropHints = /(drag|drop|long press|long-press|reorder by drag|gesture)/i;
    const advancedRuntimeHints = /(virtualized|infinite list|keyboard shortcuts everywhere|global hotkey|background sync)/i;

    if (crossSurfaceHints.test(text)) reasons.push("cross_surface");
    if (deepIntegrationHints.test(text)) reasons.push("requires_internal_api");
    if (dragDropHints.test(text) && !isFolderRequest) reasons.push("requires_dragdrop");
    if (advancedRuntimeHints.test(text)) reasons.push("high_runtime_risk");
    if (isFolderRequest && parityHints.test(text)) reasons.push("projects_parity_requested");
    if (isFolderRequest && serverSyncHints.test(text)) reasons.push("server_sync_required");
    if (score < (isFolderRequest ? 30 : 45)) reasons.push("low_page_capability");

    const classification = reasons.length ? "too_complex" : "supported";
    return {
      classification,
      reasons,
      score
    };
  }

  function proposeDecompositionSteps(prompt, reasons = []) {
    const text = normalizePrompt(prompt);
    const lower = text.toLowerCase();
    const compactLabel = (() => {
      if (!text) return "your feature";
      if (/folder|organize chat|group chat|chat folder|new folder/.test(lower)) {
        return "chat folders in the sidebar";
      }
      if (/dark mode|theme|night mode/.test(lower)) {
        return "a site-wide dark mode toggle";
      }
      const singleLine = text.replace(/\s+/g, " ").trim();
      return singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
    })();

    /** @type {{id:string,title:string,executionPrompt:string}[]} */
    const steps = [
      {
        id: "step_1_minimal",
        title: `Build a minimal working version of ${compactLabel}.`,
        executionPrompt: `Implement only step 1 for ${compactLabel}: create one minimal working UI with exactly one interaction. Do not add drag/drop, cross-section behavior, or advanced integrations yet.`
      },
      {
        id: "step_2_persistence",
        title: "Add persistence so this core interaction survives reload.",
        executionPrompt: `Implement only step 2 for ${compactLabel}: persist the current minimal feature state so it survives page refresh/reload. Keep existing behavior unchanged.`
      }
    ];

    if (reasons.includes("requires_dragdrop")) {
      steps.push({
        id: "step_dragdrop_simplify",
        title: "Replace drag/drop with select-then-assign interaction.",
        executionPrompt: `Implement only this step for ${compactLabel}: replace drag/drop with a simpler interaction (select item, then assign to target).`
      });
    }
    if (reasons.includes("cross_surface")) {
      steps.push({
        id: "step_scope_single_section",
        title: "Implement in one section first, then extend later.",
        executionPrompt: `Implement only this step for ${compactLabel}: apply the feature in one page section first and avoid cross-page/cross-section expansion.`
      });
    }
    if (reasons.includes("requires_internal_api")) {
      steps.push({
        id: "step_local_state_first",
        title: "Use extension-managed local state first.",
        executionPrompt: `Implement only this step for ${compactLabel}: use local extension-managed state only, without integrating internal app APIs yet.`
      });
    }
    if (reasons.includes("projects_parity_requested")) {
      steps.push({
        id: "step_projects_v1",
        title: "Ship a projects-like v1 with local folders and chat assignment.",
        executionPrompt: `Implement only this step for ${compactLabel}: local folders, select-to-assign chats, and reload persistence. Do not attempt full ChatGPT parity.`
      });
    }
    if (reasons.includes("server_sync_required")) {
      steps.push({
        id: "step_local_then_sync",
        title: "Keep v1 local-only; backend sync later.",
        executionPrompt: `Implement only this step for ${compactLabel}: keep v1 local-only and defer backend/server sync to a follow-up.`
      });
    }
    return steps.slice(0, 4);
  }

  function buildThemeToggleModule(anchorSelector, promptText) {
    const moduleId = `toggle-theme-${Date.now()}`;
    const scopeClass = `webedit-theme-module-${Date.now()}`;
    return {
      moduleId,
      title: "Theme Toggle",
      html: `
        <div class="${scopeClass}" data-webedit-theme-module="1">
          <button type="button" data-webedit-ai-action="toggle" class="${scopeClass}__btn" aria-pressed="false" aria-label="Toggle dark mode">
            🌙 Dark mode
          </button>
        </div>
      `,
      css: `
        .${scopeClass} { display:flex; justify-content:flex-end; margin:8px 0; }
        .${scopeClass}__btn {
          border:1px solid #334155; border-radius:999px; padding:6px 12px;
          background:#0f172a; color:#f8fafc; font-size:12px; cursor:pointer;
        }
        body.webedit-theme-dark {
          background:#0b1220 !important;
          color:#e2e8f0 !important;
        }
        body.webedit-theme-dark *,
        body.webedit-theme-dark *::before,
        body.webedit-theme-dark *::after {
          color: inherit;
        }
        body.webedit-theme-dark main,
        body.webedit-theme-dark section,
        body.webedit-theme-dark article,
        body.webedit-theme-dark aside,
        body.webedit-theme-dark nav,
        body.webedit-theme-dark div,
        body.webedit-theme-dark form,
        body.webedit-theme-dark header,
        body.webedit-theme-dark footer,
        body.webedit-theme-dark [role="main"],
        body.webedit-theme-dark [role="complementary"] {
          background-color:#0f172a !important;
          color:#e2e8f0 !important;
        }
        body.webedit-theme-dark a,
        body.webedit-theme-dark p,
        body.webedit-theme-dark span,
        body.webedit-theme-dark h1,
        body.webedit-theme-dark h2,
        body.webedit-theme-dark h3,
        body.webedit-theme-dark h4,
        body.webedit-theme-dark h5,
        body.webedit-theme-dark h6,
        body.webedit-theme-dark label,
        body.webedit-theme-dark li,
        body.webedit-theme-dark td,
        body.webedit-theme-dark th {
          color:#e2e8f0 !important;
        }
        body.webedit-theme-dark button,
        body.webedit-theme-dark input,
        body.webedit-theme-dark textarea,
        body.webedit-theme-dark select {
          background:#111827 !important;
          color:#e5e7eb !important;
          border-color:#334155 !important;
        }
        body.webedit-theme-dark [aria-selected="true"],
        body.webedit-theme-dark .active,
        body.webedit-theme-dark [data-active="true"] {
          background-color:#1f2937 !important;
          color:#f8fafc !important;
        }
      `,
      js: ""
      ,
      controller: "themeToggleController",
      stateSchema: {
        keys: ["enabled"],
        defaults: { enabled: false }
      }
    };
  }

  function extractFirstUrl(prompt) {
    const text = normalizePrompt(prompt);
    const match = text.match(/https?:\/\/[^\s)]+/i);
    if (match && match[0]) return match[0];
    if (/youtube|youtu\.be/i.test(text)) return "https://www.youtube.com/";
    return "";
  }

  function buildFolderModule(anchorSelector, promptText) {
    const scopeClass = `webedit-folder-module-${Date.now()}`;
    return {
      moduleId: `folder-system-${Date.now()}`,
      title: "Folder System",
      html: `
        <section class="${scopeClass}" data-webedit-folder-module="1">
          <div class="${scopeClass}__toolbar">
            <button type="button" class="${scopeClass}__new" data-webedit-folder-toggle-panel="1">New Folder+</button>
          </div>
          <div class="${scopeClass}__panel" data-webedit-folder-panel="1" hidden>
            <div class="${scopeClass}__source-wrap">
              <div class="${scopeClass}__label">Chats</div>
              <ul class="${scopeClass}__source" data-webedit-folder-source="1"></ul>
            </div>
            <div class="${scopeClass}__folders-wrap">
              <div class="${scopeClass}__label">Folders</div>
              <div class="${scopeClass}__list" data-webedit-folder-list="1"></div>
            </div>
          </div>
        </section>
      `,
      css: `
        .${scopeClass} { position:relative; display:flex; justify-content:flex-end; margin:6px 0; }
        .${scopeClass}__toolbar { display:flex; justify-content:flex-end; }
        .${scopeClass}__new {
          width:80px;
          min-width:80px;
          height:20px;
          border:1px solid #374151;
          background:#111827;
          color:#fff;
          border-radius:8px;
          padding:0 6px;
          cursor:pointer;
          font-size:11px;
          line-height:18px;
          text-align:center;
        }
        .${scopeClass}__panel {
          position:absolute;
          top:26px;
          right:0;
          width:min(440px, 92vw);
          border:1px solid #d1d5db;
          border-radius:10px;
          padding:10px;
          background:#fff;
          box-shadow:0 10px 24px rgba(15, 23, 42, 0.16);
          z-index:2147483647;
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:8px;
        }
        .${scopeClass}__label { font-size:12px; font-weight:600; color:#374151; margin-bottom:6px; }
        .${scopeClass}__source { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; min-height:120px; max-height:280px; overflow:auto; }
        .${scopeClass}__source-item { border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#f9fafb; cursor:pointer; user-select:none; }
        .${scopeClass}__list { display:flex; flex-direction:column; gap:8px; min-height:120px; }
        .${scopeClass}__folder { border:1px solid #d1d5db; border-radius:8px; background:#f8fafc; }
        .${scopeClass}__folder-head { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:7px 8px; }
        .${scopeClass}__folder-toggle { border:none; background:transparent; cursor:pointer; font-weight:600; color:#111827; text-align:left; flex:1; }
        .${scopeClass}__folder-rename { border:none; background:transparent; font-size:12px; color:#2563eb; cursor:pointer; }
        .${scopeClass}__folder-delete { border:none; background:transparent; font-size:12px; color:#dc2626; cursor:pointer; }
        .${scopeClass}__drop { border-top:1px dashed #cbd5e1; padding:8px; min-height:40px; display:flex; flex-direction:column; gap:6px; }
        .${scopeClass}__drop-empty { color:#94a3b8; font-size:12px; }
        .${scopeClass}__chip { border:1px solid #bfdbfe; border-radius:999px; background:#eff6ff; color:#1e3a8a; padding:4px 8px; font-size:12px; display:inline-flex; width:fit-content; }
        .webedit-folder { border:1px solid #d1d5db; border-radius:8px; background:#f8fafc; }
        .webedit-folder-head { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:7px 8px; }
        .webedit-folder-toggle { border:none; background:transparent; cursor:pointer; font-weight:600; color:#111827; text-align:left; flex:1; }
        .webedit-folder-rename { border:none; background:transparent; font-size:12px; color:#2563eb; cursor:pointer; }
        .webedit-folder-delete { border:none; background:transparent; font-size:12px; color:#dc2626; cursor:pointer; }
        .webedit-folder-drop { border-top:1px dashed #cbd5e1; padding:8px; min-height:40px; display:flex; flex-direction:column; gap:6px; }
        .webedit-folder-drop-empty { color:#94a3b8; font-size:12px; }
        .webedit-folder-source-item { border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#f9fafb; cursor:pointer; user-select:none; }
        .webedit-folder-chip { border:1px solid #bfdbfe; border-radius:999px; background:#eff6ff; color:#1e3a8a; padding:4px 8px; font-size:12px; display:inline-flex; width:fit-content; cursor:pointer; }
      `,
      js: "",
      controller: "folderGeminiController",
      config: {
        scopeClass
      },
      stateSchema: {
        keys: ["folders", "assignments"],
        defaults: { folders: [], assignments: {} }
      }
    };
  }

  function generateModuleArtifacts(prompt, context, capability, options = {}) {
    const text = normalizePrompt(prompt).toLowerCase();
    const anchorSelector = context?.selector || context?.anchorElement?.selector || "";
    const warnings = [];
    const forcedClass = normalizePlannerString(options?.forcedFeatureClass || "");
    const routedClass = routeFeatureClass(prompt, context, capability);
    let featureClass = forcedClass || routedClass || "genericAdd";
    let module = null;

    if (featureClass === "toggleTheme" || /dark mode|theme|night mode|toggle theme/.test(text)) {
      featureClass = "toggleTheme";
      module = buildThemeToggleModule(anchorSelector, text);
    } else if (featureClass === "folderSystem" || /folder|organize chat|drag|drop|group chat/.test(text)) {
      featureClass = "folderSystem";
      module = buildFolderModule(anchorSelector, text);
    } else if (featureClass === "linkCard" || /link|url|youtube|cta|button/.test(text)) {
      const href = extractFirstUrl(prompt);
      const safeHref = href || "https://example.com/";
      featureClass = "linkCard";
      module = {
        moduleId: `link-card-${Date.now()}`,
        title: "Quick Link",
        html: `
          <div data-webedit-generated-module="1" style="border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#f8fafc;display:flex;align-items:center;gap:8px;">
            <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:6px;background:#111827;color:#fff;border-radius:8px;padding:6px 10px;text-decoration:none;font-size:13px;font-weight:600;">
              Open Link
            </a>
            <span style="font-size:12px;color:#334155;overflow-wrap:anywhere;">${safeHref}</span>
          </div>
        `,
        css: "",
        js: ""
      };
    } else {
      module = {
        moduleId: `generic-module-${Date.now()}`,
        title: "Generated Feature",
        html: `<div data-webedit-generated-module="1">Feature request: ${normalizePrompt(prompt)}</div>`,
        css: `div[data-webedit-generated-module="1"]{border:1px dashed #94a3b8;padding:8px;border-radius:8px;background:#f8fafc}`,
        js: ""
      };
      warnings.push("Generated a basic scaffold. Refine with specific interactions for richer behavior.");
    }

    if ((capability?.capabilityScore || 0) < 45) {
      warnings.push("Low page capability score. Preview may be simplified.");
    }

    return {
      ok: true,
      featureClass,
      confidence: featureClass === "genericAdd" ? 0.55 : 0.82,
      warnings,
      module
    };
  }

  function routeFeatureClass(prompt, context, capability) {
    const text = normalizePrompt(prompt).toLowerCase();
    if (/dark mode|theme|night mode|toggle theme/.test(text)) return "toggleTheme";
    if (/folder|organize chat|drag|drop|group chat/.test(text)) return "folderSystem";
    if (/link|url|youtube|cta|button/.test(text)) return "linkCard";
    return "genericAdd";
  }

  function buildAddSpecFromModule(prompt, context, capability, options = {}) {
    const complexity = classifyComplexity(prompt, context, capability);
    if (complexity.classification === "too_complex") {
      return {
        ok: false,
        stage: "complexity",
        code: "too_complex",
        error: "This request is too complex for one reliable step.",
        complexity,
        decompositionSteps: proposeDecompositionSteps(prompt, complexity.reasons)
      };
    }

    const generated = generateModuleArtifacts(prompt, context, capability, {
      forcedFeatureClass: options?.forcedFeatureClass || ""
    });
    if (!generated.ok) return generated;
    const selector = context?.selector || context?.anchorElement?.selector || "";
    if (!selector) {
      return { ok: false, error: "No anchor selector available for Add feature" };
    }
    const stateKey = `webedit-module-state::${location.hostname}${location.pathname}`;
    const spec = {
      action: "add",
      selector,
      targetSelector: selector,
      position: "inside",
      html: generated.module?.html || "",
      css: generated.module?.css || "",
      js: generated.module?.js || "",
      generated_module: generated.module,
      ui_components: {
        type: generated.featureClass,
        slots: ["header", "body"],
        notes: "Generated by FeaturePlanner module pipeline"
      },
      state_model: {
        type: "local",
        keys: ["expanded", "items"],
        transitions: [{ from: "idle", to: "active", on: "user_action" }]
      },
      events: [
        { name: "click", target: selector, handler: "moduleController" }
      ],
      data_bindings: [
        { source: "state.items", target: "dom.list", transform: "renderList" }
      ],
      persistence: {
        scope: "page",
        storage: "chrome.storage.local",
        key: stateKey,
        migrationVersion: "2"
      },
      accessibility: {
        ariaLabels: ["Toggle dark mode", "Add folder"],
        keyboardSupport: "enter-space"
      },
      undo_strategy: {
        mode: "dom-revert",
        preserveStateKeys: ["expanded"]
      },
      selectors: {
        anchor: selector,
        fallback: []
      },
      validation: {
        tests: [
          { type: "selectorExists", selector: "[data-webedit-preview-target='1']" }
        ],
        required: ["html_rendered"]
      },
      metadata: {
        stage: "codegen",
        schemaVersion: "2",
        complexity: complexity
      },
      confidence: generated.confidence,
      warnings: generated.warnings
    };

    if (generated.featureClass === "toggleTheme") {
      spec.behavior = {
        type: "toggleClass",
        triggerAttr: "data-webedit-ai-action",
        triggerValue: "toggle",
        targetSelector: "body, [data-webedit-preview-target='1']",
        className: "webedit-theme-dark",
        expandedLabel: "Dark mode on",
        collapsedLabel: "Dark mode off"
      };
    }
    if (generated.featureClass === "folderSystem") {
      spec.generated_module = {
        ...(spec.generated_module || {}),
        controller: "folderGeminiController",
        requiredDataAttributes: [
          "data-webedit-folder-module",
          "data-webedit-folder-source",
          "data-webedit-folder-list",
          "data-webedit-folder-panel"
        ],
        interactionModel: "select-chat-then-click-folder"
      };
      spec.metadata = {
        ...(spec.metadata || {}),
        contract: "folder_v1_deterministic"
      };
      const tests = Array.isArray(spec.validation?.tests) ? spec.validation.tests : [];
      tests.push(
        { type: "selectorExists", selector: "[data-webedit-folder-module='1']" },
        { type: "selectorExists", selector: "[data-webedit-folder-source='1']" },
        { type: "selectorExists", selector: "[data-webedit-folder-list='1']" }
      );
      spec.validation = {
        ...(spec.validation || {}),
        tests,
        required: Array.from(new Set([...(spec.validation?.required || []), "folder_contract_ready"]))
      };
    }

    return { ok: true, spec, confidence: generated.confidence, warnings: generated.warnings };
  }

  function plan(prompt, context) {
    const text = (prompt || "").toLowerCase();
    const targetSelector = context?.selector || "";
    const warnings = [];
    let feature_type = "";
    let parameters = {};
    let confidence = 0.35;

    if (/hide|remove|dismiss/.test(text)) {
      feature_type = "HideElement";
      confidence = 0.7;
    } else if (/sticky|pin|stick/.test(text)) {
      feature_type = "StickyElement";
      parameters = { top: "0px" };
      confidence = 0.65;
    } else if (/move up|move higher|up one/.test(text)) {
      feature_type = "MoveElement";
      parameters = { direction: "up" };
      confidence = 0.6;
    } else if (/move down|lower|down one/.test(text)) {
      feature_type = "MoveElement";
      parameters = { direction: "down" };
      confidence = 0.6;
    } else if (/resize|expand|maximize|full screen|fullscreen/.test(text)) {
      feature_type = "ResizablePanel";
      parameters = { mode: "fullscreen", zIndex: "2147483647" };
      confidence = 0.72;
    } else {
      feature_type = "ResizablePanel";
      parameters = { mode: "custom" };
      warnings.push("Planner confidence is low; please refine parameters.");
    }

    if (!targetSelector) {
      warnings.push("No target selector provided; pick an element first.");
    }

    return { feature_type, targetSelector, parameters, confidence, warnings };
  }

  return { plan, generateModuleArtifacts, buildAddSpecFromModule, classifyComplexity, proposeDecompositionSteps, routeFeatureClass };
})();

if (typeof window !== "undefined") {
  window.FeaturePlanner = FeaturePlanner;
  console.log("✅ FeaturePlanner loaded");
}

