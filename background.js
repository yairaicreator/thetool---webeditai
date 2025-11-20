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
    // Send message to content script to toggle the panel
    await chrome.tabs.sendMessage(tab.id, {
      type: 'WEBEDIT_TOGGLE_PANEL'
    });
    
    console.log('WebEdit AI: Toggle message sent to tab', tab.id);
  } catch (error) {
    // If content script isn't loaded yet, it will auto-inject on page load
    console.log('WebEdit AI: Content script not ready yet, will be available after page loads');
    console.error(error);
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
