// WebEdit AI Side Panel UI (Chrome Side Panel)
// Implements the full panel UI and relays actions to the active tab content script.

(() => {
  const els = {
    logoBtn: document.getElementById("webedit-logo-btn"),
    historyBtn: document.getElementById("webedit-history-btn"),
    signinBtn: document.getElementById("webedit-signin-btn"),
    authGuard: document.getElementById("webedit-auth-guard"),
    authGuardSignin: document.getElementById("webedit-auth-guard-signin"),
    historySidebar: document.getElementById("webedit-history-sidebar"),
    historyList: document.getElementById("webedit-history-list"),
    newChatBtn: document.getElementById("webedit-new-chat-btn"),
    chatMessages: document.getElementById("webedit-chat-messages"),
    referencesContainer: document.getElementById("webedit-references-container"),
    burgerBtn: document.getElementById("webedit-burger-btn"),
    toolsMenu: document.getElementById("webedit-tools-menu"),
    toolButtons: Array.from(document.querySelectorAll(".webedit-tool-btn")),
    pickBtn: document.getElementById("webedit-pick-btn"),
    modeIndicator: document.getElementById("webedit-mode-indicator"),
    modeText: document.getElementById("webedit-mode-text"),
    modeCloseBtn: document.getElementById("webedit-mode-close-btn"),
    customizePanel: document.getElementById("webedit-customize-panel"),
    customizeCloseBtn: document.getElementById("webedit-customize-close-btn"),
    applyBtn: document.getElementById("webedit-apply-btn"),
    resetBtn: document.getElementById("webedit-reset-btn"),
    bgColorInput: document.getElementById("webedit-bg-color"),
    textColorInput: document.getElementById("webedit-text-color"),
    fontSizeInput: document.getElementById("webedit-font-size"),
    widthValueInput: document.getElementById("webedit-width-value"),
    widthUnitSelect: document.getElementById("webedit-width-unit"),
    heightValueInput: document.getElementById("webedit-height-value"),
    heightUnitSelect: document.getElementById("webedit-height-unit"),
    scaleInput: document.getElementById("webedit-scale-input"),
    scaleValue: document.getElementById("webedit-scale-value"),
    moveUpBtn: document.getElementById("webedit-move-up-btn"),
    moveDownBtn: document.getElementById("webedit-move-down-btn"),
    alignBtns: Array.from(document.querySelectorAll(".webedit-align-btn")),
    chatInput: document.getElementById("webedit-chat-input"),
    sendBtn: document.getElementById("webedit-send-btn")
  };

  const CHAT_HISTORY_KEY = "webedit-sidepanel-chat-history-v1";
  const CURRENT_SESSION_KEY = "webedit-sidepanel-current-session-id";
  const MAX_SESSIONS = 50;
  const MAX_MESSAGES = 200;

  let currentUser = null;
  let currentSessionId = null;
  let chatMessages = [];
  let activeHistoryRenameForm = null;
  let currentTool = null;
  let isAddFeatureMode = false;
  let pendingAddFeatureStep = "idle"; // idle | name | description
  let addFeatureName = "";
  let addFeatureDescription = "";
  let lastPickedTarget = null; // { selector, description }

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getScopedKey(baseKey) {
    const id = currentUser?.id || null;
    if (!id) return null;
    return `${baseKey}::${id}`;
  }

  function getHistoryStorageKey() {
    return getScopedKey(CHAT_HISTORY_KEY);
  }

  function getSessionStorageKey() {
    return getScopedKey(CURRENT_SESSION_KEY);
  }

  async function sendToActiveTab(payload) {
    const resp = await chrome.runtime.sendMessage({
      type: "WEBEDIT_SIDEPANEL_COMMAND",
      payload
    });
    return resp;
  }

  function showNotificationInChat(text) {
    addChatMessage("system", text);
  }

  function addChatMessage(type, content) {
    const msg = { type, content, timestamp: Date.now() };
    chatMessages.push(msg);
    if (chatMessages.length > MAX_MESSAGES) {
      chatMessages = chatMessages.slice(-MAX_MESSAGES);
    }
    renderChatMessages();
    saveChatHistory();
    return msg;
  }

  function renderChatMessages() {
    if (!els.chatMessages || !els.referencesContainer) return;
    els.chatMessages.innerHTML = "";
    els.referencesContainer.innerHTML = "";

    if (chatMessages.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "webedit-chat-placeholder";
      placeholder.innerHTML = "<p>Select a tool from Visual Edit menu below to get started</p>";
      els.chatMessages.appendChild(placeholder);
      return;
    }

    const regular = chatMessages.filter(m => m.type !== "reference");
    const references = chatMessages.filter(m => m.type === "reference");

    regular.forEach((msg) => {
      const msgEl = document.createElement("div");
      msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;
      const contentEl = document.createElement("div");
      contentEl.className = "webedit-chat-message-content";
      contentEl.textContent = msg.content;
      msgEl.appendChild(contentEl);
      els.chatMessages.appendChild(msgEl);
    });

    references.forEach((msg) => {
      const msgEl = document.createElement("div");
      msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;
      const content = msg.content || "";
      const labelEl = document.createElement("span");
      labelEl.className = "webedit-reference-label";
      labelEl.textContent = "Reference:";
      const textEl = document.createElement("div");
      textEl.className = "webedit-reference-text";
      textEl.textContent = content.startsWith("Reference:") ? content.substring(10).trim() : content;
      msgEl.appendChild(labelEl);
      msgEl.appendChild(textEl);
      els.referencesContainer.appendChild(msgEl);
    });

    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function getDefaultSessionTitle(messages = []) {
    const firstUser = messages.find(m => m.type === "user" && m.content && m.content.trim());
    if (firstUser) {
      const t = firstUser.content.trim();
      return t.length > 40 ? `${t.substring(0, 37)}...` : t;
    }
    return "New chat";
  }

  function getSessionDisplayName(session) {
    const title = session?.title && session.title.trim();
    if (title) return title;
    const preview = session?.preview && session.preview.trim();
    if (preview) return preview.length > 60 ? `${preview.substring(0, 57)}...` : preview;
    return "Untitled chat";
  }

  function closeActiveHistoryRenameForm() {
    if (activeHistoryRenameForm && activeHistoryRenameForm.parentNode) {
      activeHistoryRenameForm.parentNode.removeChild(activeHistoryRenameForm);
    }
    activeHistoryRenameForm = null;
  }

  function openHistoryRenameInput(session, hostEl) {
    closeActiveHistoryRenameForm();
    if (!hostEl) return;

    const form = document.createElement("form");
    form.className = "webedit-history-rename-form";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "webedit-history-rename-input";
    input.maxLength = 80;
    input.value = getSessionDisplayName(session);
    form.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "webedit-history-rename-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "webedit-history-rename-save";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "webedit-history-rename-cancel";
    cancelBtn.textContent = "Cancel";

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    const commit = (shouldSave) => {
      if (shouldSave) {
        renameChatSession(session.id, input.value);
      }
      closeActiveHistoryRenameForm();
      renderHistoryList();
    };

    form.addEventListener("click", (e) => e.stopPropagation());
    form.addEventListener("submit", (e) => { e.preventDefault(); commit(true); });
    cancelBtn.addEventListener("click", (e) => { e.preventDefault(); commit(false); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", (e) => {
      if (e.relatedTarget === saveBtn || e.relatedTarget === cancelBtn) return;
      commit(true);
    });

    hostEl.appendChild(form);
    activeHistoryRenameForm = form;
    input.focus();
    input.select();
  }

  function renameChatSession(sessionId, newName) {
    const key = getHistoryStorageKey();
    if (!key) return false;
    try {
      chrome.storage.local.get([key], (result) => {
        const history = Array.isArray(result[key]) ? result[key] : [];
        const s = history.find(x => x.id === sessionId);
        if (!s) return;
        const trimmed = (newName || "").trim();
        s.title = trimmed || getDefaultSessionTitle(s.messages || []);
        chrome.storage.local.set({ [key]: history }, () => renderHistoryList(history));
      });
      return true;
    } catch (e) {
      console.error("[SidePanel] rename failed:", e);
      return false;
    }
  }

  function renderHistoryList(historyData = null) {
    if (!els.historyList) return;
    if (!currentUser?.id) {
      els.historyList.innerHTML = '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">Sign in to view history</div>';
      return;
    }

    if (!historyData) {
      const key = getHistoryStorageKey();
      if (!key) return;
      chrome.storage.local.get([key], (result) => {
        renderHistoryList(Array.isArray(result[key]) ? result[key] : []);
      });
      return;
    }

    if (!Array.isArray(historyData) || historyData.length === 0) {
      closeActiveHistoryRenameForm();
      els.historyList.innerHTML = '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">No history yet</div>';
      return;
    }

    closeActiveHistoryRenameForm();
    els.historyList.innerHTML = "";

    historyData
      .slice()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .forEach((session) => {
        const item = document.createElement("div");
        item.className = `webedit-history-item ${session.id === currentSessionId ? "active" : ""}`;

        const main = document.createElement("div");
        main.className = "webedit-history-item-main";

        const titleEl = document.createElement("div");
        titleEl.className = "webedit-history-title";
        titleEl.textContent = getSessionDisplayName(session);
        main.appendChild(titleEl);

        const renameBtn = document.createElement("button");
        renameBtn.className = "webedit-history-rename-btn";
        renameBtn.type = "button";
        renameBtn.setAttribute("aria-label", "Rename chat");
        renameBtn.innerHTML = "✏︎";
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openHistoryRenameInput(session, item);
        });
        main.appendChild(renameBtn);

        const dateEl = document.createElement("div");
        dateEl.className = "webedit-history-date";
        const ts = session.timestamp || Date.now();
        dateEl.textContent = new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        const previewEl = document.createElement("div");
        previewEl.className = "webedit-history-preview";
        previewEl.textContent = session.preview || "New Chat";

        item.appendChild(main);
        item.appendChild(dateEl);
        item.appendChild(previewEl);
        item.addEventListener("click", () => loadSession(session.id));
        els.historyList.appendChild(item);
      });
  }

  function saveChatHistory() {
    if (!currentUser?.id) return;
    const sessionKey = getSessionStorageKey();
    const historyKey = getHistoryStorageKey();
    if (!sessionKey || !historyKey) return;

    if (!currentSessionId) {
      currentSessionId = Date.now().toString();
    }

    chrome.storage.local.get([historyKey], (result) => {
      const history = Array.isArray(result[historyKey]) ? result[historyKey] : [];
      const existing = history.find(s => s.id === currentSessionId);
      const preservedTitle = existing?.title || null;

      const session = {
        id: currentSessionId,
        timestamp: Date.now(),
        messages: chatMessages,
        preview: chatMessages.find(m => m.type === "user")?.content || "New Chat",
        title: preservedTitle || getDefaultSessionTitle(chatMessages)
      };

      const idx = history.findIndex(s => s.id === currentSessionId);
      if (idx >= 0) {
        history[idx] = session;
      } else {
        history.unshift(session);
      }
      const trimmed = history.slice(0, MAX_SESSIONS);
      chrome.storage.local.set({ [historyKey]: trimmed, [sessionKey]: currentSessionId }, () => {
        renderHistoryList(trimmed);
      });
    });
  }

  function loadSession(sessionId) {
    if (!currentUser?.id) return;
    closeActiveHistoryRenameForm();
    const historyKey = getHistoryStorageKey();
    const sessionKey = getSessionStorageKey();
    if (!historyKey || !sessionKey) return;
    chrome.storage.local.get([historyKey], (result) => {
      const history = Array.isArray(result[historyKey]) ? result[historyKey] : [];
      const session = history.find(s => s.id === sessionId);
      if (!session) return;
      currentSessionId = sessionId;
      chatMessages = Array.isArray(session.messages) ? session.messages : [];
      chrome.storage.local.set({ [sessionKey]: currentSessionId }, () => {
        renderChatMessages();
        renderHistoryList(history);
      });
    });
  }

  function startNewChat() {
    if (!currentUser?.id) return;
    currentSessionId = Date.now().toString();
    chatMessages = [];
    renderChatMessages();
    saveChatHistory();
  }

  function requireAuth(actionName) {
    if (!currentUser) {
      showNotificationInChat(`Please sign in to ${actionName}`);
      return false;
    }
    return true;
  }

  function updateAuthGuardUI() {
    const signedIn = !!currentUser;
    if (els.authGuard) {
      els.authGuard.classList.toggle("hidden", signedIn);
    }
    if (els.historyBtn) {
      els.historyBtn.style.display = signedIn ? "" : "none";
    }
  }

  function renderSignInButton() {
    if (!els.signinBtn) return;
    els.signinBtn.className = "webedit-nav-btn signin-btn";
    els.signinBtn.textContent = "Sign in";
    els.signinBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: "WEBEDIT_OPEN_LOGIN_TAB" });
    };
  }

  function renderSignedInButton(user) {
    if (!els.signinBtn) return;
    els.signinBtn.className = "webedit-nav-btn signin-btn webedit-avatar-container";
    els.signinBtn.title = user?.email || "Account";
    els.signinBtn.innerHTML = "";

    const avatar = document.createElement("div");
    avatar.className = "webedit-avatar";
    const initial = (user?.email || "U")[0].toUpperCase();
    avatar.textContent = initial;
    els.signinBtn.appendChild(avatar);

    const menu = document.createElement("div");
    menu.className = "webedit-avatar-menu";
    menu.innerHTML = `
      <div class="webedit-avatar-menu-header">
        <div class="webedit-avatar-menu-email">${escapeHtml(user?.email || "User")}</div>
      </div>
      <div class="webedit-avatar-menu-item" data-action="history">
        <span class="webedit-avatar-menu-icon">📚</span>
        <span>View History</span>
      </div>
      <div class="webedit-avatar-menu-divider"></div>
      <div class="webedit-avatar-menu-item" data-action="signout">
        <span class="webedit-avatar-menu-icon">👋</span>
        <span>Sign Out</span>
      </div>
    `;
    els.signinBtn.appendChild(menu);

    avatar.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.classList.toggle("visible");
    });

    document.addEventListener("click", () => menu.classList.remove("visible"));
    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = e.target?.closest(".webedit-avatar-menu-item")?.dataset?.action;
      if (!action) return;
      menu.classList.remove("visible");
      if (action === "history") {
        chrome.runtime.sendMessage({ type: "WEBEDIT_OPEN_HISTORY" });
      } else if (action === "signout") {
        chrome.runtime.sendMessage({ type: "WEBEDIT_SIGN_OUT" });
      }
    });
  }

  async function refreshAuth() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "WEBEDIT_GET_SESSION" });
      const session = resp?.session || null;
      currentUser = session?.user || null;
    } catch (e) {
      currentUser = null;
    }
    updateAuthGuardUI();
    if (currentUser) {
      renderSignedInButton(currentUser);
      renderHistoryList();
    } else {
      renderSignInButton();
      renderHistoryList([]);
      chatMessages = [];
      renderChatMessages();
    }
  }

  function setActiveTool(tool) {
    currentTool = tool;
    els.toolButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
  }

  function showModeIndicator(text) {
    if (!els.modeIndicator || !els.modeText) return;
    els.modeText.textContent = text;
    els.modeIndicator.classList.remove("hidden");
  }

  function hideModeIndicator() {
    if (!els.modeIndicator) return;
    els.modeIndicator.classList.add("hidden");
  }

  async function handleToolClick(tool) {
    if (tool === "remove" && !requireAuth("remove elements")) return;
    if (tool === "customize" && !requireAuth("customize elements")) return;
    if (tool === "add" && !requireAuth("add features")) return;

    setActiveTool(tool);
    if (els.toolsMenu) els.toolsMenu.classList.remove("visible");

    if (tool === "remove") {
      isAddFeatureMode = false;
      els.customizePanel?.classList.remove("visible");
      showModeIndicator("Remove mode active - Click an element to hide it");
      await sendToActiveTab({ type: "START_REMOVE_MODE" });
      return;
    }
    if (tool === "customize") {
      isAddFeatureMode = false;
      els.customizePanel?.classList.add("visible");
      showNotificationInChat("Pick an element to customize, or use Pick element.");
      await sendToActiveTab({ type: "START_PICK_MODE", reason: "customize" });
      return;
    }
    if (tool === "add") {
      isAddFeatureMode = true;
      pendingAddFeatureStep = "idle";
      addFeatureName = "";
      addFeatureDescription = "";
      els.customizePanel?.classList.remove("visible");
      showNotificationInChat("Pick an element to add content near it.");
      await sendToActiveTab({ type: "START_PICK_MODE", reason: "add" });
      return;
    }
  }

  async function handlePickClick() {
    if (!requireAuth("pick elements")) return;
    await sendToActiveTab({ type: "START_PICK_MODE", reason: "manual-pick" });
    showModeIndicator("Pick mode active - Click an element to select it");
  }

  async function applyCustomize() {
    if (!requireAuth("apply customizations")) return;
    if (!lastPickedTarget?.selector) {
      showNotificationInChat("Pick an element first.");
      return;
    }

    const widthValue = (els.widthValueInput?.value || "").trim();
    const widthUnit = els.widthUnitSelect?.value || "px";
    const heightValue = (els.heightValueInput?.value || "").trim();
    const heightUnit = els.heightUnitSelect?.value || "px";
    const scalePct = Number(els.scaleInput?.value || 100);
    const scale = Number.isFinite(scalePct) ? Math.max(0.1, scalePct / 100) : 1;

    const styles = {
      backgroundColor: els.bgColorInput?.value || "#ffffff",
      color: els.textColorInput?.value || "#000000",
      fontSize: (els.fontSizeInput?.value || "16") + "px",
      ...(widthValue ? { width: `${widthValue}${widthUnit}` } : {}),
      ...(heightValue ? { height: `${heightValue}${heightUnit}` } : {}),
      ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: "center" } : {})
    };
    await sendToActiveTab({ type: "APPLY_STYLES", selector: lastPickedTarget.selector, styles });
    showNotificationInChat("Styles applied.");
  }

  async function resetCustomize() {
    if (!lastPickedTarget?.selector) return;
    await sendToActiveTab({ type: "RESET_STYLES", selector: lastPickedTarget.selector });
    if (els.widthValueInput) els.widthValueInput.value = "";
    if (els.heightValueInput) els.heightValueInput.value = "";
    if (els.scaleInput) els.scaleInput.value = "100";
    if (els.scaleValue) els.scaleValue.textContent = "100%";
    showNotificationInChat("Styles reset.");
  }

  async function handleSend() {
    const text = (els.chatInput?.value || "").trim();
    if (!text) return;
    els.chatInput.value = "";

    // Add Feature flow in side panel
    if (isAddFeatureMode) {
      if (!lastPickedTarget?.selector) {
        addChatMessage("system", "Pick an element first.");
        return;
      }

      addChatMessage("user", text);
      if (pendingAddFeatureStep === "idle") {
        pendingAddFeatureStep = "name";
      }

      if (pendingAddFeatureStep === "name") {
        addFeatureName = text;
        pendingAddFeatureStep = "description";
        addChatMessage("system", "Describe the edit:");
        return;
      }

      if (pendingAddFeatureStep === "description") {
        addFeatureDescription = text;
        pendingAddFeatureStep = "idle";

        const thinking = addChatMessage("assistant", "Generating your feature...");
        try {
          const pageContextResp = await sendToActiveTab({ type: "GET_PAGE_CONTEXT" });
          const pageContext = pageContextResp?.response?.pageContext || null;

          const prompt = `${addFeatureName}\n\n${addFeatureDescription}`;
          const context = {
            pageContext,
            target: lastPickedTarget
          };

          const aiResp = window.SupabaseClient?.generateFeatureSpec
            ? await window.SupabaseClient.generateFeatureSpec(prompt, context)
            : null;

          const spec = aiResp?.ok ? aiResp.spec : null;
          if (spec?.action === "add" && typeof spec.html === "string" && spec.html.trim()) {
            await sendToActiveTab({
              type: "ADD_FEATURE_CARD",
              selector: spec.targetSelector || lastPickedTarget.selector,
              position: spec.position || "after",
              name: addFeatureName,
              description: addFeatureDescription,
              html: spec.html,
              css: spec.css || ""
            });
            thinking.content = "✅ Feature generated and added.";
          } else {
            await sendToActiveTab({
              type: "ADD_FEATURE_CARD",
              selector: lastPickedTarget.selector,
              name: addFeatureName,
              description: addFeatureDescription
            });
            thinking.content = aiResp?.error
              ? `✅ Added a basic feature card (AI error: ${aiResp.error}).`
              : "✅ Added a basic feature card (AI spec unavailable).";
          }
        } catch (e) {
          await sendToActiveTab({
            type: "ADD_FEATURE_CARD",
            selector: lastPickedTarget.selector,
            name: addFeatureName,
            description: addFeatureDescription
          });
          thinking.content = `✅ Added a basic feature card (AI error: ${e?.message || String(e)}).`;
        }

        addChatMessage("system", `✅ "${addFeatureName}" added.`);
        isAddFeatureMode = false;
        addFeatureName = "";
        addFeatureDescription = "";
        return;
      }
    }

    // General chat → Supabase Edge Function
    addChatMessage("user", text);
    const thinking = addChatMessage("assistant", "Assistant is thinking...");

    try {
      const pageContext = await sendToActiveTab({ type: "GET_PAGE_CONTEXT" });
      const result = await (window.SupabaseClient?.callPageChat
        ? window.SupabaseClient.callPageChat(text, pageContext?.pageContext || null, [])
        : window.callPageChat?.(text, pageContext?.pageContext || null, []));

      if (result?.ok && typeof result.reply === "string" && result.reply.trim()) {
        thinking.content = result.reply.trim();
      } else if (result?.error) {
        thinking.content = `There was a problem talking to the AI: ${result.error}`;
      } else {
        thinking.content = "AI chat is not available right now.";
      }
    } catch (e) {
      thinking.content = `There was a problem talking to the AI: ${e?.message || String(e)}`;
    }

    renderChatMessages();
    saveChatHistory();
  }

  // Listen to messages from background/content scripts
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "WEBEDIT_SESSION_UPDATED") {
      refreshAuth();
      return;
    }
    if (message?.type === "WEBEDIT_TAB_EVENT") {
      // placeholder
      return;
    }
    if (message?.type === "WEBEDIT_ELEMENT_PICKED") {
      lastPickedTarget = message.payload || null;
      if (lastPickedTarget?.description) {
        addChatMessage("reference", `Reference: ${lastPickedTarget.description}`);
      }
      hideModeIndicator();
      if (isAddFeatureMode) {
        pendingAddFeatureStep = "name";
        addChatMessage("system", "Name of edit:");
      }
      return;
    }
    if (message?.type === "WEBEDIT_MODE_EXITED") {
      hideModeIndicator();
      return;
    }
  });

  // Wire UI
  els.logoBtn?.addEventListener("click", () => chrome.tabs.create({ url: "https://www.webeditai.com" }));
  els.historyBtn?.addEventListener("click", () => {
    els.historySidebar?.classList.toggle("visible");
  });
  els.newChatBtn?.addEventListener("click", () => {
    if (!requireAuth("create a chat")) return;
    startNewChat();
  });

  els.burgerBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.toolsMenu?.classList.toggle("visible");
  });

  els.toolButtons.forEach((btn) => {
    btn.addEventListener("click", () => handleToolClick(btn.dataset.tool));
  });

  els.pickBtn?.addEventListener("click", handlePickClick);
  els.modeCloseBtn?.addEventListener("click", async () => {
    hideModeIndicator();
    await sendToActiveTab({ type: "EXIT_FEATURES" });
  });

  els.customizeCloseBtn?.addEventListener("click", () => {
    els.customizePanel?.classList.remove("visible");
  });
  els.applyBtn?.addEventListener("click", applyCustomize);
  els.resetBtn?.addEventListener("click", resetCustomize);

  els.scaleInput?.addEventListener("input", () => {
    if (els.scaleValue) {
      els.scaleValue.textContent = `${els.scaleInput.value}%`;
    }
  });

  els.moveUpBtn?.addEventListener("click", async () => {
    if (!requireAuth("move elements")) return;
    if (!lastPickedTarget?.selector) return;
    await sendToActiveTab({ type: "MOVE_ELEMENT", selector: lastPickedTarget.selector, direction: "up" });
    showNotificationInChat("Moved up.");
  });

  els.moveDownBtn?.addEventListener("click", async () => {
    if (!requireAuth("move elements")) return;
    if (!lastPickedTarget?.selector) return;
    await sendToActiveTab({ type: "MOVE_ELEMENT", selector: lastPickedTarget.selector, direction: "down" });
    showNotificationInChat("Moved down.");
  });

  els.alignBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireAuth("align elements")) return;
      if (!lastPickedTarget?.selector) return;
      const align = btn.dataset.align;
      await sendToActiveTab({ type: "ALIGN_ELEMENT", selector: lastPickedTarget.selector, align });
      showNotificationInChat(`Aligned ${align}.`);
    });
  });

  els.sendBtn?.addEventListener("click", handleSend);
  els.chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  els.authGuardSignin?.addEventListener("click", () => chrome.runtime.sendMessage({ type: "WEBEDIT_OPEN_LOGIN_TAB" }));

  // Init
  refreshAuth();
  renderChatMessages();
})();
