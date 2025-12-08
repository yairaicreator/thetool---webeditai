// Supabase Edge Function: ai-page-chat
// Uses Cohere to answer user questions about the current page.

type DenoLikeGlobal = typeof globalThis & {
  Deno?: {
    env?: {
      get(key: string): string | undefined;
    };
    serve?: (handler: (req: Request) => Response | Promise<Response>) => void | Promise<void>;
  };
};

type PageContext = {
  title: string;
  url: string;
  text: string;
};

type AttachmentInfo = {
  name: string;
  url: string;
  type: string;
};

const COHERE_CHAT_URL = "https://api.cohere.com/v1/chat";
const COHERE_MODEL = "command-r-plus-08-2024";
const DEFAULT_AUTO_PROMPT = "Summarize the important points from this page for the user.";
const INSTRUCTION_PROMPT =
  "You are an assistant helping the user understand and work with the content of a web page. " +
  "Cite the provided page text when relevant, but use general knowledge if needed.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
} as const;

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
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const asString = (candidate: unknown) => (typeof candidate === "string" ? candidate.trim() : "");
  return {
    title: asString(obj.title),
    url: asString(obj.url),
    text: asString(obj.text),
  };
};

const buildPrompt = (question: string, ctx: PageContext, attachments: AttachmentInfo[]): string => {
  const sections = [
    ctx.title ? `Page title: ${ctx.title}` : "",
    ctx.url ? `Page URL: ${ctx.url}` : "",
    ctx.text ? `Page text:\n${ctx.text}` : "",
    attachments.length
      ? `Attachments:\n${attachments
        .map((att, index) => `${index + 1}. [${att.type}] ${att.name} → ${att.url}`)
        .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return sections.length ? `${sections}\n\nUser question: ${question}` : question;
};

const extractCohereReply = (data: unknown): string => {
  if (!data || typeof data !== "object") return "";
  const payload = data as Record<string, unknown>;

  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  const message = payload.message as Record<string, unknown> | undefined;
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

const sanitizeAttachments = (value: unknown): AttachmentInfo[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!url) return null;
      const name = typeof record.name === "string" ? record.name.trim() : "Attachment";
      const type = typeof record.type === "string" ? record.type.trim() : "file";
      return { name, url, type };
    })
    .filter((att): att is AttachmentInfo => Boolean(att));
};

const jsonResponse = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const callCohere = async (apiKey: string, message: string): Promise<string> => {
  const response = await fetch(COHERE_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
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
    const detail =
      (payload && (payload as Record<string, unknown>).message) ??
      (payload && (payload as Record<string, unknown>).error) ??
      response.statusText;
    throw new Error(
      `Cohere API error: ${response.status} ${
        typeof detail === "string" ? detail : JSON.stringify(detail ?? {})
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
    "[ai-page-chat] Deno.serve is unavailable. This file must run inside a Supabase Edge runtime.",
  );
} else {
  denoServe(async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    try {
      const apiKey = getDenoEnvVar("COHERE_API_KEY");
      if (!apiKey) {
        return jsonResponse({ ok: false, error: "COHERE_API_KEY not configured" }, 500);
      }

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const userMessage = sanitizeMessage(body.message ?? body.prompt ?? body.input);
      const context = sanitizePageContext(body.pageContext);
      const attachments = sanitizeAttachments(body.attachments);

      const question = userMessage || DEFAULT_AUTO_PROMPT;
      const prompt = buildPrompt(question, context, attachments);

      console.log("[ai-page-chat] prompt length:", prompt.length);

      const reply = await callCohere(apiKey, prompt);
      return jsonResponse({ ok: true, reply }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err) || "Unknown error";
      console.error("ai-page-chat unexpected error:", message);
      return jsonResponse({ ok: false, error: message }, 500);
    }
  });
}
