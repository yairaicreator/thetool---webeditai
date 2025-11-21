// WebEdit AI Bridge Listener - Content Script
// This script ONLY runs on webeditai.com pages (specifically /auth/bridge)
// Its purpose is to capture the Supabase session posted from the website
// and forward it to the extension's background script for storage

/**
 * Listen for postMessage events from the website
 * The website's Bridge page posts the Supabase session after OAuth completes
 * We capture it here and send it to the background script
 */
window.addEventListener("message", (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const message = event.data;
  
  // Ignore messages that aren't from our auth system
  if (!message || message.type !== "WEBEDIT_AUTH") return;

  console.log("🔐 WebEdit AI: Bridge listener received auth session from website");
  
  // Forward the session to the background script for storage
  chrome.runtime.sendMessage(
    {
      type: "WEBEDIT_STORE_SESSION",
      session: message.session,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending session to background:", chrome.runtime.lastError);
        return;
      }
      console.log("✅ Session forwarded to background script:", response);
    }
  );
});

console.log("🔐 WebEdit AI: Bridge listener initialized on", window.location.href);

