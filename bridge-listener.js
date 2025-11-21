// WebEdit AI Bridge Listener - Content Script
// This script ONLY runs on https://www.webeditai.com pages
// Its purpose is to capture Supabase sessions posted from the website
// and forward them to the extension's background script for storage

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
        console.log("✅ Session forwarded to background:", response);
      }
    );
  }
});

console.log("🔐 WebEdit AI: Bridge listener initialized on", window.location.href);

