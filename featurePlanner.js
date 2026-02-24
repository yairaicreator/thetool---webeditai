// WebEdit AI - Client-only Feature Planner (no-build safe)
// Returns {feature_type, targetSelector, parameters, confidence, warnings}

const FeaturePlanner = (() => {
  function normalizePrompt(prompt) {
    return String(prompt || "").trim();
  }

  function classifyComplexity(prompt, context, capability) {
    const text = normalizePrompt(prompt).toLowerCase();
    const reasons = [];
    const score = capability?.capabilityScore || 0;

    const crossSurfaceHints = /(sidebar|header|footer|multiple sections|across page|across tabs|cross page|different areas)/i;
    const deepIntegrationHints = /(integrate|sync with|gemini internals|existing app state|server state|api integration|backend)/i;
    const dragDropHints = /(drag|drop|long press|long-press|reorder by drag|gesture)/i;
    const advancedRuntimeHints = /(virtualized|infinite list|keyboard shortcuts everywhere|global hotkey|background sync)/i;

    if (crossSurfaceHints.test(text)) reasons.push("cross_surface");
    if (deepIntegrationHints.test(text)) reasons.push("requires_internal_api");
    if (dragDropHints.test(text)) reasons.push("requires_dragdrop");
    if (advancedRuntimeHints.test(text)) reasons.push("high_runtime_risk");
    if (score < 45) reasons.push("low_page_capability");

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

  function buildFolderModule(anchorSelector, promptText) {
    const scopeClass = `webedit-folder-module-${Date.now()}`;
    return {
      moduleId: `folder-system-${Date.now()}`,
      title: "Folder System",
      html: `
        <section class="${scopeClass}" data-webedit-folder-module="1">
          <div class="${scopeClass}__toolbar">
            <button type="button" class="${scopeClass}__new">+ Folder</button>
          </div>
          <div class="${scopeClass}__columns">
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
        .${scopeClass} { border:1px solid #d1d5db; border-radius:10px; padding:10px; background:#fff; }
        .${scopeClass}__toolbar { display:flex; justify-content:flex-end; margin-bottom:8px; }
        .${scopeClass}__new { border:1px solid #374151; background:#111827; color:#fff; border-radius:8px; padding:6px 10px; cursor:pointer; }
        .${scopeClass}__columns { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .${scopeClass}__label { font-size:12px; font-weight:600; color:#374151; margin-bottom:6px; }
        .${scopeClass}__source { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; min-height:120px; max-height:280px; overflow:auto; }
        .${scopeClass}__source-item { border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#f9fafb; cursor:grab; }
        .${scopeClass}__list { display:flex; flex-direction:column; gap:8px; min-height:120px; }
        .${scopeClass}__folder { border:1px solid #d1d5db; border-radius:8px; background:#f8fafc; }
        .${scopeClass}__folder-head { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:7px 8px; }
        .${scopeClass}__folder-toggle { border:none; background:transparent; cursor:pointer; font-weight:600; color:#111827; text-align:left; flex:1; }
        .${scopeClass}__folder-rename { border:none; background:transparent; font-size:12px; color:#2563eb; cursor:pointer; }
        .${scopeClass}__drop { border-top:1px dashed #cbd5e1; padding:8px; min-height:40px; display:flex; flex-direction:column; gap:6px; }
        .${scopeClass}__drop-empty { color:#94a3b8; font-size:12px; }
        .${scopeClass}__chip { border:1px solid #bfdbfe; border-radius:999px; background:#eff6ff; color:#1e3a8a; padding:4px 8px; font-size:12px; display:inline-flex; width:fit-content; }
        .webedit-folder { border:1px solid #d1d5db; border-radius:8px; background:#f8fafc; }
        .webedit-folder-head { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:7px 8px; }
        .webedit-folder-toggle { border:none; background:transparent; cursor:pointer; font-weight:600; color:#111827; text-align:left; flex:1; }
        .webedit-folder-rename { border:none; background:transparent; font-size:12px; color:#2563eb; cursor:pointer; }
        .webedit-folder-drop { border-top:1px dashed #cbd5e1; padding:8px; min-height:40px; display:flex; flex-direction:column; gap:6px; }
        .webedit-folder-drop-empty { color:#94a3b8; font-size:12px; }
        .webedit-folder-source-item { border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#f9fafb; cursor:grab; }
        .webedit-folder-chip { border:1px solid #bfdbfe; border-radius:999px; background:#eff6ff; color:#1e3a8a; padding:4px 8px; font-size:12px; display:inline-flex; width:fit-content; cursor:grab; }
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

  function generateModuleArtifacts(prompt, context, capability) {
    const text = normalizePrompt(prompt).toLowerCase();
    const anchorSelector = context?.selector || context?.anchorElement?.selector || "";
    const warnings = [];
    let featureClass = "genericAdd";
    let module = null;

    if (/dark mode|theme|night mode|toggle theme/.test(text)) {
      featureClass = "toggleTheme";
      module = buildThemeToggleModule(anchorSelector, text);
    } else if (/folder|organize chat|drag|drop|group chat/.test(text)) {
      featureClass = "folderSystem";
      module = buildFolderModule(anchorSelector, text);
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

  function buildAddSpecFromModule(prompt, context, capability) {
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

    const generated = generateModuleArtifacts(prompt, context, capability);
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

  return { plan, generateModuleArtifacts, buildAddSpecFromModule, classifyComplexity, proposeDecompositionSteps };
})();

if (typeof window !== "undefined") {
  window.FeaturePlanner = FeaturePlanner;
  console.log("✅ FeaturePlanner loaded");
}

