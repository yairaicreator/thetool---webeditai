// WebEdit AI - Supabase Client
// This client handles authentication and raw REST requests to Supabase.

// TODO: PASTE YOUR SUPABASE URL AND ANON KEY HERE
// In a real build setup (Vite/Webpack), these would be:
// const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const SUPABASE_URL = "https://eqfjkvjwsswjxkmomxax.supabase.co";
const SUPABASE_ANON_KEY ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZmprdmp3c3N3anhrbW9teGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMTU1MDYsImV4cCI6MjA3MTY5MTUwNn0.sh5d5Hj5hshIOndyAodK_rlP0K1pERYyWyNqNxp-E7k";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE_URL")) {
  console.warn("⚠️ WebEdit AI: Supabase URL or Anon Key is missing. Edits will not be saved.");
}

// Production URLs
const WEBEDIT_PROD_BASE_URL = "https://www.webeditai.com";
const LOGIN_URL = "https://www.webeditai.com/#/signup";
const HISTORY_URL = "https://www.webeditai.com/#/history";

/**
 * Simple Supabase client implementation
 * Uses chrome.storage.local for session persistence and REST API calls.
 */
const SupabaseClient = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  
  /**
   * Get the current session from chrome.storage.local
   */
  async getSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
        const session = result.webeditSupabaseSession || null;
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
          webeditSupabaseSession: session,
          webeditSessionTimestamp: Date.now()
        }, () => {
          resolve({ data: { session }, error: null });
        });
      } else {
        resolve({ data: { session: null }, error: null });
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
    return new Promise((resolve) => {
      chrome.storage.local.remove(['webeditSupabaseSession', 'webeditSessionTimestamp'], () => {
        resolve({ error: null });
      });
    });
  },
  
  /**
   * Check if the session is expired
   */
  isSessionExpired(session) {
    if (!session || !session.expires_at) return true;
    return Date.now() / 1000 > session.expires_at;
  }
};

// Export for use in other extension files
if (typeof window !== 'undefined') {
  window.SupabaseClient = SupabaseClient;
}
