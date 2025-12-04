// Supabase Edge Function: ai-page-chat
// Provides a general-purpose Cohere-powered chat endpoint for WebEdit AI

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const COHERE_API_KEY = Deno.env.get("CXFukYursZkdvnGHryR6opijOuJNACUOrapf72nk");
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

  if (!COHERE_API_KEY) {
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

  try {
    const body = await req.json();
    const { message, pageContext } = body ?? {};

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "Missing or invalid 'message'" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    let combinedUserMessage = message.trim();

    if (pageContext && typeof pageContext === "object") {
      const contextPieces: string[] = [];
      if (pageContext.url) contextPieces.push(`URL: ${pageContext.url}`);
      if (pageContext.title) contextPieces.push(`Title: ${pageContext.title}`);
      if (pageContext.text) contextPieces.push(`Page text:\n${pageContext.text}`);

      if (contextPieces.length > 0) {
        combinedUserMessage = `${contextPieces.join("\n")}\n\nUser question: ${combinedUserMessage}`;
      }
    }

    const cohereResponse = await fetch(COHERE_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${COHERE_API_KEY}`,
      },
      body: JSON.stringify({
        model: COHERE_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: instructionPrompt },
          { role: "user", content: combinedUserMessage },
        ],
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


