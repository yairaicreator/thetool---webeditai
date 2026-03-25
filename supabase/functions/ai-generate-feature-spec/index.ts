import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const systemInstruction = `You are an expert Frontend Engineer building features for the WebEdit AI Chrome Extension.
Your goal is to generate strictly functional, self-contained HTML, CSS, and interactive behavior based *exactly* on the user's prompt.

IMPORTANT: You do NOT output raw JavaScript. Instead, you output an "actions" array of structured DOM commands. These commands are executed by a pre-built interpreter in the extension's content script, which calls real DOM APIs. This bypasses Content Security Policy (CSP) restrictions on all websites.

The Golden Rules:
1. Zero Hallucinations: Build *only* what the user asked for. Do not build extra UI elements or panels that were not requested.
2. Strict JSON Output: You must output *only* a valid JSON object with exactly three keys: "html", "css", and "actions". Do not include any conversational text, markdown formatting (like \\\`\\\`\\\`json), or explanations outside the JSON structure.
3. The "Review Before Submit" Rule: Before generating the final JSON, internally review your output against the user's prompt. Ensure every interactive behavior the user described is covered by the actions array.
4. Namespacing: All CSS classes and IDs MUST be prefixed with \`webedit-ai-\` to avoid conflicts with the host website.
5. State Persistence: If the feature needs to remember data between page loads (toggles, text, items), use the setStorage/getStorage/ifStorage actions with keys prefixed with \`webedit-ai-\`.
6. Selectors in actions are scoped to the feature container. Use CSS selectors relative to the feature root (e.g. ".webedit-ai-btn"), NOT the whole page.

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

## Example Output

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

Return ONLY this JSON object.`;

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history) {
        contents.push({ role: turn.role, parts: [{ text: turn.text }] });
      }
      contents.push({ role: "user", parts: [{ text: "User Refinement: " + prompt }] });
    } else {
      const userMessage = `Context HTML (where the feature will be inserted):\n\`\`\`html\n${htmlContext || "No context provided"}\n\`\`\`\n\nUser Request: ${prompt}`;
      contents.push({ role: "user", parts: [{ text: userMessage }] });
    }

    const geminiPayload = {
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: contents,
      generation_config: {
        response_mime_type: "application/json",
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    // Try to parse the response as JSON. Gemini should respect response_mime_type.
    let parsedSpec;
    try {
      parsedSpec = JSON.parse(textOutput);
    } catch (parseError) {
      console.error("Failed to parse Gemini output as JSON. Output was:", textOutput);
      // Fallback: try to extract JSON by finding the first { and last }
      try {
        const firstBrace = textOutput.indexOf('{');
        const lastBrace = textOutput.lastIndexOf('}');
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
      actions: parsedSpec.actions || []
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
