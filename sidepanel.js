// WebEdit AI Side Panel UI
//
// Logs:
// - Side panel DevTools: open side panel → right-click → Inspect
// - Service worker DevTools: chrome://extensions → WebEdit AI → service worker → Inspect

(() => {
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send");

  function addMessage(text, cls = "") {
    if (!messagesEl) return;
    const div = document.createElement("div");
    div.className = `msg ${cls}`.trim();
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage() {
    if (!inputEl) return;
    const text = (inputEl.value || "").trim();
    if (!text) return;

    addMessage(text, "me");
    inputEl.value = "";

    try {
      const resp = await chrome.runtime.sendMessage({
        type: "WEBEDIT_SIDEPANEL_SEND_MESSAGE",
        text
      });

      if (!resp?.ok) {
        addMessage(`Error: ${resp?.error || "unknown"}`, "sys");
        return;
      }

      addMessage(`Forwarded to tab ${resp.tabId}. Check the page console.`, "sys");
    } catch (err) {
      addMessage(`Error: ${err?.message || String(err)}`, "sys");
    }
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", sendMessage);
  }

  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  addMessage("Side panel ready. Type a message and press Enter.", "sys");
})();
