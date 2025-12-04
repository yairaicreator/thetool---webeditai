// Supabase Edge Function: ai-page-chat
// Provides a general-purpose Cohere-powered chat endpoint for WebEdit AI

type DenoLikeGlobal = typeof globalThis & {
  Deno?: {
    serve?: (handler: (req: Request) => Promise<Response> | Response) => void;
  };
};

const buildCorsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
});

const denoServe = (globalThis as DenoLikeGlobal).Deno?.serve;

if (typeof denoServe !== "function") {
  console.warn(
    "[ai-page-chat] Deno.serve is unavailable. This file must run inside a Deno/Supabase Edge runtime.",
  );
} else {
  denoServe(async (req) => {
  const corsHeaders = buildCorsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawMessage = (body?.message ?? "").toString();
    const pageContext = body?.pageContext ?? {};
    const userMessage = rawMessage.trim();

    const reply = `DEBUG: message="${userMessage}" (length=${userMessage.length}), pageTitle="${pageContext?.title ?? ""}", pageTextLength=${(pageContext?.text ?? "").toString().length}`;

    return new Response(JSON.stringify({ ok: true, reply }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  }
  });
}
