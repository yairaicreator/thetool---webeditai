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

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-3.1-pro-preview";

interface FeatureSpec {
  action: "hide" | "customize" | "add" | "text" | "chat" | "undo" | "reveal";
  selector?: string;
  targetSelector?: string;
  targetId?: string;
  description?: string;
  behavior?: {
    type: "toggleClass" | "toggleStyles";
    triggerAttr?: string;
    triggerValue?: string;
    targetSelector: string;
    className?: string;
    stylesOn?: Record<string, string>;
    stylesOff?: Record<string, string>;
    expandedLabel?: string;
    collapsedLabel?: string;
  };
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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const SYSTEM_PROMPT = `You are an AI assistant that generates structured feature specifications for web editing actions.

CRITICAL SCOPE:
- You are editing the EXTERNAL WEBSITE (the host page like ChatGPT, YouTube, etc.) visible to the user.
- You are NEVER editing the extension itself (the side panel, chat bubble, or WebEdit AI UI).
- Terms like "chat bar", "input box", "panel", "header", or "button" used by the user ALWAYS refer to elements on the host webpage.

Given a user prompt and page context, you must return ONLY valid JSON matching this exact schema:

{
  "action": "hide" | "customize" | "add" | "text" | "chat" | "undo" | "reveal",
  "selector": "CSS selector for target element (required if action is hide/customize/text)",
  "targetId": "ID of a previously applied FeatureSpec to undo (required if action is undo)",
  "description": "Human-readable description of the element",
  "styles": {
    "backgroundColor": "CSS color value (hex, rgb, or named)",
    "color": "CSS color value",
    "fontSize": "CSS font size with unit (e.g., '16px', '1.2em')",
    ...other CSS properties as key-value pairs
  },
  "content": "Text content to add/replace/chat (required if action is add/text/chat)",
  "position": "before" | "after" | "inside" | "replace",
  "targetSelector": "CSS selector for reference element (required if action is add with position)",
  "html": "For add actions ONLY: HTML snippet to insert. Use semantic markup and prefix custom classes with 'webedit-ai-'. Omit this field for other actions.",
  "css": "For add actions ONLY: CSS rules targeting classes used in html. No <style> tags. Omit this field for other actions.",
  "behavior": "Optional for add: safe interactivity descriptor. Use this for click-to-expand/collapse etc. Do NOT output JavaScript."
}

Action types:
- "hide": Hide/remove an element (needs selector)
- "customize": Modify styles of an element (needs selector and styles)
- "add": Insert new content (needs content, position, and optionally targetSelector)
- "text": Change text content (needs selector and content)
- "chat": General conversation or answer about the page (needs content). Use this for non-edit requests.
- "undo": Revert a previously applied edit (needs targetId from activeSpecs in context).
- "reveal": Force unhide of elements (headers/navs) that might be hidden by mistake.

Rules:
1. Return ONLY valid JSON, no markdown, no explanations.
2. Include only fields that are relevant to the action.
3. CSS selectors should be specific and stable. Use IDs or unique class combinations from the context.
4. If context is provided, use it to generate more accurate selectors or to answer questions about the page content.
5. For add actions, the HTML should represent the requested feature (buttons, cards, links, etc.) using accessible markup.
6. Classes inside the HTML must start with "webedit-ai-" to avoid conflicts.
7. INTERACTIVITY: If the user requests interactive behavior (toggle/expand/collapse), you MUST NOT output JavaScript. Instead:\n   - Provide HTML/CSS for the control.\n   - Provide a \"behavior\" object describing a safe, whitelisted action. The extension will bind the click handler.\n   - Preferred: behavior.type=\"toggleClass\" where the click toggles className on behavior.targetSelector.\n   - Use triggerAttr \"data-webedit-ai-action\" and triggerValue \"toggle\" on the clickable element.\n   - Make selectors stable: prefer [data-testid], [role], aria-label, IDs. Avoid long class chains.\n   - Provide CSS rules that implement both states via the toggled class.
8. If the user wants to "return", "restore", or "un-hide" something, look at "activeSpecs" in the context, find the relevant spec ID, and return {"action": "undo", "targetId": "..."}.
9. If the prompt is a general question about the page text, return {"action": "chat", "content": "..."}.
10. If the user asks to "restore header", "bring back header", "unhide nav", or if the user complains about missing UI elements and no specific undo target is found, return {"action": "reveal"}.

Example responses:
{"action":"hide","selector":"#cookie-banner"}
{"action":"chat","content":"The main article on this page discusses the impact of AI on web development."}
{"action":"undo","targetId":"chg-1735182000000-abc12345"}`;

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
    const apiKey = getEnvVar("GEMINI_API_KEY");
    if (!apiKey) {
      console.error("[ai-generate-feature-spec] Missing GEMINI_API_KEY");
      return buildJsonResponse({ ok: false, error: "GEMINI_API_KEY not set" }, 500);
    }

