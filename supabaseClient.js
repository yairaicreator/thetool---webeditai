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
const WEBEDIT_PROD_BASE_URL = "https://webeditai.com";
const LOGIN_URL = "https://webeditai.com/#/signup"; // Apex domain avoids redirect that broke hash routes; website should keep this SPA path live
const HISTORY_URL = "https://webeditai.com/#/history";

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
      console.log('[SupabaseClient] Raw invalid response:', text.slice(0, 1000));
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

async function fetchLaunchFlag() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE_URL")) {
    return { ok: false, error: "Supabase not configured" };
  }
  try {
    const qs = new URLSearchParams({
      select: "is_public_launch",
      limit: "1"
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/app_config?${qs.toString()}`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {}
    if (!response.ok) {
      const msg = (json && (json.message || json.error)) ? (json.message || json.error) : text;
      return { ok: false, error: msg || `Supabase error ${response.status}` };
    }
    const flag = Array.isArray(json) ? !!json[0]?.is_public_launch : !!json?.is_public_launch;
    return { ok: true, isPublicLaunch: flag };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Launch flag fetch failed" };
  }
}

async function fetchAuthUser() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE_URL")) {
    return { ok: false, error: "Supabase not configured", user: null };
  }
  try {
    const { data: { session } } = await SupabaseClient.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      return { ok: true, user: null };
    }
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: true, user: null };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const msg = payload?.msg || payload?.error_description || payload?.error || response.statusText;
      return { ok: false, error: msg || `Auth user fetch failed (${response.status})`, user: null };
    }
    return { ok: true, user: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Auth user fetch failed", user: null };
  }
}

async function isTesterAllowlisted(email, accessToken = null) {
  if (!email) {
    return { ok: false, error: "Missing email", allowlisted: false };
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE_URL")) {
    return { ok: false, error: "Supabase not configured", allowlisted: false };
  }
  try {
    const qs = new URLSearchParams({
      select: "email",
      email: `ilike.${email}`,
      limit: "1"
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/testers_allowlist?${qs.toString()}`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`
      }
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {}
    if (!response.ok) {
      const msg = (json && (json.message || json.error)) ? (json.message || json.error) : text;
      return { ok: false, error: msg || `Supabase error ${response.status}`, allowlisted: false };
    }
    const allowlisted = Array.isArray(json) && json.length > 0;
    return { ok: true, allowlisted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Allowlist check failed", allowlisted: false };
  }
}

const SupabaseClient = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  callPageChat,
  generateFeatureSpec,
  fetchLaunchFlag,
  fetchAuthUser,
  isTesterAllowlisted,

  async refreshSession(refreshToken) {
    if (!refreshToken) {
      return { data: { session: null }, error: 'Missing refresh token' };
    }
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const msg = payload?.msg || payload?.error_description || payload?.error || response.statusText;
        return { data: { session: null }, error: `Refresh failed: ${msg}` };
      }

      const expiresIn = Number(payload.expires_in || 0);
      const expiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : payload.expires_at;

      const session = {
        access_token: payload.access_token,
        token_type: payload.token_type,
        refresh_token: payload.refresh_token,
        expires_in: payload.expires_in,
        expires_at: expiresAt,
        user: payload.user
      };

      await this.setSession(session);
      return { data: { session }, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { data: { session: null }, error: message || 'Refresh failed' };
    }
  },

  /**
   * Get the current session from chrome.storage.local
   */
  async getSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SESSION_STORAGE_KEY], (result) => {
        const session = result[SESSION_STORAGE_KEY] || null;
        const email = session?.user?.email;
        console.log(email ? `🔐 [SupabaseClient] Loaded session for ${email}` : "🔐 [SupabaseClient] No stored session");

        // Auto-refresh expired sessions so SaveEdit can write to Supabase.
        if (session && this.isSessionExpired(session) && session.refresh_token) {
          console.log("🔄 [SupabaseClient] Session expired; attempting refresh...");
          this.refreshSession(session.refresh_token).then((res) => {
            resolve(res?.data?.session ? res : { data: { session: null }, error: res?.error || null });
          });
          return;
        }

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

// Export IMMEDIATELY to avoid race conditions with other scripts
if (typeof window !== 'undefined') {
  window.SupabaseClient = SupabaseClient;
  window.callPageChat = callPageChat;
  window.generateFeatureSpec = generateFeatureSpec;
  console.log('✅ SupabaseClient exported to window');
}


