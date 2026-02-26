// WebEdit AI Bridge Listener - Content Script
// This script ONLY runs on https://www.webeditai.com pages
// Its purpose is to capture Supabase sessions posted from the website
// and forward them to the extension's background script for storage

const SESSION_MESSAGE_TYPE = "WEBEDIT_SUPABASE_SESSION";
const SESSION_MESSAGE_SOURCE = "webedit-website";

function isContextInvalidMessage(message) {
  const text = String(message || "");
  return (
    text.includes("Extension context invalidated") ||
    text.includes("Receiving end does not exist") ||
    text.includes("No tab with id") ||
    text.includes("Could not establish connection")
  );
}

function coerceSessionCandidate(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.access_token && raw.user) return raw;
  const nested = raw.currentSession || raw.session || raw.data?.session || null;
  if (nested && typeof nested === "object" && nested.access_token && nested.user) {
    return nested;
  }
  return null;
}

function isSessionExpiredOrNearExpiry(session, leewaySec = 30) {
  const expiresAt = Number(session?.expires_at || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return expiresAt <= (nowSec + Math.max(0, leewaySec));
}

function normalizeSessionPayload(raw, context = "unknown") {
  if (raw === null) {
    return { session: null, valid: true, explicitSignOut: true };
  }
  if (typeof raw !== "object") {
    console.warn(`⚠️ [Bridge] Ignoring malformed session from ${context}: expected object`, raw);
    return { session: null, valid: false, explicitSignOut: false };
  }
  const session = coerceSessionCandidate(raw);
  if (!session) {
    console.warn(`⚠️ [Bridge] Session missing access_token/user from ${context}`, raw);
    return { session: null, valid: false, explicitSignOut: false };
  }
  if (isSessionExpiredOrNearExpiry(session)) {
    const expiresAt = Number(session?.expires_at || 0);
    console.info(`ℹ️ [Bridge] Ignoring expired/near-expiry session from ${context} (expires_at=${expiresAt})`);
    return { session: null, valid: false, explicitSignOut: false };
  }
  return { session, valid: true, explicitSignOut: false };
}

// Helper to send session (including sign-out) to background
const BRIDGE_MAX_ATTEMPTS = 15;
const BRIDGE_BASE_DELAY_MS = 500;

function forwardSessionToBackground(session, source, attempt = 0) {
  const isSignedIn = !!(session && session.user);
  const email = session?.user?.email || "anonymous";
  const prefix = attempt > 0 ? `retry ${attempt}/${BRIDGE_MAX_ATTEMPTS}` : "forward";

  // Check for orphaned script - if chrome.runtime.id is missing, this script instance
  // is dead (likely extension was reloaded) and can never talk to background again.
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
    if (attempt === 0) {
      console.log("⚠️ [Bridge] Extension context invalidated (script orphaned). Please refresh the page to sync session.");
    }
    return;
  }

  console.log(`🔐 [Bridge:${prefix}] ${isSignedIn ? "SIGNED-IN" : "SIGNED-OUT"} session from ${source}`, isSignedIn ? email : "");

  const retry = (reason) => {
    const isContextInvalid = isContextInvalidMessage(reason) || String(reason || "").includes("extension context unavailable");

    // If the extension context is invalid/orphaned, retries can never succeed.
    if (isContextInvalid) {
      console.log("ℹ️ [Bridge] Extension context is stale/invalid; skipping retries. Refresh the page after reloading the extension.");
      return;
    }

    if (attempt + 1 >= BRIDGE_MAX_ATTEMPTS) {
      console.warn(`⚠️ [Bridge] Giving up forwarding session after ${BRIDGE_MAX_ATTEMPTS} attempts (${reason})`);
      return;
    }
    const nextAttempt = attempt + 1;
    // Exponential-ish backoff
    const delay = Math.min(10000, BRIDGE_BASE_DELAY_MS * Math.pow(1.5, nextAttempt));
    console.log(`⌛ [Bridge] Retrying session forward in ${Math.round(delay)}ms (attempt ${nextAttempt}/${BRIDGE_MAX_ATTEMPTS})…`);
    setTimeout(() => forwardSessionToBackground(session, source, nextAttempt), delay);
  };

    chrome.runtime.sendMessage(
      {
        type: "WEBEDIT_STORE_SUPABASE_SESSION",
        session
      },
      (response) => {
        if (chrome.runtime.lastError) {
        const message = chrome.runtime.lastError.message || "unknown";
        const isContextInvalid =
          isContextInvalidMessage(message) ||
          String(message || "").includes("extension context unavailable");
        if (isContextInvalid) {
          retry(message);
        } else {
          console.warn("⚠️ [Bridge] Background unavailable while forwarding session:", message);
        }
          return;
        }
        if (response?.ignored) {
          console.log("⚠️ [Bridge] Session ignored by background:", response.reason || "unknown reason");
          return;
        }
        if (response?.unchanged) {
          console.log("ℹ️ [Bridge] Session already up to date, no broadcast needed");
          return;
        }
        console.log("✅ [Bridge] Session forwarded to background:", response);
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
            const parsed = JSON.parse(item);
            const result = normalizeSessionPayload(parsed, `localStorage:${key}`);
            if (result.valid && result.session) {
              const session = result.session;
              console.log("✅ Found existing session in localStorage:", key);
              forwardSessionToBackground(session, "localStorage");
              return true;
            }
          } catch (e) {
            console.error("❌ [Bridge] Failed to parse session stored in localStorage:", e);
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
  if (message.source === SESSION_MESSAGE_SOURCE && message.type === SESSION_MESSAGE_TYPE) {
    const result = normalizeSessionPayload(message.payload, "postMessage:new-format");
    if (result.valid) {
      session = result.session;
      isAuthMessage = true;
      console.log("🔐 Bridge listener: Received session (NEW format) from website", session ? `for ${session.user?.email}` : "(sign out)");
    }
  }
  // OLD FORMAT: message.type === "WEBEDIT_AUTH" (backward compatibility)
  else if (message.type === "WEBEDIT_AUTH") {
    const result = normalizeSessionPayload(message.session, "postMessage:legacy-format");
    if (result.valid) {
      session = result.session;
      isAuthMessage = true;
      console.log("🔐 Bridge listener: Received session (OLD format) from website", session ? `for ${session.user?.email}` : "(sign out)");
    }
  }
  
  // If we recognized an auth message, forward it to background
  if (isAuthMessage) {
    forwardSessionToBackground(session || null, "postMessage");
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
