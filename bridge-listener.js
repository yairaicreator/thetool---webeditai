// WebEdit AI Bridge Listener - Content Script
// This script ONLY runs on https://www.webeditai.com pages
// Its purpose is to capture Supabase sessions posted from the website
// and forward them to the extension's background script for storage

const SESSION_MESSAGE_TYPE = "WEBEDIT_SUPABASE_SESSION";
const SESSION_MESSAGE_SOURCE = "webedit-website";
const EXTENSION_SESSION_MESSAGE_TYPE = "WEBEDIT_EXTENSION_SESSION_CHANGED";
const EXTENSION_SYNC_SOURCE = "webedit-extension";
const SUPABASE_PROJECT_REF = "eqfjkvjwsswjxkmomxax";
const DEFAULT_SESSION_STORAGE_KEYS = [
  `sb-${SUPABASE_PROJECT_REF}-auth-token`,
  "supabase.auth.token"
];

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

function isAuthStorageKey(key) {
  return !!key && (
    (key.startsWith("sb-") && key.endsWith("-auth-token")) ||
    key === "supabase.auth.token"
  );
}

function safeParseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function getKnownSessionStorageKeys() {
  const keys = new Set(DEFAULT_SESSION_STORAGE_KEYS);
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (isAuthStorageKey(key)) {
        keys.add(key);
      }
    }
  } catch (_) {}
  return Array.from(keys);
}

function getCurrentWebsiteSession() {
  const keys = getKnownSessionStorageKeys();
  for (const key of keys) {
    const parsed = safeParseJson(localStorage.getItem(key));
    const result = normalizeSessionPayload(parsed, `localStorage:${key}`);
    if (result.valid && result.session) {
      return {
        session: result.session,
        key,
        parsed
      };
    }
  }
  return { session: null, key: null, parsed: null };
}

function sessionsMatch(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    String(a.access_token || "") === String(b.access_token || "") &&
    String(a.refresh_token || "") === String(b.refresh_token || "") &&
    Number(a.expires_at || 0) === Number(b.expires_at || 0) &&
    String(a.user?.id || "") === String(b.user?.id || "")
  );
}

function getSessionFingerprint(session) {
  if (!session) return "";
  return JSON.stringify({
    access_token: session.access_token || null,
    refresh_token: session.refresh_token || null,
    expires_at: session.expires_at || null,
    user_id: session.user?.id || null
  });
}

function buildPersistedSessionValue(key, session, parsed) {
  if (!session) return null;
  const nextExpiresAtMs = session?.expires_at ? Number(session.expires_at) * 1000 : null;

  if (parsed && typeof parsed === "object") {
    if (parsed.currentSession || parsed.currentUser || parsed.expiresAt) {
      return JSON.stringify({
        ...parsed,
        currentSession: session,
        currentUser: session.user || parsed.currentUser || null,
        expiresAt: nextExpiresAtMs || parsed.expiresAt || null
      });
    }
    if (parsed.session) {
      return JSON.stringify({
        ...parsed,
        session
      });
    }
    if (parsed.data && typeof parsed.data === "object") {
      return JSON.stringify({
        ...parsed,
        data: {
          ...parsed.data,
          session
        }
      });
    }
  }

  if (key === "supabase.auth.token") {
    return JSON.stringify({
      currentSession: session,
      currentUser: session.user || null,
      expiresAt: nextExpiresAtMs
    });
  }

  return JSON.stringify(session);
}

function dispatchSyntheticStorageEvent(key, oldValue, newValue) {
  try {
    const event = new StorageEvent("storage", {
      key,
      oldValue,
      newValue,
      storageArea: localStorage,
      url: location.href
    });
    window.dispatchEvent(event);
  } catch (_) {}
}

function notifyWebsiteOfExtensionSync(session, reason) {
  const payload = {
    source: EXTENSION_SYNC_SOURCE,
    type: "WEBEDIT_EXTENSION_SESSION_SYNC",
    payload: session || null,
    reason: reason || "extension"
  };

  try {
    window.postMessage(payload, "*");
  } catch (_) {}

  try {
    window.dispatchEvent(new CustomEvent("webedit:session-sync", {
      detail: {
        session: session || null,
        reason: reason || "extension"
      }
    }));
  } catch (_) {}
}

function applyExtensionSessionToWebsite(session, reason = "extension") {
  const current = getCurrentWebsiteSession();
  if (sessionsMatch(current.session, session || null)) {
    return false;
  }

  let changed = false;
  const keys = getKnownSessionStorageKeys();

  if (!session) {
    keys.forEach((key) => {
      const oldValue = localStorage.getItem(key);
      if (oldValue !== null) {
        localStorage.removeItem(key);
        dispatchSyntheticStorageEvent(key, oldValue, null);
        changed = true;
      }
    });
    if (changed) {
      notifyWebsiteOfExtensionSync(null, reason);
    }
    return changed;
  }

  keys.forEach((key) => {
    const oldValue = localStorage.getItem(key);
    const parsed = safeParseJson(oldValue);
    const newValue = buildPersistedSessionValue(key, session, parsed);
    if (oldValue !== newValue) {
      localStorage.setItem(key, newValue);
      dispatchSyntheticStorageEvent(key, oldValue, newValue);
      changed = true;
    }
  });

  if (changed) {
    notifyWebsiteOfExtensionSync(session, reason);
  }
  return changed;
}

function requestExtensionSessionBootstrap() {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
    return;
  }

  chrome.runtime.sendMessage({ type: "WEBEDIT_GET_SESSION" }, (response) => {
    if (chrome.runtime.lastError) {
      return;
    }

    const extensionSession = response?.session || null;
    const websiteSession = getCurrentWebsiteSession().session;
    if (extensionSession && !websiteSession) {
      applyExtensionSessionToWebsite(extensionSession, "bootstrap");
    }
  });
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

    const stored = getCurrentWebsiteSession();
    if (stored.session) {
      console.log("✅ Found existing session in localStorage:", stored.key);
      forwardSessionToBackground(stored.session, "localStorage");
      return true;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== EXTENSION_SESSION_MESSAGE_TYPE) {
    return false;
  }

  try {
    const changed = applyExtensionSessionToWebsite(message.session || null, "background-message");
    sendResponse({ ok: true, changed });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    sendResponse({ ok: false, error: text });
  }
  return true;
});

// Initial check when script loads
checkLocalStorageForSession();
requestExtensionSessionBootstrap();

let lastObservedWebsiteSessionFingerprint = getSessionFingerprint(getCurrentWebsiteSession().session);
setInterval(() => {
  const currentSession = getCurrentWebsiteSession().session;
  const nextFingerprint = getSessionFingerprint(currentSession);
  if (nextFingerprint === lastObservedWebsiteSessionFingerprint) {
    return;
  }
  lastObservedWebsiteSessionFingerprint = nextFingerprint;
  forwardSessionToBackground(currentSession || null, "poll");
}, 1500);

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
  if (isAuthStorageKey(event.key)) {
    console.log("📦 Storage changed, re-checking session");
    if (event.newValue === null) {
      forwardSessionToBackground(null, "storage");
    } else {
      checkLocalStorageForSession();
    }
  }
});

// Also re-check when window gets focus (user switches back to this tab)
window.addEventListener('focus', () => {
  console.log("👁️ Window focused, re-checking session");
  if (!checkLocalStorageForSession()) {
    requestExtensionSessionBootstrap();
  }
});

console.log("🔐 WebEdit AI: Bridge listener initialized on", window.location.href);
