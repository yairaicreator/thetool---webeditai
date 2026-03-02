// WebEdit AI - MV3 Service Worker
// Native Side Panel scaffold (Chrome Side Panel API).
//
// Logs:
// - Service worker logs: chrome://extensions → WebEdit AI → "service worker" → Inspect
// - Side panel logs: open side panel → right-click inside → Inspect

const SIDEPANEL_PATH = "sidepanel.html";

// Active-tab tracking: tab ID stored on action click for messaging.
const SESSION_TAB_KEY = "webeditActiveTabId";
const SUPABASE_SESSION_KEY = "webeditSupabaseSession";

async function configureSidePanelForTab(tabId) {
  if (!tabId || !chrome.sidePanel?.setOptions) return;
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: SIDEPANEL_PATH,
      enabled: true
    });
  } catch (error) {
    console.warn("[WebEdit] Failed to set side panel options:", error);
  }
}

async function configureGlobalSidePanelBehavior() {
  // Preferred: clicking the extension action opens the side panel.
  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn("[WebEdit] Failed to set panel behavior:", error);
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await configureGlobalSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(async () => {
  await configureGlobalSidePanelBehavior();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await configureSidePanelForTab(tab.id);
  try {
    if (chrome.storage?.session?.set) {
      await chrome.storage.session.set({ [SESSION_TAB_KEY]: tab.id });
    }
  } catch (_) {}

  // Ensure the side panel opens for the current tab.
  if (chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      console.warn("[WebEdit] Failed to open side panel:", error);
    }
  }
});

async function getStoredActiveTabId() {
  if (!chrome.storage?.session?.get) return null;
  return new Promise((resolve) => {
    chrome.storage.session.get([SESSION_TAB_KEY], (result) => {
      resolve(result[SESSION_TAB_KEY] || null);
    });
  });
}

async function storeActiveTabId(tabId) {
  if (!tabId || !chrome.storage?.session?.set) return;
  try {
    await chrome.storage.session.set({ [SESSION_TAB_KEY]: tabId });
  } catch (_) {}
}

async function clearStoredActiveTabId() {
  if (!chrome.storage?.session?.remove) return;
  try {
    await chrome.storage.session.remove([SESSION_TAB_KEY]);
  } catch (_) {}
}

async function getStoredSession() {
  if (!chrome.storage?.local?.get) return null;
  return new Promise((resolve) => {
    chrome.storage.local.get([SUPABASE_SESSION_KEY], (result) => {
      resolve(result?.[SUPABASE_SESSION_KEY] || null);
    });
  });
}

function isWebEditDomainUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = (parsed.hostname || "").toLowerCase();
    return host === "webeditai.com" || host === "www.webeditai.com";
  } catch (_) {
    return false;
  }
}

async function getTabById(tabId) {
  if (!tabId) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.id ? tab : null;
  } catch (_) {
    return null;
  }
}

