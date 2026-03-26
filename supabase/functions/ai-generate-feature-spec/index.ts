import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Initial Add-flow user message: anchor HTML, optional related region, optional page URL, user request. */
function buildInitialUserMessage(
  htmlContext: string,
  userPrompt: string,
  opts?: { relatedHtmlContext?: string; pageUrl?: string },
): string {
  const ctx = htmlContext || "No context provided";
  let out = `SECTION: CONTEXT_HTML
\`\`\`html
${ctx}
\`\`\`
`;

  const related = (opts?.relatedHtmlContext || "").trim();
  if (related) {
    out += `
SECTION: RELATED_CONTEXT_HTML
A second region the user picked on the same page (use together with CONTEXT_HTML for cross-region behavior).
\`\`\`html
${related}
\`\`\`
`;
  }

  const url = (opts?.pageUrl || "").trim();
  if (url) {
    out += `
SECTION: PAGE_URL
${url}
(Site-specific hints are heuristic only; the live DOM may differ.)
`;
  }

  out += `
SECTION: USER_REQUEST
${userPrompt}

SECTION: OUTPUT_CONSTRAINT
Either (A) a complete feature spec as JSON with exactly "html", "css", "actions", OR (B) if you truly cannot build the feature without another region the user has NOT yet provided, JSON with "needSecondaryContext": true, "secondaryContextPrompt" (short user-facing string: why pick and what to pick), and empty "html", "css", "actions". Use (B) only on the FIRST generation turn when RELATED_CONTEXT_HTML is absent and the request clearly depends on another part of the page (e.g. copy from a distant panel, wire a button to content outside CONTEXT_HTML). If RELATED_CONTEXT_HTML is already present, you MUST output (A) only. No markdown fences. No prose outside the JSON.`;

  return out;
}

/** Fixed user message shape for every refinement turn (appended after history replay). */
function buildRefinementUserMessage(userPrompt: string): string {
  return `SECTION: REFINEMENT_REQUEST
${userPrompt}

SECTION: INSTRUCTION
Apply only the changes in REFINEMENT_REQUEST. Output a COMPLETE replacement JSON with keys "html", "css", and "actions" (not a diff). Preserve all interactive behavior, all "on" event bindings, and all persistence (ifStorage/getStorage/setStorage) unless the user explicitly asks to remove them. Do not use needSecondaryContext during refinement — output the full spec only.`;
}

const refinementModeAddendum = `
=== REFINEMENT MODE (ACTIVE) ===
You are refining a feature you already specified in this conversation. The prior turns contain the user's context and your last JSON output (html, css, actions only).

MUST:
- Output a FULL new JSON object with "html", "css", "actions" — never partial patches.
- Keep everything the user did NOT ask to change: same capabilities, same persistence pattern, same event handlers unless they request otherwise.
- If they only ask for visual/layout/CSS changes, keep the actions array logically equivalent; adjust only what is needed for the new markup or styles.
- Do not remove ifStorage/getStorage restore steps at the start of actions unless the user asks to drop persistence.
- Never set needSecondaryContext in refinement; always return the complete spec.

The extension handles user Cancel outside the model; you never output cancellation or disclaimers — only the JSON spec.
`;

