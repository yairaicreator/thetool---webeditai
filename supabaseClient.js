// WebEdit AI - Shared Supabase Client for Extension
// This client is used across background, content scripts, and panel

// Constants - DO NOT CHANGE
const SUPABASE_URL = "https://eqfjkvjwsswjxkmomxax.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZmprdmp3c3N3anhrbW9teGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMTU1MDYsImV4cCI6MjA3MTY5MTUwNn0.sh5d5Hj5hshIOndyAodK_rlP0K1pERYyWyNqNxp-E7k";

// Check for missing config
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("⚠️ WebEdit AI: Supabase URL or Anon Key is missing in supabaseClient.js");
}

// Production URLs - ALWAYS USE THESE
const WEBEDIT_PROD_BASE_URL = "https://www.webeditai.com";
const LOGIN_URL = "https://www.webeditai.com/#/signup";
const HISTORY_URL = "https://www.webeditai.com/#/history";

/**
 * Simple Supabase client implementation
 * Since we can't easily bundle @supabase/supabase-js in a Chrome extension without a build system,
 * we use chrome.storage.local for session persistence and REST API calls for auth operations
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

/**
 * Get the current authenticated user
 * Returns null if not authenticated or session expired
 */
async function getCurrentUser() {
  const { data: { session } } = await SupabaseClient.getSession();
  if (!session) return null;
  
  if (SupabaseClient.isSessionExpired(session)) {
    await SupabaseClient.signOut();
    return null;
  }
  
  return session.user || null;
}

/**
 * Apply a session received from the website
 */
async function setSessionFromWebsite(session) {
  if (!session) {
    await SupabaseClient.signOut();
    return { success: false, error: "No session provided" };
  }
  
  await SupabaseClient.setSession(session);
  return { success: true, user: session.user };
}

/**
 * Clear the current session (sign out)
 */
async function clearSession() {
  await SupabaseClient.signOut();
  return { success: true };
}

// Export for use in other extension files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SupabaseClient,
    getCurrentUser,
    setSessionFromWebsite,
    clearSession,
    WEBEDIT_PROD_BASE_URL,
    LOGIN_URL,
    HISTORY_URL
  };
}