async function queryActiveTabInCurrentWindow() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const activeTab = Array.isArray(tabs) && tabs.length > 0 ? tabs[0] : null;
        resolve(activeTab?.id ? activeTab : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function queryActiveTabInLastFocusedWindow() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const activeTab = Array.isArray(tabs) && tabs.length > 0 ? tabs[0] : null;
        resolve(activeTab?.id ? activeTab : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function queryBestEditableTabInCurrentWindow() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !Array.isArray(tabs) || tabs.length === 0) {
          resolve(null);
          return;
        }
        const candidates = tabs.filter((tab) => tab?.id && !isWebEditDomainUrl(tab.url || ""));
        if (!candidates.length) {
          resolve(null);
          return;
        }
        const activeCandidate = candidates.find((tab) => tab.active);
        if (activeCandidate) {
          resolve(activeCandidate);
          return;
        }
        const sorted = candidates
          .slice()
          .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
        resolve(sorted[0] || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function queryBestEditableTabAnyWindow() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError || !Array.isArray(tabs) || tabs.length === 0) {
          resolve(null);
          return;
        }
        const candidates = tabs.filter((tab) => tab?.id && !isWebEditDomainUrl(tab.url || ""));
        if (!candidates.length) {
          resolve(null);
          return;
        }
        const activeCandidate = candidates.find((tab) => tab.active);
        if (activeCandidate) {
          resolve(activeCandidate);
          return;
        }
        const sorted = candidates
          .slice()
          .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
        resolve(sorted[0] || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function resolveTargetTabContext(senderTabId = null) {
  if (senderTabId) {
    const senderTab = await getTabById(senderTabId);
    if (senderTab) {
      await storeActiveTabId(senderTab.id);
      return { tab: senderTab, source: "sender" };
    }
  }

  const activeTab = await queryActiveTabInCurrentWindow();
  if (activeTab?.id && !isWebEditDomainUrl(activeTab.url || "")) {
    await storeActiveTabId(activeTab.id);
    return { tab: activeTab, source: "active-query" };
  }

  const focusedActiveTab = await queryActiveTabInLastFocusedWindow();
  if (focusedActiveTab?.id && !isWebEditDomainUrl(focusedActiveTab.url || "")) {
    await storeActiveTabId(focusedActiveTab.id);
    return { tab: focusedActiveTab, source: "active-last-focused" };
  }

  const bestEditableTab = await queryBestEditableTabInCurrentWindow();
  if (bestEditableTab?.id) {
    await storeActiveTabId(bestEditableTab.id);
    return { tab: bestEditableTab, source: "best-editable" };
  }

  const bestEditableAnyWindow = await queryBestEditableTabAnyWindow();
  if (bestEditableAnyWindow?.id) {
    await storeActiveTabId(bestEditableAnyWindow.id);
    return { tab: bestEditableAnyWindow, source: "best-editable-any-window" };
  }

  const storedTabId = await getStoredActiveTabId();
  if (storedTabId) {
    const storedTab = await getTabById(storedTabId);
    if (storedTab) {
      return { tab: storedTab, source: "stored" };
    }
    await clearStoredActiveTabId();
  }

  const fallbackActiveTab = await queryActiveTabInCurrentWindow();
  if (fallbackActiveTab?.id && !isWebEditDomainUrl(fallbackActiveTab.url || "")) {
    await storeActiveTabId(fallbackActiveTab.id);
    return { tab: fallbackActiveTab, source: "active-query-fallback" };
  }

  const fallbackFocusedTab = await queryActiveTabInLastFocusedWindow();
  if (fallbackFocusedTab?.id && !isWebEditDomainUrl(fallbackFocusedTab.url || "")) {
    await storeActiveTabId(fallbackFocusedTab.id);
    return { tab: fallbackFocusedTab, source: "active-last-focused-fallback" };
  }
  return { tab: null, source: "none" };
}

async function shouldDeferPageMessaging(tab) {
  const tabUrl = tab?.url || "";
  if (!isWebEditDomainUrl(tabUrl)) {
    return { defer: false };
  }
  const session = await getStoredSession();
  const isAuthed = !!session?.user?.id;
  if (!isAuthed) {
    return {
      defer: true,
      error: "Authentication in progress on webeditai.com. Finish sign-in, then open the site you want to edit."
    };
  }
  return {
    defer: true,
    error: "You're currently on webeditai.com. Navigate back to the page you want to edit, then try again."
  };
}

function isUnsupportedMessagingUrl(url) {
  if (!url) return false;
  const value = String(url).toLowerCase();
  return value.startsWith("chrome://") ||
    value.startsWith("chrome-extension://") ||
    value.startsWith("edge://") ||
    value.startsWith("about:") ||
    value.startsWith("devtools://") ||
    value.startsWith("view-source:");
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function probeTabScriptability(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => true
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, response: resp || null });
      });
    } catch (error) {
      resolve({ ok: false, error: error?.message || String(error) });
    }
  });
}

async function pingTab(tabId) {
  return sendMessageToTab(tabId, { type: "PING" });
}

async function injectPageRuntime(tabId) {
  // Scripts are manifest-managed content scripts on <all_urls>.
  // Re-injecting here can redeclare top-level identifiers and break persistence.
  return { ok: false, error: "Content scripts are managed by manifest; reload the page if script context is missing." };
}

const MANIFEST_MANAGED_SCRIPT_FILES = new Set([
  "supabaseClient.js",
  "editRules.js",
  "saveEdit.js",
  "featureSpec.js",
  "featureSpecExecutor.js",
  "contextExtractor.js",
  "featureRegistry.js",
  "featureEngine.js",
  "featureStore.js",
  "previewLab.js",
  "messages.js",
  "contentScript.js"
]);

