// supabase/functions/ai-page-chat/index.ts

type DenoLikeGlobal = typeof globalThis & {
  Deno?: {
    env?: {
      get(key: string): string | undefined;
    };
    serve?: (
      handler: (req: Request) => Response | Promise<Response>,
      options?: Record<string, unknown>,
    ) => void | Promise<void>;
  };
};

function getDenoEnvVar(key: string): string | undefined {
  const { Deno: deno } = globalThis as DenoLikeGlobal;
  return deno?.env?.get?.(key);
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const denoServe = (globalThis as DenoLikeGlobal).Deno?.serve;

if (typeof denoServe !== "function") {
  console.warn(
    "[ai-page-chat] Deno.serve is unavailable. This file must run inside a Deno/Supabase Edge runtime.",
  );
} else {
  denoServe(async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    // Only allow POST requests
    if (req.method !== "POST") {
      return json(
        { ok: false, error: "Method not allowed" },
        405,
      );
    }

    try {
      // 1. Read Cohere API key
      const apiKey = getDenoEnvVar("COHERE_API_KEY");
      if (!apiKey) {
        console.error("COHERE_API_KEY not configured");
        return json(
          { ok: false, error: "COHERE_API_KEY not configured" },
          500,
        );
      }

      // 2. Parse request body: { message, pageContext }
      const body = await req.json().catch(() => ({}));
      const message = body?.message;
      const pageContext = body?.pageContext ?? {};

      const userMessage = 
        typeof message === "string" ? message.trim() :
        typeof message === "number" ? String(message).trim() :
        "";

      if (!userMessage.length) {
        return json(
          { ok: false, error: "message must be a non-empty string" },
          400,
        );
      }

      // 3. Build prompt using message + pageContext
      const pageTitle = (pageContext.title ?? "").toString();
      const pageUrl = (pageContext.url ?? "").toString();
      const pageText = (pageContext.text ?? "").toString();

      const fullPrompt = [
        "You are an assistant helping the user understand and work with the content of a web page.",
        pageTitle ? `Page title: ${pageTitle}` : "",
        pageUrl ? `Page URL: ${pageUrl}` : "",
        pageText ? `Page text:\n${pageText}` : "",
        `User question: ${userMessage}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      // 4. Call Cohere Chat API (v1)
      const cohereRes = await fetch("https://api.cohere.com/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "command-r-plus", // you can change model later if you want
          message: fullPrompt,
          temperature: 0.3,
        }),
      });

      const cohereJson = await cohereRes.json().catch(() => null);

      if (!cohereRes.ok) {
        const rawError =
          (cohereJson && (cohereJson.message || cohereJson.error)) ??
          cohereRes.statusText ??
          "Unknown Cohere error";

        const apiError =
          typeof rawError === "string"
            ? rawError
            : rawError && typeof rawError === "object"
              ? JSON.stringify(rawError)
              : String(rawError ?? "Unknown Cohere error");
        console.error("Cohere API error:", apiError);
        return json(
          { ok: false, error: `Cohere API error: ${apiError}` },
          502,
        );
      }

      // Extract reply text from Cohere response
      // Response shape: { text: "..." } OR { message: { content: [ { type: "text", text: "..." } ] } }
      let replyText = "";
      
      // Try top-level text field first (older API format)
      if (typeof cohereJson?.text === "string" && cohereJson.text.trim()) {
        replyText = cohereJson.text.trim();
      } 
      // Try nested message.content structure (newer API format)
      else if (cohereJson?.message?.content && Array.isArray(cohereJson.message.content)) {
        replyText = cohereJson.message.content
          .filter((chunk: any) => chunk?.type === "text" && chunk?.text)
          .map((chunk: any) => chunk.text)
          .join("")
          .trim();
      }
      
      if (!replyText.length) {
        console.error("Cohere response structure:", JSON.stringify(cohereJson));
        return json(
          { ok: false, error: "Cohere returned an empty reply" },
          500,
        );
      }

      return json({ ok: true, reply: replyText }, 200);
    } catch (err) {
      console.error("ai-page-chat unexpected error:", err);
      const msg =
        err instanceof Error ? err.message : (String(err) || "Unknown error");
      return json({ ok: false, error: msg }, 500);
    }
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
