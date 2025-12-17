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
  if (message?.type !== "WEBEDIT_SIDEPANEL_SEND_MESSAGE") {
    return;
  }

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
});