async function resolveReadyTabContext(senderTabId = null) {
  const retryDelays = [150, 300, 500, 800];
  let lastPingError = "";

  for (let i = 0; i < retryDelays.length; i += 1) {
    const tabContext = await resolveTargetTabContext(senderTabId);
    const tab = tabContext?.tab || null;
    if (!tab?.id) {
      await waitMs(retryDelays[i]);
      continue;
    }
    if (isUnsupportedMessagingUrl(tab.url || "")) {
      return {
        ok: false,
        error: "This page type cannot be edited. Open a regular website tab and try again."
      };
    }

    const deferState = await shouldDeferPageMessaging(tab);
    if (deferState.defer) {
      return { ok: false, error: deferState.error };
    }

    const ping = await pingTab(tab.id);
    if (ping.ok) {
      return { ok: true, tabContext };
    }

    lastPingError = String(ping.error || "");
    const shouldRetry =
      lastPingError.includes("Receiving end does not exist") ||
      lastPingError.includes("The message port closed before a response was received");
    if (!shouldRetry) {
      return {
        ok: false,
        error: ping.error || "Failed to contact page context."
      };
    }

    await waitMs(retryDelays[i]);
  }

  // Secondary readiness probe: tab can be scriptable before content script responds to PING.
  const tabContext = await resolveTargetTabContext(senderTabId);
  const tab = tabContext?.tab || null;
  if (tab?.id) {
    if (isUnsupportedMessagingUrl(tab.url || "")) {
      return {
        ok: false,
        error: "This page type cannot be edited. Open a regular website tab and try again."
      };
    }
    const deferState = await shouldDeferPageMessaging(tab);
    if (deferState.defer) {
      return { ok: false, error: deferState.error };
    }

    const probe = await probeTabScriptability(tab.id);
    if (probe.ok) {
      await waitMs(220);
      const pingAfterProbe = await pingTab(tab.id);
      if (pingAfterProbe.ok) {
        return { ok: true, tabContext };
      }
      lastPingError = String(pingAfterProbe.error || lastPingError || "");
    }
  }

  return {
    ok: false,
    error: "Page is still initializing. Please try again in a moment."
  };
}

