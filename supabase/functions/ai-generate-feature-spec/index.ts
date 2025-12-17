// Supabase Edge Function: ai-generate-feature-spec
// Generates a structured feature specification from a natural language prompt

type DenoLikeGlobal = typeof globalThis & {
  Deno?: {
    env?: {
      get(key: string): string | undefined;
    };
    serve?: (handler: (req: Request) => Response | Promise<Response>) => void | Promise<void>;
  };
};

const COHERE_CHAT_URL = "https://api.cohere.com/v1/chat";
const COHERE_MODEL = "command-a-vision-07-2025";

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

const denoServe = (globalThis as DenoLikeGlobal).Deno?.serve;

const getEnvVar = (key: string): string | undefined => {
  const { Deno: deno } = globalThis as DenoLikeGlobal;
  return deno?.env?.get?.(key);
};

if (typeof denoServe !== "function") {
  console.warn(
    "[ai-generate-feature-spec] Deno.serve is unavailable. This file must run inside a Supabase Edge runtime.",
  );
} else {
  denoServe(async (req) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      },
    });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return buildJsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    // Validate API key
    const apiKey = getEnvVar("COHERE_API_KEY");
    if (!apiKey) {
      console.error("[ai-generate-feature-spec] Missing COHERE_API_KEY");
      return buildJsonResponse({ ok: false, error: "COHERE_API_KEY not set" }, 500);
    }

    // Parse request body
    const { prompt, context } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return buildJsonResponse({ ok: false, error: "Missing or invalid 'prompt' field" }, 400);
    }

    const userMessage = buildUserMessage(prompt, context);

    const coherePayload = {
      model: COHERE_MODEL,
      message: userMessage,
      preamble: SYSTEM_PROMPT,
      temperature: 0.2,
      max_output_tokens: 600,
    };

    const cohereResponse = await fetch(COHERE_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(coherePayload),
    });

    const raw = await cohereResponse.text();
    let spec: FeatureSpec;

    if (!cohereResponse.ok) {
      console.error("[ai-generate-feature-spec] Cohere API error:", cohereResponse.status, raw);
      return buildJsonResponse(
        { ok: false, error: `Cohere request failed: ${cohereResponse.status}` },
        500,
      );
    }

    const parsedResponse = safeJsonParse(raw);
    const content = extractCohereReply(parsedResponse);

    if (!content) {
      console.error("[ai-generate-feature-spec] Empty response from Cohere");
      return buildJsonResponse({ ok: false, error: "Empty response from Cohere" }, 500);
    }

    try {
      spec = JSON.parse(content);
    } catch (error) {
      console.error("[ai-generate-feature-spec] Failed to parse Cohere JSON:", content, error);
      return buildJsonResponse(
        { ok: false, error: "Failed to parse AI output as JSON" },
        500,
      );
    }

    // Validate spec structure
    if (!spec.action || !["hide", "customize", "add", "text"].includes(spec.action)) {
      return buildJsonResponse(
        {
          ok: false,
          error: `Invalid action: ${spec.action}. Must be one of: hide, customize, add, text`,
        },
        500,
      );
    }

    if (spec.action === "add") {
      if (typeof spec.html !== "string" || !spec.html.trim()) {
        return buildJsonResponse({ ok: false, error: "Invalid spec: missing html" }, 500);
      }
      if (typeof spec.css !== "string") {
        return buildJsonResponse({ ok: false, error: "Invalid spec: missing css" }, 500);
      }
    }

    // Return success response
    return buildJsonResponse({ ok: true, spec }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ai-generate-feature-spec] Unexpected error:", message);
    return buildJsonResponse({ ok: false, error: message }, 500);
  }
});
}

function buildUserMessage(prompt: string, context?: unknown) {
  if (!context) {
    return prompt;
  }

  const contextString =
    typeof context === "string" ? context : JSON.stringify(context, null, 2);

  return `Context:\n${contextString}\n\nUser request:\n${prompt}`;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractCohereReply(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const text = (data as { text?: string }).text;
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }

  const message = (data as { message?: { content?: Array<{ text?: string }> } }).message;
  if (message?.content?.length) {
    const combined = message.content
      .map((chunk) => (typeof chunk?.text === "string" ? chunk.text : ""))
      .join("")
      .trim();
    if (combined) return combined;
  }

  const generations = (data as { generations?: Array<{ text?: string }> }).generations;
  if (generations?.length) {
    const combined = generations
      .map((chunk) => (typeof chunk?.text === "string" ? chunk.text : ""))
      .join("")
      .trim();
    if (combined) return combined;
  }

  return null;
}

function buildJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

