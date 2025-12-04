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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
} as const;

const getDenoEnvVar = (key: string): string | undefined => {
  const { Deno: deno } = globalThis as DenoLikeGlobal;
  return deno?.env?.get?.(key);
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

    try {
      const apiKey = getDenoEnvVar("COHERE_API_KEY");
      if (!apiKey) {
        return json({ ok: false, error: "COHERE_API_KEY not configured" }, 500);
      }

      const body = await req.json().catch(() => ({}));
      const raw =
        (body?.message ??
          body?.prompt ??
          body?.input ??
          "").toString();

      const userMessage = raw.trim();
      const pageContext = body?.pageContext ?? {};

      console.log("ai-page-chat incoming body:", body);
      console.log("ai-page-chat userMessage:", userMessage, "len=", userMessage.length);

      if (!userMessage.length) {
        return json(
          {
            ok: false,
            error:
              'message must be a non-empty string; got "' +
              raw +
              '"',
          },
          400,
        );
      }

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

      const cohereRes = await fetch("https://api.cohere.ai/v1/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "command-r-plus",
          message: fullPrompt,
        }),
      });

      const cohereJson = await cohereRes.json().catch(() => null);

      if (!cohereRes.ok) {
        const apiError =
          (cohereJson && (cohereJson.message || cohereJson.error)) ||
          cohereRes.statusText ||
          "Unknown Cohere error";
        console.error("Cohere API error:", apiError);
        return json(
          { ok: false, error: "Cohere API error: " + apiError },
          500,
        );
      }

      const replyText = (cohereJson?.text ?? "").toString().trim();
      if (!replyText.length) {
        return json(
          { ok: false, error: "Cohere returned an empty reply" },
          500,
        );
      }

      return json({ ok: true, reply: replyText }, 200);
    } catch (err) {
      console.error("ai-page-chat unexpected error:", err);
      const msg =
        err instanceof Error ? err.message : String(err) || "Unknown error";
      return json({ ok: false, error: msg }, 500);
    }
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
