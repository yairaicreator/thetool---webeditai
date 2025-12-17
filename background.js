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
        files: ['supabaseClient.js', 'saveEdit.js', 'injector.js', 'messages.js', 'editRules.js', 'contentScript.js']
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
// Panel Visibility Sync
// ============================================
const PANEL_VISIBILITY_STORAGE_KEY = "webeditGlobalPanelOpen";
const panelVisibilityStorage = (chrome.storage && chrome.storage.sync) ? chrome.storage.sync : chrome.storage.local;
let cachedPanelVisibility = null;

function readPanelVisibilityPreference() {
  if (cachedPanelVisibility !== null) {
    return Promise.resolve(cachedPanelVisibility);
  }
  return new Promise((resolve) => {
    if (!panelVisibilityStorage) {
      resolve(false);
      return;
    }
    panelVisibilityStorage.get([PANEL_VISIBILITY_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn("WebEdit AI: Failed to read panel preference", chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      const stored = result?.[PANEL_VISIBILITY_STORAGE_KEY];
      cachedPanelVisibility = typeof stored === "boolean" ? stored : false;
      resolve(cachedPanelVisibility);
    });
  });
}

function writePanelVisibilityPreference(isOpen) {
  cachedPanelVisibility = !!isOpen;
  return new Promise((resolve) => {
    if (!panelVisibilityStorage) {
      resolve();
      return;
    }
    panelVisibilityStorage.set({ [PANEL_VISIBILITY_STORAGE_KEY]: cachedPanelVisibility }, () => {
      if (chrome.runtime.lastError) {
        console.warn("WebEdit AI: Failed to persist panel preference", chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

function broadcastPanelVisibility(isOpen, options = {}) {
  const excludeTabId = options.excludeTabId || null;
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id || (excludeTabId && tab.id === excludeTabId)) {
        return;
      }
      chrome.tabs.sendMessage(tab.id, {
        type: "WEBEDIT_APPLY_PANEL_VISIBILITY",
        isOpen
      }, () => {
        // Suppress errors for tabs without the content script
        if (chrome.runtime.lastError) {
          return;
        }
      });
    });
  });
}

// ============================================
// Supabase Authentication Handlers
// ============================================

// PRODUCTION URLs - ALWAYS USE THESE
const WEBEDIT_PROD_BASE_URL = "https://webeditai.com";
const LOGIN_URL = "https://webeditai.com/#/signup"; // Apex domain avoids redirect that broke hash routes; site should keep this SPA path live
const HISTORY_URL = "https://webeditai.com/#/history";
const WEBEDIT_SIGNOUT_URL = `${HISTORY_URL}?from=extension-logout`;
const WEBEDIT_LANDING_URL = "https://webeditai.com/";
const SIGN_OUT_SUPPRESSION_MS = 8000;
let signOutCooldownUntil = 0;
let lastClearedSessionToken = null;

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

function sessionsAreEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const accessTokenMatch = a.access_token === b.access_token;
  const userIdMatch = (a.user?.id || a.user?.email || null) === (b.user?.id || b.user?.email || null);
  return accessTokenMatch && userIdMatch;
}

function isSignOutSuppressed() {
  return Date.now() < signOutCooldownUntil;
}

function shouldSuppressSessionDuringCooldown(session) {
  if (!isSignOutSuppressed()) {
    return false;
  }

  // Suppress null/undefined sessions (sign-out echoes)
  if (!session) {
    return true;
  }

  // Suppress only if the session matches the one we just cleared
  if (!lastClearedSessionToken) {
    return false;
  }

  return session.access_token === lastClearedSessionToken;
}

/**
 * Listen for authentication-related messages
 * All URLs use PRODUCTION constants - no dev URLs
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WEBEDIT_GET_PANEL_OPEN_STATE") {
    (async () => {
      const isOpen = await readPanelVisibilityPreference();
      sendResponse({ ok: true, isOpen });
    })();
    return true;
  }

  if (message.type === "WEBEDIT_SET_PANEL_OPEN_STATE") {
    const nextState = !!message.isOpen;
    (async () => {
      const currentState = await readPanelVisibilityPreference();
      if (currentState === nextState) {
        sendResponse({ ok: true, isOpen: nextState, unchanged: true });
        return;
      }
      await writePanelVisibilityPreference(nextState);
      broadcastPanelVisibility(nextState, { excludeTabId: sender?.tab?.id });
      sendResponse({ ok: true, isOpen: nextState });
    })();
    return true;
  }

  // Handle WEBEDIT_STORE_SUPABASE_SESSION - Store session from website
  if (message.type === "WEBEDIT_STORE_SUPABASE_SESSION") {
    const session = message.session;
    const isSignedIn = !!(session && session.user);
    console.log(`💾 Received session update from website: ${isSignedIn ? "SIGNED-IN" : "SIGNED-OUT"}`, isSignedIn ? session.user?.email : "");

    if (shouldSuppressSessionDuringCooldown(session)) {
      console.log("⚠️ Sign-out in progress; ignoring session update");
      sendResponse({ ok: false, ignored: true, reason: "SIGN_OUT_IN_PROGRESS" });
      return;
    }

    if (!session) {
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

        console.log("🧹 Cleared stored session (website sign-out)");
        broadcastSessionUpdate(null);
        signOutCooldownUntil = 0;
        lastClearedSessionToken = null;
        sendResponse({ ok: true, cleared: true });
      });
      return true;
    }

    chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
      const existingSession = result.webeditSupabaseSession || null;

      if (sessionsAreEqual(existingSession, session)) {
        console.log("ℹ️ Session unchanged – skipping storage/broadcast");
        sendResponse({ ok: true, unchanged: true });
        return;
      }

      chrome.storage.local.set({
        webeditSupabaseSession: session,
        webeditSessionTimestamp: Date.now()
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("❌ Error storing session:", chrome.runtime.lastError);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        console.log("✅ Session stored successfully for user:", session?.user?.email || "(signed out)");

        // Broadcast to all tabs
        broadcastSessionUpdate(session);
        signOutCooldownUntil = 0;
        lastClearedSessionToken = null;

        sendResponse({ ok: true, user: session?.user });
      });
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

    chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
      const existingSession = result.webeditSupabaseSession || null;
      lastClearedSessionToken = existingSession?.access_token || null;
      signOutCooldownUntil = Date.now() + SIGN_OUT_SUPPRESSION_MS;

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

        // Ensure website session is cleared and user sees landing page
        openWebsiteSignOutFlow();

        sendResponse({ ok: true });
      });
    });

    return true; // Keep message channel open for async response
  }

  function openWebsiteSignOutFlow() {
    console.log("🌐 Initiating website sign-out flow");
    // First, hit a route that performs Supabase sign-out in the SPA (open in background)
    chrome.tabs.create({ url: WEBEDIT_SIGNOUT_URL, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        console.warn("⚠️ Could not open website sign-out tab:", chrome.runtime.lastError.message);
      } else if (tab) {
        console.log("🧼 Website sign-out tab opened:", tab.id);
      }
    });

    // Then open the public landing page for the user
    chrome.tabs.create({ url: WEBEDIT_LANDING_URL, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error("❌ Failed to open landing page:", chrome.runtime.lastError.message);
      } else if (tab) {
        console.log("🏠 Landing page opened:", tab.id);
      }
    });
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

  // ============================================
  // FeatureSpec relay (UI/background -> active tab content script)
  // ============================================
  if (
    message?.type === "GET_PAGE_CONTEXT" ||
    message?.type === "APPLY_FEATURE_SPEC" ||
    message?.type === "UNDO_LAST" ||
    message?.type === "REDO_LAST"
  ) {
    (async () => {
      try {
        const tabIdFromSender = sender?.tab?.id || null;

        const resolveActiveTabId = () =>
          new Promise((resolve) => {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
              const tabId = tabs && tabs[0] && tabs[0].id ? tabs[0].id : null;
              resolve(tabId);
            });
          });

        const targetTabId = tabIdFromSender || (await resolveActiveTabId());
        if (!targetTabId) {
          sendResponse({ ok: false, error: "No active tab found" });
          return;
        }

        chrome.tabs.sendMessage(targetTabId, message, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { ok: false, error: "No response from content script" });
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: msg || "Failed to relay message" });
      }
    })();

    return true; // Keep message channel open for async response
  }
});