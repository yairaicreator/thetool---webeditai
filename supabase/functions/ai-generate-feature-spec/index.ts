import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Fixed user message shape for every initial Add-flow generation. */
function buildInitialUserMessage(htmlContext: string, userPrompt: string): string {
  const ctx = htmlContext || "No context provided";
  return `SECTION: CONTEXT_HTML
\`\`\`html
${ctx}
\`\`\`

SECTION: USER_REQUEST
${userPrompt}

SECTION: OUTPUT_CONSTRAINT
Respond with ONLY a JSON object. Exactly three keys: "html", "css", "actions". No other keys. No markdown. No prose.`;
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

The extension handles user Cancel outside the model; you never output cancellation or disclaimers — only the JSON spec.
`;

const systemInstructionBase = `You are an expert Frontend Engineer for the WebEdit AI Chrome Extension.

=== NON-NEGOTIABLE (READ FIRST) ===
MUST_OUTPUT_SHAPE: Exactly one JSON object with keys "html", "css", "actions" only. No "js", no "confidence", no extra keys, no markdown fences, no commentary.
MUST_INTERACTIVE: If the feature has any interactive control (button, switch, checkbox, link that does something, input, dropdown, tab, modal trigger, etc.), "actions" MUST NOT be empty. Every such control MUST have at least one "on" event with nested actions that do real work (DOM or page ops + setStorage when state matters). CSS-only motion without actions is INVALID.
MUST_PERSIST: If the user can change state (toggle, theme, text field value to remember, etc.), persistence uses browser localStorage. Keys MUST start with "webedit-ai-". The SAME localStorage API exists on every website — only key names and values differ, not the command vocabulary.
MUST_RESTORE_FIRST: For any feature with remembered state, the "actions" array MUST BEGIN with one or more ifStorage and/or getStorage steps that re-apply saved UI and page effects BEFORE any "on" bindings. Then add "on" handlers that update DOM and call setStorage.
MUST_NAMESPACE: All CSS classes and IDs in html/css MUST use prefix webedit-ai-.
MUST_PAGE_OPS: To change the whole page (e.g. dark mode on document), use pageAddClass, pageRemoveClass, pageToggleClass, or pageSetStyle with selectors like "html" or "body". Other ops use selectors relative to the feature root.

You do NOT output raw JavaScript. You output structured DOM commands in "actions". A content-script interpreter runs them with real DOM APIs (CSP-safe).

=== DETAILED RULES ===
1. Build only what the user asked; no extra panels or chrome.
2. Before sending JSON, verify: (a) interactive elements have "on" + logic, (b) persistent features start with ifStorage/getStorage restore, (c) three keys only.
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

**Scroll:**
- scrollTo: { "op": "scrollTo", "selector": ".el" }

**Form:**
- getValue: { "op": "getValue", "selector": "input.webedit-ai-input", "storageKey": "webedit-ai-input-val" }
  Reads input value and saves to localStorage.
- setValue: { "op": "setValue", "selector": "input.webedit-ai-input", "value": "hello" }

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

=== BEFORE YOU RESPOND — CHECKLIST ===
[ ] JSON has exactly "html", "css", "actions"
[ ] Every interactive control has "on" + real behavior in actions
[ ] If state should survive refresh: actions start with ifStorage/getStorage restore, then "on" handlers call setStorage
[ ] Classes/IDs use webedit-ai- prefix

Return ONLY this JSON object.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, htmlContext, history } = await req.json();

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
        parts: [{ text: buildInitialUserMessage(htmlContext || "", String(prompt).trim()) }],
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

    let parsedSpec;
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
