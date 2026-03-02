const apiKey = process.env.GEMINI_API_KEY;

async function testGemini() {
  const payload = {
    system_instruction: {
      parts: [{ text: "You are a helpful assistant." }]
    },
    contents: [
      { role: "user", parts: [{ text: "Hello" }] }
    ],
    generation_config: {
        response_mime_type: "application/json"
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(`Test:`, response.status, await response.text());
}

testGemini();