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
        files: ['contentScript.js']
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
// Supabase Authentication Handlers
// ============================================

/**
 * Detect if we're in development or production mode
 * In development: use localhost
 * In production: use the live website
 */
function getWebsiteUrl() {
  // Check if extension is loaded unpacked (development mode)
  const manifest = chrome.runtime.getManifest();
  const isDev = !('update_url' in manifest);
  
  return isDev 
    ? 'http://127.0.0.1:8080'
    : 'https://www.webeditai.com';
}

/**
 * Listen for authentication-related messages
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle WEBEDIT_STORE_SESSION - Store Supabase session from website
  if (message.type === "WEBEDIT_STORE_SESSION") {
    console.log("💾 Storing Supabase session from website");
    
    chrome.storage.local.set({ 
      webedit_supabase_session: message.session,
      webedit_session_timestamp: Date.now()
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error storing session:", chrome.runtime.lastError);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      console.log("✅ Session stored successfully");
      
      // Notify all tabs that the session has been updated
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            type: "WEBEDIT_SESSION_UPDATED",
            session: message.session
          }).catch(() => {
            // Ignore errors for tabs that don't have our content script
          });
        });
      });
      
      sendResponse({ ok: true });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_GET_SESSION - Retrieve stored session
  if (message.type === "WEBEDIT_GET_SESSION") {
    chrome.storage.local.get(['webedit_supabase_session', 'webedit_session_timestamp'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error retrieving session:", chrome.runtime.lastError);
        sendResponse({ session: null, error: chrome.runtime.lastError.message });
        return;
      }
      
      const session = result.webedit_supabase_session || null;
      const timestamp = result.webedit_session_timestamp || null;
      
      console.log("📖 Retrieved session:", session ? "exists" : "none", timestamp ? `(stored ${Date.now() - timestamp}ms ago)` : "");
      sendResponse({ session, timestamp });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_OPEN_LOGIN - Open login page on website
  if (message.type === "WEBEDIT_OPEN_LOGIN") {
    console.log("🔐 Opening login page for extension auth");
    
    const websiteUrl = getWebsiteUrl();
    const loginUrl = `${websiteUrl}/#/signup?from=extension`;
    
    chrome.tabs.create({ url: loginUrl }, (tab) => {
      console.log("✅ Opened login tab:", tab.id);
      sendResponse({ ok: true, tabId: tab.id });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_SIGN_OUT - Clear stored session
  if (message.type === "WEBEDIT_SIGN_OUT") {
    console.log("👋 Signing out - clearing stored session");
    
    chrome.storage.local.remove(['webedit_supabase_session', 'webedit_session_timestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error("Error clearing session:", chrome.runtime.lastError);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      console.log("✅ Session cleared");
      
      // Notify all tabs that the session has been cleared
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            type: "WEBEDIT_SESSION_UPDATED",
            session: null
          }).catch(() => {
            // Ignore errors for tabs that don't have our content script
          });
        });
      });
      
      // Optionally open the website to sign out there too
      const websiteUrl = getWebsiteUrl();
      chrome.tabs.create({ url: `${websiteUrl}/#/signup?from=extension-logout` });
      
      sendResponse({ ok: true });
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle WEBEDIT_OPEN_HISTORY - Open history page on website
  if (message.type === "WEBEDIT_OPEN_HISTORY") {
    const websiteUrl = getWebsiteUrl();
    const historyUrl = `${websiteUrl}/#/history`;
    
    chrome.tabs.create({ url: historyUrl }, (tab) => {
      console.log("📚 Opened history tab:", tab.id);
      sendResponse({ ok: true, tabId: tab.id });
    });
    
    return true; // Keep message channel open for async response
  }
});