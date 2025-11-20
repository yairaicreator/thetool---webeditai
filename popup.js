// WebEdit AI Popup - Simple Toggle Interface

const toggleBtn = document.getElementById("toggleBtn");
const status = document.getElementById("status");

toggleBtn.addEventListener("click", async () => {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id) {
      status.textContent = "❌ No active tab found";
      return;
    }

    // Send message to content script to toggle the panel
    chrome.tabs.sendMessage(
      tab.id,
      { type: "WEBEDIT_TOGGLE_PANEL" },
      (response) => {
        if (chrome.runtime.lastError) {
          status.textContent = "❌ Please refresh the page first";
          console.error(chrome.runtime.lastError);
        } else {
          status.textContent = "✓ Panel toggled!";
          // Close popup after a brief delay
          setTimeout(() => window.close(), 300);
        }
      }
    );
  } catch (error) {
    status.textContent = "❌ Error: " + error.message;
    console.error(error);
  }
});

// Check if we can communicate with the tab
chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "PING" });
      status.textContent = "Ready to open";
    } catch (error) {
      status.textContent = "Please refresh the page";
    }
  }
});
