// Supabase Edge Function: ai-page-chat
// Provides a Cohere-powered chat endpoint for WebEdit AI.

type DenoLikeGlobal = typeof globalThis & {
  Deno?: {
    env?: {
      get(key: string): string | undefined;
    };
    serve?: (handler: (req: Request) => Promise<Response> | Response) => void;
  };
};

type PageContext = {
  title: string;
  url: string;
  text: string;
};

const COHERE_CHAT_URL = "https://api.cohere.com/v1/chat";
const COHERE_MODEL = "command-r-plus";
const DEFAULT_AUTO_PROMPT = "Provide a concise helpful summary of the page for the user.";
const INSTRUCTION_PROMPT =
  "You are an assistant helping the user understand and work with the content of a web page. " +
  "Use the provided page text when relevant. If information is missing, rely on general knowledge.";

const buildCorsHeaders = (): Record<string, string> => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
});

const getDenoEnvVar = (key: string): string | undefined => {
  const { Deno: deno } = globalThis as DenoLikeGlobal;
  return deno?.env?.get?.(key);
};

const sanitizeMessage = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value).trim();
  return "";
};

const sanitizePageContext = (value: unknown): PageContext => {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const asString = (maybe: unknown) => (typeof maybe === "string" ? maybe : "").trim();
  return {
    title: asString(input.title),
    url: asString(input.url),
    text: asString(input.text),
  };
};

const buildPrompt = (question: string, ctx: PageContext): string => {
  const segments = [
    ctx.title ? `Page title: ${ctx.title}` : "",
    ctx.url ? `Page URL: ${ctx.url}` : "",
    ctx.text ? `Page text:\n${ctx.text}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!segments.length) return question;
  return `${segments}\n\nUser question: ${question}`;
};

const extractCohereReply = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  if (typeof obj.text === "string" && obj.text.trim()) {
    return obj.text.trim();
  }

  const message = obj.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (Array.isArray(content)) {
    return content
      .map((chunk) => (typeof chunk?.text === "string" ? chunk.text : ""))
      .join("")
      .trim();
  }

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  return "";
};

const jsonResponse = (
  data: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const callCohere = async (apiKey: string, message: string): Promise<string> => {
  const response = await fetch(COHERE_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: COHERE_MODEL,
      message,
      preamble: INSTRUCTION_PROMPT,
      temperature: 0.3,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorDetail =
      (payload && (payload as Record<string, unknown>).message) ??
      (payload && (payload as Record<string, unknown>).error) ??
      response.statusText;
    throw new Error(
      `Cohere API error: ${response.status} ${
        typeof errorDetail === "string" ? errorDetail : JSON.stringify(errorDetail ?? {})
      }`,
    );
  }

  const reply = extractCohereReply(payload);
  if (!reply.length) {
    throw new Error("Cohere returned an empty reply");
  }
  return reply;
};

const denoServe = (globalThis as DenoLikeGlobal).Deno?.serve;

if (typeof denoServe !== "function") {
  console.warn(
    "[ai-page-chat] Deno.serve is unavailable. This file must run inside a Deno/Supabase Edge runtime.",
  );
} else {
  denoServe(async (req) => {
    const corsHeaders = buildCorsHeaders();

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
    }

    try {
      const apiKey = getDenoEnvVar("COHERE_API_KEY");
      if (!apiKey) {
        console.error("[ai-page-chat] Missing COHERE_API_KEY");
        return jsonResponse(
          { ok: false, error: "COHERE_API_KEY not configured" },
          500,
          corsHeaders,
        );
      }

      const body = await req.json().catch(() => ({}));
      const userMessage = sanitizeMessage((body as Record<string, unknown>)?.message);
      const context = sanitizePageContext((body as Record<string, unknown>)?.pageContext);

      const question = userMessage || DEFAULT_AUTO_PROMPT;
      const prompt = buildPrompt(question, context);

      console.log(`[ai-page-chat] Sending prompt length: ${prompt.length}`);

      const reply = await callCohere(apiKey, prompt);

      return jsonResponse({ ok: true, reply }, 200, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ai-page-chat] unexpected error:", message);
      return jsonResponse({ ok: false, error: message }, 500, corsHeaders);
    }
  });
}
