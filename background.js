// WebEdit AI Background Service Worker
// Handles extension icon clicks to directly toggle the in-page chat panel

/**
 * Listen for extension icon clicks
 * When clicked, send a message to the active tab's content script to toggle the panel
 * No popup window or intermediate UI - direct panel toggle
 */
chrome.action.onClicked.addListener(async (tab) => {
  // Don't try to inject into protected Chrome pages
  if (!tab.url || 
      tab.url.startsWith('chrome://') || 
      tab.url.startsWith('edge://') || 
      tab.url.startsWith('about:') ||
      tab.url.startsWith('chrome-extension://')) {
    console.log('WebEdit AI: Cannot inject into protected pages');
    return;
  }

  try {
    // First, try to send a message to check if content script is loaded
    await chrome.tabs.sendMessage(tab.id, {
      type: 'WEBEDIT_TOGGLE_PANEL'
    });
    
    console.log('WebEdit AI: Toggle message sent to tab', tab.id);
  } catch (error) {
    // Content script not loaded yet, inject it manually
    console.log('WebEdit AI: Injecting content script...');
    
    try {
      // Inject CSS files
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['contentStyles.css', 'panel.css']
      });
      
      // Inject JavaScript
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['contentScript.js']
      });
      
      console.log('WebEdit AI: Content script injected successfully');
      
      // Wait a bit for script to initialize, then toggle panel
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'WEBEDIT_TOGGLE_PANEL'
          });
        } catch (e) {
          console.log('WebEdit AI: Please refresh the page and try again');
        }
      }, 100);
      
    } catch (injectError) {
      console.log('WebEdit AI: Could not inject content script. Please refresh the page.');
    }
  }
});

/**
 * Optional: Listen for installation/update events
 * Can be used to show welcome message or update notes
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('WebEdit AI: Extension installed! Click the icon on any webpage to start editing.');
  } else if (details.reason === 'update') {
    console.log('WebEdit AI: Extension updated to version', chrome.runtime.getManifest().version);
  }
});

// ============================================
// Supabase Authentication Handlers
// ============================================

// PRODUCTION URLs - ALWAYS USE THESE
const WEBEDIT_PROD_BASE_URL = "https://www.webeditai.com";
const LOGIN_URL = "https://www.webeditai.com/#/signup";
const HISTORY_URL = "https://www.webeditai.com/#/history";

/**
 * Get the current user from stored session
 */
async function getCurrentUser() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
      const session = result.webeditSupabaseSession;
      if (session && session.user && !isSessionExpired(session)) {
        resolve(session.user);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Check if session is expired
 * Validates existence of session and expiration time
 */
function isSessionExpired(session) {
  if (!session) return true;
  
  // If no expires_at, assume it's valid (some session objects might be minimal)
  // or check if we have a user object at least
  if (!session.expires_at) {
    // If we have a user, we assume it's valid for now to prevent aggressive logout
    return !session.user;
  }
  
  // Check expiration with a small buffer (60s) to avoid edge cases
  return (Date.now() / 1000) > (session.expires_at + 60);
}

/**
 * Broadcast session update to all tabs
 */
function broadcastSessionUpdate(session) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, {
        type: "WEBEDIT_SESSION_UPDATED",
        session: session
      }).catch(() => {
        // Ignore errors for tabs without content script
      });
    });
  });
}

/**
 * Listen for authentication-related messages
 * All URLs use PRODUCTION constants - no dev URLs
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle WEBEDIT_STORE_SUPABASE_SESSION - Store session from website
  if (message.type === "WEBEDIT_STORE_SUPABASE_SESSION") {
    console.log("💾 Storing Supabase session from website");
    
    const session = message.session;
    
    chrome.storage.local.set({ 
      webeditSupabaseSession: session,
      webeditSessionTimestamp: Date.now()
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("❌ Error storing session:", chrome.runtime.lastError);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      console.log("✅ Session stored successfully for user:", session?.user?.email);
      
      // Broadcast to all tabs
      broadcastSessionUpdate(session);
      
      sendResponse({ ok: true, user: session?.user });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_GET_SESSION - Retrieve stored session
  if (message.type === "WEBEDIT_GET_SESSION") {
    chrome.storage.local.get([
      'webeditSupabaseSession', 
      'webeditSessionTimestamp',
      // Old key names for migration
      'webedit_supabase_session',
      'webedit_session_timestamp'
    ], (result) => {
      if (chrome.runtime.lastError) {
        console.error("❌ Error retrieving session:", chrome.runtime.lastError);
        sendResponse({ session: null, error: chrome.runtime.lastError.message });
        return;
      }
      
      let session = result.webeditSupabaseSession || null;
      let timestamp = result.webeditSessionTimestamp || null;
      
      // MIGRATION: Check for old key names and migrate them
      if (!session && result.webedit_supabase_session) {
        console.log("🔄 Migrating session from old storage keys...");
        session = result.webedit_supabase_session;
        timestamp = result.webedit_session_timestamp || Date.now();
        
        // Store with new keys
        chrome.storage.local.set({
          webeditSupabaseSession: session,
          webeditSessionTimestamp: timestamp
        });
        
        // Remove old keys
        chrome.storage.local.remove(['webedit_supabase_session', 'webedit_session_timestamp']);
        
        console.log("✅ Session migrated successfully");
      }
      
      // Check if session is expired
      if (session && isSessionExpired(session)) {
        console.log("⚠️ Session expired, clearing...");
        chrome.storage.local.remove([
          'webeditSupabaseSession', 
          'webeditSessionTimestamp',
          'webedit_supabase_session',
          'webedit_session_timestamp'
        ]);
        sendResponse({ session: null, expired: true });
        return;
      }
      
      console.log("📖 Retrieved session:", session ? `${session.user?.email}` : "none");
      sendResponse({ session, timestamp });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_OPEN_LOGIN_TAB - Open production login page
  if (message.type === "WEBEDIT_OPEN_LOGIN_TAB") {
    console.log("🔐 Opening production login page");
    
    const loginUrl = LOGIN_URL + "?from=extension";
    
    chrome.tabs.create({ url: loginUrl }, (tab) => {
      console.log("✅ Opened login tab:", tab.id, loginUrl);
      sendResponse({ ok: true, tabId: tab.id });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_SIGN_OUT - Clear session and sign out
  if (message.type === "WEBEDIT_SIGN_OUT") {
    console.log("👋 Signing out - clearing stored session");
    
    // Clear both new and old storage keys for complete cleanup
    chrome.storage.local.remove([
      'webeditSupabaseSession', 
      'webeditSessionTimestamp',
      'webedit_supabase_session',
      'webedit_session_timestamp'
    ], () => {
      if (chrome.runtime.lastError) {
        console.error("❌ Error clearing session:", chrome.runtime.lastError);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      console.log("✅ Session cleared");
      
      // Broadcast sign out to all tabs
      broadcastSessionUpdate(null);
      
      // Open website to sign out there too
      const logoutUrl = HISTORY_URL + "?from=extension-logout";
      chrome.tabs.create({ url: logoutUrl });
      
      sendResponse({ ok: true });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_OPEN_HISTORY - Open production history page
  if (message.type === "WEBEDIT_OPEN_HISTORY") {
    console.log("📚 Opening production history page");
    
    chrome.tabs.create({ url: HISTORY_URL }, (tab) => {
      console.log("✅ Opened history tab:", tab.id);
      sendResponse({ ok: true, tabId: tab.id });
    });
    
    return true; // Keep message channel open for async response
  }
});