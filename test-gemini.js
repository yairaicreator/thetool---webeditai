const apiKey = process.env.GEMINI_API_KEY;

async function testGemini(model) {
  const payload = {
    contents: [
      { role: "user", parts: [{ text: "Hello" }] }
    ]
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(`Test ${model}:`, response.status, await response.text());
}

async function run() {
  await testGemini('gemini-3.1-pro-preview');
  await testGemini('gemini-3-flash-preview');
}

run();