// Message relay: sidepanel.js -> background.js -> contentScript.js (active tab)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // =========================================================
  // Tab -> Side Panel event relay (pick/remove/customize, etc.)
  //
  // Content scripts can only message the service worker directly.
  // The side panel UI listens on chrome.runtime.onMessage, so we
  // re-broadcast these events from the SW.
  //
  // IMPORTANT: Guard with sender.tab so we don't echo messages
  // originating from extension pages (sidepanel, options, etc.)
  // back into ourselves and create loops.
  // =========================================================
  if (sender?.tab?.id && typeof message?.type === "string") {
    const relayTypes = new Set([
      "WEBEDIT_ELEMENT_PICKED",
      "WEBEDIT_MODE_STARTED",
      "WEBEDIT_MODE_EXITED",
      "WEBEDIT_SESSION_UPDATED",
      "WEBEDIT_PREVIEW_ACTION"
    ]);
    if (relayTypes.has(message.type)) {
      // Best-effort broadcast to extension UIs (sidepanel, etc.)
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  }

  if (message?.type === "WEBEDIT_ENSURE_CONTENT_SCRIPTS") {
    (async () => {
      const tabId = sender?.tab?.id || null;
      const files = Array.isArray(message.files) ? message.files.filter(Boolean) : [];
      if (!tabId) {
        sendResponse({ ok: false, error: "No sender tab" });
        return;
      }
      if (!files.length) {
        sendResponse({ ok: false, error: "No files requested" });
        return;
      }
      try {
        const unmanagedFiles = files.filter((file) => !MANIFEST_MANAGED_SCRIPT_FILES.has(file));
        if (unmanagedFiles.length > 0) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: unmanagedFiles
          });
        }
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type === "WEBEDIT_SIDEPANEL_COMMAND") {
    (async () => {
      try {
        const resolved = await resolveReadyTabContext(sender?.tab?.id || null);
        if (!resolved?.ok || !resolved?.tabContext?.tab?.id) {
          sendResponse({
            ok: false,
            error: resolved?.error || "No active tab found"
          });
          return;
        }
        const tabId = resolved.tabContext.tab.id;

        const relayResult = await sendMessageToTab(tabId, {
          type: "WEBEDIT_SIDEPANEL_COMMAND",
          payload: message.payload || {}
        });
        if (!relayResult.ok && typeof relayResult.error === "string" && relayResult.error.includes("Receiving end does not exist")) {
          // One internal retry for transient runtime startup races.
          await waitMs(180);
          const retryResolved = await resolveReadyTabContext(sender?.tab?.id || null);
          const retryTabId = retryResolved?.ok ? retryResolved?.tabContext?.tab?.id : null;
          if (retryTabId) {
            const retryRelay = await sendMessageToTab(retryTabId, {
              type: "WEBEDIT_SIDEPANEL_COMMAND",
              payload: message.payload || {}
            });
            if (retryRelay.ok) {
              sendResponse({ ok: true, response: retryRelay.response || null });
              return;
            }
          }
        }
        if (!relayResult.ok) {
          sendResponse({ ok: false, error: relayResult.error || "Failed to deliver command to tab" });
          return;
        }
        sendResponse({ ok: true, response: relayResult.response || null });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true; // async response
  }

  // Legacy message relay: sidepanel.js -> background.js -> contentScript.js (active tab)
  if (message?.type === "WEBEDIT_SIDEPANEL_SEND_MESSAGE") {
    (async () => {
      try {
        const tabContext = await resolveTargetTabContext(sender?.tab?.id || null);
        const tabId = tabContext?.tab?.id || null;
        if (!tabId) {
          sendResponse({ ok: false, error: "No active tab found" });
          return;
        }

        const deferState = await shouldDeferPageMessaging(tabContext.tab);
        if (deferState.defer) {
          sendResponse({ ok: false, error: deferState.error });
          return;
        }

        const relayResult = await sendMessageToTab(tabId, {
          type: "WEBEDIT_FROM_SIDEPANEL",
          text: String(message.text || ""),
          at: Date.now()
        });
        if (!relayResult.ok) {
          sendResponse({ ok: false, error: relayResult.error || "Failed to forward message to tab" });
          return;
        }
        sendResponse({ ok: true, forwarded: true, tabId, response: relayResult.response || null });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true; // async response
  }

  if (message?.type === "WEBEDIT_STORE_SUPABASE_SESSION") {
    const session = message.session || null;

    const broadcast = () => {
      chrome.runtime.sendMessage({ type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
    };

    if (!session) {
      chrome.storage.local.remove(["webeditSupabaseSession", "webeditSessionTimestamp"], () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        broadcast();
        sendResponse({ ok: true, user: null });
      });
      return true;
    }

    chrome.storage.local.set({ webeditSupabaseSession: session, webeditSessionTimestamp: Date.now() }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      broadcast();
      sendResponse({ ok: true, user: session?.user || null });
    });
    return true;
  }

  if (message?.type === "WEBEDIT_GET_SESSION") {
    chrome.storage.local.get(["webeditSupabaseSession", "webeditSessionTimestamp"], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ session: null, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ session: result.webeditSupabaseSession || null, timestamp: result.webeditSessionTimestamp || null });
    });
    return true;
  }

  if (message?.type === "WEBEDIT_SIGN_OUT") {
    chrome.storage.local.get(["webeditSupabaseSession"], async (result) => {
      const previousSession = result?.webeditSupabaseSession || null;
      const previousUserId = previousSession?.user?.id || null;

      // Clear any user-scoped cached keys (chats/rules/features/etc.) so a refresh won't resurrect old state.
      chrome.storage.local.get(null, (all) => {
        const keys = Object.keys(all || {});
        const keysToRemove = new Set(["webeditSupabaseSession", "webeditSessionTimestamp"]);
        if (previousUserId) {
          keys.forEach((k) => {
            if (k.includes(`::${previousUserId}`)) keysToRemove.add(k);
          });
        }

        chrome.storage.local.remove(Array.from(keysToRemove), () => {
          const session = null;
          chrome.runtime.sendMessage({ type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
          sendResponse({ ok: true, clearedUserId: previousUserId });
        });
      });
    });
    return true;
  }

  if (message?.type === "WEBEDIT_OPEN_LOGIN_TAB") {
    sendResponse({ ok: true, openUrl: "https://webeditai.com/#/signup?from=extension" });
    return true;
  }

  if (message?.type === "WEBEDIT_OPEN_HISTORY") {
    sendResponse({ ok: true, openUrl: "https://webeditai.com/#/history" });
    return true;
  }

  return false;
});