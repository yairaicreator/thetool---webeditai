// Supabase Edge Function: ai-page-chat
// Provides a general-purpose Cohere-powered chat endpoint for WebEdit AI

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const COHERE_CHAT_URL = "https://api.cohere.com/v1/chat";
const COHERE_MODEL = "command-r-plus";

const buildCorsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
});

const instructionPrompt =
  "You are an assistant helping the user understand and work with the content of a web page. Use the page text when relevant, but if something is not in the page, answer from general knowledge.";

serve(async (req) => {
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
    const apiKey = Deno.env.get("COHERE_API_KEY");
    if (!apiKey) {
      console.error("COHERE_API_KEY not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "COHERE_API_KEY not configured" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const { message, pageContext } = await req.json();

    const normalizedMessage =
      typeof message === "string" ? message.trim() :
        typeof message === "number" ? String(message).trim() :
          "";

    if (!normalizedMessage) {
      return new Response(
        JSON.stringify({ ok: false, error: "message must be a non-empty string" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const safeContext = pageContext && typeof pageContext === "object" ? pageContext : {};
    const pageText = typeof safeContext.text === "string" ? safeContext.text : "";
    const pageTitle = typeof safeContext.title === "string" ? safeContext.title : "";
    const pageUrl = typeof safeContext.url === "string" ? safeContext.url : "";

    const contextParts: string[] = [];
    if (pageTitle) contextParts.push(`Page title: ${pageTitle}`);
    if (pageUrl) contextParts.push(`Page URL: ${pageUrl}`);
    if (pageText) contextParts.push(`Page text: ${pageText}`);
    
    const fullPrompt = contextParts.length > 0
      ? `${contextParts.join("\n\n")}\n\nUser question: ${normalizedMessage}`
      : normalizedMessage;

    console.log(`[Cohere] Sending message length: ${fullPrompt.length} chars`);

    const cohereResponse = await fetch(COHERE_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: COHERE_MODEL,
        message: fullPrompt,
        preamble: instructionPrompt,
        temperature: 0.3,
      }),
    });

    if (!cohereResponse.ok) {
      const errorText = await cohereResponse.text();
      return new Response(
        JSON.stringify({ ok: false, error: `Cohere API error: ${cohereResponse.status} ${errorText}` }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    const cohereData = await cohereResponse.json();

    let reply = "";
    if (typeof cohereData.text === "string" && cohereData.text.trim()) {
      reply = cohereData.text.trim();
    } else if (cohereData.message?.content && Array.isArray(cohereData.message.content)) {
      reply = cohereData.message.content
        .map((chunk: { text?: string }) => chunk?.text ?? "")
        .join("")
        .trim();
    } else if (typeof cohereData.message?.content === "string") {
      reply = cohereData.message.content.trim();
    }

    if (!reply) {
      return new Response(JSON.stringify({ ok: false, error: "Cohere response missing text" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

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


