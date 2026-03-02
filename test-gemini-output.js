const apiKey = process.env.GEMINI_API_KEY;

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

const userMessage = `Context HTML (where the feature will be inserted):
\`\`\`html
<div>Target</div>
\`\`\`

User Request: Add a dark mode toggle`;

async function testGemini() {
  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [
      { role: "user", parts: [{ text: userMessage }] }
    ],
    generation_config: {
        response_mime_type: "application/json"
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  console.log(`Test:`, response.status);
  console.log(`Body:`, text);
}

testGemini();