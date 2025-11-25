# ai-generate-feature-spec

Supabase Edge Function that generates structured feature specifications from natural language prompts using OpenAI.

## Setup

1. Set the `OPENAI_API_KEY` environment variable in your Supabase project:
   ```bash
   supabase secrets set OPENAI_API_KEY=your-api-key-here
   ```

## Testing with curl

```bash
curl -X POST https://your-project.supabase.co/functions/v1/ai-generate-feature-spec \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "prompt": "Hide the cookie banner",
    "context": "Page has a cookie banner with id cookie-banner"
  }'
```

## Testing with Postman

1. Method: `POST`
2. URL: `https://your-project.supabase.co/functions/v1/ai-generate-feature-spec`
3. Headers:
   - `Content-Type: application/json`
   - `Authorization: Bearer YOUR_ANON_KEY`
4. Body (JSON):
   ```json
   {
     "prompt": "Change the header background to red",
     "context": "Header element has class .main-header"
   }
   ```

## Request Format

```json
{
  "prompt": "string (required) - User's natural language request",
  "context": "string | object (optional) - Additional context about the page/elements"
}
```

## Response Format

**Success:**
```json
{
  "ok": true,
  "spec": {
    "action": "hide" | "customize" | "add" | "text",
    "selector": "...",
    "description": "...",
    "styles": { ... },
    "content": "...",
    "position": "...",
    "targetSelector": "..."
  }
}
```

**Error:**
```json
{
  "ok": false,
  "error": "Error message"
}
```

## Deployment

```bash
supabase functions deploy ai-generate-feature-spec
```

