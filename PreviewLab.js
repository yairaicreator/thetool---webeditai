// WebEdit AI - Preview Lab (Shadow DOM preview workspace)
// Loaded as a classic script; exposes PreviewLab on window.

const PreviewLab = (() => {
  const LAB_ID = "webedit-preview-lab";
  const LAB_Z_INDEX = 2147483647;
  const LAB_STYLE_MARKER = "data-webedit-lab-style";
  const LAB_CSS_MARKER = "data-webedit-lab-css";
  const LAB_HTML_MARKER = "data-webedit-lab-html";
  const LAB_TARGET_MARKER = "data-webedit-lab-target";

  let labEl = null;
  let shadowHost = null;
  let shadowRoot = null;
  let shadowContainer = null;
  let currentPreview = null;

  function ensureLab() {
    if (labEl && shadowRoot && shadowContainer) return;

    labEl = document.getElementById(LAB_ID);
    if (!labEl) {
      labEl = document.createElement("div");
      labEl.id = LAB_ID;
      labEl.className = "webedit-preview-lab";
      labEl.style.zIndex = String(LAB_Z_INDEX);
      document.body.appendChild(labEl);
    }

    labEl.innerHTML = `
      <div class="webedit-preview-lab-header">
        <div class="webedit-preview-lab-title">The Lab</div>
        <div class="webedit-preview-lab-actions">
          <button class="webedit-preview-lab-btn" data-action="apply">Apply</button>
          <button class="webedit-preview-lab-btn" data-action="refine">Refine</button>
          <button class="webedit-preview-lab-btn" data-action="undo">Undo</button>
          <button class="webedit-preview-lab-btn" data-action="close">Close</button>
        </div>
      </div>
      <div class="webedit-preview-lab-body">
        <div class="webedit-preview-lab-preview-host"></div>
      </div>
      <div class="webedit-preview-lab-resizer" aria-hidden="true"></div>
    `;

    shadowHost = labEl.querySelector(".webedit-preview-lab-preview-host");
    if (!shadowHost) return;
    shadowRoot = shadowHost.attachShadow({ mode: "open" });
    shadowContainer = document.createElement("div");
    shadowContainer.className = "webedit-preview-lab-shadow-container";
    shadowRoot.appendChild(shadowContainer);

    wireLabActions();
    wireDrag();
    wireResize();
    isolateEvents();
  }

  function isolateEvents() {
    if (!labEl) return;
    const stop = (event) => {
      event.stopPropagation();
    };
    ["click", "mousedown", "mouseup", "keydown", "keypress", "keyup", "wheel", "touchstart", "touchend", "pointerdown", "pointerup"].forEach((type) => {
      labEl.addEventListener(type, stop, true);
    });
  }

  function wireLabActions() {
    labEl.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        const previewId = currentPreview?.previewId || null;
        try {
          chrome.runtime?.sendMessage?.({ type: "LAB_ACTION", action, previewId });
        } catch (_) {}
      });
    });
  }

  function wireDrag() {
    const header = labEl.querySelector(".webedit-preview-lab-header");
    if (!header) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerDown = (event) => {
      if (!(event instanceof PointerEvent)) return;
      dragging = true;
      labEl.setPointerCapture(event.pointerId);
      const rect = labEl.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      labEl.style.right = "auto";
      labEl.style.bottom = "auto";
      labEl.style.left = `${startLeft}px`;
      labEl.style.top = `${startTop}px`;
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      labEl.style.left = `${startLeft + dx}px`;
      labEl.style.top = `${startTop + dy}px`;
    };

    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = false;
      try { labEl.releasePointerCapture(event.pointerId); } catch (_) {}
    };

    header.addEventListener("pointerdown", onPointerDown);
    header.addEventListener("pointermove", onPointerMove);
    header.addEventListener("pointerup", onPointerUp);
    header.addEventListener("pointercancel", onPointerUp);
  }

  function wireResize() {
    const handle = labEl.querySelector(".webedit-preview-lab-resizer");
    if (!handle) return;
    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    const onPointerDown = (event) => {
      if (!(event instanceof PointerEvent)) return;
      resizing = true;
      handle.setPointerCapture(event.pointerId);
      const rect = labEl.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
    };

    const onPointerMove = (event) => {
      if (!resizing) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      labEl.style.width = `${Math.max(320, startWidth + dx)}px`;
      labEl.style.height = `${Math.max(240, startHeight + dy)}px`;
    };

    const onPointerUp = (event) => {
      if (!resizing) return;
      resizing = false;
      try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
    };

    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  }

  function clonePageStylesIntoShadow(root) {
    if (!root || root.querySelector(`[${LAB_STYLE_MARKER}="1"]`)) return;
    const styleHost = document.createElement("div");
    styleHost.setAttribute(LAB_STYLE_MARKER, "1");
    const styleNodes = Array.from(document.querySelectorAll("style, link[rel=\"stylesheet\"]"));
    styleNodes.forEach((node) => {
      try {
        if (node.tagName === "STYLE") {
          const style = document.createElement("style");
          style.textContent = node.textContent || "";
          styleHost.appendChild(style);
          return;
        }
        if (node.tagName === "LINK") {
          const href = node.getAttribute("href");
          if (!href) return;
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          styleHost.appendChild(link);
        }
      } catch (_) {}
    });
    root.appendChild(styleHost);
  }

  function clearShadow() {
    if (!shadowContainer) return;
    shadowContainer.innerHTML = "";
  }

  function setStatus(message) {
    if (!shadowContainer) return;
    const status = document.createElement("div");
    status.className = "webedit-preview-lab-status";
    status.textContent = message;
    clearShadow();
    shadowContainer.appendChild(status);
  }

  function getTargetClone(targetSelector) {
    if (!targetSelector) return null;
    try {
      const target = document.querySelector(targetSelector);
      if (!target) return null;
      const clone = target.cloneNode(true);
      if (clone instanceof Element) {
        clone.setAttribute(LAB_TARGET_MARKER, "1");
      }
      return clone;
    } catch (_) {
      return null;
    }
  }

  function renderSpecPreview(spec, previewId) {
    ensureLab();
    open();
    clonePageStylesIntoShadow(shadowRoot);
    clearShadow();

    const targetSelector = spec?.targetSelector || spec?.selector || "";
    const targetClone = getTargetClone(targetSelector);
    if (targetClone) {
      shadowContainer.appendChild(targetClone);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "webedit-preview-lab-placeholder";
      placeholder.textContent = "Preview target not found. Showing feature in isolation.";
      shadowContainer.appendChild(placeholder);
    }

    currentPreview = {
      previewId,
      kind: "spec",
      spec: { ...spec },
      targetSelector,
      createdAt: Date.now()
    };

    const exec = window.FeatureSpecExecutor;
    if (!exec || typeof exec.applyFeatureSpec !== "function") {
      setStatus("FeatureSpec preview engine unavailable.");
      return { ok: false, error: "FeatureSpec preview engine unavailable" };
    }

    const applyTarget = targetClone || shadowContainer;
    const previewSpec = { ...spec };
    const applied = exec.applyFeatureSpec(previewSpec, {
      skipPersist: true,
      root: shadowRoot,
      targetEl: applyTarget,
      id: previewId
    });
    if (applied && typeof applied.then === "function") {
      applied.then(() => markInsertedNodes(previewId)).catch(() => {});
    } else {
      markInsertedNodes(previewId);
    }

    return { ok: true };
  }

  function renderPlanPreview(plan, previewId) {
    ensureLab();
    open();
    clonePageStylesIntoShadow(shadowRoot);
    clearShadow();

    const targetSelector = plan?.targetSelector || "";
    const targetClone = getTargetClone(targetSelector);
    if (!targetClone) {
      setStatus("Preview target not found.");
      currentPreview = { previewId, kind: "plan", plan, targetSelector, createdAt: Date.now() };
      return { ok: false, error: "Target not found" };
    }

    shadowContainer.appendChild(targetClone);
    currentPreview = {
      previewId,
      kind: "plan",
      plan: { ...plan },
      targetSelector,
      createdAt: Date.now()
    };

    const engine = window.FeatureEngine;
    if (engine && typeof engine.applyFeature === "function") {
      engine.applyFeature(plan, "preview", { targetEl: targetClone, root: shadowRoot, skipBadges: true, skipPreviewStore: true });
    }

    return { ok: true };
  }

  function getPreviewPayload(previewId) {
    if (!currentPreview || (previewId && currentPreview.previewId !== previewId)) return null;
    const payload = { ...currentPreview };

    if (currentPreview.kind === "spec") {
      const styleEl = shadowRoot?.querySelector(`style[${LAB_CSS_MARKER}="${previewId}"]`);
      const inserted = shadowRoot?.querySelectorAll(`[${LAB_HTML_MARKER}="${previewId}"]`) || [];
      const html = Array.from(inserted)
        .map((node) => {
          if (!(node instanceof Element)) return node.outerHTML || "";
          const clone = node.cloneNode(true);
          if (clone instanceof Element) {
            clone.removeAttribute(LAB_HTML_MARKER);
            clone.removeAttribute("data-webedit-ai-insert-id");
            clone.removeAttribute("data-webedit-ai-bound");
            clone.removeAttribute("data-webedit-ai-style-state");
          }
          return clone.outerHTML || "";
        })
        .join("")
        .trim();
      payload.extracted = {
        html,
        css: styleEl?.textContent || ""
      };
    }

    return payload;
  }

  function markInsertedNodes(previewId) {
    const nodes = shadowRoot?.querySelectorAll(`[data-webedit-ai-insert-id="${CSS.escape(previewId)}"]`) || [];
    nodes.forEach((node) => {
      if (node instanceof Element) {
        node.setAttribute(LAB_HTML_MARKER, previewId);
      }
    });
    const styleEl = shadowRoot?.querySelector(`style[data-webedit-ai-style-id="${CSS.escape(previewId)}"]`);
    if (styleEl) {
      styleEl.setAttribute(LAB_CSS_MARKER, previewId);
    }
  }

  function open() {
    ensureLab();
    labEl.classList.add("webedit-preview-lab-open");
  }

  function clearPreview(options = {}) {
    const keepOpen = !!options.keepOpen;
    currentPreview = null;
    clearShadow();
    if (!keepOpen) {
      labEl.classList.remove("webedit-preview-lab-open");
    }
  }

  return {
    openPreview: (payload) => {
      const previewId = payload?.previewId || `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (payload?.kind === "spec") {
        renderSpecPreview(payload.spec, previewId);
      } else if (payload?.kind === "plan") {
        renderPlanPreview(payload.plan, previewId);
      }
      return previewId;
    },
    getPreviewPayload,
    clearPreview,
    isOpen: () => !!labEl?.classList.contains("webedit-preview-lab-open"),
    renderSpecPreview,
    renderPlanPreview
  };
})();

try {
  window.PreviewLab = PreviewLab;
} catch (_) {}
