import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, htmlContext, history } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const systemInstruction = `You are an expert Frontend Engineer building features for the WebEdit AI Chrome Extension.
Your goal is to generate strictly functional, self-contained HTML, CSS, and Javascript based *exactly* on the user's prompt.

The Golden Rules:
1. Zero Hallucinations: Build *only* what the user asked for. Do not build extra UI elements or panels that were not requested.
2. Self-Contained Logic: Your Javascript must handle its own state. Do not rely on external libraries or frameworks (no React, no jQuery, no Tailwind). Use pure Vanilla Javascript.
3. Strict JSON Output: You must output *only* a valid JSON object with exactly three keys: "html", "css", and "js". Do not include any conversational text, markdown formatting (like \`\`\`json), or explanations outside the JSON structure.
4. The "Review Before Submit" Rule: Before generating the final JSON, internally review your code against the user's prompt. Ensure every workflow step described by the user is accounted for in your Javascript. Ensure it actually modifies the provided DOM context if requested.
5. Namespacing: All CSS classes, IDs, and JS variables MUST be prefixed with \`webedit-ai-\` to ensure they do not conflict with or break the host website.
6. State Persistence: If your feature has interactive data (like toggles, text inputs, or created folders/items), your Javascript MUST save that data to the browser's \`localStorage\` using a unique key prefixed with \`webedit-ai-\`. When the feature loads, it must check \`localStorage\` to restore its previous state.

Output format:
{
  "html": "<div class='webedit-ai-container'>...</div>",
  "css": ".webedit-ai-container { ... }",
  "js": "const myState = localStorage.getItem('webedit-ai-state'); ..."
}

Return ONLY this JSON object.`;

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history) {
        contents.push({ role: turn.role, parts: [{ text: turn.text }] });
      }
      contents.push({ role: "user", parts: [{ text: "User Refinement: " + prompt }] });
    } else {
      const userMessage = `Context HTML (where the feature will be inserted):\n\`\`\`html\n${htmlContext || "No context provided"}\n\`\`\`\n\nUser Request: ${prompt}`;
      contents.push({ role: "user", parts: [{ text: userMessage }] });
    }

    const geminiPayload = {
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: contents,
      generation_config: {
        response_mime_type: "application/json",
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
    }

    const geminiData = await response.json();
    let textOutput = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!textOutput) {
      throw new Error("Empty response from Gemini");
    }

    // Try to parse the response as JSON. Gemini should respect response_mime_type.
    let parsedSpec;
    try {
      parsedSpec = JSON.parse(textOutput);
    } catch (parseError) {
      console.error("Failed to parse Gemini output as JSON. Output was:", textOutput);
      // Fallback: try to extract JSON by finding the first { and last }
      try {
        const firstBrace = textOutput.indexOf('{');
        const lastBrace = textOutput.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const jsonString = textOutput.substring(firstBrace, lastBrace + 1);
          parsedSpec = JSON.parse(jsonString);
        } else {
          throw new Error("No JSON object found in output.");
        }
      } catch (fallbackError) {
        throw new Error("Could not parse AI output as JSON.");
      }
    }

    // Validate the expected keys exist
    const finalSpec = {
      html: parsedSpec.html || "",
      css: parsedSpec.css || "",
      js: parsedSpec.js || ""
    };

    return new Response(JSON.stringify(finalSpec), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in ai-generate-feature-spec:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
