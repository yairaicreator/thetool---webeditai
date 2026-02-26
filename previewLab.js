// WebEdit AI - Preview Lab (Shadow DOM workspace)
// Provides a floating, draggable, resizable preview surface for AI output.

const PreviewLab = (() => {
  const HOST_ID = "webedit-preview-lab-host";
  const PREVIEW_TARGET_ATTR = "data-webedit-preview-target";
  const MAX_Z = "2147483647";

  let host = null;
  let shadowRoot = null;
  let frame = null;
  let titleEl = null;
  let bodyEl = null;
  let actionsEl = null;
  let positionControlWrap = null;
  let positionSelectEl = null;
  let onPositionChange = null;
  let styleCloneEl = null;
  let contentStyleEl = null;
  let contentScriptEl = null;
  let currentPreviewId = null;
  let currentContent = { html: "", css: "", js: "" };
  let handlers = { onApply: null, onUndo: null, onRefine: null, onClose: null };

  function ensureHost() {
    if (host && shadowRoot) return;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.position = "fixed";
    host.style.top = "80px";
    host.style.left = "80px";
    host.style.width = "520px";
    host.style.height = "420px";
    host.style.zIndex = MAX_Z;
    host.style.pointerEvents = "auto";
    host.style.userSelect = "none";

    shadowRoot = host.attachShadow({ mode: "open" });
    buildShell();
    document.body.appendChild(host);
  }

  function buildShell() {
    const baseStyle = document.createElement("style");
    baseStyle.textContent = `
      :host { all: initial; }
      .webedit-preview-frame {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #ffffff;
        color: #111827;
        border: 1px solid rgba(0,0,0,0.12);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        overflow: hidden;
        resize: both;
        min-width: 320px;
        min-height: 240px;
      }
      .webedit-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: #111827;
        color: #f9fafb;
        font-size: 13px;
        cursor: move;
        user-select: none;
      }
      .webedit-preview-title {
        font-weight: 600;
      }
      .webedit-preview-close {
        background: transparent;
        border: none;
        color: #f9fafb;
        font-size: 16px;
        cursor: pointer;
      }
      .webedit-preview-body {
        position: relative;
        flex: 1;
        overflow: auto;
        background: #f3f4f6;
        padding: 16px;
      }
      .webedit-preview-mount {
        position: relative;
        min-height: 120px;
      }
      .webedit-preview-footer {
        display: flex;
        gap: 8px;
        padding: 10px 12px;
        background: #f9fafb;
        border-top: 1px solid rgba(0,0,0,0.08);
        justify-content: space-between;
        align-items: center;
      }
      .webedit-preview-position-wrap {
        display: none;
        align-items: center;
        gap: 6px;
      }
      .webedit-preview-position-label {
        font-size: 12px;
        color: #374151;
      }
      .webedit-preview-position-select {
        font-size: 12px;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid rgba(0,0,0,0.18);
        background: #fff;
      }
      .webedit-preview-btn {
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid rgba(0,0,0,0.12);
        background: #ffffff;
        cursor: pointer;
      }
      .webedit-preview-btn-primary {
        background: #4f46e5;
        color: #ffffff;
        border-color: #4f46e5;
      }
    `;

    frame = document.createElement("div");
    frame.className = "webedit-preview-frame";

    const header = document.createElement("div");
    header.className = "webedit-preview-header";

    titleEl = document.createElement("div");
    titleEl.className = "webedit-preview-title";
    titleEl.textContent = "Preview Lab";

    const closeBtn = document.createElement("button");
    closeBtn.className = "webedit-preview-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => {
      handlers.onClose?.();
      close();
    });

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    bodyEl = document.createElement("div");
    bodyEl.className = "webedit-preview-body";

    const mount = document.createElement("div");
    mount.className = "webedit-preview-mount";
    mount.setAttribute(PREVIEW_TARGET_ATTR, "root");
    bodyEl.appendChild(mount);

    actionsEl = document.createElement("div");
    actionsEl.className = "webedit-preview-footer";

    positionControlWrap = document.createElement("div");
    positionControlWrap.className = "webedit-preview-position-wrap";
    const positionLabel = document.createElement("span");
    positionLabel.className = "webedit-preview-position-label";
    positionLabel.textContent = "Placement:";
    positionSelectEl = document.createElement("select");
    positionSelectEl.className = "webedit-preview-position-select";
    const placementOptions = [
      { value: "before", label: "Before" },
      { value: "inside", label: "Inside" },
      { value: "after", label: "After" },
      { value: "replace", label: "Replace" }
    ];
    placementOptions.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      positionSelectEl.appendChild(option);
    });
    positionSelectEl.addEventListener("change", () => {
      const nextValue = positionSelectEl?.value || "inside";
      try { onPositionChange?.(nextValue); } catch (_) {}
    });
    positionControlWrap.appendChild(positionLabel);
    positionControlWrap.appendChild(positionSelectEl);

    const actionButtonsWrap = document.createElement("div");
    actionButtonsWrap.style.display = "flex";
    actionButtonsWrap.style.gap = "8px";

    const applyBtn = document.createElement("button");
    applyBtn.className = "webedit-preview-btn webedit-preview-btn-primary";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => handlers.onApply?.());

    const refineBtn = document.createElement("button");
    refineBtn.className = "webedit-preview-btn";
    refineBtn.textContent = "Refine";
    refineBtn.addEventListener("click", () => handlers.onRefine?.());

    const undoBtn = document.createElement("button");
    undoBtn.className = "webedit-preview-btn";
    undoBtn.textContent = "Undo";
    undoBtn.addEventListener("click", () => handlers.onUndo?.());

    actionButtonsWrap.appendChild(applyBtn);
    actionButtonsWrap.appendChild(refineBtn);
    actionButtonsWrap.appendChild(undoBtn);
    actionsEl.appendChild(positionControlWrap);
    actionsEl.appendChild(actionButtonsWrap);

    frame.appendChild(header);
    frame.appendChild(bodyEl);
    frame.appendChild(actionsEl);

    shadowRoot.appendChild(baseStyle);
    shadowRoot.appendChild(frame);

    enableDrag(header);
  }

  function enableDrag(handleEl) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const nextLeft = Math.max(8, startLeft + dx);
      const nextTop = Math.max(8, startTop + dy);
      host.style.left = `${nextLeft}px`;
      host.style.top = `${nextTop}px`;
    };

    const onUp = () => {
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    handleEl.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(host.style.left || "0", 10);
      startTop = parseInt(host.style.top || "0", 10);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  function cloneHostStyles() {
    if (!shadowRoot) return;
    if (styleCloneEl) styleCloneEl.remove();
    styleCloneEl = document.createElement("div");
    styleCloneEl.setAttribute("data-webedit-lab-styles", "1");

    const styleTags = Array.from(document.querySelectorAll("style"));
    const linkTags = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    styleTags.forEach((style) => {
      const clone = style.cloneNode(true);
      styleCloneEl.appendChild(clone);
    });
    linkTags.forEach((link) => {
      const clone = link.cloneNode(false);
      styleCloneEl.appendChild(clone);
    });

    const computed = window.getComputedStyle(document.body || document.documentElement);
    const inheritStyle = document.createElement("style");
    inheritStyle.textContent = `
      .webedit-preview-body, .webedit-preview-mount {
        font-family: ${computed.fontFamily || "inherit"};
        font-size: ${computed.fontSize || "inherit"};
        color: ${computed.color || "inherit"};
        line-height: ${computed.lineHeight || "normal"};
      }
    `;
    styleCloneEl.appendChild(inheritStyle);

    shadowRoot.insertBefore(styleCloneEl, shadowRoot.firstChild);
  }

  function clearContent() {
    if (!bodyEl) return;
    const mount = bodyEl.querySelector(`.webedit-preview-mount`);
    if (mount) mount.innerHTML = "";
    if (shadowRoot) {
      const insertedNodes = shadowRoot.querySelectorAll("[data-webedit-ai-insert-id]");
      insertedNodes.forEach((node) => {
        try { node.remove(); } catch (_) {}
      });
    }
    if (contentStyleEl) {
      contentStyleEl.remove();
      contentStyleEl = null;
    }
    if (shadowRoot) {
      const injected = shadowRoot.querySelectorAll('style[data-webedit-ai-style-id]');
      injected.forEach((el) => el.remove());
    }
    if (contentScriptEl) {
      contentScriptEl.remove();
      contentScriptEl = null;
    }
    currentContent = { html: "", css: "", js: "" };
  }

  function setContent({ html = "", css = "", js = "" }) {
    if (!shadowRoot || !bodyEl) return;
    clearContent();
    const mount = bodyEl.querySelector(`.webedit-preview-mount`);
    if (!mount) return;
    if (typeof html === "string" && html.trim()) {
      mount.innerHTML = html;
    }
    if (typeof css === "string" && css.trim()) {
      contentStyleEl = document.createElement("style");
      contentStyleEl.setAttribute("data-webedit-preview-style", "1");
      contentStyleEl.textContent = css;
      shadowRoot.appendChild(contentStyleEl);
    }
    if (typeof js === "string" && js.trim()) {
      runScopedScript(js);
    }
    currentContent = { html, css, js };
  }

  function runScopedScript(js) {
    // Preview lab intentionally skips eval-based JS execution to avoid CSP violations.
    // Functional behaviors are bound through extension controllers in content scripts.
    console.info("[WebEdit PreviewLab] Skipped inline script execution in CSP-safe mode.");
  }

  function open(previewId, title, nextHandlers = {}) {
    ensureHost();
    cloneHostStyles();
    currentPreviewId = previewId || null;
    handlers = { ...handlers, ...nextHandlers };
    if (titleEl && title) titleEl.textContent = title;
    host.style.display = "block";
  }

  function close() {
    if (!host) return;
    host.style.display = "none";
    clearContent();
    setInsertionPositionControl({ visible: false });
    currentPreviewId = null;
  }

  function setInsertionPositionControl(config = {}) {
    if (!positionControlWrap || !positionSelectEl) return;
    const visible = !!config.visible;
    onPositionChange = typeof config.onChange === "function" ? config.onChange : null;
    positionControlWrap.style.display = visible ? "inline-flex" : "none";
    if (!visible) return;
    const value = typeof config.value === "string" && config.value
      ? config.value
      : "inside";
    positionSelectEl.value = value;
  }

  function getContent() {
    const mount = getMountNode();
    const html = mount ? mount.innerHTML : "";
    const styleNodes = shadowRoot
      ? Array.from(shadowRoot.querySelectorAll('style[data-webedit-preview-style], style[data-webedit-ai-style-id]'))
      : [];
    const css = styleNodes.map((style) => style.textContent || "").join("\n");
    return { html, css, js: currentContent.js };
  }

  function getMountNode() {
    if (!bodyEl) return null;
    return bodyEl.querySelector(`.webedit-preview-mount`);
  }

  function getShadowRoot() {
    return shadowRoot;
  }

  return {
    open,
    close,
    clearContent,
    setContent,
    setInsertionPositionControl,
    getContent,
    getMountNode,
    getShadowRoot
  };
})();

if (typeof window !== "undefined") {
  window.PreviewLab = PreviewLab;
}
