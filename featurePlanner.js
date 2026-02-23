// WebEdit AI - Client-only Feature Planner (no-build safe)
// Returns {feature_type, targetSelector, parameters, confidence, warnings}

const FeaturePlanner = (() => {
  function normalizePrompt(prompt) {
    return String(prompt || "").trim();
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
          <ul class="${scopeClass}__list"></ul>
        </section>
      `,
      css: `
        .${scopeClass} { border:1px solid #d1d5db; border-radius:10px; padding:10px; background:#fff; }
        .${scopeClass}__toolbar { display:flex; justify-content:flex-end; margin-bottom:8px; }
        .${scopeClass}__new { border:1px solid #374151; background:#111827; color:#fff; border-radius:8px; padding:6px 10px; cursor:pointer; }
        .${scopeClass}__list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
        .${scopeClass}__item { border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#f9fafb; }
      `,
      js: `
        (function(){
          const root = document.querySelector('[data-webedit-folder-module="1"]');
          if (!root) return;
          const list = root.querySelector('.${scopeClass}__list');
          const button = root.querySelector('.${scopeClass}__new');
          if (!list || !button) return;
          button.addEventListener('click', function() {
            const name = prompt('Folder name', 'New folder');
            if (!name) return;
            const li = document.createElement('li');
            li.className = '${scopeClass}__item';
            li.textContent = name;
            list.appendChild(li);
          });
        })();
      `
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
        schemaVersion: "2"
      },
      confidence: generated.confidence,
      warnings: generated.warnings
    };

    if (generated.featureClass === "toggleTheme") {
      spec.behavior = {
        type: "toggleClass",
        triggerAttr: "data-webedit-ai-action",
        triggerValue: "toggle",
        targetSelector: "body",
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

  return { plan, generateModuleArtifacts, buildAddSpecFromModule };
})();

if (typeof window !== "undefined") {
  window.FeaturePlanner = FeaturePlanner;
  console.log("✅ FeaturePlanner loaded");
}

