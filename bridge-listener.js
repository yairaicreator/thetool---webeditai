// WebEdit AI Bridge Listener - Content Script
// This script ONLY runs on https://www.webeditai.com pages
// Its purpose is to capture Supabase sessions posted from the website
// and forward them to the extension's background script for storage

// Helper to send session to background
function forwardSessionToBackground(session, source) {
  if (!session) return;
  
  console.log(`🔐 Bridge listener: Forwarding session from ${source}`, `for ${session.user?.email}`);
  
  chrome.runtime.sendMessage(
    {
      type: "WEBEDIT_STORE_SUPABASE_SESSION",
      session: session,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("❌ Error forwarding session to background:", chrome.runtime.lastError);
        return;
      }
      if (response?.ignored) {
        console.log("⚠️ Session ignored by background:", response.reason || "unknown reason");
        return;
      }
      if (response?.unchanged) {
        console.log("ℹ️ Session already up to date, no broadcast needed");
        return;
      }
      console.log("✅ Session forwarded to background:", response);
    }
  );
}

/**
 * Try to find Supabase session in localStorage
 * This handles the case where user is already logged in
 */
function checkLocalStorageForSession() {
  try {
    console.log("🔍 Checking localStorage for existing session...");
    
    // Iterate through all keys to find Supabase token
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      
      // Look for standard Supabase auth token patterns
      // Format: sb-<project-id>-auth-token or supabase.auth.token
      if ((key.startsWith('sb-') && key.endsWith('-auth-token')) || 
          key === 'supabase.auth.token') {
        
        const item = localStorage.getItem(key);
        if (item) {
          try {
            const session = JSON.parse(item);
            // Verify it looks like a valid session
            if (session && session.access_token && session.user) {
              console.log("✅ Found existing session in localStorage:", key);
              forwardSessionToBackground(session, "localStorage");
              return true;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (e) {
    console.error("Error checking localStorage:", e);
  }
  return false;
}

/**
 * Listen for postMessage events from the website
 * The website posts the Supabase session after OAuth completes or auth state changes
 * We capture it and send it to the background script
 */
window.addEventListener("message", (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const message = event.data;
  
  // Ignore non-auth messages
  if (!message) return;
  
  let session = null;
  let isAuthMessage = false;
  
  // NEW FORMAT: message.source === "webedit-website" && message.type === "WEBEDIT_SUPABASE_SESSION"
  if (message.source === "webedit-website" && message.type === "WEBEDIT_SUPABASE_SESSION") {
    session = message.payload;
    isAuthMessage = true;
    console.log("🔐 Bridge listener: Received session (NEW format) from website", session ? `for ${session.user?.email}` : "(sign out)");
  }
  // OLD FORMAT: message.type === "WEBEDIT_AUTH" (backward compatibility)
  else if (message.type === "WEBEDIT_AUTH") {
    session = message.session;
    isAuthMessage = true;
    console.log("🔐 Bridge listener: Received session (OLD format) from website", session ? `for ${session.user?.email}` : "(sign out)");
  }
  
  // If we recognized an auth message, forward it to background
  if (isAuthMessage) {
    // If session is null (sign out), we pass it along to clear storage
    if (!session) {
      console.log("👋 Bridge listener: Received sign out signal");
      try {
        chrome.runtime.sendMessage({ type: "WEBEDIT_SIGN_OUT" }, () => {
          if (chrome.runtime.lastError) {
            console.error("❌ Error forwarding sign-out to background:", chrome.runtime.lastError);
          } else {
            console.log("✅ Sign-out forwarded to background");
          }
        });
      } catch (error) {
        console.error("❌ Exception while forwarding sign-out:", error);
      }
    } else {
      forwardSessionToBackground(session, "postMessage");
    }
  }
});

// Initial check when script loads
checkLocalStorageForSession();

// Poll for session in case it's set asynchronously (e.g. during hydration)
let pollCount = 0;
const pollInterval = setInterval(() => {
  pollCount++;
  const found = checkLocalStorageForSession();
  
  // Stop polling if found or after 5 seconds (10 attempts)
  if (found || pollCount >= 10) {
    clearInterval(pollInterval);
  }
}, 500);

// Listen for storage changes (in case login happens in another tab/window)
window.addEventListener('storage', (event) => {
  if ((event.key && event.key.startsWith('sb-') && event.key.endsWith('-auth-token')) || 
      event.key === 'supabase.auth.token') {
    console.log("📦 Storage changed, re-checking session");
    checkLocalStorageForSession();
  }
});

// Also re-check when window gets focus (user switches back to this tab)
window.addEventListener('focus', () => {
  console.log("👁️ Window focused, re-checking session");
  checkLocalStorageForSession();
});

console.log("🔐 WebEdit AI: Bridge listener initialized on", window.location.href);
