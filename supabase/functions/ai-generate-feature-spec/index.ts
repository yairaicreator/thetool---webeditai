// Supabase Edge Function: ai-generate-feature-spec
// Generates a structured feature specification from a natural language prompt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface FeatureSpec {
  action: "hide" | "customize" | "add" | "text";
  selector?: string;
  targetSelector?: string;
  description?: string;
  styles?: {
    backgroundColor?: string;
    color?: string;
    fontSize?: string;
    [key: string]: string | undefined;
  };
  content?: string;
  position?: "before" | "after" | "inside" | "replace";
  html?: string;
  css?: string;
}

const SYSTEM_PROMPT = `You are an AI assistant that generates structured feature specifications for web editing actions.

Given a user prompt and page context, you must return ONLY valid JSON matching this exact schema:

{
  "action": "hide" | "customize" | "add" | "text",
  "selector": "CSS selector for target element (required if action is hide/customize/text)",
  "description": "Human-readable description of the element",
  "styles": {
    "backgroundColor": "CSS color value (hex, rgb, or named)",
    "color": "CSS color value",
    "fontSize": "CSS font size with unit (e.g., '16px', '1.2em')",
    ...other CSS properties as key-value pairs
  },
  "content": "Text content to add/replace (required if action is add/text)",
  "position": "before" | "after" | "inside" | "replace",
  "targetSelector": "CSS selector for reference element (required if action is add with position)",
  "html": "For add actions ONLY: HTML snippet to insert. Use semantic markup and prefix custom classes with 'webedit-ai-'. Omit this field for other actions.",
  "css": "For add actions ONLY: CSS rules targeting classes used in html. No <style> tags. Omit this field for other actions."
}

Action types:
- "hide": Hide/remove an element (only needs selector)
- "customize": Modify styles of an element (needs selector and styles)
- "add": Insert new content (needs content, position, and optionally targetSelector)
- "text": Change text content (needs selector and content)

Rules:
1. Return ONLY valid JSON, no markdown, no explanations
2. Include only fields that are relevant to the action
3. CSS selectors should be specific and stable
4. If context is provided, use it to generate more accurate selectors
5. For add actions, the HTML should represent the requested feature (buttons, cards, links, etc.) using accessible markup.
6. Classes inside the HTML must start with "webedit-ai-" to avoid conflicts.
7. If the prompt is unclear, return a minimal spec with the most likely action

Example responses:
{"action":"hide","selector":"#cookie-banner"}
{"action":"customize","selector":".header","styles":{"backgroundColor":"#ff0000","color":"#ffffff"}}
{"action":"add","content":"New paragraph text","position":"after","targetSelector":".main-content","html":"<div class=\\"webedit-ai-note\\">New paragraph text</div>","css":".webedit-ai-note{padding:12px;border-radius:8px;background:#f1f5f9;}"}`

serve(async (req) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Validate API key
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "OPENAI_API_KEY not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const { prompt, context } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing or invalid 'prompt' field" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Build user message
    let userMessage = prompt;
    if (context) {
      userMessage = `Context: ${typeof context === "string" ? context : JSON.stringify(context)}\n\nUser request: ${prompt}`;
    }

    // Call OpenAI API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      return new Response(
        JSON.stringify({
          ok: false,
          error: `OpenAI API error: ${openaiResponse.status} ${errorText}`,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ ok: false, error: "No content in OpenAI response" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse and validate JSON response
    let spec: FeatureSpec;
    try {
      spec = JSON.parse(content);
    } catch (parseError) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Failed to parse JSON response: ${parseError}`,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate spec structure
    if (!spec.action || !["hide", "customize", "add", "text"].includes(spec.action)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Invalid action: ${spec.action}. Must be one of: hide, customize, add, text`,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Return success response
    return new Response(
      JSON.stringify({ ok: true, spec }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});

