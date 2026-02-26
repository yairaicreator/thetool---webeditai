// WebEdit AI - Client-only Feature Planner (no-build safe)
// Returns {feature_type, targetSelector, parameters, confidence, warnings}

const FeaturePlanner = (() => {
  const __WEBEDIT_PLANNER_VERSION = "planner-v2026-02-10-normalizePlannerString";
  // #region agent log
  fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'dd92ff'},body:JSON.stringify({sessionId:'dd92ff',runId:'normstr-debug-2',hypothesisId:'H6',location:'featurePlanner.js:moduleInit',message:'FeaturePlanner module evaluated',data:{plannerVersion:__WEBEDIT_PLANNER_VERSION,href:String(location.href||''),legacyNormalizeStringType:typeof normalizeString},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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

    const crossSurfaceHints = /(sidebar|header|footer|multiple sections|across page|across tabs|cross page|different areas)/i;
    const deepIntegrationHints = /(integrate|sync with|gemini internals|existing app state|server state|api integration|backend)/i;
    const dragDropHints = /(drag|drop|long press|long-press|reorder by drag|gesture)/i;
    const advancedRuntimeHints = /(virtualized|infinite list|keyboard shortcuts everywhere|global hotkey|background sync)/i;

    if (crossSurfaceHints.test(text)) reasons.push("cross_surface");
    if (deepIntegrationHints.test(text)) reasons.push("requires_internal_api");
    if (dragDropHints.test(text) && !isFolderRequest) reasons.push("requires_dragdrop");
    if (advancedRuntimeHints.test(text)) reasons.push("high_runtime_risk");
    if (score < (isFolderRequest ? 30 : 45)) reasons.push("low_page_capability");

    const classification = reasons.length ? "too_complex" : "supported";
    return {
      classification,
      reasons,
      score
    };
  }

  function proposeDecompositionSteps(prompt, reasons = []) {
    const steps = [];
    const text = normalizePrompt(prompt);
    const label = text || "your feature";

    steps.push(`Create a minimal working version of ${label} with one interactive action.`);
    steps.push("Add persistence for this core action so state survives reload.");
    if (reasons.includes("requires_dragdrop")) {
      steps.push("Replace drag/drop with a simple move action (e.g., select item then assign).");
    }
    if (reasons.includes("cross_surface")) {
      steps.push("Implement it in one page section first, then extend to other sections.");
    }
    if (reasons.includes("requires_internal_api")) {
      steps.push("Use extension-managed state first, then integrate with app APIs later if needed.");
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
    // #region agent log
    fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'dd92ff'},body:JSON.stringify({sessionId:'dd92ff',runId:'normstr-debug-1',hypothesisId:'H4',location:'featurePlanner.js:generateModuleArtifacts:entry',message:'Entered generateModuleArtifacts',data:{hasAnchor:!!anchorSelector,forcedClassRaw:String(options?.forcedFeatureClass||''),hasNormalizePlannerString:typeof normalizePlannerString==='function',legacyNormalizeStringType:typeof normalizeString},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const forcedClass = normalizePlannerString(options?.forcedFeatureClass || "");
    const routedClass = routeFeatureClass(prompt, context, capability);
    // #region agent log
    fetch('http://127.0.0.1:7745/ingest/6dbb3b4c-43d7-4544-a1cf-5ec2e0dc6c98',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'dd92ff'},body:JSON.stringify({sessionId:'dd92ff',runId:'normstr-debug-1',hypothesisId:'H4',location:'featurePlanner.js:generateModuleArtifacts:classRouting',message:'Resolved feature classes in generateModuleArtifacts',data:{forcedClass:String(forcedClass||''),routedClass:String(routedClass||'')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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

  return { plan, generateModuleArtifacts, buildAddSpecFromModule, classifyComplexity, proposeDecompositionSteps, routeFeatureClass, __plannerVersion: __WEBEDIT_PLANNER_VERSION };
})();

if (typeof window !== "undefined") {
  window.FeaturePlanner = FeaturePlanner;
  console.log("✅ FeaturePlanner loaded");
}

