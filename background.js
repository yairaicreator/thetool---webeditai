// WebEdit AI - MV3 Service Worker
// Native Side Panel scaffold (Chrome Side Panel API).
//
// Logs:
// - Service worker logs: chrome://extensions → WebEdit AI → "service worker" → Inspect
// - Side panel logs: open side panel → right-click inside → Inspect

const SIDEPANEL_PATH = "sidepanel.html";

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

// Message relay: sidepanel.js -> background.js -> contentScript.js (active tab)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WEBEDIT_SIDEPANEL_COMMAND") {
    (async () => {
      const tabIdFromSender = sender?.tab?.id || null;
      const tabId = tabIdFromSender || (await getActiveTabId());
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab found" });
        return;
      }
      chrome.tabs.sendMessage(tabId, { type: "WEBEDIT_SIDEPANEL_COMMAND", payload: message.payload || {} }, (resp) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, response: resp || null });
      });
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
    chrome.storage.local.set({ webeditSupabaseSession: session, webeditSessionTimestamp: Date.now() }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      // Broadcast to all extension contexts
      chrome.runtime.sendMessage({ type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (!tab.id) return;
          chrome.tabs.sendMessage(tab.id, { type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
        });
      });
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
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "WEBEDIT_OPEN_LOGIN_TAB") {
    chrome.tabs.create({ url: "https://www.webeditai.com/#/signup?from=extension" }, (tab) => {
      sendResponse({ ok: true, tabId: tab?.id || null });
    });
    return true;
  }

  if (message?.type === "WEBEDIT_OPEN_HISTORY") {
    chrome.tabs.create({ url: "https://www.webeditai.com/#/history" }, (tab) => {
      sendResponse({ ok: true, tabId: tab?.id || null });
    });
    return true;
  }

  return false;
});