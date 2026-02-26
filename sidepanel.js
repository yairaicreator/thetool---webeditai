// WebEdit AI Side Panel UI (Chrome Side Panel)
// Implements the full panel UI and relays actions to the active tab content script.

(() => {
  const els = {
    headerHamburger: document.getElementById("webedit-header-hamburger"),
    homeBtn: document.getElementById("webedit-home-btn"),
    signinBtn: document.getElementById("webedit-signin-btn"),
    authGuard: document.getElementById("webedit-auth-guard"),
    authGuardTitle: document.getElementById("webedit-auth-guard-title"),
    authGuardMessage: document.getElementById("webedit-auth-guard-message"),
    authGuardSignin: document.getElementById("webedit-auth-guard-signin"),
    historySidebar: document.getElementById("webedit-history-sidebar"),
    historyList: document.getElementById("webedit-history-list"),
    newChatBtn: document.getElementById("webedit-new-chat-btn"),
    chatMessages: document.getElementById("webedit-chat-messages"),
    referencesContainer: document.getElementById("webedit-references-container"),
    featureButtons: Array.from(document.querySelectorAll(".webedit-feature-btn")),
    removeBtn: document.getElementById("webedit-remove-btn"),
    addBtn: document.getElementById("webedit-add-btn"),
    customizeBtn: document.getElementById("webedit-customize-btn"),
    modeIndicator: document.getElementById("webedit-mode-indicator"),
    modeText: document.getElementById("webedit-mode-text"),
    modeCloseBtn: document.getElementById("webedit-mode-close-btn"),
    customizePanel: document.getElementById("webedit-customize-panel"),
    customizeCloseBtn: document.getElementById("webedit-customize-close-btn"),
    applyBtn: document.getElementById("webedit-apply-btn"),
    resetBtn: document.getElementById("webedit-reset-btn"),
    reviewBtn: document.getElementById("webedit-review-btn"),
    bgColorInput: document.getElementById("webedit-bg-color"),
    textColorInput: document.getElementById("webedit-text-color"),
    fontSizeInput: document.getElementById("webedit-font-size"),
    widthValueInput: document.getElementById("webedit-width-value"),
    widthUnitSelect: document.getElementById("webedit-width-unit"),
    heightValueInput: document.getElementById("webedit-height-value"),
    heightUnitSelect: document.getElementById("webedit-height-unit"),
    scaleInput: document.getElementById("webedit-scale-input"),
    scaleValue: document.getElementById("webedit-scale-value"),
    moveUpBtn: document.getElementById("webedit-move-up-btn"),
    moveDownBtn: document.getElementById("webedit-move-down-btn"),
    alignBtns: Array.from(document.querySelectorAll(".webedit-align-btn")),
    chatInput: document.getElementById("webedit-chat-input"),
    sendBtn: document.getElementById("webedit-send-btn")
  };

  const CHAT_HISTORY_KEY = "webedit-sidepanel-chat-history-v1";
  const CURRENT_SESSION_KEY = "webedit-sidepanel-current-session-id";
  const MAX_SESSIONS = 50;
  const MAX_MESSAGES = 200;

  const AUTH_STATES = {
    UNAUTHENTICATED: "unauthenticated",
    AUTHENTICATED: "authenticated"
  };

  let authState = AUTH_STATES.UNAUTHENTICATED;
  let signedInUser = null;
  let currentUser = null;
  let lastUserId = null;
  let currentSessionId = null;
  let chatMessages = [];
  let activeHistoryRenameForm = null;
  let currentTool = "add";
  let pendingFeaturePickMode = null; // null | add | remove | customize
  let isAddFeatureMode = false;
  let customizeReviewApplied = false;
  let lastPickedTarget = null; // { selector, description }
  let pendingAiAnchorRequest = null; // { text } waiting for Pick Element anchor
  let pendingPreviewRefine = null; // { previewId, plan }
  let pendingComplexDecomposition = null; // { awaiting: "confirm"|"pick_step", steps: string[] }

  function ensureFeatureControlsLayout() {
    const legacySelectors = [
      ".webedit-visual-edit",
      ".webedit-tool-label",
      ".webedit-hamburger-btn",
      ".webedit-tools-menu",
      ".webedit-tool-btn",
      ".webedit-pick-btn-bottom",
      ".pick-btn",
      ".tool-label"
    ];
    legacySelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        try { node.remove(); } catch (_) {}
      });
    });

    const bottomControls = document.querySelector(".webedit-bottom-controls");
    if (!bottomControls) return;

    let controls = bottomControls.querySelector(".webedit-feature-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "webedit-feature-controls";
      bottomControls.prepend(controls);
    }

    const buttonDefs = [
      { id: "webedit-remove-btn", tool: "remove", label: "Remove" },
      { id: "webedit-add-btn", tool: "add", label: "Add" },
      { id: "webedit-customize-btn", tool: "customize", label: "Customize" }
    ];

    buttonDefs.forEach((def) => {
      let btn = controls.querySelector(`#${def.id}`);
      if (!btn) {
        btn = document.createElement("button");
        btn.id = def.id;
        controls.appendChild(btn);
      }
      btn.type = "button";
      btn.className = "webedit-feature-btn";
      btn.dataset.tool = def.tool;
      btn.textContent = def.label;
    });

    const orderedButtons = buttonDefs
      .map((def) => controls.querySelector(`#${def.id}`))
      .filter(Boolean);
    controls.innerHTML = "";
    orderedButtons.forEach((btn) => controls.appendChild(btn));

    els.featureButtons = orderedButtons;
    els.removeBtn = controls.querySelector("#webedit-remove-btn");
    els.addBtn = controls.querySelector("#webedit-add-btn");
    els.customizeBtn = controls.querySelector("#webedit-customize-btn");
  }

  // References shown after picking an element should be ephemeral.
  const PICK_REFERENCE_TTL_MS = 8000;
  let pickReferenceDismissTimeout = null;

  function clearPickReferences(options = {}) {
    const shouldPersist = options.persist === true;
    if (pickReferenceDismissTimeout) {
      clearTimeout(pickReferenceDismissTimeout);
      pickReferenceDismissTimeout = null;
    }
    const beforeCount = chatMessages.length;
    chatMessages = chatMessages.filter((m) => m.type !== "reference");
    if (chatMessages.length !== beforeCount) {
      renderChatMessages();
      if (shouldPersist) {
        saveChatHistory();
      }
    }
  }

  function showPickReference(description) {
    if (!description) return;
    // Remove old references immediately so only one shows at a time.
    clearPickReferences({ persist: false });
    addChatMessage("reference", `Reference: ${description}`);
    // Auto-dismiss so reference never lingers.
    pickReferenceDismissTimeout = setTimeout(() => {
      clearPickReferences({ persist: true });
    }, PICK_REFERENCE_TTL_MS);
  }

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getScopedKey(baseKey) {
    const id = currentUser?.id || null;
    if (!id) return null;
    return `${baseKey}::${id}`;
  }

  function getHistoryStorageKey() {
    return getScopedKey(CHAT_HISTORY_KEY);
  }

  function getSessionStorageKey() {
    return getScopedKey(CURRENT_SESSION_KEY);
  }

  async function sendToActiveTab(payload) {
    const commandType = String(payload?.type || "");
    const stateChangingCommands = new Set([
      "COMMIT_FEATURE_SPEC",
      "COMMIT_FEATURE",
      "APPLY_STYLES",
      "REMOVE_ELEMENT",
      "UNDO_LAST",
      "REDO_LAST",
      "UNDO_BY_ID",
      "RESET_STYLES"
    ]);
    const shouldUseStrongAuthRefresh = stateChangingCommands.has(commandType);

    if (!isAuthenticated()) {
      await refreshAuthorization({ forceRefresh: shouldUseStrongAuthRefresh });
      if (!isAuthenticated()) {
        return { ok: false, stage: "auth", error: "Not authorized" };
      }
    }
    try {
      let resp = await chrome.runtime.sendMessage({
        type: "WEBEDIT_SIDEPANEL_COMMAND",
        payload
      });
      const responseError = String(resp?.response?.error || "").toLowerCase();
      const directError = String(resp?.error || "").toLowerCase();
      const isAuthError =
        responseError.includes("not authorized") ||
        directError.includes("not authorized");
      if (isAuthError) {
        await refreshAuthorization({ forceRefresh: true });
        if (isAuthenticated()) {
          // One retry after auth refresh for transient session desync.
          resp = await chrome.runtime.sendMessage({
            type: "WEBEDIT_SIDEPANEL_COMMAND",
            payload
          });
        }
      }
      if (!resp?.ok) {
        const errorText = String(resp?.error || "unknown");
        const isTransientRuntimeIssue =
          errorText.includes("Page is still initializing") ||
          errorText.includes("Receiving end does not exist");
        if (isTransientRuntimeIssue) {
          // One light client-side retry to smooth SW/content-script startup races.
          await new Promise((resolve) => setTimeout(resolve, 260));
          const retryResp = await chrome.runtime.sendMessage({
            type: "WEBEDIT_SIDEPANEL_COMMAND",
            payload
          });
          if (retryResp?.ok) {
            resp = retryResp;
          }
        }
      }
      if (!resp?.ok) {
        const errorText = String(resp?.error || "unknown");
        const isTabContextIssue =
          errorText.includes("No active tab found") ||
          errorText.includes("Authentication in progress on webeditai.com") ||
          errorText.includes("You're currently on webeditai.com") ||
          errorText.includes("Page is still initializing");
        if (isTabContextIssue) {
          showNotificationInChat(errorText);
        } else {
          showNotificationInChat(`Error talking to page: ${errorText}`);
        }
      }
      if (resp?.ok && resp?.response && resp.response.ok === false) {
        showNotificationInChat(`Page error: ${resp.response.error || "unknown"}`);
      }
      return resp;
    } catch (error) {
      showNotificationInChat(`Error talking to page: ${error?.message || String(error)}`);
      return { ok: false, error: error?.message || String(error) };
    }
  }

  function formatStageError(resp, fallback = "Operation failed") {
    const stage = resp?.response?.stage || resp?.stage || "";
    const detail = resp?.response?.error || resp?.error || fallback;
    if (!stage) return detail;
    const labels = {
      auth: "authorization required",
      parse: "parse failure",
      capability: "capability mismatch",
      generation: "generation failed",
      complexity: "complexity gate",
      decomposition: "decomposition needed",
      generation_quality_failed: "generation quality failed",
      validation: "behavior tests failed",
      apply: "apply migration failed"
    };
    return `${labels[stage] || stage}: ${detail}`;
  }

  function isFolderIntent(text) {
    return /folder|organize chat|group chat|chat folder|new folder/i.test(String(text || ""));
  }

  function createAddTraceId() {
    return `add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function buildAddSpecPipeline(promptText, baseContext, previousSpec = null, traceId = "") {
    const anchorSelector = lastPickedTarget?.selector || previousSpec?.targetSelector || previousSpec?.selector || "";
    if (!anchorSelector) {
      return { ok: false, stage: "capability", error: "No anchor selected. Pick a target section first." };
    }

    const resolvedTraceId = String(traceId || createAddTraceId());
    const domContextResp = await sendToActiveTab({
      type: "GET_ADD_DOM_CONTEXT",
      selector: anchorSelector,
      traceId: resolvedTraceId
    });
    const domContext = domContextResp?.response?.addDomContext || null;
    const capability = domContext?.capability || null;
    if (!domContextResp?.response?.ok || !domContext) {
      const authLikeError = String(domContextResp?.error || "").toLowerCase();
      if (authLikeError.includes("not authorized")) {
        return { ok: false, stage: "auth", error: "Please sign in before generating Add features.", traceId: resolvedTraceId };
      }
      return {
        ok: false,
        stage: "capability",
        error: domContextResp?.response?.error || domContextResp?.error || "DOM context extraction failed.",
        traceId: resolvedTraceId
      };
    }

    if (capability.recommendation === "simplified_ui_only") {
      const folderIntent = isFolderIntent(promptText);
      if (folderIntent && (capability.capabilityScore || 0) >= 30) {
        // Allow folder flows in DOM-reorganization mode on medium capability pages.
      } else {
      return {
        ok: false,
        stage: "capability",
        error: "This page cannot safely run a complex generated module. Try a simpler feature or pick a more stable section."
      };
      }
    }

    const planner = window.FeaturePlanner;
    if (!planner || typeof planner.buildAddSpecFromModule !== "function") {
      return { ok: false, stage: "generation", error: "Feature module generator is not available." };
    }

    const plannerCtx = {
      ...(baseContext || {}),
      selector: anchorSelector,
      anchorElement: lastPickedTarget,
      previousSpec: previousSpec || undefined,
      addDomContext: domContext
    };

    const forcedFeatureClass = typeof planner.routeFeatureClass === "function"
      ? planner.routeFeatureClass(promptText, plannerCtx, capability)
      : null;

    const built = planner.buildAddSpecFromModule(promptText, plannerCtx, capability, { forcedFeatureClass });
    if (!built?.ok || !built?.spec) {
      return {
        ok: false,
        stage: built?.stage || "generation",
        code: built?.code || null,
        error: built?.error || "Could not generate module artifacts.",
        decompositionSteps: Array.isArray(built?.decompositionSteps) ? built.decompositionSteps : [],
        traceId: resolvedTraceId
      };
    }
    const addContract = typeof window.validateAddSpecContract === "function"
      ? window.validateAddSpecContract({
          ...built.spec,
          targetSelector: anchorSelector,
          selector: built.spec.selector || anchorSelector
        })
      : { ok: true, spec: built.spec };
    if (!addContract?.ok || !addContract?.spec) {
      return {
        ok: false,
        stage: addContract?.stage || "contract",
        error: addContract?.error || "Add contract validation failed.",
        traceId: resolvedTraceId
      };
    }
    const finalSpec = {
      ...addContract.spec,
      metadata: {
        ...(addContract.spec.metadata || {}),
        stage: "generation",
        capabilityScore: capability.capabilityScore,
        traceId: resolvedTraceId
      }
    };

    return { ok: true, spec: finalSpec, capability, domContext, traceId: resolvedTraceId };
  }

  function isYesText(text) {
    const t = String(text || "").trim().toLowerCase();
    return t === "yes" || t === "y" || t === "sure" || t === "ok" || t === "okay";
  }

  function isNoText(text) {
    const t = String(text || "").trim().toLowerCase();
    return t === "no" || t === "n" || t === "cancel" || t === "stop";
  }

  function beginComplexityDecomposition(decompositionSteps = []) {
    const steps = Array.isArray(decompositionSteps) ? decompositionSteps.filter(Boolean).slice(0, 4) : [];
    if (!steps.length) return false;
    pendingComplexDecomposition = {
      awaiting: "confirm",
      steps
    };
    addChatMessage(
      "assistant",
      "This request is too complex for one reliable step. Would you like me to break it into smaller reliable steps? (yes/no)"
    );
    return true;
  }

  async function ensureRenderableAddSpec(spec, promptText, pageContext = {}, previousSpec = null) {
    const isDarkModePrompt = /dark mode|night mode|theme/i.test(String(promptText || ""));
    const isLinkPrompt = /youtube|youtu\.be|link|url|hyperlink|href|anchor|open|visit|go to|website|web page|webpage|http/i.test(String(promptText || ""));
    const hasDarkModeCoverage = (cssText = "") => {
      const css = String(cssText || "").toLowerCase();
      const hasBackground = /(background|background-color)/.test(css);
      const hasTextColor = /color\s*:/.test(css);
      const hasInteractive = /button|input|textarea|select|a\b/.test(css);
      const hasContainerCoverage = /(main|section|article|div|\[role="main"\])/.test(css);
      return hasBackground && hasTextColor && hasInteractive && hasContainerCoverage;
    };
    const buildLinkFallback = (base = {}) => {
      const firstUrlMatch = String(promptText || "").match(/https?:\/\/[^\s)]+/i);
      const href = firstUrlMatch?.[0] || (/youtube|youtu\.be/i.test(String(promptText || "")) ? "https://www.youtube.com/" : "https://example.com/");
      return {
        ...base,
        action: "add",
        targetSelector: base.targetSelector || base.selector || lastPickedTarget?.selector || "",
        selector: base.selector || base.targetSelector || lastPickedTarget?.selector || "",
        position: base.position || "inside",
        html: `<div data-webedit-generated-module="1" style="border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#f8fafc;display:flex;align-items:center;gap:8px;">
          <a href="${href}" target="_blank" rel="noopener noreferrer"
             style="display:inline-flex;align-items:center;gap:6px;background:#111827;color:#fff;border-radius:8px;padding:6px 10px;text-decoration:none;font-size:13px;font-weight:600;">
            Open Link
          </a>
          <span style="font-size:12px;color:#334155;overflow-wrap:anywhere;">${href}</span>
        </div>`,
        css: base.css || "",
        js: base.js || ""
      };
    };
    const buildGenericFunctionalFallback = (base = {}) => {
      const safeText = escapeHtml(
        String(base?.description || base?.purpose || base?.name || promptText || "New feature").trim()
      );
      return {
        ...base,
        action: "add",
        targetSelector: base.targetSelector || base.selector || lastPickedTarget?.selector || "",
        selector: base.selector || base.targetSelector || lastPickedTarget?.selector || "",
        position: base.position || "inside",
        html: `<div data-webedit-generated-module="1" style="border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#f8fafc;">
          <div style="font-size:13px;color:#111827;line-height:1.4;">${safeText}</div>
        </div>`,
        css: base.css || "",
        js: base.js || ""
      };
    };

    const next = spec ? { ...spec } : null;
    if (!next || next.action !== "add") return { ok: true, spec: next };
    const generatedHtml = next.generated_module?.html || "";
    const generatedCss = next.generated_module?.css || "";
    const generatedJs = next.generated_module?.js || "";
    const hasRenderable = !!((next.html && String(next.html).trim()) || (next.content && String(next.content).trim()) || (generatedHtml && String(generatedHtml).trim()));
    if (hasRenderable) {
      if ((!next.html || !String(next.html).trim()) && generatedHtml) next.html = generatedHtml;
      if ((!next.css || !String(next.css).trim()) && generatedCss) next.css = generatedCss;
      if ((!next.js || !String(next.js).trim()) && generatedJs) next.js = generatedJs;
      const htmlText = String(next.html || "").toLowerCase();
      const contentText = String(next.content || "").toLowerCase();
      const isPlaceholder =
        htmlText.includes("feature request:") ||
        contentText.startsWith("feature request:") ||
        contentText === String(promptText || "").trim().toLowerCase();
      if (isPlaceholder) {
        if (isLinkPrompt) {
          return { ok: true, spec: buildLinkFallback(next) };
        }
        return { ok: true, spec: buildGenericFunctionalFallback(next) };
      }
      if (isDarkModePrompt) {
        const combinedCss = `${next.css || ""}\n${generatedCss || ""}`;
        if (!hasDarkModeCoverage(combinedCss)) {
          return {
            ok: false,
            stage: "generation_quality_failed",
            error: "Dark mode output is incomplete. It must update background, text, and interactive surfaces."
          };
        }
      }
      return { ok: true, spec: next };
    }

    const rebuilt = await buildAddSpecPipeline(promptText, pageContext, previousSpec || next);
    if (!rebuilt.ok || !rebuilt.spec) {
      if (isLinkPrompt) {
        return { ok: true, spec: buildLinkFallback(next || {}) };
      }
      return { ok: true, spec: buildGenericFunctionalFallback(next || {}) };
    }
    return { ok: true, spec: rebuilt.spec };
  }

  function forceMinimalAddRenderable(spec, promptText = "") {
    const next = spec ? { ...spec } : null;
    if (!next || next.action !== "add") return next;
    const hasRenderable = !!((next.html && String(next.html).trim()) || (next.content && String(next.content).trim()));
    if (hasRenderable) return next;
    const safeText = (next.description || next.purpose || next.name || promptText || "New feature").toString().trim();
    const escaped = escapeHtml(safeText);
    next.html = `<div data-webedit-generated-module="1" style="border:1px dashed #94a3b8;padding:8px;border-radius:8px;background:#f8fafc;">${escaped}</div>`;
    if (!next.css) next.css = "";
    if (!next.js) next.js = "";
    if (!next.content) next.content = safeText;
    return next;
  }

  async function orchestrateAddSpec(promptText, pageContext, previousSpec = null, traceId = "") {
    const runTraceId = String(traceId || createAddTraceId());
    const built = await buildAddSpecPipeline(promptText, pageContext, previousSpec, runTraceId);
    if (!built.ok || !built.spec) return built;

    const hydrated = await ensureRenderableAddSpec(built.spec, promptText, pageContext, previousSpec || built.spec);
    if (!hydrated.ok || !hydrated.spec) {
      return {
        ok: false,
        stage: hydrated?.stage || "generation",
        error: hydrated?.error || "Refinement could not generate renderable Add code.",
        traceId: runTraceId
      };
    }
    const validated = typeof window.validateAddSpecContract === "function"
      ? window.validateAddSpecContract(hydrated.spec)
      : { ok: true, spec: hydrated.spec };
    if (!validated?.ok || !validated?.spec) {
      return {
        ok: false,
        stage: validated?.stage || "contract",
        error: validated?.error || "Add contract validation failed.",
        traceId: runTraceId
      };
    }

    const finalSpec = {
      ...validated.spec,
      metadata: {
        ...(validated.spec.metadata || {}),
        traceId: runTraceId
      }
    };
    return { ok: true, spec: finalSpec, traceId: runTraceId };
  }

  function showNotificationInChat(text) {
    addChatMessage("system", text);
  }

  async function handlePreviewApply(previewId) {
    if (!previewId) return;
    const msg = chatMessages.find(m => m.type === "preview" && m.content?.previewId === previewId);
    if (!msg) return;
    const kind = msg?.content?.previewKind || "plan";
    const traceId = String(msg?.content?.spec?.metadata?.traceId || createAddTraceId());
    const thinking = addChatMessage("assistant", "Applying preview...");
    const resp = kind === "spec"
      ? await sendToActiveTab({ type: "COMMIT_FEATURE_SPEC", previewId, spec: msg.content?.spec || null, traceId })
      : await sendToActiveTab({ type: "COMMIT_FEATURE", previewId, plan: msg.content?.plan || null });
    if (resp?.response?.ok) {
      chatMessages = chatMessages.filter(m => !(m.type === "preview" && m.content?.previewId === previewId));
      thinking.content = "✅ Feature applied.";
    } else {
      thinking.content = `❌ ${formatStageError(resp, "Apply failed")}`;
    }
    renderChatMessages();
    saveChatHistory();
  }

  async function handlePreviewUndo(previewId) {
    if (!previewId) return;
    const msg = chatMessages.find(m => m.type === "preview" && m.content?.previewId === previewId);
    const kind = msg?.content?.previewKind || "plan";
    const resp = kind === "spec"
      ? await sendToActiveTab({ type: "UNDO_FEATURE_SPEC", previewId })
      : await sendToActiveTab({ type: "UNDO_FEATURE", previewId });
    if (resp?.response?.ok) {
      chatMessages = chatMessages.filter(m => !(m.type === "preview" && m.content?.previewId === previewId));
      addChatMessage("assistant", "✅ Preview removed.");
    } else {
      addChatMessage("assistant", `❌ Undo failed: ${resp?.response?.error || "unknown error"}`);
    }
    renderChatMessages();
    saveChatHistory();
  }

  function handlePreviewRefine(previewId) {
    if (!previewId) return;
    const msg = chatMessages.find(m => m.type === "preview" && m.content?.previewId === previewId);
    if (!msg) return;
    pendingPreviewRefine = {
      previewId,
      plan: msg.content?.plan || null,
      spec: msg.content?.spec || null,
      mode: msg.content?.previewKind || "plan"
    };
    addChatMessage("system", "Describe how to refine this preview.");
    renderChatMessages();
    saveChatHistory();
  }

  async function handlePreviewReopen(previewId) {
    if (!previewId) return;
    const msg = chatMessages.find(m => m.type === "preview" && m.content?.previewId === previewId);
    if (!msg) return;
    const content = msg.content || {};
    const mode = content.previewKind || "plan";
    const payload = mode === "spec"
      ? { type: "REOPEN_PREVIEW", previewId, previewKind: "spec", spec: content.spec || null }
      : { type: "REOPEN_PREVIEW", previewId, previewKind: "plan", plan: content.plan || null };
    const resp = await sendToActiveTab(payload);
    if (resp?.response?.ok) {
      addChatMessage("system", "Preview window reopened.");
      return;
    }
    addChatMessage("system", `Could not reopen preview: ${formatStageError(resp, "unknown error")}`);
  }

  function addChatMessage(type, content) {
    const msg = { type, content, timestamp: Date.now() };
    chatMessages.push(msg);
    if (chatMessages.length > MAX_MESSAGES) {
      chatMessages = chatMessages.slice(-MAX_MESSAGES);
    }
    renderChatMessages();
    saveChatHistory();
    return msg;
  }

  function addPreviewMessage(content) {
    const msg = { type: "preview", content, timestamp: Date.now() };
    chatMessages.push(msg);
    if (chatMessages.length > MAX_MESSAGES) {
      chatMessages = chatMessages.slice(-MAX_MESSAGES);
    }
    renderChatMessages();
    saveChatHistory();
    return msg;
  }

  function renderChatMessages() {
    if (!els.chatMessages || !els.referencesContainer) return;
    els.chatMessages.innerHTML = "";
    els.referencesContainer.innerHTML = "";

    if (chatMessages.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "webedit-chat-placeholder";
      placeholder.innerHTML = "<p>Select Remove, Add, or Customize below to get started</p>";
      els.chatMessages.appendChild(placeholder);
      return;
    }

    const regular = chatMessages.filter(m => m.type !== "reference");
    const references = chatMessages.filter(m => m.type === "reference");

    regular.forEach((msg) => {
      const msgEl = document.createElement("div");
      msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;
      if (msg.type === "preview") {
        const data = msg.content || {};
        const contentEl = document.createElement("div");
        contentEl.className = "webedit-chat-message-content";
        const confidence = Math.round((data.confidence || 0) * 100);
        contentEl.textContent = `Preview: ${data.feature_type || "Feature"} (${confidence}% confidence)`;
        msgEl.appendChild(contentEl);

        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          const warnEl = document.createElement("div");
          warnEl.className = "webedit-chat-message-content";
          warnEl.textContent = `Warnings: ${data.warnings.join("; ")}`;
          msgEl.appendChild(warnEl);
        }

        const actions = document.createElement("div");
        actions.className = "webedit-preview-actions";
        const applyBtn = document.createElement("button");
        applyBtn.className = "webedit-btn-small webedit-btn-primary";
        applyBtn.textContent = "Apply";
        applyBtn.addEventListener("click", () => handlePreviewApply(data.previewId));
        const undoBtn = document.createElement("button");
        undoBtn.className = "webedit-btn-small webedit-btn-secondary";
        undoBtn.textContent = "Undo";
        undoBtn.addEventListener("click", () => handlePreviewUndo(data.previewId));
        const refineBtn = document.createElement("button");
        refineBtn.className = "webedit-btn-small webedit-btn-secondary";
        refineBtn.textContent = "Refine";
        refineBtn.addEventListener("click", () => handlePreviewRefine(data.previewId));
        const reopenBtn = document.createElement("button");
        reopenBtn.className = "webedit-btn-small webedit-btn-secondary";
        reopenBtn.textContent = "Reopen";
        reopenBtn.addEventListener("click", () => handlePreviewReopen(data.previewId));
        actions.appendChild(applyBtn);
        actions.appendChild(undoBtn);
        actions.appendChild(refineBtn);
        actions.appendChild(reopenBtn);
        msgEl.appendChild(actions);
      } else {
        const contentEl = document.createElement("div");
        contentEl.className = "webedit-chat-message-content";
        contentEl.textContent = msg.content;
        msgEl.appendChild(contentEl);
      }
      els.chatMessages.appendChild(msgEl);
    });

    references.forEach((msg) => {
      const msgEl = document.createElement("div");
      msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;
      const content = msg.content || "";
      const labelEl = document.createElement("span");
      labelEl.className = "webedit-reference-label";
      labelEl.textContent = "Reference:";
      const textEl = document.createElement("div");
      textEl.className = "webedit-reference-text";
      textEl.textContent = content.startsWith("Reference:") ? content.substring(10).trim() : content;
      msgEl.appendChild(labelEl);
      msgEl.appendChild(textEl);
      els.referencesContainer.appendChild(msgEl);
    });

    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function getDefaultSessionTitle(messages = []) {
    const firstUser = messages.find(m => m.type === "user" && m.content && m.content.trim());
    if (firstUser) {
      const t = firstUser.content.trim();
      return t.length > 40 ? `${t.substring(0, 37)}...` : t;
    }
    return "New chat";
  }

  function getSessionDisplayName(session) {
    const title = session?.title && session.title.trim();
    if (title) return title;
    const preview = session?.preview && session.preview.trim();
    if (preview) return preview.length > 60 ? `${preview.substring(0, 57)}...` : preview;
    return "Untitled chat";
  }

  function closeActiveHistoryRenameForm() {
    if (activeHistoryRenameForm && activeHistoryRenameForm.parentNode) {
      try {
        if (activeHistoryRenameForm.parentNode.contains(activeHistoryRenameForm)) {
          activeHistoryRenameForm.parentNode.removeChild(activeHistoryRenameForm);
        }
      } catch (e) {
        // ignore removal errors (e.g. node already removed)
      }
    }
    activeHistoryRenameForm = null;
  }

  function openHistoryRenameInput(session, hostEl) {
    closeActiveHistoryRenameForm();
    if (!hostEl) return;

    const form = document.createElement("form");
    form.className = "webedit-history-rename-form";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "webedit-history-rename-input";
    input.maxLength = 80;
    input.value = getSessionDisplayName(session);
    form.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "webedit-history-rename-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "webedit-history-rename-save";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "webedit-history-rename-cancel";
    cancelBtn.textContent = "Cancel";

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    const commit = (shouldSave) => {
      if (shouldSave) {
        renameChatSession(session.id, input.value);
      }
      closeActiveHistoryRenameForm();
      renderHistoryList();
    };

    form.addEventListener("click", (e) => e.stopPropagation());
    form.addEventListener("submit", (e) => { e.preventDefault(); commit(true); });
    cancelBtn.addEventListener("click", (e) => { e.preventDefault(); commit(false); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", (e) => {
      if (e.relatedTarget === saveBtn || e.relatedTarget === cancelBtn) return;
      commit(true);
    });

    hostEl.appendChild(form);
    activeHistoryRenameForm = form;
    input.focus();
    input.select();
  }

  function renameChatSession(sessionId, newName) {
    const key = getHistoryStorageKey();
    if (!key) return false;
    try {
      chrome.storage.local.get([key], (result) => {
        const history = Array.isArray(result[key]) ? result[key] : [];
        const s = history.find(x => x.id === sessionId);
        if (!s) return;
        const trimmed = (newName || "").trim();
        s.title = trimmed || getDefaultSessionTitle(s.messages || []);
        chrome.storage.local.set({ [key]: history }, () => renderHistoryList(history));
      });
      return true;
    } catch (e) {
      console.error("[SidePanel] rename failed:", e);
      return false;
    }
  }

  function renderHistoryList(historyData = null) {
    if (!els.historyList) return;
    if (!currentUser?.id) {
      const msg = "Log in to view history";
      els.historyList.innerHTML = `<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">${msg}</div>`;
      return;
    }

    if (!historyData) {
      const key = getHistoryStorageKey();
      if (!key) return;
      chrome.storage.local.get([key], (result) => {
        renderHistoryList(Array.isArray(result[key]) ? result[key] : []);
      });
      return;
    }

    if (!Array.isArray(historyData) || historyData.length === 0) {
      closeActiveHistoryRenameForm();
      els.historyList.innerHTML = '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">No history yet</div>';
      return;
    }

    closeActiveHistoryRenameForm();
    els.historyList.innerHTML = "";

    historyData
      .slice()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .forEach((session) => {
        const item = document.createElement("div");
        item.className = `webedit-history-item ${session.id === currentSessionId ? "active" : ""}`;

        const main = document.createElement("div");
        main.className = "webedit-history-item-main";

        const titleEl = document.createElement("div");
        titleEl.className = "webedit-history-title";
        titleEl.textContent = getSessionDisplayName(session);
        main.appendChild(titleEl);

        const renameBtn = document.createElement("button");
        renameBtn.className = "webedit-history-rename-btn";
        renameBtn.type = "button";
        renameBtn.setAttribute("aria-label", "Rename chat");
        renameBtn.innerHTML = "✏︎";
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openHistoryRenameInput(session, item);
        });
        main.appendChild(renameBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "webedit-history-delete-btn";
        deleteBtn.type = "button";
        deleteBtn.setAttribute("aria-label", "Delete chat");
        deleteBtn.innerHTML = "🗑";
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteChatSession(session.id);
        });
        main.appendChild(deleteBtn);

        const dateEl = document.createElement("div");
        dateEl.className = "webedit-history-date";
        const ts = session.timestamp || Date.now();
        dateEl.textContent = new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        const previewEl = document.createElement("div");
        previewEl.className = "webedit-history-preview";
        previewEl.textContent = session.preview || "New Chat";

        item.appendChild(main);
        item.appendChild(dateEl);
        item.appendChild(previewEl);
        item.addEventListener("click", () => loadSession(session.id));
        els.historyList.appendChild(item);
      });
  }

  function saveChatHistory() {
    if (!currentUser?.id) return;
    const sessionKey = getSessionStorageKey();
    const historyKey = getHistoryStorageKey();
    if (!sessionKey || !historyKey) return;

    if (!currentSessionId) {
      currentSessionId = Date.now().toString();
    }

    chrome.storage.local.get([historyKey], (result) => {
      const history = Array.isArray(result[historyKey]) ? result[historyKey] : [];
      const existing = history.find(s => s.id === currentSessionId);
      const preservedTitle = existing?.title || null;

      const session = {
        id: currentSessionId,
        timestamp: Date.now(),
        messages: chatMessages,
        preview: chatMessages.find(m => m.type === "user")?.content || "New Chat",
        title: preservedTitle || getDefaultSessionTitle(chatMessages)
      };

      const idx = history.findIndex(s => s.id === currentSessionId);
      if (idx >= 0) {
        history[idx] = session;
      } else {
        history.unshift(session);
      }
      const trimmed = history.slice(0, MAX_SESSIONS);
      chrome.storage.local.set({ [historyKey]: trimmed, [sessionKey]: currentSessionId }, () => {
        renderHistoryList(trimmed);
      });
    });
  }

  function loadSession(sessionId) {
    if (!currentUser?.id) return;
    closeActiveHistoryRenameForm();
    clearPickReferences({ persist: false });
    const historyKey = getHistoryStorageKey();
    const sessionKey = getSessionStorageKey();
    if (!historyKey || !sessionKey) return;
    chrome.storage.local.get([historyKey], (result) => {
      const history = Array.isArray(result[historyKey]) ? result[historyKey] : [];
      const session = history.find(s => s.id === sessionId);
      if (!session) return;
      currentSessionId = sessionId;
      chatMessages = Array.isArray(session.messages) ? session.messages : [];
      chrome.storage.local.set({ [sessionKey]: currentSessionId }, () => {
        renderChatMessages();
        renderHistoryList(history);
      });
    });
  }

  function startNewChat() {
    if (!currentUser?.id) return;
    currentSessionId = Date.now().toString();
    chatMessages = [];
    clearPickReferences({ persist: false });
    renderChatMessages();
    saveChatHistory();
  }

  function isAuthenticated() {
    return authState === AUTH_STATES.AUTHENTICATED;
  }

  function requireAuth(actionName) {
    if (isAuthenticated()) return true;
    showNotificationInChat(`Please log in to ${actionName}`);
    return false;
  }

  function updateAuthGuardUI() {
    if (!els.authGuard) return;
    const showGuard = authState === AUTH_STATES.UNAUTHENTICATED;
    els.authGuard.classList.toggle("hidden", !showGuard);

    if (authState === AUTH_STATES.UNAUTHENTICATED) {
      if (els.authGuardTitle) els.authGuardTitle.textContent = "Log in to use WebEdit AI";
      if (els.authGuardMessage) els.authGuardMessage.textContent = "Sign in or create an account to continue.";
      if (els.authGuardSignin) {
        els.authGuardSignin.textContent = "Log in";
        els.authGuardSignin.hidden = false;
      }
    }
  }

  function setFeatureControlsEnabled(enabled) {
    const controls = [
      els.newChatBtn,
      els.removeBtn,
      els.addBtn,
      els.customizeBtn,
      els.applyBtn,
      els.resetBtn,
      els.reviewBtn,
      els.moveUpBtn,
      els.moveDownBtn,
      els.sendBtn,
      els.chatInput,
      ...els.alignBtns
    ].filter(Boolean);

    controls.forEach((el) => {
      if ("disabled" in el) {
        el.disabled = !enabled;
      }
      el.setAttribute("aria-disabled", enabled ? "false" : "true");
    });

    if (!enabled) {
      els.customizePanel?.classList.remove("visible");
      hideModeIndicator();
      isAddFeatureMode = false;
      pendingFeaturePickMode = null;
      customizeReviewApplied = false;
      pendingAiAnchorRequest = null;
      lastPickedTarget = null;
    }
  }

  function applyAuthStateUI() {
    updateAuthGuardUI();
    setFeatureControlsEnabled(isAuthenticated());
    if (isAuthenticated()) {
      renderHistoryList();
      return;
    }
    chatMessages = [];
    renderChatMessages();
    renderHistoryList([]);
  }

  function renderSignInButton() {
    if (!els.signinBtn) return;
    els.signinBtn.className = "webedit-nav-btn signin-btn";
    els.signinBtn.textContent = "Log in";
    els.signinBtn.onclick = () => {
      window.open("https://webeditai.com/#/signup?from=extension", "_blank");
    };
  }

  function renderSignedInButton(user) {
    if (!els.signinBtn) return;
    els.signinBtn.className = "webedit-nav-btn signin-btn webedit-avatar-container";
    els.signinBtn.title = user?.email || "Account";
    els.signinBtn.innerHTML = "";

    const avatar = document.createElement("div");
    avatar.className = "webedit-avatar";
    const initial = (user?.email || "U")[0].toUpperCase();
    avatar.textContent = initial;
    els.signinBtn.appendChild(avatar);

    const menu = document.createElement("div");
    menu.className = "webedit-avatar-menu";
    menu.innerHTML = `
      <div class="webedit-avatar-menu-header">
        <div class="webedit-avatar-menu-email">${escapeHtml(user?.email || "User")}</div>
      </div>
      <div class="webedit-avatar-menu-item" data-action="signout">
        <span class="webedit-avatar-menu-icon">👋</span>
        <span>Sign out</span>
      </div>
    `;
    els.signinBtn.appendChild(menu);

    avatar.addEventListener("click", (e) => {
            e.preventDefault();
      e.stopPropagation();
      menu.classList.toggle("visible");
    });

    document.addEventListener("click", () => menu.classList.remove("visible"));
    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = e.target?.closest(".webedit-avatar-menu-item")?.dataset?.action;
      if (!action) return;
      menu.classList.remove("visible");
      if (action === "signout") {
        // Requirement: sign out fully inside the extension (no website redirect) using Supabase session only.
        // We call `supabase.auth.signOut()` in the side panel context, then clear/broadcast via background.
        Promise.resolve(window.supabase?.auth?.signOut?.())
          .catch(() => {})
          .finally(() => chrome.runtime.sendMessage({ type: "WEBEDIT_SIGN_OUT" }));
        }
    });
}

  function toggleHistorySidebar(forceState = null) {
    if (!els.historySidebar) return;
    const willShow = forceState === null ? !els.historySidebar.classList.contains("visible") : !!forceState;
    els.historySidebar.classList.toggle("visible", willShow);
  }

  function attachHeaderEventListeners() {
    if (els.headerHamburger && els.historySidebar) {
      els.headerHamburger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleHistorySidebar();
      });

      document.addEventListener("click", (e) => {
        if (!els.historySidebar.classList.contains("visible")) return;
        if (els.historySidebar.contains(e.target)) return;
        if (els.headerHamburger.contains(e.target)) return;
        toggleHistorySidebar(false);
      });
    }

    if (els.homeBtn) {
      els.homeBtn.addEventListener("click", () => {
        window.open("https://webeditai.com/", "_blank");
      });
    }
  }

  function deleteChatSession(sessionId) {
    const historyKey = getHistoryStorageKey();
    if (!historyKey) return;
    chrome.storage.local.get([historyKey], (result) => {
      const history = Array.isArray(result[historyKey]) ? result[historyKey] : [];
      const next = history.filter(s => s.id !== sessionId);
      chrome.storage.local.set({ [historyKey]: next }, () => {
        if (currentSessionId === sessionId) {
          currentSessionId = null;
          chatMessages = [];
          renderChatMessages();
        }
        renderHistoryList(next);
      });
    });
  }

  async function refreshAuthorization(options = {}) {
    const client = window.SupabaseClient;
    let session = null;
    let user = null;
    const forceRefresh = !!options?.forceRefresh;

    try {
      if (client?.getSession) {
        const sessionResp = await client.getSession({ allowRefresh: forceRefresh });
        session = sessionResp?.data?.session || null;
      }
    } catch (_) {
      session = null;
    }

    try {
      if (client?.fetchAuthUser) {
        const authResp = await client.fetchAuthUser();
        user = authResp?.ok ? authResp.user : null;
      } else {
        user = session?.user || null;
      }
      if (!user && session?.user) {
        user = session.user;
      }
    } catch (_) {
      user = null;
    }

    signedInUser = user || null;
    currentUser = user || null;
    authState = user ? AUTH_STATES.AUTHENTICATED : AUTH_STATES.UNAUTHENTICATED;

    const nextUserId = signedInUser?.id || null;
    if (nextUserId !== lastUserId) {
      console.log(`[SidePanel Auth] user changed: ${lastUserId || "none"} -> ${nextUserId || "none"}`);
      lastUserId = nextUserId;
      currentSessionId = null;
      chatMessages = [];
    }

    if (signedInUser) {
      renderSignedInButton(signedInUser);
    } else {
      renderSignInButton();
    }
    applyAuthStateUI();
  }

  function setActiveTool(tool) {
    currentTool = tool;
    els.featureButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
  }

  function showModeIndicator(text) {
    if (!els.modeIndicator || !els.modeText) return;
    els.modeText.textContent = text;
    els.modeIndicator.classList.remove("hidden");
  }

  function hideModeIndicator() {
    if (!els.modeIndicator) return;
    els.modeIndicator.classList.add("hidden");
  }

  async function startFeaturePickFlow(tool) {
    if (tool === "remove" && !requireAuth("remove elements")) return;
    if (tool === "customize" && !requireAuth("customize elements")) return;
    if (tool === "add" && !requireAuth("add features")) return;

    setActiveTool(tool);
    pendingFeaturePickMode = tool;
    pendingPreviewRefine = null;
    isAddFeatureMode = false;
    customizeReviewApplied = false;
    els.customizePanel?.classList.remove("visible");

    if (tool === "remove") {
      showNotificationInChat("Pick an element to remove.");
      showModeIndicator("Remove: pick an element to remove");
    }
    if (tool === "customize") {
      showNotificationInChat("Pick an element to customize.");
      showModeIndicator("Customize: pick an element");
    }
    if (tool === "add") {
      showNotificationInChat("Pick an element to add content near it.");
      showModeIndicator("Add: pick an anchor element");
    }

    const resp = await sendToActiveTab({ type: "START_PICK_MODE", reason: tool });
    if (!resp?.ok) {
      hideModeIndicator();
      pendingFeaturePickMode = null;
      return;
    }
    showModeIndicator("Pick mode active - Click an element to select it");
  }

  function buildCustomizeDraftStyles() {
    const widthValue = (els.widthValueInput?.value || "").trim();
    const widthUnit = els.widthUnitSelect?.value || "px";
    const heightValue = (els.heightValueInput?.value || "").trim();
    const heightUnit = els.heightUnitSelect?.value || "px";
    const scalePct = Number(els.scaleInput?.value || 100);
    const scale = Number.isFinite(scalePct) ? Math.max(0.1, scalePct / 100) : 1;

    return {
      backgroundColor: els.bgColorInput?.value || "#ffffff",
      color: els.textColorInput?.value || "#000000",
      fontSize: (els.fontSizeInput?.value || "16") + "px",
      ...(widthValue ? { width: `${widthValue}${widthUnit}` } : {}),
      ...(heightValue ? { height: `${heightValue}${heightUnit}` } : {}),
      ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: "center" } : {})
    };
  }

  async function reviewCustomize() {
    if (!requireAuth("review customizations")) return;
    if (!lastPickedTarget?.selector) {
      showNotificationInChat("Pick an element first.");
      return;
    }
    const styles = buildCustomizeDraftStyles();
    const resp = await sendToActiveTab({ type: "PREVIEW_STYLES", selector: lastPickedTarget.selector, styles });
    if (resp?.response?.ok) {
      showNotificationInChat("Preview updated. Apply to save permanently.");
      customizeReviewApplied = false;
    }
  }

  async function applyCustomize() {
    if (!requireAuth("apply customizations")) return;
    if (!lastPickedTarget?.selector) {
      showNotificationInChat("Pick an element first.");
      return;
    }
    const styles = buildCustomizeDraftStyles();
    const resp = await sendToActiveTab({ type: "APPLY_STYLES", selector: lastPickedTarget.selector, styles });
    if (resp?.response?.ok) {
      customizeReviewApplied = true;
      showNotificationInChat("Customization applied and saved.");
    }
  }

  async function resetCustomize() {
    if (!requireAuth("reset customizations")) return;
    if (!lastPickedTarget?.selector) return;
    const resetType = customizeReviewApplied ? "RESET_STYLES" : "RESET_PREVIEW_STYLES";
    await sendToActiveTab({ type: resetType, selector: lastPickedTarget.selector });
    if (els.widthValueInput) els.widthValueInput.value = "";
    if (els.heightValueInput) els.heightValueInput.value = "";
    if (els.scaleInput) els.scaleInput.value = "100";
    if (els.scaleValue) els.scaleValue.textContent = "100%";
    customizeReviewApplied = false;
    showNotificationInChat("Element reset to original state.");
  }

  async function handleSend(textOverride = null) {
    const text = (typeof textOverride === "string" ? textOverride : (els.chatInput?.value || "")).trim();
    if (!text) return;
    if (!requireAuth("use WebEdit")) return;
    if (typeof textOverride !== "string") els.chatInput.value = "";

    if (pendingComplexDecomposition) {
      const state = pendingComplexDecomposition;
      if (state.awaiting === "confirm") {
        addChatMessage("user", text);
        if (isYesText(text)) {
          state.awaiting = "pick_step";
          const lines = state.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
          addChatMessage("assistant", `Great. Choose the first step to implement by number:\n${lines}`);
        } else if (isNoText(text)) {
          pendingComplexDecomposition = null;
          addChatMessage("assistant", "Understood. I won't break it down now.");
        } else {
          addChatMessage("assistant", "Please reply yes or no.");
        }
        renderChatMessages();
        saveChatHistory();
        return;
      }

      if (state.awaiting === "pick_step") {
        addChatMessage("user", text);
        const stepNumber = Number.parseInt(text, 10);
        if (Number.isInteger(stepNumber) && stepNumber >= 1 && stepNumber <= state.steps.length) {
          const chosenStep = state.steps[stepNumber - 1];
          pendingComplexDecomposition = null;
          addChatMessage("assistant", `Implementing step ${stepNumber}: ${chosenStep}`);
          isAddFeatureMode = true;
          renderChatMessages();
          saveChatHistory();
          handleSend(chosenStep);
          return;
        }
        addChatMessage("assistant", `Please pick a number between 1 and ${state.steps.length}.`);
        renderChatMessages();
        saveChatHistory();
        return;
      }
    }

    if (pendingPreviewRefine) {
      const { previewId, plan, spec, mode } = pendingPreviewRefine;
      pendingPreviewRefine = null;
      addChatMessage("user", text);
      const thinking = addChatMessage("assistant", "Refining preview...");

      if (mode === "spec") {
        const pageContextResp = await sendToActiveTab({ type: "GET_PAGE_CONTEXT" });
        const pageContext = pageContextResp?.response?.pageContext || {};
        if (lastPickedTarget && lastPickedTarget.selector) {
          pageContext.anchorElement = lastPickedTarget;
        }
        if (spec) {
          pageContext.previousSpec = spec;
        }
        let nextSpec = null;
        const refineTraceId = String(spec?.metadata?.traceId || createAddTraceId());
        if (spec?.action === "add") {
          const orchestrated = await orchestrateAddSpec(text, pageContext, spec, refineTraceId);
          if (!orchestrated.ok) {
            if (orchestrated.stage === "complexity" && beginComplexityDecomposition(orchestrated.decompositionSteps || [])) {
              thinking.content = "⚠️ Request needs decomposition before reliable implementation.";
              renderChatMessages();
              saveChatHistory();
              return;
            }
            thinking.content = `❌ ${formatStageError(orchestrated, "Refinement failed")}`;
            renderChatMessages();
            saveChatHistory();
            return;
          }
          nextSpec = orchestrated.spec;
        } else {
          const aiResp = window.SupabaseClient?.generateFeatureSpec
            ? await window.SupabaseClient.generateFeatureSpec(text, pageContext)
            : null;
          if (!aiResp?.ok) {
            thinking.content = `❌ ${aiResp?.error || "AI is not available right now."}`;
            renderChatMessages();
            saveChatHistory();
            return;
          }
          nextSpec = aiResp.spec;
        }

        if (!nextSpec || nextSpec.action === "chat" || nextSpec.action === "undo" || nextSpec.action === "reveal") {
          thinking.content = "❌ I couldn't generate a new preview for that refinement.";
        } else {
          // Keep Add refinements anchored to the originally picked element.
          if (spec?.action === "add") {
            if (nextSpec.action !== "add") {
              thinking.content = "❌ Refinement must still describe an Add feature. Please refine with UI/workflow/goal for a new feature.";
              renderChatMessages();
              saveChatHistory();
              return;
            }
            const anchorSelector = lastPickedTarget?.selector || spec.targetSelector || spec.selector || "";
            if (!anchorSelector) {
              thinking.content = "❌ I lost the selected anchor. Please pick the target section again and retry.";
              renderChatMessages();
              saveChatHistory();
              return;
            }
            nextSpec.targetSelector = anchorSelector;
            if (!nextSpec.selector) nextSpec.selector = anchorSelector;
          }
          const traceId = String(nextSpec?.metadata?.traceId || refineTraceId);
          console.info(`[SidePanel Add][${traceId}] refine-preview-start`);
          let previewResp = await sendToActiveTab({ type: "PREVIEW_FEATURE_SPEC", spec: nextSpec, previewId, traceId });
          if (!previewResp?.response?.ok && nextSpec?.action === "add") {
            const errText = String(previewResp?.response?.error || "");
            if (errText.includes("add requires html or content")) {
              const forced = forceMinimalAddRenderable(nextSpec, text);
              previewResp = await sendToActiveTab({ type: "PREVIEW_FEATURE_SPEC", spec: forced, previewId, traceId });
              nextSpec = forced;
            }
          }
          if (previewResp?.response?.ok) {
            addPreviewMessage({
              previewId: previewResp.response.previewId,
              feature_type: nextSpec.action,
              confidence: nextSpec.confidence,
              warnings: nextSpec.warnings || [],
              spec: nextSpec,
              previewKind: "spec"
            });
            thinking.content = "✅ Updated preview.";
          } else {
            thinking.content = `❌ ${formatStageError(previewResp, "Preview failed")}`;
          }
        }
        renderChatMessages();
        saveChatHistory();
        return;
      }

      const selector = plan?.targetSelector || lastPickedTarget?.selector || "";
      const ctxResp = await sendToActiveTab({ type: "GET_ADD_CONTEXT", selector });
      const context = ctxResp?.response?.context || null;
      const planner = window.FeaturePlanner;
      if (!planner || typeof planner.plan !== "function") {
        thinking.content = "❌ FeaturePlanner not available.";
        renderChatMessages();
        saveChatHistory();
        return;
      }
      const nextPlan = planner.plan(text, context);
      nextPlan.targetSelector = selector;
      await sendToActiveTab({ type: "UNDO_FEATURE", previewId });
      const previewResp = await sendToActiveTab({ type: "PREVIEW_FEATURE", plan: nextPlan, previewId });
      if (previewResp?.response?.ok) {
        addPreviewMessage({
          previewId: previewResp.response.previewId,
          feature_type: nextPlan.feature_type,
          confidence: nextPlan.confidence,
          warnings: nextPlan.warnings || [],
          plan: nextPlan,
          previewKind: "plan"
        });
        thinking.content = "✅ Updated preview.";
      } else {
        thinking.content = `❌ Preview failed: ${previewResp?.response?.error || "unknown error"}`;
      }
      renderChatMessages();
      saveChatHistory();
      return;
    }

    const lower = text.toLowerCase();
    if (lower === "undo" || lower === "/undo") {
      addChatMessage("user", text);
      const thinking = addChatMessage("assistant", "Undoing last change...");
      const resp = await sendToActiveTab({ type: "UNDO_LAST" });
      thinking.content = resp?.response?.ok ? "✅ Undid the last change." : `❌ ${resp?.response?.error || "Undo failed"}`;
      renderChatMessages();
      saveChatHistory();
      return;
    }

    if (lower === "redo" || lower === "/redo") {
      addChatMessage("user", text);
      const thinking = addChatMessage("assistant", "Redoing last change...");
      const resp = await sendToActiveTab({ type: "REDO_LAST" });
      thinking.content = resp?.response?.ok ? "✅ Redid the last change." : `❌ ${resp?.response?.error || "Redo failed"}`;
      renderChatMessages();
      saveChatHistory();
      return;
    }

    // Add Feature flow handling (single guided prompt after pick)
    if (isAddFeatureMode) {
      if (!lastPickedTarget?.selector) {
        addChatMessage("system", "Pick an element first.");
        return;
      }

      addChatMessage("user", text);
      isAddFeatureMode = false; // consume guided add prompt and return to normal chat mode
      const thinking = addChatMessage("assistant", "Generating your feature...");
      try {
        const addTraceId = createAddTraceId();
        const pageContextResp = await sendToActiveTab({ type: "GET_PAGE_CONTEXT" });
        const pageContext = pageContextResp?.response?.pageContext || {};
        pageContext.anchorElement = lastPickedTarget;

        const orchestrated = await orchestrateAddSpec(text, pageContext, null, addTraceId);
        if (!orchestrated.ok) {
          if (orchestrated.stage === "complexity" && beginComplexityDecomposition(orchestrated.decompositionSteps || [])) {
            thinking.content = "⚠️ Request needs decomposition before reliable implementation.";
            renderChatMessages();
            saveChatHistory();
            return;
          }
          throw new Error(formatStageError(orchestrated, "Feature generation failed"));
        }

        let spec = orchestrated.spec || null;
        if (!spec) {
          throw new Error("No feature specification returned.");
        }

        // Add flow expects an add-capable spec. If not, guide user to refine prompt.
        if (spec.action !== "add") {
          const actionLabel = spec.action || "unknown";
          throw new Error(`AI generated '${actionLabel}' instead of an add feature. Refine your prompt with clear UI and workflow details for a new feature.`);
        }

        // Force Add previews to stay anchored to the picked target section.
        if (lastPickedTarget?.selector) {
          spec.targetSelector = lastPickedTarget.selector;
          if (!spec.selector) spec.selector = lastPickedTarget.selector;
        }

        const traceId = String(spec?.metadata?.traceId || addTraceId);
        console.info(`[SidePanel Add][${traceId}] add-preview-start`);
        let previewResp = await sendToActiveTab({ type: "PREVIEW_FEATURE_SPEC", spec, traceId });
        if (!previewResp?.response?.ok) {
          const errText = String(previewResp?.response?.error || "");
          if (errText.includes("add requires html or content")) {
            const forced = forceMinimalAddRenderable(spec, text);
            previewResp = await sendToActiveTab({ type: "PREVIEW_FEATURE_SPEC", spec: forced, traceId });
            spec = forced;
          }
        }
        if (!previewResp?.response?.ok) {
          throw new Error(previewResp?.response?.error || "Preview failed");
        }

        addPreviewMessage({
          previewId: previewResp.response.previewId,
          feature_type: spec.action,
          confidence: spec.confidence,
          warnings: spec.warnings || [],
          spec,
          previewKind: "spec"
        });
        thinking.content = "✅ Preview ready. Review and click Apply.";
      } catch (e) {
        console.error("[Add Feature] Spec preview failed:", e);
        thinking.content = `❌ I couldn't generate a preview.\nReason: ${e.message || "Unknown error"}`;
      }
      renderChatMessages();
      saveChatHistory();
      return;
    }

    // General chat / Conversation / Edit Commands
    addChatMessage("user", text);
    const thinking = addChatMessage("assistant", "🤖 Thinking...");

    try {
      const pageContextResp = await sendToActiveTab({ type: "GET_PAGE_CONTEXT" });
      const pageContext = pageContextResp?.response?.pageContext || {};

      // Inject user-picked anchor if available (crucial for user-guided retry flow)
      if (lastPickedTarget && lastPickedTarget.selector) {
        pageContext.anchorElement = lastPickedTarget;
      }

      // Use generateFeatureSpec for everything - it handles both edits and chat now.
      const aiResp = window.SupabaseClient?.generateFeatureSpec
        ? await window.SupabaseClient.generateFeatureSpec(text, pageContext)
        : null;

      if (!aiResp?.ok) {
        thinking.content = `❌ ${aiResp?.error || "AI is not available right now."}`;
      } else {
        let spec = aiResp.spec;
        
        if (spec.action === "chat") {
          thinking.content = spec.content || "I couldn't generate a response.";
        } else if (spec.action === "undo") {
          thinking.content = "Reverting that change for you...";
          const undoResp = await sendToActiveTab({ type: "UNDO_BY_ID", targetId: spec.targetId });
          thinking.content = undoResp?.response?.ok ? "✅ Done! I've restored that element." : `❌ Sorry, I couldn't undo that: ${undoResp?.response?.error || "unknown error"}`;
        } else if (spec.action === "reveal") {
          thinking.content = "Trying to reveal hidden UI elements...";
          const revealResp = await sendToActiveTab({ type: "REVEAL_HEADER" });
          thinking.content = revealResp?.response?.ok
            ? `✅ Done. Revealed ${revealResp.response.count || 0} element(s).`
            : `❌ ${revealResp?.response?.error || "Reveal failed"}`;
        } else {
          if (spec.action === "add") {
            const flowTraceId = String(spec?.metadata?.traceId || createAddTraceId());
            const orchestrated = await orchestrateAddSpec(text, pageContext, spec, flowTraceId);
            if (!orchestrated.ok || !orchestrated.spec) {
              thinking.content = `❌ ${formatStageError(orchestrated, "Add generation failed.")}`;
              renderChatMessages();
              saveChatHistory();
              return;
            }
            spec = orchestrated.spec;
            if (lastPickedTarget?.selector) {
              spec.targetSelector = lastPickedTarget.selector;
              if (!spec.selector) spec.selector = lastPickedTarget.selector;
            }
          }
          // It's an edit command (hide, customize, add, text)
          thinking.content = "Generating a preview...";
          const previewTraceId = String(spec?.metadata?.traceId || createAddTraceId());
          console.info(`[SidePanel Add][${previewTraceId}] general-preview-start action=${String(spec?.action || "unknown")}`);
          const previewResp = await sendToActiveTab({ type: "PREVIEW_FEATURE_SPEC", spec, traceId: previewTraceId });
          if (previewResp?.response?.ok) {
            addPreviewMessage({
              previewId: previewResp.response.previewId,
              feature_type: spec.action,
              confidence: spec.confidence,
              warnings: spec.warnings || [],
              spec,
              previewKind: "spec"
            });
            thinking.content = "✅ Preview ready. Review and click Apply.";
          } else {
            const err = previewResp?.response?.error || "preview failed";
            if (typeof err === "string" && err.includes("Could not find target for selector")) {
              thinking.content = "❌ I couldn't find the exact element. Click Add, Remove, or Customize, pick an anchor, then re-send your request.";
              pendingAiAnchorRequest = { text };
            } else {
              thinking.content = `❌ ${formatStageError(previewResp, `I tried to do that, but: ${err}`)}`;
            }
          }
        }
      }
    } catch (e) {
      thinking.content = `❌ Something went wrong: ${e?.message || String(e)}`;
    }

    renderChatMessages();
    saveChatHistory();
  }

  // Listen to messages from background/content scripts
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "WEBEDIT_SESSION_UPDATED") {
      refreshAuthorization();
      return;
    }
    if (message?.type === "WEBEDIT_PREVIEW_SPEC_UPDATED") {
      const previewId = message?.payload?.previewId;
      const spec = message?.payload?.spec || null;
      if (!previewId || !spec) return;
      const msg = chatMessages.find((m) => m.type === "preview" && m.content?.previewId === previewId);
      if (!msg || !msg.content) return;
      msg.content.spec = spec;
      renderChatMessages();
      saveChatHistory();
      return;
    }
    if (message?.type === "WEBEDIT_TAB_EVENT") {
      // placeholder
      return;
    }
    if (message?.type === "WEBEDIT_PREVIEW_ACTION") {
      const action = message?.payload?.action;
      const previewId = message?.payload?.previewId;
      if (action === "apply") {
        handlePreviewApply(previewId);
      } else if (action === "undo") {
        handlePreviewUndo(previewId);
      } else if (action === "refine") {
        handlePreviewRefine(previewId);
      }
      return;
    }
    if (message?.type === "WEBEDIT_ELEMENT_PICKED") {
      lastPickedTarget = message.payload || null;
      if (lastPickedTarget?.description) {
        showPickReference(lastPickedTarget.description);
      }
      hideModeIndicator();
      els.customizePanel?.classList.remove("visible");

      const pickedTool = pendingFeaturePickMode;
      pendingFeaturePickMode = null;
      if (pickedTool === "remove" && lastPickedTarget?.selector) {
        (async () => {
          const resp = await sendToActiveTab({ type: "REMOVE_ELEMENT", selector: lastPickedTarget.selector });
          if (resp?.response?.ok) {
            showNotificationInChat(`Removed: ${lastPickedTarget.description || lastPickedTarget.selector}`);
          }
        })();
      } else if (pickedTool === "customize" && lastPickedTarget?.selector) {
        (async () => {
          const resp = await sendToActiveTab({ type: "START_CUSTOMIZE_SESSION", selector: lastPickedTarget.selector });
          if (!resp?.response?.ok) {
            els.customizePanel?.classList.remove("visible");
            return;
          }
          customizeReviewApplied = false;
          els.customizePanel?.classList.add("visible");
          showNotificationInChat(`Element picked for customize: ${lastPickedTarget.description || lastPickedTarget.selector}`);
        })();
      } else if (pickedTool === "add" && lastPickedTarget?.selector) {
        isAddFeatureMode = true;
        addChatMessage(
          "system",
          "Great, anchor selected. Please include in your prompt the workflow, how the feature works, UI, and goal of the feature."
        );
      }

      if (pendingAiAnchorRequest && lastPickedTarget?.selector) {
        addChatMessage("system", `Anchor selected: ${lastPickedTarget.description || lastPickedTarget.selector}`);
        
        const textToRetry = pendingAiAnchorRequest.text;
        if (textToRetry && typeof textToRetry === "string") {
          addChatMessage("system", "Retrying request with new anchor...");
          pendingAiAnchorRequest = null;
          handleSend(textToRetry);
        } else {
          addChatMessage("system", "Now re-send your last request and I will apply it to this selected area.");
          pendingAiAnchorRequest = null;
        }
      }
      return;
    }
    if (message?.type === "WEBEDIT_MODE_EXITED") {
      hideModeIndicator();
      return;
    }
    if (message?.type === "WEBEDIT_MODE_STARTED") {
      const mode = message.payload?.mode;
      if (mode === "pick") {
        showModeIndicator("Pick mode active - Click an element to select it");
      } else if (mode === "remove") {
        showModeIndicator("Remove mode active - Click an element to hide it");
      }
      return;
    }
  });

  function initializeFeatureHandlers() {
    els.newChatBtn?.addEventListener("click", () => {
      if (!requireAuth("create a chat")) return;
      startNewChat();
    });

    els.featureButtons.forEach((btn) => {
      btn.addEventListener("click", () => startFeaturePickFlow(btn.dataset.tool));
    });

    els.modeCloseBtn?.addEventListener("click", async () => {
      hideModeIndicator();
      pendingFeaturePickMode = null;
      await sendToActiveTab({ type: "EXIT_FEATURES" });
    });

    els.customizeCloseBtn?.addEventListener("click", () => {
      els.customizePanel?.classList.remove("visible");
    });
    els.reviewBtn?.addEventListener("click", reviewCustomize);
    els.applyBtn?.addEventListener("click", applyCustomize);
    els.resetBtn?.addEventListener("click", resetCustomize);

    els.scaleInput?.addEventListener("input", () => {
      if (els.scaleValue) {
        els.scaleValue.textContent = `${els.scaleInput.value}%`;
      }
    });

    els.moveUpBtn?.addEventListener("click", async () => {
      if (!requireAuth("move elements")) return;
      if (!lastPickedTarget?.selector) return;
      await sendToActiveTab({ type: "MOVE_ELEMENT", selector: lastPickedTarget.selector, direction: "up" });
      showNotificationInChat("Moved up.");
    });

    els.moveDownBtn?.addEventListener("click", async () => {
      if (!requireAuth("move elements")) return;
      if (!lastPickedTarget?.selector) return;
      await sendToActiveTab({ type: "MOVE_ELEMENT", selector: lastPickedTarget.selector, direction: "down" });
      showNotificationInChat("Moved down.");
    });

    els.alignBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!requireAuth("align elements")) return;
        if (!lastPickedTarget?.selector) return;
        const align = btn.dataset.align;
        await sendToActiveTab({ type: "ALIGN_ELEMENT", selector: lastPickedTarget.selector, align });
        showNotificationInChat(`Aligned ${align}.`);
      });
    });

    els.sendBtn?.addEventListener("click", handleSend);
    els.chatInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  // Wire UI
  attachHeaderEventListeners();
  els.authGuardSignin?.addEventListener("click", () => window.open("https://webeditai.com/#/signup?from=extension", "_blank"));

  // Init
  (async () => {
    ensureFeatureControlsLayout();
    await refreshAuthorization();
    initializeFeatureHandlers();
    setActiveTool("add");
    renderChatMessages();
  })();
})();
