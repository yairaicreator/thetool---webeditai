---
name: lab-preview-workspace
overview: Introduce a floating Shadow DOM “Lab” preview for all AI-generated features, route previews into it, and only commit to the live page when the user clicks Apply.
todos:
  - id: lab-ui
    content: Create PreviewLab with ShadowRoot + drag/resize + buttons
    status: pending
  - id: lab-preview-routing
    content: Route PREVIEW_FEATURE/_SPEC into Lab, store state
    status: pending
  - id: lab-commit-bridge
    content: Apply/Refine/Undo from Lab to live DOM paths
    status: pending
  - id: executor-support
    content: Add shadowRoot support in FeatureSpecExecutor/Engine
    status: pending
isProject: false
---

# Lab Preview Workspace Plan

## Context

- Chat preview actions are handled in `sidepanel.js` and currently call `COMMIT_FEATURE`/`UNDO_FEATURE` directly.```153:178:c:\WebEdit AI\dev\thetool---webeditai-1\sidepanel.js
async function handlePreviewApply(previewId) {
if (!previewId) return;
const thinking = addChatMessage("assistant", "Applying preview...");
const resp = await sendToActiveTab({ type: "COMMIT_FEATURE", previewId });
if (resp?.response?.ok) {
chatMessages = chatMessages.filter(m => !(m.type === "preview" && m.content?.previewId === previewId));
thinking.content = "✅ Feature applied.";
} else {
thinking.content = `❌ Apply failed: ${resp?.response?.error || "unknown error"}`;
}
renderChatMessages();
saveChatHistory();
}

```
- AI spec edits are applied immediately in `sidepanel.js` by calling `APPLY_FEATURE_SPEC`.```1038:1070:c:\WebEdit AI\dev\thetool---webeditai-1\sidepanel.js
const aiResp = window.SupabaseClient?.generateFeatureSpec
  ? await window.SupabaseClient.generateFeatureSpec(text, pageContext)
  : null;
// ...
const applyResp = await sendToActiveTab({ type: "APPLY_FEATURE_SPEC", spec });
```

- `contentScript.js` routes preview/commit and spec-apply messages to `FeatureEngine` and `FeatureSpecExecutor`.```1485:1600:c:\WebEdit AI\dev\thetool---webeditai-1\contentScript.js
if (type === "APPLY_FEATURE_SPEC") { /* ... */ }
if (type === "PREVIEW_FEATURE") { /* ... */ }
if (type === "COMMIT_FEATURE") { /* ... */ }

```

## Plan
1) **Create Lab UI + Shadow Root host**
   - Add a new `PreviewLab.js` module that creates a draggable/resizable floating window, attaches a ShadowRoot (`mode: "open"`), and exposes methods like `openPreview({ kind, targetSelector, plan/spec })`, `updatePreview(...)`, `getPreviewPayload()`, `clearPreview()`, and `isOpen()`.
   - Include a `clonePageStylesIntoShadow(shadowRoot)` utility that copies page `<style>` and same‑origin `<link rel="stylesheet">` rules into the ShadowRoot so the preview matches host styles.
   - Put Apply/Refine/Undo/Close buttons inside the Lab header, but also keep chat preview actions (per your choice). The Lab buttons will dispatch messages back to the sidepanel via `chrome.runtime.sendMessage` so existing flows can reuse the same handlers.

2) **Route all previews into the Lab**
   - **AI spec flow** (generateFeatureSpec): change `sidepanel.js` to call a new message `PREVIEW_FEATURE_SPEC` instead of `APPLY_FEATURE_SPEC` so nothing touches the live DOM until Apply.
   - **FeatureEngine flow** (Add Feature): when preview is created (`PREVIEW_FEATURE`), open the Lab and render the preview version in the ShadowRoot automatically when “Preview ready” is shown.
   - Add Lab‑specific message handlers in `contentScript.js` for:
     - `PREVIEW_FEATURE_SPEC` → render the spec HTML/CSS in the Lab ShadowRoot only
     - `PREVIEW_FEATURE` (or a new `PREVIEW_FEATURE_IN_LAB`) → apply the plan against a clone inside the Lab ShadowRoot (no live DOM changes)

3) **Apply/Refine/Undo from Lab → bridge to live**
   - Store the current preview payload inside `PreviewLab` so Apply can reconstitute the HTML/CSS/JS/behavior. This satisfies the “extract from ShadowRoot” requirement by reading from the ShadowRoot container and any `<style>` tags inserted there.
   - On Apply:
     - For spec previews: call `FeatureSpecExecutor.applyFeatureSpec()` against the real document with the extracted html/css/behavior and original selector/position.
     - For FeatureEngine previews: call `FeatureEngine.applyFeature(plan, "commit")` using the stored plan (since nothing touched live DOM yet).
   - On Undo/Close: clear Lab content and discard preview state without touching live DOM.
   - On Refine: keep the Lab open, send a “refine” request to the sidepanel, and re-render the Lab with the updated spec/plan when it returns.

4) **Preview execution support in FeatureSpecExecutor/FeatureEngine**
   - Extend `FeatureSpecExecutor.applyFeatureSpec()` to accept an optional `root`/`shadowRoot` and `container` so it can insert HTML/CSS into the Lab ShadowRoot instead of `document.head`/`document` (no live DOM mutations).
   - Extend `FeatureEngine.applyFeature()` to accept a root element or document override (used when rendering into the Lab clone), while keeping current behavior for commits.

## Files to change
- `c:\WebEdit AI\dev\thetool---webeditai-1\PreviewLab.js` (new)
- `c:\WebEdit AI\dev\thetool---webeditai-1\contentScript.js`
- `c:\WebEdit AI\dev\thetool---webeditai-1\sidepanel.js`
- `c:\WebEdit AI\dev\thetool---webeditai-1\featureSpecExecutor.js`
- `c:\WebEdit AI\dev\thetool---webeditai-1\featureEngine.js`
- `c:\WebEdit AI\dev\thetool---webeditai-1\panel.css` or `contentStyles.css` (Lab window styling)

## Notes / Assumptions
- “All previews” means both AI HTML/CSS/JS specs and Add Feature previews will be rendered inside the Lab ShadowRoot, with no live DOM changes until Apply.
- Lab controls exist both in the Lab window and in chat preview messages, and both trigger the same apply/refine/undo actions.

## Test plan
- Trigger Add Feature → confirm “Preview ready” opens the Lab and renders the preview inside ShadowRoot; clicking Apply commits to the live DOM.
- Trigger standard AI edit → confirm no live DOM change until Apply; Refine updates the Lab; Undo clears Lab.
- Verify elements inside the Lab are interactive (click/hover) and that styles match the host page.
```