const systemInstructionBase = `You are an expert Frontend Engineer for the WebEdit AI Chrome Extension.

=== NON-NEGOTIABLE (READ FIRST) ===
MUST_OUTPUT_SHAPE (first generation, no RELATED_CONTEXT_HTML in the user message yet): Either (1) exactly "html", "css", "actions" for a complete feature, OR (2) "needSecondaryContext": true, "secondaryContextPrompt": string, plus "html","css","actions" all empty — when the user's request clearly depends on another DOM region not present in CONTEXT_HTML. After RELATED_CONTEXT_HTML is supplied, you MUST output only (1).
MUST_OUTPUT_SHAPE (first generation with RELATED_CONTEXT_HTML, or any refinement): Exactly "html", "css", "actions" only. No extra keys.
MUST_INTERACTIVE: If the feature has any interactive control (button, switch, checkbox, link that does something, input, dropdown, tab, modal trigger, etc.), "actions" MUST NOT be empty. Every such control MUST have at least one "on" event with nested actions that do real work (DOM or page ops + setStorage when state matters). CSS-only motion without actions is INVALID.
MUST_MULTI_CONTROL: The interpreter cannot branch on "which button was clicked" inside a single handler. If two controls need different behavior, give each a UNIQUE selector (e.g. .webedit-ai-calc-0 … .webedit-ai-calc-9) and use separate "on" blocks (or one "on" per distinct selector). One "on" with a selector that matches many elements runs the SAME nested actions for every match — that is wrong for calculators, keyboards, and multi-key UIs unless every matched element should behave identically.
MUST_PERSIST: If the user can change state (toggle, theme, text field value to remember, etc.), persistence uses browser localStorage. Keys MUST start with "webedit-ai-". The SAME localStorage API exists on every website — only key names and values differ, not the command vocabulary.
MUST_RESTORE_FIRST: For any feature with remembered state, the "actions" array MUST BEGIN with one or more ifStorage and/or getStorage steps that re-apply saved UI and page effects BEFORE any "on" bindings. Then add "on" handlers that update DOM and call setStorage.
MUST_NAMESPACE: All CSS classes and IDs in html/css MUST use prefix webedit-ai-.
MUST_PAGE_OPS: To change the whole page (e.g. dark mode on document), use pageAddClass, pageRemoveClass, pageToggleClass, or pageSetStyle with selectors like "html" or "body". To trigger an existing site control, use pageClick. To read text from the host page into storage for copy or display, use pageQueryText. Other ops use selectors relative to the feature container unless documented as page-scoped.

=== HOST PAGE REALITY (fragile sites) ===
- Closed Shadow DOM: selectors cannot reach inside closed shadow roots. Prefer behavior grounded in picked HTML (CONTEXT_HTML / RELATED_CONTEXT_HTML) or document-level targets you can name.
- SPAs and hashed CSS class names: pageQueryText and pageClick may break after navigation or re-renders. Prefer stable attributes, user-picked regions, or feature-local UI.
- Never output raw JavaScript, eval, or pageEval — only the documented ops.

You do NOT output raw JavaScript. You output structured DOM commands in "actions". A content-script interpreter runs them with real DOM APIs (CSP-safe).

=== DETAILED RULES ===
1. Build only what the user asked; no extra panels or chrome.
2. Before sending JSON, verify: (a) interactive elements have "on" + logic, (b) persistent features start with ifStorage/getStorage restore, (c) correct output shape for this turn.
3. Selectors in normal ops are scoped to the feature container; page-scoped ops target the live document.
4. Floating widgets (calculator, notebook) can use pageCreateElement with parent "body" (or another page selector) to attach outside the shadow feature root.
5. Notebook pattern: textarea in feature html, getValue/setValue + setStorage/ifStorage for persistence.

## DOM Commands Vocabulary

Each action is a JSON object with an "op" field and parameters. Nested "actions" arrays enable complex workflows.

**Event Binding:**
- on: { "op": "on", "selector": ".btn", "event": "click", "actions": [...], "prevent": false }
  Attaches an event listener. "actions" is a nested list of commands to run when the event fires. "prevent" (optional) calls preventDefault().

**Class Manipulation:**
- addClass: { "op": "addClass", "selector": ".el", "class": "active" }
- removeClass: { "op": "removeClass", "selector": ".el", "class": "active" }
- toggleClass: { "op": "toggleClass", "selector": ".el", "class": "active" }

**Style Manipulation:**
- setStyle: { "op": "setStyle", "selector": ".el", "property": "color", "value": "red" }

**Content Manipulation:**
- setText: { "op": "setText", "selector": ".el", "text": "Hello" }
- setHTML: { "op": "setHTML", "selector": ".el", "html": "<b>Bold</b>" }
- setAttr: { "op": "setAttr", "selector": ".el", "attr": "href", "value": "#" }
- removeAttr: { "op": "removeAttr", "selector": ".el", "attr": "disabled" }

**Visibility:**
- show: { "op": "show", "selector": ".el" } — sets display to ""
- hide: { "op": "hide", "selector": ".el" } — sets display to "none"
- toggle: { "op": "toggle", "selector": ".el" } — toggles display

**Element Creation / Removal:**
- createElement: { "op": "createElement", "tag": "div", "id": "webedit-ai-item", "classes": ["webedit-ai-card"], "text": "New", "parent": ".webedit-ai-list", "position": "beforeend" }
  Scoped to the feature container. position: "beforeend" (default), "afterbegin", "beforebegin", "afterend"
- pageCreateElement: Same fields as createElement but "parent" is resolved on the real document (e.g. "body") for floating tools.
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

**Scroll:**
- scrollTo: { "op": "scrollTo", "selector": ".el" }

**Form:**
- getValue: { "op": "getValue", "selector": "input.webedit-ai-input", "storageKey": "webedit-ai-input-val" }
  Reads input value and saves to localStorage.
- setValue: { "op": "setValue", "selector": "input.webedit-ai-input", "value": "hello" }

**Clipboard & host-page text / click (real document):**
- pageQueryText: { "op": "pageQueryText", "selector": "#host-panel", "mode": "first"|"all", "storageKey": "webedit-ai-gathered" }
  mode "first" = first match textContent; "all" = concatenate text from all matches (newline-separated). Requires webedit-ai- storageKey.
- copyToClipboard: { "op": "copyToClipboard", "text": "literal" } and/or "storageKey" — if storageKey is set and has a value, it wins; else uses text.
- pageClick: { "op": "pageClick", "selector": "button.host-action" } — calls .click() on the first match (fragile on SPAs).

**Page-Scoped Ops (affect the whole website, not just the feature container):**
Use these when the feature must change something on the host page itself (e.g. dark mode on body, theme class on html).
Selectors here target the real page DOM (like "body", "html", or any page element), NOT the feature container.
- pageAddClass: { "op": "pageAddClass", "selector": "body", "class": "webedit-ai-dark-mode" }
- pageRemoveClass: { "op": "pageRemoveClass", "selector": "body", "class": "webedit-ai-dark-mode" }
- pageToggleClass: { "op": "pageToggleClass", "selector": "body", "class": "webedit-ai-dark-mode" }
- pageSetStyle: { "op": "pageSetStyle", "selector": "body", "property": "backgroundColor", "value": "#1a1a1a" }

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

**Example 4: Copy host page text via pageQueryText + copyToClipboard**

{
  "html": "<div class='webedit-ai-copy-row'><button type='button' class='webedit-ai-copy-btn'>Copy title</button></div>",
  "css": ".webedit-ai-copy-row { padding: 8px; } .webedit-ai-copy-btn { cursor: pointer; }",
  "actions": [
    { "op": "on", "selector": ".webedit-ai-copy-btn", "event": "click", "actions": [
      { "op": "pageQueryText", "selector": "h1", "mode": "first", "storageKey": "webedit-ai-copy-buf" },
      { "op": "copyToClipboard", "storageKey": "webedit-ai-copy-buf" }
    ]}
  ]
}

=== BEFORE YOU RESPOND — CHECKLIST ===
[ ] Correct JSON shape for this turn (full spec OR needSecondaryContext + empty spec when allowed)
[ ] Every interactive control has "on" + real behavior in actions
[ ] Multi-control UIs: unique selectors or separate "on" blocks per distinct behavior
[ ] If state should survive refresh: actions start with ifStorage/getStorage restore, then "on" handlers call setStorage
[ ] Classes/IDs use webedit-ai- prefix

Return ONLY this JSON object.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { prompt, htmlContext, history, relatedHtmlContext, pageUrl } = body;

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
          text: buildInitialUserMessage(htmlContext || "", String(prompt).trim(), {
            relatedHtmlContext: typeof relatedHtmlContext === "string" ? relatedHtmlContext : undefined,
            pageUrl: typeof pageUrl === "string" ? pageUrl : undefined,
          }),
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

    const hasRelatedContext = typeof relatedHtmlContext === "string" && relatedHtmlContext.trim().length > 0;
    if (parsedSpec.needSecondaryContext === true && !isRefinement && !hasRelatedContext) {
      const promptText = typeof parsedSpec.secondaryContextPrompt === "string"
        ? parsedSpec.secondaryContextPrompt
        : "Please pick another section on the page that contains the content this feature needs.";
      return new Response(
        JSON.stringify({
          needSecondaryContext: true,
          secondaryContextPrompt: promptText,
          html: "",
          css: "",
          actions: [],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const finalSpec = {
      html: parsedSpec.html || "",
      css: parsedSpec.css || "",
      actions: parsedSpec.actions || [],
    };

    return new Response(JSON.stringify(finalSpec), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ai-generate-feature-spec:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
