---
name: preview-lab
overview: Add a floating Shadow DOM Preview Lab overlay injected via content script, route preview rendering into its shadow root, and bridge Apply/Refine/Undo between the lab and existing chat preview flow.
todos: []
isProject: false
---

# Preview Lab Implementation Plan

## Context

- Preview actions are currently driven from `sidepanel.js` via Apply/Undo/Refine handlers and preview cards, and routed through `contentScript.js` to `FeatureEngine` for DOM changes. This flow will be extended to render AI output inside a floating Shadow DOM lab first, then commit to the live DOM on Apply.

## Key References

- Preview buttons + handlers in `[sidepanel.js](sidepanel.js)`

```
153:289:sidepanel.js
  async function handlePreviewApply(previewId) {
    ...
    const resp = await sendToActiveTab({ type: "COMMIT_FEATURE", previewId });
    ...
  }
  async function handlePreviewUndo(previewId) {
    ...
    const resp = await sendToActiveTab({ type: "UNDO_FEATURE", previewId });
    ...
  }
  function handlePreviewRefine(previewId) {
    ...
    pendingPreviewRefine = { previewId, plan: msg.content?.plan || null };
    ...
  }
  function renderChatMessages() {
    ...
    applyBtn.addEventListener("click", () => handlePreviewApply(data.previewId));
    undoBtn.addEventListener("click", () => handlePreviewUndo(data.previewId));
    refineBtn.addEventListener("click", () => handlePreviewRefine(data.previewId));
    ...
  }
```

- Preview/commit message routing in `[contentScript.js](contentScript.js)`

```
1562:1616:contentScript.js
    if (type === "PREVIEW_FEATURE") {
      const engine = window.FeatureEngine;
      const result = engine.applyFeature(payload.plan, "preview");
      sendResponse(result);
      return true;
    }
    if (type === "COMMIT_FEATURE") {
      ...
      if (previewId) {
        result = engine.commitPreview(previewId);
      } else {
        result = engine.applyFeature(plan, "commit");
      }
      ...
    }
    if (type === "UNDO_FEATURE") {
      ...
      if (payload.previewId) {
        const res = engine.undoPreview(payload.previewId);
        sendResponse(res);
        return true;
      }
    }
```

- Current DOM injection uses document-level head/body in `[featureSpecExecutor.js](featureSpecExecutor.js)`

```
107:163:featureSpecExecutor.js
function injectCss(cssText, markerId) {
  ...
  const head = document.head || document.documentElement;
  ...
  head.appendChild(style);
}
function createNodesFromHtml(html, markerId) {
  ...
}
function insertNodes(target, nodes, position) {
  ...
}
```

- Shadow DOM mount helper in `[injector.js](injector.js)`

```
268:345:injector.js
function mountFeature(spec, hostDocument = document) {
  ...
  const shadowRoot = host.attachShadow({ mode: 'open' });
  ...
  if (spec.css) { ... shadowRoot.appendChild(style); }
  ...
  setElementHTML(container, spec.html);
  shadowRoot.appendChild(container);
  ...
}
```

## Plan

1. **Create Preview Lab overlay (content script injected) in a new file**
  - Add `[previewLab.js](previewLab.js)` (or similar) to manage a singleton floating window with drag + resize behavior.
  - Structure:
    - Host element appended to `document.body` with high z-index.
    - Shadow root (`mode: "open"`) inside the host.
    - Inside shadow root: frame container, header (title + close), body (mount point), and footer actions (Apply/Refine/Undo).
  - Provide an API on `window.PreviewLab` (or module export) with:
    - `open(previewId, title)` / `close()` / `clear()`
    - `setContent({ html, css, js })` with injection scoped to the lab’s shadow root
    - `getContent()` to extract current HTML/CSS/JS from the shadow root for Apply
  - Use `pointer-events` and `user-select` settings to ensure interactive state inside the lab.
2. **Implement style inheritance utility for the Shadow Root**
  - Add a helper (inside `previewLab.js` or a new shared module) that clones host page styles into the lab’s shadow root.
  - Strategy:
    - Copy `<style>` tags and `<link rel="stylesheet">` tags that are same-origin or already loaded; append clones to shadow root.
    - Fallback: inline a minimal reset plus selected computed styles for `body`/`html` to preserve fonts/colors.
  - Ensure this runs before rendering preview HTML to match site visual language.
3. **Route preview rendering into the Lab instead of live DOM**
  - Extend `[featureSpecExecutor.js](featureSpecExecutor.js)` to accept an optional `root`/`container` target for CSS + HTML insertion (default to document for existing behavior).
  - When preview mode is triggered, call the executor with the lab’s shadow root container so all HTML/CSS/JS is injected there only.
  - Keep commit mode unchanged (still applies to target DOM element).
4. **Update content script message handling to control the Lab**
  - Add new message types in `[contentScript.js](contentScript.js)` for lab lifecycle:
    - `OPEN_PREVIEW_LAB` / `UPDATE_PREVIEW_LAB` (render into lab)
    - `CLOSE_PREVIEW_LAB`
    - `APPLY_PREVIEW_LAB` (extract content and apply to target selector)
  - On `PREVIEW_FEATURE`, instead of calling `FeatureEngine.applyFeature`, render via lab and store `{ previewId, plan, labSnapshot }` in a preview map for Apply/Undo.
  - On `COMMIT_FEATURE` with previewId, read lab content and inject into the live target using the existing executor, then close/clear lab.
  - On `UNDO_FEATURE`, clear lab preview for that previewId and respond ok.
5. **Wire sidepanel preview state to open the Lab when preview is ready**
  - In `[sidepanel.js](sidepanel.js)`, when a preview message is added, send `OPEN_PREVIEW_LAB` (with previewId + plan/spec) to the active tab.
  - Keep existing Apply/Undo/Refine buttons (per decision) and have them call the lab-enabled message types.
  - When Refine is triggered, keep lab open and send `UPDATE_PREVIEW_LAB` after new plan/spec is generated.
6. **Apply/Refine/Undo bridging**
  - Apply: extract HTML/CSS/JS from lab shadow root and inject into selected target element (based on existing pick element selector).
  - Refine: keep lab open; update contents with new spec; preserve drag/resize state.
  - Undo/Close: clear lab shadow root and remove host overlay.
7. **Testing & validation**
  - Manual checks on a sample page:
    - Preview appears when “Preview ready” is shown.
    - Hover/click interactions work inside the lab.
    - Apply copies content into target element and removes lab.
    - Undo/Close clears lab without touching DOM.
    - Refine updates lab content without closing.

## Todos

- Create the Preview Lab overlay module and shadow-root style cloning.
- Route preview rendering to the lab and add new content-script message types.
- Update sidepanel preview flow to open/update/close the lab.
- Validate apply/refine/undo behavior end-to-end.

