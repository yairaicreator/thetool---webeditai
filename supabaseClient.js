// WebEdit AI - Supabase Client
// This client handles authentication and raw REST requests to Supabase.

// TODO: PASTE YOUR SUPABASE URL AND ANON KEY HERE
// In a real build setup (Vite/Webpack), these would be:
// const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const SUPABASE_URL = "https://eqfjkvjwsswjxkmomxax.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZmprdmp3c3N3anhrbW9teGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMTU1MDYsImV4cCI6MjA3MTY5MTUwNn0.sh5d5Hj5hshIOndyAodK_rlP0K1pERYyWyNqNxp-E7k";
const SESSION_STORAGE_KEY = "webeditSupabaseSession";
const SESSION_TIMESTAMP_KEY = "webeditSessionTimestamp";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE_URL")) {
  console.warn("⚠️ WebEdit AI: Supabase URL or Anon Key is missing. Edits will not be saved.");
}

// Production URLs
const WEBEDIT_PROD_BASE_URL = "https://www.webeditai.com";
const LOGIN_URL = "https://webeditai.com/#/signup"; // Apex domain avoids redirect that broke hash routes; website should keep this SPA path live
const HISTORY_URL = "https://www.webeditai.com/#/history";

/**
 * Simple Supabase client implementation
 * Uses chrome.storage.local for session persistence and REST API calls.
 */
async function callPageChat(message, pageContext = null, attachments = []) {
  const sanitizedMessage = typeof message === 'string' ? message.trim() : '';
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!sanitizedMessage && !hasAttachments) {
    return { ok: false, error: 'Message is required' };
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE_URL")) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const payload = {
    message: sanitizedMessage
  };

  if (pageContext && typeof pageContext === 'object') {
    payload.pageContext = pageContext;
  }

  if (hasAttachments) {
    payload.attachments = attachments
      .filter(att => att && att.url)
      .map(att => ({
        type: att.type || 'file',
        name: att.name || '',
        url: att.url,
        mimeType: att.mimeType || '',
        size: att.size || 0
      }));
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-page-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (parseError) {
      console.error('[SupabaseClient] Failed to parse ai-page-chat response:', parseError);
    }

    if (!json) {
      return { ok: false, error: 'Invalid response from ai-page-chat' };
    }

    if (!response.ok && typeof json.error === 'string') {
      return { ok: false, error: json.error };
    }

    if (!response.ok) {
      return { ok: false, error: `ai-page-chat failed with status ${response.status}` };
    }

    return json;
  } catch (error) {
    console.error('[SupabaseClient] ai-page-chat request failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function generateFeatureSpec(prompt, context = null) {
  const sanitizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!sanitizedPrompt) {
    return { ok: false, error: 'Prompt is required' };
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE_URL")) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const payload = { prompt: sanitizedPrompt };
  if (context && typeof context === 'object') {
    payload.context = context;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate-feature-spec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (parseError) {
      console.error('[SupabaseClient] Failed to parse ai-generate-feature-spec response:', parseError);
    }

    if (!json) {
      return { ok: false, error: 'Invalid response from ai-generate-feature-spec' };
    }

    if (!response.ok && typeof json.error === 'string') {
      return { ok: false, error: json.error };
    }

    if (!response.ok) {
      return { ok: false, error: `ai-generate-feature-spec failed with status ${response.status}` };
    }

    return json;
  } catch (error) {
    console.error('[SupabaseClient] ai-generate-feature-spec request failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

const SupabaseClient = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  callPageChat,
  generateFeatureSpec,

  /**
   * Get the current session from chrome.storage.local
   */
  async getSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SESSION_STORAGE_KEY], (result) => {
        const session = result[SESSION_STORAGE_KEY] || null;
        const email = session?.user?.email;
        console.log(email ? `🔐 [SupabaseClient] Loaded session for ${email}` : "🔐 [SupabaseClient] No stored session");
        resolve({ data: { session }, error: null });
      });
    });
  },

  /**
   * Set/update the session in chrome.storage.local
   */
  async setSession(session) {
    return new Promise((resolve) => {
      if (session) {
        chrome.storage.local.set({
          [SESSION_STORAGE_KEY]: session,
          [SESSION_TIMESTAMP_KEY]: Date.now()
        }, () => {
          console.log("💾 [SupabaseClient] Stored session for", session.user?.email || "unknown user");
          resolve({ data: { session }, error: null });
        });
      } else {
        chrome.storage.local.remove([SESSION_STORAGE_KEY, SESSION_TIMESTAMP_KEY], () => {
          console.log("🧹 [SupabaseClient] Cleared stored session");
          resolve({ data: { session: null }, error: null });
        });
      }
    });
  },

  /**
   * Get the current user from the stored session
   */
  async getUser() {
    const { data: { session } } = await this.getSession();
    if (session && session.user) {
      return { data: { user: session.user }, error: null };
    }
    return { data: { user: null }, error: null };
  },

  /**
   * Sign out - clears the session from storage
   */
  async signOut() {
    return this.setSession(null);
  },

  /**
   * Check if the session is expired
   * Modified to keep users signed in indefinitely until they explicitly sign out
   */
  isSessionExpired(session) {
    if (!session) return true;
    if (!session.expires_at) {
      return false;
    }
    return (Date.now() / 1000) > (session.expires_at - 60); // include small buffer
  }
};

// Export for use in other extension files
if (typeof window !== 'undefined') {
  window.SupabaseClient = SupabaseClient;
  window.callPageChat = callPageChat;
}
