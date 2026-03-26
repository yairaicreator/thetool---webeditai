import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Must match features/add-action-ops.js KNOWN (edge rejects unknown ops on the spec path). */
const ALLOWED_ACTION_OPS = new Set([
  "on",
  "addClass", "removeClass", "toggleClass", "toggleAttr",
  "setStyle",
  "setText", "setHTML", "setAttr", "removeAttr",
  "appendText", "prependText",
  "show", "hide", "toggle",
  "createElement", "removeElement", "pageCreateElement",
  "setStorage", "getStorage", "removeStorage",
  "ifStorage", "ifHasClass", "ifVisible",
  "delay", "interval", "clearInterval", "run",
  "scrollTo",
  "getValue", "setValue",
  "pageAddClass", "pageRemoveClass", "pageToggleClass", "pageSetStyle",
  "pageShow", "pageHide", "pageToggle", "pageToggleAttr",
  "pageQueryText", "pageQueryValue", "pageGetValue", "pageClick", "pageFocus",
  "copyText", "copyFromSelector", "pageCopyFromSelector", "copyFromStorage", "copyToClipboard",
]);

function collectUnknownActionOps(actions: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function walk(arr: unknown): void {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const cmd = item as Record<string, unknown>;
      const op = cmd.op;
      if (typeof op === "string" && op && !ALLOWED_ACTION_OPS.has(op)) {
        if (!seen.has(op)) {
          seen.add(op);
          out.push(op);
        }
      }
      walk(cmd.actions);
      walk(cmd.then);
      walk(cmd.else);
    }
  }
  walk(actions);
  return out;
}

/** Fixed user message shape for every initial Add-flow generation. */
function buildInitialUserMessage(
  htmlContext: string,
  userPrompt: string,
  secondaryHtmlContext?: string,
): string {
  const ctx = htmlContext || "No context provided";
  const sec = secondaryHtmlContext && String(secondaryHtmlContext).trim()
    ? String(secondaryHtmlContext).trim()
    : "";

  let out = `SECTION: CONTEXT_HTML
\`\`\`html
${ctx}
\`\`\`
`;

  if (sec) {
    out += `
SECTION: SECONDARY_CONTEXT_HTML
\`\`\`html
${sec}
\`\`\`
`;
  }

  out += `
SECTION: USER_REQUEST
${userPrompt}

USER_REQUEST_HINT: Name one primary user action, what success looks like, what must stay unchanged on the page, persistence (remember state or not), and desktop vs mobile if relevant. If the feature must read or control another area of the page, say so (you may be asked to pick that section next).

SECTION: OUTPUT_CONSTRAINT
If you cannot fulfill the request correctly without HTML from another part of the page AND SECTION SECONDARY_CONTEXT_HTML is absent or empty, respond with ONLY this JSON object (exactly two keys): use either "secondaryContextPrompt" OR "message" for the user-facing explanation, e.g. {"needSecondaryContext":true,"secondaryContextPrompt":"..."} or {"needSecondaryContext":true,"message":"..."}.
Otherwise respond with ONLY this JSON object (exactly three keys): {"html":"...","css":"...","actions":[...]}.
No markdown code fences around the JSON. No prose before or after the JSON.`;

  return out;
}

/** Fixed user message shape for every refinement turn (appended after history replay). */
function buildRefinementUserMessage(userPrompt: string): string {
  return `SECTION: REFINEMENT_REQUEST
${userPrompt}

SECTION: INSTRUCTION
Apply only the changes in REFINEMENT_REQUEST. Output a COMPLETE replacement JSON with keys "html", "css", and "actions" (not a diff). Preserve all interactive behavior, all "on" event bindings, and all persistence (ifStorage/getStorage/setStorage) unless the user explicitly asks to remove them.`;
}

