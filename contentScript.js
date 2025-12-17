// WebEdit AI Content Script (Native Side Panel scaffold)
//
// Purpose (for now): confirm end-to-end messaging
// sidepanel.js -> background.js(service worker) -> contentScript.js(active tab)
//
// Logs:
// - Page logs: open DevTools on the page → Console

console.log("[WebEdit] contentScript loaded on", location.href);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WEBEDIT_FROM_SIDEPANEL") {
    console.log("[WebEdit] Message from side panel:", message, "sender:", sender);
    sendResponse({ ok: true, received: true });
    return true;
  }

  if (message?.type === "PING") {
    sendResponse({ ok: true, status: "ready" });
    return true;
  }

  return false;
});
