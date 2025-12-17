// WebEdit AI Side Panel UI
//
// Logs:
// - Side panel DevTools: open side panel → right-click → Inspect
// - Service worker DevTools: chrome://extensions → WebEdit AI → service worker → Inspect

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

function addMessage(text, cls = "") {
  const div = document.createElement("div");
  div.className = `msg ${cls}`.trim();
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendMessage() {
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

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

addMessage("Side panel ready. Type a message and press Enter.", "sys");
// WebEdit AI Side Panel Script

console.log('WebEdit AI Side Panel loaded');

// UI Elements
const burgerBtn = document.getElementById('webedit-burger-btn');
const toolsMenu = document.getElementById('webedit-tools-menu');
const toolButtons = document.querySelectorAll('.webedit-tool-btn');
const pickBtn = document.getElementById('webedit-pick-btn');
const chatInput = document.getElementById('webedit-chat-input');
const sendBtn = document.getElementById('webedit-send-btn');
const signinBtn = document.getElementById('webedit-signin-btn');

// Toggle tools menu
if (burgerBtn && toolsMenu) {
    burgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toolsMenu.classList.toggle('visible');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!burgerBtn.contains(e.target) && !toolsMenu.contains(e.target)) {
            toolsMenu.classList.remove('visible');
        }
    });
}

// Tool selection
toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        toolsMenu.classList.remove('visible');
        console.log('Selected tool:', btn.dataset.tool);
        // TODO: Communicate tool change to content script
    });
});

// Pick button
if (pickBtn) {
    pickBtn.addEventListener('click', () => {
        console.log('Pick element clicked');
        // TODO: Communicate pick action to content script
    });
}

// Chat input
if (chatInput && sendBtn) {
    const sendMessage = () => {
        const text = chatInput.value.trim();
        if (text) {
            console.log('Sending message:', text);
            // TODO: Send message to content script/backend
            chatInput.value = '';

            // Add user message to chat (demo)
            addMessageToChat(text, 'user');
        }
    };

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// Sign in button
if (signinBtn) {
    signinBtn.addEventListener('click', () => {
        console.log('Sign in clicked');
        // TODO: Handle sign in
    });
}

// Helper to add message to chat (for demo purposes)
function addMessageToChat(text, sender) {
    const chatMessages = document.getElementById('webedit-chat-messages');
    if (!chatMessages) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `webedit-chat-message webedit-chat-message-${sender}`;
    msgDiv.textContent = text;

    // Remove placeholder if it exists
    const placeholder = chatMessages.querySelector('.webedit-chat-placeholder');
    if (placeholder) {
        placeholder.remove();
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
