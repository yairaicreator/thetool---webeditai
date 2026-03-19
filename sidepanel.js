// WebEdit AI Side Panel UI
// The Remove, Customize, and Add buttons are visual-only.

(() => {
  const els = {
    headerHamburger: document.getElementById("webedit-header-hamburger"),
    homeBtn: document.getElementById("webedit-home-btn"),
    signinBtn: document.getElementById("webedit-signin-btn"),
    authGuard: document.getElementById("webedit-auth-guard"),
    authGuardTitle: document.getElementById("webedit-auth-guard-title"),
    authGuardMessage: document.getElementById("webedit-auth-guard-message"),
    authGuardSignin: document.getElementById("webedit-auth-guard-signin"),
    historySidebar: document.getElementById("webedit-history-sidebar"),
    historyList: document.getElementById("webedit-history-list"),
    newChatBtn: document.getElementById("webedit-new-chat-btn"),
    featureButtons: Array.from(document.querySelectorAll(".webedit-feature-btn")),
    chatMessages: document.getElementById("webedit-chat-messages"),
    chatInput: document.getElementById("webedit-chat-input"),
    sendBtn: document.getElementById("webedit-send-btn")
  };

  const CHAT_HISTORY_KEY = "webedit-sidepanel-chat-history-v1";
  const CURRENT_SESSION_KEY = "webedit-sidepanel-current-session-id";
  const MAX_SESSIONS = 50;
  const MAX_MESSAGES = 200;

  const AUTH_STATES = {
    UNAUTHENTICATED: "unauthenticated",
    AUTHENTICATED: "authenticated"
  };

  let authState = AUTH_STATES.UNAUTHENTICATED;
  let signedInUser = null;
  let currentUser = null;
  let lastUserId = null;
  let currentSessionId = null;
  let chatMessages = [];
  let activeHistoryRenameForm = null;
  let selectedFeature = "remove";

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

  function showNotificationInChat(text) {
    addChatMessage("system", text);
  }

  function renderChatMessages() {
    if (!els.chatMessages) return;
    els.chatMessages.innerHTML = "";

    if (chatMessages.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "webedit-chat-placeholder";
      placeholder.innerHTML = "<p>Describe what you want to change to get started</p>";
      els.chatMessages.appendChild(placeholder);
      return;
    }

    chatMessages.forEach((msg) => {
      const msgEl = document.createElement("div");
      msgEl.className = `webedit-chat-message webedit-chat-message-${msg.type}`;

      const contentEl = document.createElement("div");
      contentEl.className = "webedit-chat-message-content";
      contentEl.textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
      msgEl.appendChild(contentEl);

      els.chatMessages.appendChild(msgEl);
    });

    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function getDefaultSessionTitle(messages = []) {
    const firstUser = messages.find((m) => m.type === "user" && m.content && String(m.content).trim());
    if (firstUser) {
      const title = String(firstUser.content).trim();
      return title.length > 40 ? `${title.substring(0, 37)}...` : title;
    }
    return "New chat";
  }

  function getSessionDisplayName(session) {
    const title = session?.title && String(session.title).trim();
    if (title) return title;
    const preview = session?.preview && String(session.preview).trim();
    if (preview) return preview.length > 60 ? `${preview.substring(0, 57)}...` : preview;
    return "Untitled chat";
  }

  function closeActiveHistoryRenameForm() {
    if (activeHistoryRenameForm && activeHistoryRenameForm.parentNode) {
      try {
        if (activeHistoryRenameForm.parentNode.contains(activeHistoryRenameForm)) {
          activeHistoryRenameForm.parentNode.removeChild(activeHistoryRenameForm);
        }
      } catch (_) {}
    }
    activeHistoryRenameForm = null;
  }

  function renameChatSession(sessionId, newName) {
    const key = getHistoryStorageKey();
    if (!key) return false;
    try {
      chrome.storage.local.get([key], (result) => {
        const history = Array.isArray(result[key]) ? result[key] : [];
        const session = history.find((entry) => entry.id === sessionId);
        if (!session) return;
        const trimmed = (newName || "").trim();
        session.title = trimmed || getDefaultSessionTitle(session.messages || []);
        chrome.storage.local.set({ [key]: history }, () => renderHistoryList(history));
      });
      return true;
    } catch (error) {
      console.error("[SidePanel] rename failed:", error);
      return false;
    }
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

    form.addEventListener("click", (event) => event.stopPropagation());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      commit(true);
    });
    cancelBtn.addEventListener("click", (event) => {
      event.preventDefault();
      commit(false);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", (event) => {
      if (event.relatedTarget === saveBtn || event.relatedTarget === cancelBtn) return;
      commit(true);
    });

    hostEl.appendChild(form);
    activeHistoryRenameForm = form;
    input.focus();
    input.select();
  }

  function renderHistoryList(historyData = null) {
    if (!els.historyList) return;
    if (!currentUser?.id) {
      els.historyList.innerHTML = '<div style="padding:10px; color:#9ca3af; font-size:12px; text-align:center">Log in to view history</div>';
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
        renameBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          openHistoryRenameInput(session, item);
        });
        main.appendChild(renameBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "webedit-history-delete-btn";
        deleteBtn.type = "button";
        deleteBtn.setAttribute("aria-label", "Delete chat");
        deleteBtn.innerHTML = "🗑";
        deleteBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteChatSession(session.id);
        });
        main.appendChild(deleteBtn);

        const dateEl = document.createElement("div");
        dateEl.className = "webedit-history-date";
        const timestamp = session.timestamp || Date.now();
        dateEl.textContent = new Date(timestamp).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });

        const previewEl = document.createElement("div");
        previewEl.className = "webedit-history-preview";
        previewEl.textContent = session.preview || "New chat";

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
      const existing = history.find((entry) => entry.id === currentSessionId);
      const preservedTitle = existing?.title || null;

      const session = {
        id: currentSessionId,
        timestamp: Date.now(),
        messages: chatMessages,
        preview: chatMessages.find((message) => message.type === "user")?.content || "New chat",
        title: preservedTitle || getDefaultSessionTitle(chatMessages)
      };

      const index = history.findIndex((entry) => entry.id === currentSessionId);
      if (index >= 0) {
        history[index] = session;
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
      const session = history.find((entry) => entry.id === sessionId);
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

  function isAuthenticated() {
    return authState === AUTH_STATES.AUTHENTICATED;
  }

  function requireAuth(actionName) {
    if (isAuthenticated()) return true;
    showNotificationInChat(`Please log in to ${actionName}`);
    return false;
  }

  function updateAuthGuardUI() {
    if (!els.authGuard) return;
    const showGuard = authState === AUTH_STATES.UNAUTHENTICATED;
    els.authGuard.classList.toggle("hidden", !showGuard);

    if (authState === AUTH_STATES.UNAUTHENTICATED) {
      if (els.authGuardTitle) els.authGuardTitle.textContent = "Log in to use WebEdit AI";
      if (els.authGuardMessage) els.authGuardMessage.textContent = "Sign in or create an account to continue.";
      if (els.authGuardSignin) {
        els.authGuardSignin.textContent = "Log in";
        els.authGuardSignin.hidden = false;
      }
    }
  }

  function setControlsEnabled(enabled) {
    [els.newChatBtn, els.sendBtn, els.chatInput].filter(Boolean).forEach((el) => {
      if ("disabled" in el) {
        el.disabled = !enabled;
      }
      el.setAttribute("aria-disabled", enabled ? "false" : "true");
    });
  }

  function applyAuthStateUI() {
    updateAuthGuardUI();
    setControlsEnabled(isAuthenticated());
    if (isAuthenticated()) {
      renderHistoryList();
      return;
    }
    chatMessages = [];
    renderChatMessages();
    renderHistoryList([]);
  }

  function renderSignInButton() {
    if (!els.signinBtn) return;
    els.signinBtn.className = "webedit-nav-btn signin-btn";
    els.signinBtn.textContent = "Log in";
    els.signinBtn.onclick = () => {
      window.open("https://webeditai.com/#/signup?from=extension", "_blank");
    };
  }

  function renderSignedInButton(user) {
    if (!els.signinBtn) return;
    els.signinBtn.className = "webedit-nav-btn signin-btn webedit-avatar-container";
    els.signinBtn.title = user?.email || "Account";
    els.signinBtn.innerHTML = "";

    const avatar = document.createElement("div");
    avatar.className = "webedit-avatar";
    avatar.textContent = (user?.email || "U")[0].toUpperCase();
    els.signinBtn.appendChild(avatar);

    const menu = document.createElement("div");
    menu.className = "webedit-avatar-menu";
    menu.innerHTML = `
      <div class="webedit-avatar-menu-header">
        <div class="webedit-avatar-menu-email">${escapeHtml(user?.email || "User")}</div>
      </div>
      <div class="webedit-avatar-menu-item" data-action="signout">
        <span class="webedit-avatar-menu-icon">👋</span>
        <span>Sign out</span>
      </div>
    `;
    els.signinBtn.appendChild(menu);

    avatar.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.toggle("visible");
    });

    document.addEventListener("click", () => menu.classList.remove("visible"));
    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = event.target?.closest(".webedit-avatar-menu-item")?.dataset?.action;
      if (!action) return;
      menu.classList.remove("visible");
      if (action === "signout") {
        Promise.resolve(window.supabase?.auth?.signOut?.())
          .catch(() => {})
          .finally(() => chrome.runtime.sendMessage({ type: "WEBEDIT_SIGN_OUT" }));
      }
    });
  }

  function toggleHistorySidebar(forceState = null) {
    if (!els.historySidebar) return;
    const willShow = forceState === null
      ? !els.historySidebar.classList.contains("visible")
      : !!forceState;
    els.historySidebar.classList.toggle("visible", willShow);
  }

  function attachHeaderEventListeners() {
    if (els.headerHamburger && els.historySidebar) {
      els.headerHamburger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleHistorySidebar();
      });

      document.addEventListener("click", (event) => {
        if (!els.historySidebar.classList.contains("visible")) return;
        if (els.historySidebar.contains(event.target)) return;
        if (els.headerHamburger.contains(event.target)) return;
        toggleHistorySidebar(false);
      });
    }

    if (els.homeBtn) {
      els.homeBtn.addEventListener("click", () => {
        window.open("https://webeditai.com/", "_blank");
      });
    }
  }

  function deleteChatSession(sessionId) {
    const historyKey = getHistoryStorageKey();
    if (!historyKey) return;

    chrome.storage.local.get([historyKey], (result) => {
      const history = Array.isArray(result[historyKey]) ? result[historyKey] : [];
      const next = history.filter((entry) => entry.id !== sessionId);
      chrome.storage.local.set({ [historyKey]: next }, () => {
        if (currentSessionId === sessionId) {
          currentSessionId = null;
          chatMessages = [];
          renderChatMessages();
        }
        renderHistoryList(next);
      });
    });
  }

  async function refreshAuthorization(options = {}) {
    const client = window.SupabaseClient;
    let session = null;
    let user = null;
    const forceRefresh = !!options?.forceRefresh;

    try {
      if (client?.getSession) {
        const sessionResp = await client.getSession({ allowRefresh: forceRefresh });
        session = sessionResp?.data?.session || null;
      }
    } catch (_) {
      session = null;
    }

    try {
      if (client?.fetchAuthUser) {
        const authResp = await client.fetchAuthUser(forceRefresh);
        user = authResp?.ok ? authResp.user : null;
      } else {
        user = session?.user || null;
      }
      if (!user && session?.user) {
        user = session.user;
      }
    } catch (_) {
      user = null;
    }

    signedInUser = user || null;
    currentUser = user || null;
    authState = user ? AUTH_STATES.AUTHENTICATED : AUTH_STATES.UNAUTHENTICATED;

    const nextUserId = signedInUser?.id || null;
    if (nextUserId !== lastUserId) {
      lastUserId = nextUserId;
      currentSessionId = null;
      chatMessages = [];
    }

    if (signedInUser) {
      renderSignedInButton(signedInUser);
    } else {
      renderSignInButton();
    }
    applyAuthStateUI();
  }

  function setSelectedFeature(tool) {
    selectedFeature = tool;
    els.featureButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
  }

  function handleSend() {
    const text = (els.chatInput?.value || "").trim();
    if (!text) return;
    if (!requireAuth("use WebEdit")) return;

    els.chatInput.value = "";
    addChatMessage("user", text);
    addChatMessage(
      "assistant",
      `The ${selectedFeature} feature is currently unavailable. Remove, Customize, and Add are visual-only buttons right now.`
    );
  }

  function initializeHandlers() {
    els.newChatBtn?.addEventListener("click", () => {
      if (!requireAuth("create a chat")) return;
      startNewChat();
    });

    els.featureButtons.forEach((button) => {
      button.addEventListener("click", () => setSelectedFeature(button.dataset.tool || "remove"));
    });

    els.sendBtn?.addEventListener("click", handleSend);
    els.chatInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "WEBEDIT_SESSION_UPDATED") {
      refreshAuthorization();
    }
  });

  attachHeaderEventListeners();
  els.authGuardSignin?.addEventListener("click", () => {
    window.open("https://webeditai.com/#/signup?from=extension", "_blank");
  });

  (async () => {
    setSelectedFeature(selectedFeature);
    await refreshAuthorization();
    initializeHandlers();
    renderChatMessages();
  })();
})();
