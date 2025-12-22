// WebEdit AI - MV3 Service Worker
// Native Side Panel scaffold (Chrome Side Panel API).
//
// Logs:
// - Service worker logs: chrome://extensions → WebEdit AI → "service worker" → Inspect
// - Side panel logs: open side panel → right-click inside → Inspect

const SIDEPANEL_PATH = "sidepanel.html";

// WebEdit AI website routes (use apex domain + hash routes to avoid SPA 404s during OAuth back navigation).
const WEBEDIT_LOGIN_URL = "https://webeditai.com/#/signup?from=extension";
const WEBEDIT_HISTORY_URL = "https://webeditai.com/#/history";
const WEBEDIT_SIGNOUT_URL = "https://webeditai.com/#/history?from=extension-logout";
const WEBEDIT_LANDING_URL = "https://webeditai.com/";

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

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await configureSidePanelForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    await configureSidePanelForTab(tabId);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await configureSidePanelForTab(tab.id);

  // Ensure the side panel opens for the current tab.
  if (chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      console.warn("[WebEdit] Failed to open side panel:", error);
    }
  }
});

function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id || null);
    });
  });
}

async function pingTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: "PING" }, (resp) => {
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

async function injectPageRuntime(tabId) {
  // NOTE: We only inject when the content script is missing (ping fails).
  // This avoids double-injecting scripts and causing duplicate listeners.
  const jsFiles = [
    "supabaseClient.js",
    "editRules.js",
    "saveEdit.js",
    "featureSpec.js",
    "featureSpecExecutor.js",
    "messages.js",
    "contentScript.js"
  ];
  const cssFiles = ["contentStyles.css"];

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: cssFiles
    });
  } catch (error) {
    // Some pages may block CSS injection; continue anyway.
    console.warn("[WebEdit] Failed to inject CSS:", error);
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: jsFiles
  });

  return { ok: true };
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
      "WEBEDIT_SESSION_UPDATED"
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
        await chrome.scripting.executeScript({
          target: { tabId },
          files
        });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type === "WEBEDIT_SIDEPANEL_COMMAND") {
    (async () => {
      const tabIdFromSender = sender?.tab?.id || null;
      const tabId = tabIdFromSender || (await getActiveTabId());
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab found" });
        return;
      }

      // PING first; inject runtime if missing; then retry command once.
      const ping = await pingTab(tabId);
      if (!ping.ok && typeof ping.error === "string" && ping.error.includes("Receiving end does not exist")) {
        try {
          await injectPageRuntime(tabId);
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
          return;
        }
      }

      chrome.tabs.sendMessage(
        tabId,
        { type: "WEBEDIT_SIDEPANEL_COMMAND", payload: message.payload || {} },
        (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ ok: true, response: resp || null });
        }
      );
    })();
    return true;
  }

  // Legacy message relay: sidepanel.js -> background.js -> contentScript.js (active tab)
  if (message?.type !== "WEBEDIT_SIDEPANEL_SEND_MESSAGE") {
    // fall through to auth handlers below
  } else {
    (async () => {
      const tabIdFromSender = sender?.tab?.id || null;
      const tabId = tabIdFromSender || (await getActiveTabId());
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab found" });
        return;
      }

      chrome.tabs.sendMessage(
        tabId,
        {
          type: "WEBEDIT_FROM_SIDEPANEL",
          text: String(message.text || ""),
          at: Date.now()
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ ok: true, forwarded: true, tabId, response: resp || null });
        }
      );
    })();

    return true; // async response
  }

  if (message?.type === "WEBEDIT_STORE_SUPABASE_SESSION") {
    const session = message.session || null;

    const broadcast = () => {
      chrome.runtime.sendMessage({ type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (!tab.id) return;
          chrome.tabs.sendMessage(tab.id, { type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
        });
      });
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
    chrome.storage.local.remove(["webeditSupabaseSession", "webeditSessionTimestamp"], () => {
      const session = null;
      chrome.runtime.sendMessage({ type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (!tab.id) return;
          chrome.tabs.sendMessage(tab.id, { type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
        });
      });

      // Best-effort: open a hidden WebEdit tab to trigger website logout (if the site implements it),
      // then bring the user to the landing page. This avoids the extension being re-signed-in
      // immediately if the website still has a valid session.
      chrome.tabs.create({ url: WEBEDIT_SIGNOUT_URL, active: false }, (hiddenTab) => {
        setTimeout(() => {
          if (hiddenTab?.id) {
            chrome.tabs.remove(hiddenTab.id).catch(() => {});
          }
          chrome.tabs.create({ url: WEBEDIT_LANDING_URL, active: true }, () => {});
        }, 1000);
      });

      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "WEBEDIT_OPEN_LOGIN_TAB") {
    // Use apex domain + hash route to avoid SPA 404s/redirects that can drop the hash.
    chrome.tabs.create({ url: WEBEDIT_LOGIN_URL }, (tab) => {
      sendResponse({ ok: true, tabId: tab?.id || null });
    });
    return true;
  }

  if (message?.type === "WEBEDIT_OPEN_HISTORY") {
    chrome.tabs.create({ url: WEBEDIT_HISTORY_URL }, (tab) => {
      sendResponse({ ok: true, tabId: tab?.id || null });
    });
    return true;
  }

  return false;
});