    // Parse request body
    const { prompt, context } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return buildJsonResponse({ ok: false, error: "Missing or invalid 'prompt' field" }, 400);
    }

    const userMessage = buildUserMessage(prompt, context);

    const geminiPayload = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200,
      },
    };

    const geminiResponse = await fetch(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiPayload),
    });

    const raw = await geminiResponse.text();
    let spec: FeatureSpec;

    if (!geminiResponse.ok) {
      console.error("[ai-generate-feature-spec] Gemini API error:", geminiResponse.status, raw);
      return buildJsonResponse(
        { ok: false, error: `Gemini request failed: ${geminiResponse.status}` },
        500,
      );
    }

    const parsedResponse = safeJsonParse(raw);
    let content = extractGeminiReply(parsedResponse);

    if (!content) {
      console.error("[ai-generate-feature-spec] Empty response from Gemini");
      return buildJsonResponse({ ok: false, error: "Empty response from Gemini" }, 500);
    }

    // Extract JSON from markdown code fences if present
    // Matches 3+ backticks, captures length in group 1, matches content, matches closing group 1.
    const codeBlockMatch = content.match(/(`{3,})(?:json)?\s*([\s\S]*?)\s*\1/i);
    if (codeBlockMatch) {
      content = codeBlockMatch[2].trim();
    } else {
      // Fallback: just strip leading/trailing fences if they exist loosely
      content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    }

    // Fallback: If content doesn't look like JSON (e.g. chatty preamble), extract from first '{' to last '}'
    if (!content.startsWith("{") && content.includes("{")) {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (end > start) {
        content = content.substring(start, end + 1);
      }
    }

    try {
      spec = JSON.parse(content);
    } catch (error) {
      console.error("[ai-generate-feature-spec] Failed to parse Gemini JSON:", content, error);
      return buildJsonResponse(
        { ok: false, error: "Failed to parse AI output as JSON" },
        500,
      );
    }

    // Validate spec structure
    const validActions = ["hide", "customize", "add", "text", "chat", "undo", "reveal"];
    if (!spec.action || !validActions.includes(spec.action)) {
      return buildJsonResponse(
        {
          ok: false,
          error: `Invalid action: ${spec.action}. Must be one of: ${validActions.join(", ")}`,
        },
        500,
      );
    }

    if (spec.action === "add") {
      // Ensure html/css exist so the client can render something useful.
      // If the model omitted them, synthesize a minimal card instead of failing.
      const ctx = (context && typeof context === "object")
        ? (context as Record<string, unknown>)
        : {};

      const title =
        asNonEmptyString(spec.description) ||
        asNonEmptyString(ctx.editName) ||
        "New feature";

      // Prefer spec.content; fall back to a user-provided request when present; then prompt.
      const body =
        asNonEmptyString(spec.content) ||
        asNonEmptyString(ctx.userRequest) ||
        asNonEmptyString(ctx.requestedAction) ||
        asNonEmptyString(prompt);

      if (typeof spec.html !== "string" || !spec.html.trim()) {
        spec.html = `
<section class="webedit-ai-card" role="region" aria-label="${escapeHtml(title)}">
  <h3 class="webedit-ai-card__title">${escapeHtml(title)}</h3>
  <p class="webedit-ai-card__body">${escapeHtml(body || "Added by WebEdit AI.")}</p>
</section>
        `.trim();
      }

      if (typeof spec.css !== "string") {
        spec.css = "";
      }

      if (!spec.css.trim()) {
        spec.css = `
.webedit-ai-card{
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  background: #f8fafc;
  border: 1px solid rgba(15,23,42,0.14);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 10px 24px rgba(15,23,42,0.08);
  max-width: 420px;
}
.webedit-ai-card__title{
  margin: 0 0 6px 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}
.webedit-ai-card__body{
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(15,23,42,0.82);
}
        `.trim();
      }
    }

    if (spec.action === "undo" && !spec.targetId) {
      return buildJsonResponse({ ok: false, error: "Invalid spec: undo requires targetId" }, 500);
    }

    if (spec.action === "chat" && !spec.content) {
      return buildJsonResponse({ ok: false, error: "Invalid spec: chat requires content" }, 500);
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

function extractGeminiReply(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const parts = candidates[0]?.content?.parts || [];
  const combined = parts
    .map((chunk) => (typeof chunk?.text === "string" ? chunk.text : ""))
    .join("")
    .trim();
  return combined || null;
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