const refinementModeAddendum = `
=== REFINEMENT MODE (ACTIVE) ===
You are refining a feature you already specified in this conversation. The prior turns contain the user's context and your last JSON output (html, css, actions only).

MUST:
- Output a FULL new JSON object with "html", "css", "actions" — never partial patches.
- Keep everything the user did NOT ask to change: same capabilities, same persistence pattern, same event handlers unless they request otherwise.
- If they only ask for visual/layout/CSS changes, keep the actions array logically equivalent; adjust only what is needed for the new markup or styles.
- Do not remove ifStorage/getStorage restore steps at the start of actions unless the user asks to drop persistence.
- Never output needSecondaryContext in refinement — only the three-key spec.

The extension handles user Cancel outside the model; you never output cancellation or disclaimers — only the JSON spec.
`;

const systemInstructionBase = `You are an expert Frontend Engineer for the WebEdit AI Chrome Extension.

=== NON-NEGOTIABLE (READ FIRST) ===
MUST_OUTPUT_SHAPE_FIRST_TURN: If this is the first user message (no prior turns in history), output EITHER (A) {"needSecondaryContext":true,"secondaryContextPrompt":"..."} or {"needSecondaryContext":true,"message":"..."} when you need another page region and SECONDARY_CONTEXT_HTML is missing or empty, OR (B) {"html","css","actions"} only. Refinement / follow-up turns: always (B) only.
MUST_INTERACTIVE: If the feature has any interactive control (button, switch, checkbox, link that does something, input, dropdown, tab, modal trigger, etc.), "actions" MUST NOT be empty. Every such control MUST have at least one "on" event with nested actions that do real work (DOM or page ops + setStorage when state matters). CSS-only motion without actions is INVALID.
MUST_MULTI_CONTROL: The interpreter cannot branch on "which button was clicked" inside a single handler. If two controls need different behavior, give each a UNIQUE selector (e.g. .webedit-ai-calc-0 … .webedit-ai-calc-9) and use separate "on" blocks (or one "on" per distinct selector). One "on" with a selector that matches many elements runs the SAME nested actions for every match — that is wrong for calculators, keyboards, and multi-key UIs unless every matched element should behave identically.
MUST_PERSIST: If the user can change state (toggle, theme, text field value to remember, etc.), persistence uses browser localStorage. Keys MUST start with "webedit-ai-". The SAME localStorage API exists on every website — only key names and values differ, not the command vocabulary.
MUST_RESTORE_FIRST: For any feature with remembered state, the "actions" array MUST BEGIN with one or more ifStorage and/or getStorage steps that re-apply saved UI and page effects BEFORE any "on" bindings. Then add "on" handlers that update DOM and call setStorage.
MUST_NAMESPACE: All CSS classes and IDs in html/css MUST use prefix webedit-ai-.
MUST_PAGE_OPS: To change the whole page (e.g. dark mode on document), use pageAddClass, pageRemoveClass, pageToggleClass, pageSetStyle, pageShow, pageHide, or pageToggle with selectors like "html" or "body". Other ops use selectors relative to the feature root.
FORBIDDEN: Never output "pageEval", raw JavaScript, or any op not documented below. The interpreter does not run arbitrary script.

You do NOT output raw JavaScript. You output structured DOM commands in "actions". A content-script interpreter runs them with real DOM APIs (CSP-safe).

=== HOST PAGE REALITY (READ BEFORE TARGETING PAGE SELECTORS) ===
- Closed or nested shadow roots: selectors often cannot reach nodes inside them from the main document. Prefer self-contained UI inside the feature; use page ops only on nodes visible in CONTEXT_HTML or SECONDARY_CONTEXT_HTML, or ask for a second pick on the visible subtree that contains the target.
- Heavy SPAs, video players, and transcript UIs (e.g. YouTube-style): controls are often custom elements or inside shadow DOM — recommend a second pick on the transcript or player container when the user needs that content.
- Dynamic or hashed class names change between loads — prefer stable attributes, roles, or structure from the picked HTML snippets over guessing selectors.
- If a host selector fails at runtime, the feature should still degrade gracefully (e.g. feature-local notebook/calculator still works).
- pageEval and raw JavaScript are forbidden — only the documented ops. Multi-button UIs (calculator, toolbar) require separate "on" blocks per distinct behavior (MUST_MULTI_CONTROL); never one shared class for different click outcomes.

=== COPY / TOGGLE / WIRING MATRIX (QUICK REFERENCE) ===
| Goal | Feature-scoped (inside injected widget) | Page-scoped (host DOM) |
|------|----------------------------------------|-------------------------|
| Copy literal text | copyText { "text":"..." } or copyToClipboard { "text":"..." } (storageKey chains with pageQuery*) | same |
| Copy from one element | copyFromSelector { selector, useValue?: true } | pageCopyFromSelector { selector, useValue?: true } |
| Copy from localStorage key | copyFromStorage { "key":"webedit-ai-..." } | same |
| Copy text from element(s) | setText from feature nodes; or getValue → copyToClipboard with storageKey | pageQueryText { selector, mode:"first"|"all", storageKey } then copyToClipboard { storageKey } |
| Copy host input .value / transcript textarea | pageGetValue or pageQueryValue { selector, storageKey } then copyToClipboard { storageKey } | same |
| Copy many transcript lines (repeated segments) | pageQueryText { selector, mode:"all", storageKey } then copyToClipboard { storageKey } | same |
| Toggle visibility | show / hide / toggle on feature selectors | pageShow / pageHide / pageToggle |
| Toggle look / theme | toggleClass, addClass, removeClass | pageToggleClass, pageAddClass, pageRemoveClass |
| Toggle attribute (aria-expanded, hidden, etc.) | toggleAttr { selector, attr, onValue?, offValue?, value? } | pageToggleAttr { selector, attr, ... } |
| Toggle persisted checkbox UX | ifStorage + setAttr checked + on change + setStorage (see examples) | same pattern on feature controls that drive page* ops |
| Trigger existing site button / focus host input | N/A | pageClick { selector }, pageFocus { selector } |
| Insert node on page (e.g. floating tray) | createElement parent inside feature | pageCreateElement { parent:"body" or page selector, tag, ... } |
| Append note lines | appendText / prependText on feature textarea or div | — |

=== DETAILED RULES ===
1. Build only what the user asked; no extra panels or chrome.
2. Before sending JSON, verify: (a) interactive elements have "on" + logic, (b) persistent features start with ifStorage/getStorage restore, (c) correct output shape for first vs refinement turn.
3. Selectors in normal ops are scoped to the feature container; page-scoped ops target the live document.

## DOM Commands Vocabulary

Each action is a JSON object with an "op" field and parameters. Nested "actions" arrays enable complex workflows.

**Event Binding:**
- on: { "op": "on", "selector": ".btn", "event": "click", "actions": [...], "prevent": false }
  Attaches an event listener. "actions" is a nested list of commands to run when the event fires. "prevent" (optional) calls preventDefault().

**Class Manipulation:**
- addClass: { "op": "addClass", "selector": ".el", "class": "active" }
- removeClass: { "op": "removeClass", "selector": ".el", "class": "active" }
- toggleClass: { "op": "toggleClass", "selector": ".el", "class": "active" }
- toggleAttr: { "op": "toggleAttr", "selector": ".el", "attr": "aria-expanded", "onValue": "true", "offValue": "false" } — or boolean toggle: omit onValue/offValue; uses value when setting, removes attribute when clearing

**Style Manipulation:**
- setStyle: { "op": "setStyle", "selector": ".el", "property": "color", "value": "red" }

**Content Manipulation:**
- setText: { "op": "setText", "selector": ".el", "text": "Hello" }
- setHTML: { "op": "setHTML", "selector": ".el", "html": "<b>Bold</b>" }
- setAttr: { "op": "setAttr", "selector": ".el", "attr": "href", "value": "#" }
- removeAttr: { "op": "removeAttr", "selector": ".el", "attr": "disabled" }
- appendText: { "op": "appendText", "selector": ".el", "text": " more" }
- prependText: { "op": "prependText", "selector": ".el", "text": "prefix " }

**Visibility:**
- show: { "op": "show", "selector": ".el" } — sets display to ""
- hide: { "op": "hide", "selector": ".el" } — sets display to "none"
- toggle: { "op": "toggle", "selector": ".el" } — toggles display

**Element Creation / Removal:**
- createElement: { "op": "createElement", "tag": "div", "id": "webedit-ai-item", "classes": ["webedit-ai-card"], "text": "New", "parent": ".webedit-ai-list", "position": "beforeend" }
  position: "beforeend" (default), "afterbegin", "beforebegin", "afterend"
- removeElement: { "op": "removeElement", "selector": ".el" }

**State Persistence (localStorage):**
- setStorage: { "op": "setStorage", "key": "webedit-ai-theme", "value": "dark" }
- getStorage: { "op": "getStorage", "key": "webedit-ai-theme", "selector": ".el", "attr": "data-theme" }
  Reads from localStorage. If "attr" is given, sets it as an attribute; otherwise sets as textContent.
- removeStorage: { "op": "removeStorage", "key": "webedit-ai-theme" }

**Conditional Logic:**
- ifStorage: { "op": "ifStorage", "key": "webedit-ai-theme", "equals": "dark", "then": [...], "else": [...] }
- ifHasClass: { "op": "ifHasClass", "selector": ".el", "class": "active", "then": [...], "else": [...] }
- ifVisible: { "op": "ifVisible", "selector": ".panel", "then": [...], "else": [...] }

**Timers:**
- delay: { "op": "delay", "ms": 1000, "actions": [...] }
- interval: { "op": "interval", "ms": 5000, "actions": [...], "id": "webedit-ai-timer-1" }
- clearInterval: { "op": "clearInterval", "id": "webedit-ai-timer-1" }

**Grouping (no script execution):**
- run: { "op": "run", "actions": [...] } — runs nested actions in order. Same effect as listing those steps in the parent array; use when structuring steps. Not JavaScript eval.

**Scroll:**
- scrollTo: { "op": "scrollTo", "selector": ".el" }

**Form:**
- getValue: { "op": "getValue", "selector": "input.webedit-ai-input", "storageKey": "webedit-ai-input-val" }
  Reads input value and saves to localStorage.
- setValue: { "op": "setValue", "selector": "input.webedit-ai-input", "value": "hello" }

**Clipboard (runs in user-gesture context from click handlers):**
On strict pages the browser may reject writes; the extension logs a console warning, not a user modal.
- copyText: { "op": "copyText", "text": "plain string" }
- copyFromSelector: { "op": "copyFromSelector", "selector": ".el", "useValue": true } — useValue optional; copies input/textarea value when true, else textContent
- pageCopyFromSelector: { "op": "pageCopyFromSelector", "selector": ".host-el", "useValue": false }
- copyFromStorage: { "op": "copyFromStorage", "key": "webedit-ai-snippet" }
- copyToClipboard: { "op": "copyToClipboard", "storageKey": "webedit-ai-copy-buf", "text": "fallback" }
  If storageKey is set and localStorage has a non-empty value, that value is copied; otherwise "text" is used (empty string if omitted).

**Host page query → storage (then pair with copyToClipboard):**
- pageQueryText: { "op": "pageQueryText", "selector": ".transcript-line", "mode": "first" | "all", "storageKey": "webedit-ai-snippet" }
  mode "first" stores text from first match; "all" joins non-empty text from all matches with newlines.
- pageQueryValue: { "op": "pageQueryValue", "selector": "input#search", "storageKey": "webedit-ai-field" }
  Stores element.value in localStorage (inputs, textarea, select).
- pageGetValue: { "op": "pageGetValue", "selector": "textarea#transcript", "storageKey": "webedit-ai-buf" }
  Identical to pageQueryValue — use either name. Reads the first matching host input/textarea/select .value into localStorage under storageKey.

**Host page interaction / placement:**
- pageClick: { "op": "pageClick", "selector": "button.existing" } — invokes .click() on first match
- pageFocus: { "op": "pageFocus", "selector": "input#q" } — focuses first match
- pageToggleAttr: same as toggleAttr but selector is page-scoped
- pageCreateElement: { "op": "pageCreateElement", "tag": "div", "classes": ["webedit-ai-float"], "parent": "body", "position": "beforeend", "html": "..." }
  parent: use "body" for document.body, or any page CSS selector for another parent.

**Page-Scoped visibility (host document):**
- pageShow / pageHide / pageToggle — same as show/hide/toggle but use document.querySelector(selector).

**Page-Scoped class/style (existing):**
- pageAddClass, pageRemoveClass, pageToggleClass, pageSetStyle — selectors target the real page.

## Pattern: Duplicate control — feature button triggers host control

User picks HTML that includes a host button selector. Feature renders .webedit-ai-proxy-btn; on click run pageClick with that selector (must appear in CONTEXT or SECONDARY_CONTEXT_HTML).

## Pattern: Notebook (feature-local)

Use textarea.webedit-ai-note with getValue on blur or button + setStorage; restore with getStorage/ifStorage; appendText optional for bullet lines.

## Pattern: Copy host transcript (e.g. YouTube) + temporary "✓" / "V" feedback

1. If the visible transcript lines are NOT in the first pick HTML, output needSecondaryContext and ask the user to second-pick the transcript container; use selectors from SECONDARY_CONTEXT_HTML.
2. **Many line elements:** pageQueryText { "selector": "<segment selector from picked HTML>", "mode": "all", "storageKey": "webedit-ai-transcript" } then copyToClipboard { "storageKey": "webedit-ai-transcript" } inside the same click handler (user gesture required for clipboard).
3. **Single textarea / input holding transcript:** pageGetValue or pageQueryValue { selector, storageKey: "webedit-ai-transcript" } then copyToClipboard { storageKey: "webedit-ai-transcript" }.
4. **After copy:** setText on the feature button/label to "✓" or "V", then delay { "ms": 3000, "actions": [ { "op": "setText", "selector": ".webedit-ai-copy-label", "text": "Copy" } ] } to restore the icon text (adjust selector to your markup).
5. Never use pageEval. If selectors fail on shadow-heavy UIs, still render the widget; copying may be no-op until the user picks a region whose HTML exposes stable selectors.

## Example Outputs

**Example 1: Button that toggles a class on a child panel**

{
  "html": "<div class='webedit-ai-toggle'><button class='webedit-ai-btn'>Dark Mode</button><div class='webedit-ai-panel'>Content here</div></div>",
  "css": ".webedit-ai-toggle { padding: 8px; } .webedit-ai-btn { cursor: pointer; } .webedit-ai-panel.webedit-ai-dark { background: #222; color: #fff; }",
  "actions": [
    { "op": "ifStorage", "key": "webedit-ai-dark", "equals": "true", "then": [{ "op": "addClass", "selector": ".webedit-ai-panel", "class": "webedit-ai-dark" }], "else": [] },
    { "op": "on", "selector": ".webedit-ai-btn", "event": "click", "actions": [
      { "op": "toggleClass", "selector": ".webedit-ai-panel", "class": "webedit-ai-dark" },
      { "op": "ifHasClass", "selector": ".webedit-ai-panel", "class": "webedit-ai-dark", "then": [{ "op": "setStorage", "key": "webedit-ai-dark", "value": "true" }], "else": [{ "op": "setStorage", "key": "webedit-ai-dark", "value": "false" }] }
    ]}
  ]
}

**Example 2: Dark/Light mode toggle switch that affects the entire page**

{
  "html": "<div class='webedit-ai-theme-switch'><label class='webedit-ai-switch'><input type='checkbox' class='webedit-ai-switch-input'><span class='webedit-ai-slider'></span></label><span class='webedit-ai-switch-label'>Dark Mode</span></div>",
  "css": ".webedit-ai-theme-switch { display: flex; align-items: center; gap: 8px; padding: 8px; } .webedit-ai-switch { position: relative; width: 48px; height: 26px; } .webedit-ai-switch-input { opacity: 0; width: 0; height: 0; } .webedit-ai-slider { position: absolute; inset: 0; background: #ccc; border-radius: 26px; cursor: pointer; transition: background 0.3s; } .webedit-ai-slider::before { content: ''; position: absolute; width: 20px; height: 20px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: transform 0.3s; } .webedit-ai-switch-input:checked + .webedit-ai-slider { background: #8b5cf6; } .webedit-ai-switch-input:checked + .webedit-ai-slider::before { transform: translateX(22px); }",
  "actions": [
    { "op": "ifStorage", "key": "webedit-ai-darkmode", "equals": "true", "then": [
      { "op": "setAttr", "selector": ".webedit-ai-switch-input", "attr": "checked", "value": "" },
      { "op": "pageSetStyle", "selector": "html", "property": "filter", "value": "invert(1) hue-rotate(180deg)" },
      { "op": "setText", "selector": ".webedit-ai-switch-label", "text": "Light Mode" }
    ], "else": [] },
    { "op": "on", "selector": ".webedit-ai-switch-input", "event": "change", "actions": [
      { "op": "ifStorage", "key": "webedit-ai-darkmode", "equals": "true", "then": [
        { "op": "pageSetStyle", "selector": "html", "property": "filter", "value": "" },
        { "op": "setStorage", "key": "webedit-ai-darkmode", "value": "false" },
        { "op": "setText", "selector": ".webedit-ai-switch-label", "text": "Dark Mode" }
      ], "else": [
        { "op": "pageSetStyle", "selector": "html", "property": "filter", "value": "invert(1) hue-rotate(180deg)" },
        { "op": "setStorage", "key": "webedit-ai-darkmode", "value": "true" },
        { "op": "setText", "selector": ".webedit-ai-switch-label", "text": "Light Mode" }
      ]}
    ]}
  ]
}

**Example 3: Multi-button UI — separate "on" per control (pattern for calculators, numpads, toolbars)**

Each button has its own class and its own "on" block so clicks do different things. For a full calculator, repeat this pattern for every key (digits, operators, equals) with unique webedit-ai- classes.

{
  "html": "<div class='webedit-ai-calc'><div class='webedit-ai-calc-display'>0</div><div class='webedit-ai-calc-keys'><button type='button' class='webedit-ai-calc-one'>1</button><button type='button' class='webedit-ai-calc-two'>2</button><button type='button' class='webedit-ai-calc-clear'>C</button></div></div>",
  "css": ".webedit-ai-calc { padding: 8px; font-family: system-ui, sans-serif; } .webedit-ai-calc-display { min-height: 28px; padding: 6px; background: #f1f5f9; border-radius: 6px; margin-bottom: 8px; } .webedit-ai-calc-keys { display: flex; gap: 6px; } .webedit-ai-calc-keys button { cursor: pointer; padding: 8px 12px; border-radius: 6px; border: 1px solid #cbd5e1; }",
  "actions": [
    { "op": "ifStorage", "key": "webedit-ai-calc-val", "equals": "1", "then": [{ "op": "setText", "selector": ".webedit-ai-calc-display", "text": "1" }], "else": [
      { "op": "ifStorage", "key": "webedit-ai-calc-val", "equals": "2", "then": [{ "op": "setText", "selector": ".webedit-ai-calc-display", "text": "2" }], "else": [{ "op": "setText", "selector": ".webedit-ai-calc-display", "text": "0" }] }
    ]},
    { "op": "on", "selector": ".webedit-ai-calc-one", "event": "click", "actions": [
      { "op": "setText", "selector": ".webedit-ai-calc-display", "text": "1" },
      { "op": "setStorage", "key": "webedit-ai-calc-val", "value": "1" }
    ]},
    { "op": "on", "selector": ".webedit-ai-calc-two", "event": "click", "actions": [
      { "op": "setText", "selector": ".webedit-ai-calc-display", "text": "2" },
      { "op": "setStorage", "key": "webedit-ai-calc-val", "value": "2" }
    ]},
    { "op": "on", "selector": ".webedit-ai-calc-clear", "event": "click", "actions": [
      { "op": "setText", "selector": ".webedit-ai-calc-display", "text": "0" },
      { "op": "setStorage", "key": "webedit-ai-calc-val", "value": "0" }
    ]}
  ]
}

=== BEFORE YOU RESPOND — CHECKLIST ===
[ ] Correct JSON shape for this turn (needSecondaryContext pair OR html/css/actions)
[ ] Every interactive control has "on" + real behavior in actions
[ ] Multi-control UIs: unique selectors or separate "on" blocks per distinct behavior (never one shared class for different click outcomes)
[ ] If state should survive refresh: actions start with ifStorage/getStorage restore, then "on" handlers call setStorage
[ ] Classes/IDs use webedit-ai- prefix

Return ONLY the JSON object for this turn.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { prompt, htmlContext, relatedHtmlContext, secondaryHtmlContext, history } = body;
    const mergedSecondaryHtml = String(relatedHtmlContext || secondaryHtmlContext || "").trim();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const isRefinement = Array.isArray(history) && history.length > 0;

    const systemParts: Array<{ text: string }> = [{ text: systemInstructionBase }];
    if (isRefinement) {
      systemParts.push({ text: refinementModeAddendum });
    }

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    if (isRefinement) {
      for (const turn of history) {
        contents.push({ role: turn.role, parts: [{ text: turn.text }] });
      }
      contents.push({ role: "user", parts: [{ text: buildRefinementUserMessage(String(prompt).trim()) }] });
    } else {
      contents.push({
        role: "user",
        parts: [{
          text: buildInitialUserMessage(
            htmlContext || "",
            String(prompt).trim(),
            mergedSecondaryHtml,
          ),
        }],
      });
    }

    const geminiPayload = {
      system_instruction: {
        parts: systemParts,
      },
      contents: contents,
      generation_config: {
        response_mime_type: "application/json",
      },
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
    }

    const geminiData = await response.json();
    let textOutput = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!textOutput) {
      throw new Error("Empty response from Gemini");
    }

    let parsedSpec: Record<string, unknown>;
    try {
      parsedSpec = JSON.parse(textOutput);
    } catch (parseError) {
      console.error("Failed to parse Gemini output as JSON. Output was:", textOutput);
      try {
        const firstBrace = textOutput.indexOf("{");
        const lastBrace = textOutput.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const jsonString = textOutput.substring(firstBrace, lastBrace + 1);
          parsedSpec = JSON.parse(jsonString);
        } else {
          throw new Error("No JSON object found in output.");
        }
      } catch (fallbackError) {
        throw new Error("Could not parse AI output as JSON.");
      }
    }

    if (!isRefinement && parsedSpec.needSecondaryContext === true) {
      const fromSecondary = typeof parsedSpec.secondaryContextPrompt === "string"
        ? parsedSpec.secondaryContextPrompt.trim()
        : "";
      const fromMessage = typeof parsedSpec.message === "string" ? parsedSpec.message.trim() : "";
      const secondaryContextPrompt = fromSecondary || fromMessage ||
        "This feature needs another section of the page. Please pick the related area on the website.";
      return new Response(
        JSON.stringify({
          needSecondaryContext: true,
          secondaryContextPrompt,
          message: secondaryContextPrompt,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const finalSpec = {
      html: typeof parsedSpec.html === "string" ? parsedSpec.html : "",
      css: typeof parsedSpec.css === "string" ? parsedSpec.css : "",
      actions: Array.isArray(parsedSpec.actions) ? parsedSpec.actions : [],
    };

    const unknownOps = collectUnknownActionOps(finalSpec.actions);
    if (unknownOps.length > 0) {
      return new Response(
        JSON.stringify({ error: `Unknown action ops: ${unknownOps.join(", ")}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify(finalSpec), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ai-generate-feature-spec:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
