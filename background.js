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
