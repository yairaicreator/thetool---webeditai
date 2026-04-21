'use strict';

// WebEdit AI — The "Dumb" Control Panel
// This file ONLY does two things:
//   1. Listens to what the user does (Event Listeners)
//   2. Sends Standardized Envelopes to the Brain (Chrome Post Office)
// It contains ZERO logic, ZERO Supabase, ZERO chrome.storage, ZERO DOM manipulation
// of the host website.

(() => {

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: DOM References
// ═══════════════════════════════════════════════════════════════════════════════

  const els = {
  chatPanel:       document.getElementById('webedit-chat-panel'),
  headerHamburger: document.getElementById('webedit-header-hamburger'),
  homeBtn:         document.getElementById('webedit-home-btn'),
  headerUpgrade:   document.getElementById('webedit-header-upgrade'),
  signinBtn:       document.getElementById('webedit-signin-btn'),
  authGuard:       document.getElementById('webedit-auth-guard'),
  authGuardTitle:  document.getElementById('webedit-auth-guard-title'),
  authGuardMessage:document.getElementById('webedit-auth-guard-message'),
  authGuardSignin: document.getElementById('webedit-auth-guard-signin'),
  historySidebar:  document.getElementById('webedit-history-sidebar'),
  historyList:     document.getElementById('webedit-history-list'),
  historyProfileCard: document.getElementById('webedit-history-profile-card'),
  historyProfileAvatar: document.getElementById('webedit-history-profile-avatar'),
  historyProfileName: document.getElementById('webedit-history-profile-name'),
  historyProfileSub: document.getElementById('webedit-history-profile-sub'),
  chatHome:        document.getElementById('webedit-chat-home'),
  chatThread:      document.getElementById('webedit-chat-thread'),
  bottomNav:       document.getElementById('webedit-bottom-nav'),
  sidebarNavNewChat: document.getElementById('webedit-sidebar-nav-new-chat'),
  sidebarNavRecentEdits: document.getElementById('webedit-sidebar-nav-recent-edits'),
  sidebarNavSettings: document.getElementById('webedit-sidebar-nav-settings'),
  newChatBtn:      document.getElementById('webedit-new-chat-btn'),
  mainContent:     document.getElementById('webedit-main-content'),
  featureButtons:  Array.from(document.querySelectorAll('.webedit-feature-btn')),
  blueprintList:   document.getElementById('webedit-blueprint-list'),
  chatMessages:    document.getElementById('webedit-chat-messages'),
  editHistoryView: document.getElementById('webedit-edit-history-view'),
  bottomControls:  document.getElementById('webedit-bottom-controls'),
  pageEditsRow:    document.getElementById('webedit-page-edits-row'),
  inputContainer:  document.getElementById('webedit-input-container'),
  chatInput:       document.getElementById('webedit-chat-input'),
  sendBtn:         document.getElementById('webedit-send-btn'),
  navChat:         document.getElementById('webedit-nav-chat'),
  navHistory:      document.getElementById('webedit-nav-history'),
  navBrowse:       document.getElementById('webedit-nav-browse'),
  profileView:     document.getElementById('webedit-profile-view'),
  profileBack:     document.getElementById('webedit-profile-back'),
  profileOverflow: document.getElementById('webedit-profile-overflow'),
  profileAvatarImg: document.getElementById('webedit-profile-avatar-img'),
  profileAvatarLetter: document.getElementById('webedit-profile-avatar-letter'),
  profileAvatarEdit: document.getElementById('webedit-profile-avatar-edit'),
  profileDisplayName: document.getElementById('webedit-profile-display-name'),
  profileEmailEl:  document.getElementById('webedit-profile-email'),
  profileUpgrade:  document.getElementById('webedit-profile-upgrade'),
  profilePricingLink: document.getElementById('webedit-profile-pricing-link'),
  profilePlanName: document.getElementById('webedit-profile-plan-name'),
  profilePlanBadge: document.getElementById('webedit-profile-plan-badge'),
  profilePlanDesc: document.getElementById('webedit-profile-plan-desc'),
  profilePaymentStatus: document.getElementById('webedit-profile-payment-status'),
  profilePrefAccount: document.getElementById('webedit-profile-pref-account'),
  profilePrefNotifications: document.getElementById('webedit-profile-pref-notifications'),
  profilePrefPrivacy: document.getElementById('webedit-profile-pref-privacy'),
  profileLogout:   document.getElementById('webedit-profile-logout'),
  profileVersion:  document.getElementById('webedit-profile-version'),
  presequencesView: document.getElementById('webedit-presequences-view'),
  sidebarNavPresequences: document.getElementById('webedit-sidebar-nav-presequences'),
};

// ── Keep-Alive Port: holds the service worker alive during long Add flows ────

var keepAlivePort = null;

function openKeepAlivePort() {
  if (keepAlivePort) return;
  keepAlivePort = chrome.runtime.connect({ name: 'keep-alive' });
  keepAlivePort.onDisconnect.addListener(function () {
    keepAlivePort = null;
  });
}

function closeKeepAlivePort() {
  if (!keepAlivePort) return;
  keepAlivePort.disconnect();
  keepAlivePort = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: The Chrome Post Office
// Every Event Listener uses these two helpers to talk to the Brain.
// ═══════════════════════════════════════════════════════════════════════════════

async function getCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

function normalizePageKey(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
  } catch (_) {
    return String(url).trim();
  }
}

async function sendToBrain(type, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    return response || { success: false, error: 'No response from Brain' };
  } catch (err) {
    console.error('[Panel] sendToBrain failed:', type, err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Error Prevention
// 3a. Client-side Schema Validation (mirrors Brain's MESSAGE_SCHEMAS)
// 3b. Debounce (prevents rapid-fire duplicate clicks)
// 3c. Dead Receiver Ping (ensures Brain is alive)
// ═══════════════════════════════════════════════════════════════════════════════

// 3a — Schema Validation
const PANEL_SCHEMAS = {
  SAVE_BLUEPRINT:        ['url', 'edit.action', 'edit.selector'],
  TOGGLE_STATUS:         ['url', 'editId'],
  GET_ACTIVE_BLUEPRINTS: ['url'],
  FETCH_FULL_HISTORY:    [],
  TOGGLE_HISTORY_EDIT:   ['editId'],
  START_PICK_MODE:       ['feature'],
  CANCEL_FLOW:           [],
  PREVIEW_CSS:           ['selector', 'cssText'],
  CUSTOMIZE_APPLY:       ['selector', 'url'],
  CUSTOMIZE_CANCEL:      [],
  ADD_APPLY:             [],
  ADD_CANCEL:            [],
  GENERATE_FEATURE:      ['prompt'],
  PING:                  [],
  WEBEDIT_GET_SESSION:   [],
  WEBEDIT_SIGN_OUT:      [],
  GET_CHAT_SESSIONS:     [],
  GET_CHAT_SESSION:      ['sessionId'],
  SAVE_CHAT_SESSION:     ['sessionId'],
  DELETE_CHAT_SESSION:    ['sessionId'],
  RENAME_CHAT_SESSION:   ['sessionId', 'title'],
  ARM_REVISE_ADD:        ['editId', 'url'],
  RESUME_CUSTOMIZE_EDIT: ['editId', 'url'],
  SYNC_LEDGER_PAGE:      ['url'],
};

function validateBeforeSend(type, payload) {
  const schema = PANEL_SCHEMAS[type];
  if (schema === undefined) {
    showNotification('Unknown message type: ' + type);
    return false;
  }
  for (const path of schema) {
    const parts = path.split('.');
    let value = payload;
    for (const part of parts) {
      value = value?.[part];
    }
    if (value === undefined || value === null || value === '') {
      showNotification('Missing required field: ' + path);
      return false;
    }
  }
  return true;
}

// 3b — Debounce
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 3c — Dead Receiver Ping
let brainAlive = true;

async function pingBrain() {
  try {
    const resp = await sendToBrain('PING');
    if (!resp?.success) throw new Error();
    if (!brainAlive) {
      brainAlive = true;
      showNotification('Connection restored.');
    }
  } catch {
    brainAlive = false;
    showNotification('Connection lost. Please reload the extension.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: UI State (In-Memory Only)
// All state lives in JS variables. Populated entirely from Brain responses.
// The Panel NEVER reads from chrome.storage — it always asks the Brain.
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_MESSAGES = 200;

let authState = 'unauthenticated';
let currentUser = null;
let chatMessages = [];
let currentSessionId = null;
let chatSessions = [];
let activeBlueprints = {};
let currentBlueprintPageKey = '';
let selectedFeature = 'remove';
let activeHistoryRenameForm = null;
let currentPanelMode = 'chat';
let historySites = [];
let historyLoading = false;
let historyError = '';
const ALL_SITES_KEY = '__all__';
const HISTORY_CAT_KEYS = ['remove', 'add', 'customize'];

let selectedHistoryPageKey = ALL_SITES_KEY;
let selectedHistoryCategory = 'all';
let panelRevisionEditId = null;
let panelRevisionKind = null;

/** Panel mode to restore when leaving Profile (back). */
let panelModeBeforeProfile = 'chat';

/** Cached from Brain (`WEBEDIT_GET_PLAN` / `WEBEDIT_PLAN_UPDATED`). */
let currentPaymentPlan = 'Free';

let profilePlanRefreshTimer = null;

/** True while Brain reports Add flow (pick / preview / generate). */
let addBrainFlowActive = false;

/** Free-tier Add usage (from WEBEDIT_GET_FREE_ADD_USAGE). */
let freeAddUsageCount = 0;
let freeAddMax = 1;

const WEBEDIT_PRICING_URL = 'https://www.webeditai.com/#/pricing';
const WEBEDIT_SITE_URL = 'https://www.webeditai.com/';

function isAuthenticated() {
  return authState === 'authenticated';
}

function isLifetimePlan() {
  return String(currentPaymentPlan || '').trim() === 'LifeTime';
}

async function refreshFreeAddUsage() {
  if (!isAuthenticated() || isLifetimePlan()) {
    freeAddUsageCount = 0;
    freeAddMax = 1;
    return;
  }
  const r = await sendToBrain('WEBEDIT_GET_FREE_ADD_USAGE');
  if (r && r.success && r.maxCount != null) {
    freeAddUsageCount = Math.max(0, Number(r.count) || 0);
    freeAddMax = Math.max(1, Number(r.maxCount) || 1);
  }
}

function updateHeaderUpgradeVisibility() {
  if (!els.headerUpgrade) return;
  els.headerUpgrade.hidden = !isAuthenticated() || isLifetimePlan();
}

async function syncPlanFromBrain() {
  if (!isAuthenticated()) {
    currentPaymentPlan = 'Free';
    freeAddUsageCount = 0;
    freeAddMax = 1;
    addBrainFlowActive = false;
    updateChatPlanControls();
    return;
  }
  const r = await sendToBrain('WEBEDIT_GET_PLAN');
  if (r.success && r.plan) {
    currentPaymentPlan = r.plan;
  }
  await refreshFreeAddUsage();
  updateChatPlanControls();
}

function debouncedRefreshPlanFromServer() {
  if (!isAuthenticated()) return;
  clearTimeout(profilePlanRefreshTimer);
  profilePlanRefreshTimer = setTimeout(function () {
    sendToBrain('WEBEDIT_REFRESH_PLAN').then(function (r) {
      if (r.success && r.plan) {
        currentPaymentPlan = r.plan;
      }
      return refreshFreeAddUsage();
    }).then(function () {
      updateChatPlanControls();
      if (currentPanelMode === 'profile') {
        renderProfileView();
      }
    });
  }, 400);
}

function updateChatPlanControls() {
  const auth = isAuthenticated();
  const lifetime = isLifetimePlan();
  const freeAddExhausted = auth && !lifetime && freeAddUsageCount >= freeAddMax;

  let inputDisabled;
  let placeholder;

  if (!auth) {
    inputDisabled = true;
    placeholder = 'Ask AI to edit this page…';
  } else if (lifetime) {
    inputDisabled = false;
    placeholder = 'Ask AI to edit this page…';
  } else if (addBrainFlowActive) {
    inputDisabled = false;
    placeholder = 'Describe the feature or how you want to refine it…';
  } else if (freeAddExhausted) {
    inputDisabled = true;
    placeholder = 'You’ve used your free Add. Upgrade for unlimited AI chat and edits…';
  } else {
    inputDisabled = true;
    placeholder = 'Use Add below, pick where to place it, then describe your feature here…';
  }

  if (els.chatInput) {
    els.chatInput.disabled = inputDisabled;
    els.chatInput.setAttribute('aria-disabled', inputDisabled ? 'true' : 'false');
    els.chatInput.placeholder = placeholder;
  }
  if (els.sendBtn) {
    els.sendBtn.disabled = inputDisabled;
    els.sendBtn.setAttribute('aria-disabled', inputDisabled ? 'true' : 'false');
  }
  updateHeaderUpgradeVisibility();
}

function updateSidebarNavActive() {
  if (els.sidebarNavRecentEdits) {
    els.sidebarNavRecentEdits.classList.toggle('is-active', currentPanelMode === 'history');
  }
  if (els.sidebarNavNewChat) {
    els.sidebarNavNewChat.classList.remove('is-active');
  }
  if (els.sidebarNavSettings) {
    els.sidebarNavSettings.classList.toggle('is-active', currentPanelMode === 'profile');
  }
  if (els.sidebarNavPresequences) {
    els.sidebarNavPresequences.classList.toggle('is-active', currentPanelMode === 'presequences');
  }
}

function updateBottomNavActive() {
  const onProfile = currentPanelMode === 'profile';
  if (els.navChat) {
    const on = currentPanelMode === 'chat' && !onProfile;
    els.navChat.classList.toggle('active', on);
    els.navChat.classList.remove('active-history-tab');
    if (on) {
      els.navChat.setAttribute('aria-current', 'page');
    } else {
      els.navChat.removeAttribute('aria-current');
    }
  }
  if (els.navHistory) {
    const on = currentPanelMode === 'history' && !onProfile;
    els.navHistory.classList.toggle('active', on);
    els.navHistory.classList.toggle('active-history-tab', on);
    if (on) {
      els.navHistory.setAttribute('aria-current', 'page');
    } else {
      els.navHistory.removeAttribute('aria-current');
    }
  }
  if (els.navBrowse) {
    els.navBrowse.classList.remove('active');
    els.navBrowse.classList.remove('active-history-tab');
    els.navBrowse.removeAttribute('aria-current');
  }
  updateSidebarNavActive();
}

function getUserDisplayName(user) {
  if (!user) return '';
  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const full = String(meta.full_name || meta.name || '').trim();
  if (full) return full;
  const em = String(user.email || '').trim();
  if (!em) return 'User';
  const at = em.indexOf('@');
  return at > 0 ? em.slice(0, at) : em;
}

function getUserAvatarUrl(user) {
  if (!user) return '';
  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  return String(meta.avatar_url || meta.picture || '').trim();
}

function updateHistorySidebarProfile() {
  if (!els.historyProfileCard || !els.historyProfileName || !els.historyProfileAvatar) return;
  if (currentUser && (currentUser.email || currentUser.id)) {
    const name = getUserDisplayName(currentUser);
    els.historyProfileName.textContent = name || 'User';
    els.historyProfileAvatar.textContent = (currentUser.email || name || 'U')[0].toUpperCase();
    if (els.historyProfileSub) {
      els.historyProfileSub.textContent = currentUser.email || 'The Digital Editor';
    }
    els.historyProfileCard.classList.remove('hidden');
  } else {
    els.historyProfileName.textContent = '';
    els.historyProfileAvatar.textContent = 'U';
    els.historyProfileCard.classList.add('hidden');
  }
}

function openAccountMenu() {
  window.open('https://webeditai.com/#/signup?from=extension', '_blank');
}

function renderProfileView() {
  if (!els.profileView || !currentUser) return;
  const name = getUserDisplayName(currentUser);
  const email = String(currentUser.email || '').trim();
  if (els.profileDisplayName) els.profileDisplayName.textContent = name || 'User';
  if (els.profileEmailEl) els.profileEmailEl.textContent = email;
  const avatarUrl = getUserAvatarUrl(currentUser);
  if (els.profileAvatarImg && els.profileAvatarLetter) {
    if (avatarUrl) {
      els.profileAvatarImg.src = avatarUrl;
      els.profileAvatarImg.alt = name || 'Profile photo';
      els.profileAvatarImg.classList.remove('hidden');
      els.profileAvatarLetter.classList.add('hidden');
    } else {
      els.profileAvatarImg.removeAttribute('src');
      els.profileAvatarImg.classList.add('hidden');
      els.profileAvatarLetter.classList.remove('hidden');
      els.profileAvatarLetter.textContent = (email || name || 'U')[0].toUpperCase();
    }
  }
  if (els.profileVersion) {
    try {
      const v = chrome.runtime.getManifest().version || '';
      els.profileVersion.textContent = 'WebEdit AI Extension v' + v + ' · Built with Intelligence';
    } catch (_) {
      els.profileVersion.textContent = 'WebEdit AI Extension';
    }
  }

  const lifetime = isLifetimePlan();
  if (els.profilePaymentStatus) {
    els.profilePaymentStatus.textContent = lifetime ? 'LifeTime' : 'Free';
  }
  if (els.profilePlanName) {
    els.profilePlanName.textContent = lifetime ? 'WebEdit AI — Lifetime' : 'WebEdit AI — Free';
  }
  if (els.profilePlanBadge) {
    els.profilePlanBadge.textContent = lifetime ? 'LIFETIME' : 'FREE';
    els.profilePlanBadge.classList.toggle('webedit-profile-plan-badge-lifetime', lifetime);
  }
  if (els.profilePlanDesc) {
    els.profilePlanDesc.textContent = lifetime
      ? 'You have full access: unlimited edits and AI chat on every site.'
      : 'Limited free edits per feature. Upgrade for unlimited edits and AI chat.';
  }
  if (els.profileUpgrade) {
    els.profileUpgrade.hidden = lifetime;
  }
  if (els.profilePricingLink) {
    els.profilePricingLink.textContent = lifetime ? 'Open webeditai.com' : 'View pricing & plans';
  }
}

function openProfile() {
  if (!isAuthenticated()) {
    openAccountMenu();
    return;
  }
  if (currentPanelMode !== 'profile') {
    panelModeBeforeProfile = currentPanelMode === 'history' ? 'history' : 'chat';
  }
  if (window.WebEditPanel && typeof window.WebEditPanel.closeCustomizeDashboard === 'function') {
    const hadCustomize = document.querySelector('.webedit-ee-root');
    window.WebEditPanel.closeCustomizeDashboard();
    if (hadCustomize) {
      sendToBrain('CUSTOMIZE_CANCEL');
    }
  }
  toggleHistorySidebar(false);
  setPanelMode('profile');
  renderProfileView();
  debouncedRefreshPlanFromServer();
}

function closeProfile() {
  const back = panelModeBeforeProfile === 'history' ? 'history' : 'chat';
  setPanelMode(back);
}

function startNewChatSession() {
  if (!isAuthenticated()) {
    showNotification('Please log in to create a chat');
    return;
  }
  persistCurrentSession();
  currentSessionId = Date.now().toString();
  chatMessages = [];
  renderChatMessages();
  persistCurrentSession();
  loadChatSessions();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: UI Rendering
// Pure rendering functions. They read in-memory state and update the DOM.
// They NEVER call chrome.storage or Supabase.
// ═══════════════════════════════════════════════════════════════════════════════

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatHistoryDate(value) {
  const stamp = Date.parse(value || '');
  if (!stamp) return 'Unknown time';
  return new Date(stamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeTime(value) {
  const t = Date.parse(value || '') || 0;
  if (!t) return '';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  if (sec < 604800) return Math.floor(sec / 86400) + 'd ago';
  return formatHistoryDate(value);
}

// siteTabDisplayName, pageKeyToFriendlySiteName — elementLabels.js (loaded before this file)

function editsForSite(site) {
  const out = [];
  if (!site || !site.categories) return out;
  HISTORY_CAT_KEYS.forEach(function (cat) {
    const arr = site.categories[cat] || [];
    arr.forEach(function (edit) {
      out.push({ edit: edit, category: cat });
    });
  });
  return out;
}

function historyCountForCategory(cat) {
  if (!historySites.length) return 0;
  if (cat === 'all') {
    if (selectedHistoryPageKey === ALL_SITES_KEY) {
      return historySites.reduce(function (sum, site) {
        return sum + editsForSite(site).length;
      }, 0);
    }
    const one = historySites.find(function (s) { return s.pageKey === selectedHistoryPageKey; });
    return one ? editsForSite(one).length : 0;
  }
  if (selectedHistoryPageKey === ALL_SITES_KEY) {
    return historySites.reduce(function (sum, site) {
      return sum + (site.categories[cat] || []).length;
    }, 0);
  }
  const site = historySites.find(function (s) { return s.pageKey === selectedHistoryPageKey; });
  if (!site) return 0;
  return (site.categories[cat] || []).length;
}

function getFilteredSortedEdits() {
  const rows = [];
  const sites = selectedHistoryPageKey === ALL_SITES_KEY
    ? historySites
    : historySites.filter(function (s) { return s.pageKey === selectedHistoryPageKey; });
  sites.forEach(function (site) {
    editsForSite(site).forEach(function (row) {
      if (selectedHistoryCategory !== 'all' && row.category !== selectedHistoryCategory) return;
      rows.push(row);
    });
  });
  rows.sort(function (a, b) {
    return (Date.parse(b.edit.updatedAt || b.edit.createdAt || '') || 0) -
      (Date.parse(a.edit.updatedAt || a.edit.createdAt || '') || 0);
  });
  return rows;
}

function setHistorySites(nextSites) {
  historySites = Array.isArray(nextSites) ? nextSites : [];
  if (!historySites.length) {
    selectedHistoryPageKey = '';
    return;
  }

  if (selectedHistoryPageKey !== ALL_SITES_KEY) {
    const stillExists = historySites.some(function (site) { return site.pageKey === selectedHistoryPageKey; });
    if (!stillExists) {
      selectedHistoryPageKey = ALL_SITES_KEY;
    }
  }
}

function ensureSessionId() {
  if (!currentSessionId && isAuthenticated()) {
    currentSessionId = Date.now().toString();
  }
  }

  function addChatMessage(type, content, extra) {
  ensureSessionId();
  const msg = { type: type, content: content, timestamp: Date.now() };
  if (extra && typeof extra === 'object') {
    Object.assign(msg, extra);
  }
  chatMessages.push(msg);
    if (chatMessages.length > MAX_MESSAGES) {
      chatMessages = chatMessages.slice(-MAX_MESSAGES);
    }
    renderChatMessages();
  persistCurrentSession();
}

function filterOutStaleAddSpecPending(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(function (m) { return !m.addSpecPending; });
}

function stripAddSpecPendingFromChat() {
  const next = chatMessages.filter(function (m) { return !m.addSpecPending; });
  if (next.length === chatMessages.length) return;
  chatMessages = next;
  renderChatMessages();
  persistCurrentSession();
}

/** Removes all messages marked { isProcessingMsg: true } — call before adding spec-ready or error. */
function stripProcessingMessages() {
  const next = chatMessages.filter(function (m) { return !m.isProcessingMsg; });
  if (next.length === chatMessages.length) return;
  chatMessages = next;
  renderChatMessages();
  persistCurrentSession();
}

/** Removes all messages marked { isApplyingMsg: true } — call after ADD_APPLY resolves. */
function stripApplyingMessages() {
  const next = chatMessages.filter(function (m) { return !m.isApplyingMsg; });
  if (next.length === chatMessages.length) return;
  chatMessages = next;
}

async function executeAddSpecAction(idx, action) {
  // Re-find the pending message by flag rather than relying on a stale index.
  // This prevents silent failures when the messages array was modified between
  // the last render and the button click.
  let resolvedIdx = idx;
  const msgAtIdx = chatMessages[idx];
  if (!msgAtIdx || !msgAtIdx.addSpecPending) {
    // Stale index — scan for the actual pending message.
    resolvedIdx = chatMessages.findIndex(function (m) { return m.addSpecPending; });
    if (resolvedIdx < 0) return; // No pending spec — nothing to do.
  }

  const msg = chatMessages[resolvedIdx];
  if (!msg || !msg.addSpecPending) return;

  chatMessages.splice(resolvedIdx, 1);

  if (action === 'apply') {
    // Show loading state.
    chatMessages.push({ type: 'system', content: 'Applying feature…', isApplyingMsg: true, timestamp: Date.now() });
    if (chatMessages.length > MAX_MESSAGES) chatMessages = chatMessages.slice(-MAX_MESSAGES);
    renderChatMessages();
    persistCurrentSession();

    const resp = await sendToBrain('ADD_APPLY');

    // Remove the "Applying…" placeholder.
    stripApplyingMessages();

    if (!resp.success) {
      // Sync principle: only show error if something actually went wrong.
      addChatMessage('assistant', 'Could not apply the feature: ' + (resp.error || 'unknown error') + '. Try again or use Refine to adjust it first.');
    }
    // On success: ADD_COMPLETED broadcast already fires "Feature applied successfully"
    // via add-panel.js → notify() path, so we don't double-announce here.
    renderChatMessages();
    persistCurrentSession();
    return;
  }

  if (action === 'refine') {
    chatMessages.push({
      type: 'assistant',
      content: 'What would you like to improve? Describe the change clearly — the AI will regenerate the feature with your feedback applied.',
      timestamp: Date.now()
    });
    if (chatMessages.length > MAX_MESSAGES) chatMessages = chatMessages.slice(-MAX_MESSAGES);
    renderChatMessages();
    persistCurrentSession();
    if (els.chatInput) {
      els.chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      els.chatInput.focus();
      els.chatInput.placeholder = 'Describe what to improve…';
    }
    return;
  }

  if (action === 'cancel') {
    const cancelResp = await sendToBrain('ADD_CANCEL');
    // Sync principle: show cancellation message only if Brain confirmed.
    if (cancelResp.success !== false) {
      chatMessages.push({ type: 'system', content: 'Feature cancelled. The preview has been removed.', timestamp: Date.now() });
    } else {
      chatMessages.push({ type: 'system', content: 'Cancelled.', timestamp: Date.now() });
    }
    if (chatMessages.length > MAX_MESSAGES) chatMessages = chatMessages.slice(-MAX_MESSAGES);
    renderChatMessages();
    persistCurrentSession();
  }
}

function showNotification(text) {
  ensureSessionId();
  chatMessages.push({ type: 'system', content: text, timestamp: Date.now() });
    if (chatMessages.length > MAX_MESSAGES) {
      chatMessages = chatMessages.slice(-MAX_MESSAGES);
    }
    renderChatMessages();
  persistCurrentSession();
  }

function updateChatHomeVisibility() {
  if (!els.chatHome) return;
  const showHero = currentPanelMode === 'chat' && chatMessages.length === 0 && isAuthenticated();
  els.chatHome.hidden = !showHero;
}

  function renderChatMessages() {
  if (!els.chatMessages || !els.chatThread) return;
  updateChatHomeVisibility();
  els.chatThread.innerHTML = '';

    if (chatMessages.length === 0) {
    if (!isAuthenticated()) {
      const placeholder = document.createElement('div');
      placeholder.className = 'webedit-chat-placeholder';
      placeholder.innerHTML = '<p>Log in to describe what you want to change.</p>';
      els.chatThread.appendChild(placeholder);
    }
    els.chatMessages.scrollTop = 0;
      return;
    }

  chatMessages.forEach(function (msg, idx) {
    const msgEl = document.createElement('div');
    msgEl.className = 'webedit-chat-message webedit-chat-message-' + msg.type;
    const contentEl = document.createElement('div');
    contentEl.className = 'webedit-chat-message-content';
    contentEl.textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        msgEl.appendChild(contentEl);

    if (msg.addSpecPending) {
      const specRow = document.createElement('div');
      specRow.className = 'webedit-chat-action-buttons webedit-chat-spec-actions';
      const specIdx = idx;

      const applySpecBtn = document.createElement('button');
      applySpecBtn.type = 'button';
      applySpecBtn.className = 'webedit-chat-action-btn webedit-chat-spec-apply-btn';
      applySpecBtn.textContent = 'Apply';
      applySpecBtn.addEventListener('click', debounce(async function () {
        await executeAddSpecAction(specIdx, 'apply');
      }));
      specRow.appendChild(applySpecBtn);

      const refineSpecBtn = document.createElement('button');
      refineSpecBtn.type = 'button';
      refineSpecBtn.className = 'webedit-chat-action-btn webedit-chat-spec-refine-btn';
      refineSpecBtn.textContent = 'Refine';
      refineSpecBtn.addEventListener('click', debounce(async function () {
        await executeAddSpecAction(specIdx, 'refine');
      }));
      specRow.appendChild(refineSpecBtn);

      const cancelSpecBtn = document.createElement('button');
      cancelSpecBtn.type = 'button';
      cancelSpecBtn.className = 'webedit-chat-action-btn webedit-chat-spec-cancel-btn';
      cancelSpecBtn.textContent = 'Cancel';
      cancelSpecBtn.addEventListener('click', debounce(async function () {
        await executeAddSpecAction(specIdx, 'cancel');
      }));
      specRow.appendChild(cancelSpecBtn);

      msgEl.appendChild(specRow);
    } else if (msg.editId) {
      const btnRow = document.createElement('div');
      btnRow.className = 'webedit-chat-action-buttons';

      const undoBtn = document.createElement('button');
      undoBtn.className = 'webedit-chat-action-btn webedit-chat-undo-btn';
      undoBtn.textContent = 'Undo';
      undoBtn.disabled = msg.editStatus !== 'active';
      undoBtn.addEventListener('click', debounce(async function () {
        if (!validateBeforeSend('TOGGLE_STATUS', { url: msg.url, editId: msg.editId })) return;
        await sendToBrain('TOGGLE_STATUS', { url: msg.url, editId: msg.editId });
        msg.editStatus = 'inactive';
        chatMessages[idx] = msg;
        renderChatMessages();
      }));
      btnRow.appendChild(undoBtn);

      const redoBtn = document.createElement('button');
      redoBtn.className = 'webedit-chat-action-btn webedit-chat-redo-btn';
      redoBtn.textContent = 'Redo';
      redoBtn.disabled = msg.editStatus !== 'inactive';
      redoBtn.addEventListener('click', debounce(async function () {
        if (!validateBeforeSend('TOGGLE_STATUS', { url: msg.url, editId: msg.editId })) return;
        await sendToBrain('TOGGLE_STATUS', { url: msg.url, editId: msg.editId });
        msg.editStatus = 'active';
        chatMessages[idx] = msg;
        renderChatMessages();
      }));
      btnRow.appendChild(redoBtn);

      msgEl.appendChild(btnRow);
    }

    els.chatThread.appendChild(msgEl);
    });

  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function renderHistoryPreview(token) {
  const preview = token || {};
  // Inline style= attributes violate the extension's own CSP (style-src 'self').
  // We store the color values in data-attributes instead, then apply them via
  // element.style.setProperty() after the HTML is written to the DOM.
  // See applyHistoryPreviewSwatchColors() which is called after innerHTML is set.
  return (
    '<div class="webedit-edit-history-preview-card">' +
      '<div class="webedit-edit-history-preview-swatch"' +
        ' data-preview-color="' + escapeHtml(preview.color || '#cbd5e1') + '"' +
        ' data-preview-accent="' + escapeHtml(preview.accent || '#f8fafc') + '"' +
      '></div>' +
      '<span>' + escapeHtml(preview.label || 'Preview') + '</span>' +
    '</div>'
  );
}

/**
 * After renderEditHistoryView() writes HTML containing preview swatches,
 * this function queries all swatch elements and sets their CSS custom
 * properties via element.style.setProperty() — which is CSP-safe because
 * it mutates an existing element's JS property rather than injecting markup.
 */
function applyHistoryPreviewSwatchColors() {
  if (!els.editHistoryView) return;
  const swatches = els.editHistoryView.querySelectorAll('.webedit-edit-history-preview-swatch[data-preview-color]');
  swatches.forEach(function (swatch) {
    const color = swatch.getAttribute('data-preview-color');
    const accent = swatch.getAttribute('data-preview-accent');
    if (color) swatch.style.setProperty('--preview-color', color);
    if (accent) swatch.style.setProperty('--preview-accent', accent);
    // Clean up the data-attributes — they are only needed as a transfer mechanism.
    swatch.removeAttribute('data-preview-color');
    swatch.removeAttribute('data-preview-accent');
  });
}

function renderCategoryIconMarkup(categoryKey) {
  if (categoryKey === 'remove') {
    return '<span class="webedit-edit-history-cat-icon webedit-edit-history-cat-remove" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10 10 0 1 1 19 12h-2M12 8v4l3 3"/></svg></span>';
  }
  if (categoryKey === 'add') {
    return '<span class="webedit-edit-history-cat-icon webedit-edit-history-cat-add" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></span>';
  }
  return '<span class="webedit-edit-history-cat-icon webedit-edit-history-cat-customize" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span>';
}

function renderSingleEditHistoryCard(edit, categoryKey) {
  const siteName = pageKeyToFriendlySiteName(edit.pageKey);
  const rel = formatRelativeTime(edit.updatedAt || edit.createdAt);
  const meta = rel ? siteName + ' • ' + rel : siteName;
  let html = '<article class="webedit-edit-history-card webedit-edit-history-card-v2">';
  html += '<div class="webedit-edit-history-card-topline">';
  html += renderCategoryIconMarkup(categoryKey);
  html += '<div class="webedit-edit-history-card-title-block">';
  html += '<div class="webedit-edit-history-card-title">' + escapeHtml(edit.summary || 'Untitled edit') + '</div>';
  html += '<div class="webedit-edit-history-card-meta">' + escapeHtml(meta) + '</div>';
  html += '</div>';
  if (categoryKey === 'add' || categoryKey === 'customize') {
    html += '<div class="webedit-edit-history-card-corner">';
    html += '<button type="button" class="webedit-edit-modify-btn" data-edit-id="' + escapeHtml(edit.id) + '" data-page-key="' + escapeHtml(edit.pageKey) + '" data-history-cat="' + escapeHtml(categoryKey) + '">Modify</button>';
    html += '</div>';
  }
  html += '</div>';
  html += '<p class="webedit-edit-history-card-description">' + escapeHtml(edit.description || '') + '</p>';
  if (categoryKey === 'customize') {
    html += '<div class="webedit-edit-history-previews">';
    html += renderHistoryPreview(edit.previews?.before);
    html += renderHistoryPreview(edit.previews?.after);
    html += '</div>';
  }
  html += '<div class="webedit-edit-history-card-actions">';
  html += '<button class="webedit-edit-action-btn webedit-edit-action-btn-block" type="button" data-edit-id="' + escapeHtml(edit.id) + '" data-page-key="' + escapeHtml(edit.pageKey) + '" data-action="' + (edit.isActive ? 'undo' : 'redo') + '">';
  html += edit.isActive ? 'Undo' : 'Redo';
  html += '</button>';
  html += '</div>';
  html += '</article>';
  return html;
}

function getFaviconUrl(origin) {
  if (!origin) return '';
  try {
    const url = new URL(origin);
    return 'https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(url.hostname);
  } catch (_) {
    return '';
  }
}

function renderEditHistoryView() {
  if (!els.editHistoryView) return;

  if (!isAuthenticated()) {
    els.editHistoryView.innerHTML =
      '<div class="webedit-edit-history-state">' +
        '<h3>Log in to view Edit History</h3>' +
        '<p>Your edit timeline appears here after authentication.</p>' +
      '</div>';
    return;
  }

  if (historyLoading) {
    els.editHistoryView.innerHTML =
      '<div class="webedit-edit-history-state">' +
        '<h3>Loading edit history</h3>' +
        '<p>Fetching your edits from the Brain.</p>' +
      '</div>';
    return;
  }

  if (historyError) {
    els.editHistoryView.innerHTML =
      '<div class="webedit-edit-history-state">' +
        '<h3>Could not load edit history</h3>' +
        '<p>' + escapeHtml(historyError) + '</p>' +
      '</div>';
    return;
  }

  if (!historySites.length) {
    els.editHistoryView.innerHTML =
      '<div class="webedit-edit-history-state">' +
        '<h3>No edits yet</h3>' +
        '<p>Make edits to view them here.</p>' +
      '</div>';
    return;
  }

  const catTabKeys = ['all', 'remove', 'add', 'customize'];
  if (catTabKeys.indexOf(selectedHistoryCategory) === -1) {
    selectedHistoryCategory = 'all';
  }

  if (selectedHistoryPageKey !== ALL_SITES_KEY) {
    const siteOk = historySites.some(function (s) { return s.pageKey === selectedHistoryPageKey; });
    if (!siteOk) selectedHistoryPageKey = ALL_SITES_KEY;
  }

  let html = '<div class="webedit-edit-history-shell">';

  html += '<div class="webedit-edit-history-activity-block">';
  html += '<div class="webedit-edit-history-activity-label">Activity log</div>';
  html += '<h2 class="webedit-edit-history-page-title">Recent Edits</h2>';
  html += '</div>';

  html += '<div class="webedit-edit-history-sites-section">';
  html += '<div class="webedit-edit-history-sites" role="tablist" aria-label="Sites">';
  const allSitesActive = selectedHistoryPageKey === ALL_SITES_KEY ? ' active' : '';
  html += '<button class="webedit-edit-history-site-tab webedit-edit-history-site-tab-all' + allSitesActive + '" type="button" data-page-key="' + escapeHtml(ALL_SITES_KEY) + '">All Sites</button>';
  historySites.forEach(function (site) {
    const activeClass = site.pageKey === selectedHistoryPageKey ? ' active' : '';
    const favicon = getFaviconUrl(site.siteOrigin || site.pageKey);
    const displayTitle = siteTabDisplayName(site);
    html += '<button class="webedit-edit-history-site-tab' + activeClass + '" type="button" data-page-key="' + escapeHtml(site.pageKey) + '">';
    if (favicon) {
      html += '<img class="webedit-edit-history-site-favicon" src="' + escapeHtml(favicon) + '" alt="" width="16" height="16">';
    }
    html += '<span class="webedit-edit-history-site-title">' + escapeHtml(displayTitle) + '</span>';
    html += '</button>';
  });
  html += '</div>';
  html += '</div>';

  html += '<div class="webedit-edit-history-site-panel">';
  html += '<div class="webedit-edit-history-cat-tabs" role="tablist" aria-label="Edit categories">';
  catTabKeys.forEach(function (cat) {
    const count = historyCountForCategory(cat);
    const label = cat === 'all' ? 'All Edits' : (cat.charAt(0).toUpperCase() + cat.slice(1));
    const activeClass = cat === selectedHistoryCategory ? ' active' : '';
    html += '<button class="webedit-edit-history-cat-tab' + activeClass + '" type="button" data-cat="' + cat + '">';
    html += escapeHtml(label);
    html += '<span class="webedit-edit-history-cat-count">' + count + '</span>';
    html += '</button>';
  });
  html += '</div>';

  html += '<div class="webedit-edit-history-cat-panel">';
  const rows = getFilteredSortedEdits();
  if (!rows.length) {
    html += '<div class="webedit-edit-history-empty-card">No edits in this view yet.</div>';
  } else {
    rows.forEach(function (row) {
      html += renderSingleEditHistoryCard(row.edit, row.category);
    });
  }
  html += '</div>';

  html += '</div>';
  html += '</div>';

  els.editHistoryView.innerHTML = html;
  // Apply swatch CSS custom properties via setProperty (CSP-safe).
  applyHistoryPreviewSwatchColors();
}

function isRevisionPickableAction(action) {
  const a = String(action || '').toLowerCase();
  return a === 'add' || a === 'customize' || a === 'text';
}

function formatPageEditLabel(edit, editId) {
  const payload = edit && typeof edit.payload === 'object' ? edit.payload : {};
  const sum = String(payload.summary || '').trim();
  const action = String(edit.action || '').toLowerCase();
  const tag = action === 'customize' ? 'Customize' : 'Add';
  if (sum) return tag + ': ' + sum;
  const shortId = String(editId || '').slice(0, 8);
  return tag + ' · ' + (shortId || 'edit');
}

function historyEditLabelForReference(edit, categoryKey) {
  const cat = String(categoryKey || '').toLowerCase();
  const action = cat === 'customize' ? 'customize' : 'add';
  return formatPageEditLabel(
    { action: action, payload: { summary: (edit && edit.summary) || '' } },
    edit && edit.id
  );
}

function findHistoryEntryById(editId) {
  const want = String(editId || '').trim();
  if (!want) return null;
  let found = null;
  let category = '';
  historySites.some(function (site) {
    return HISTORY_CAT_KEYS.some(function (cat) {
      const arr = site.categories[cat] || [];
      const hit = arr.find(function (e) { return e.id === want; });
      if (hit) {
        found = hit;
        category = cat;
        return true;
      }
      return false;
    });
  });
  return found ? { edit: found, category: category } : null;
}

function clearPanelRevisionSelection() {
  panelRevisionEditId = null;
  panelRevisionKind = null;
}

function renderPageEditsPicker() {
  if (!els.pageEditsRow) return;

  const entries = Object.entries(activeBlueprints).filter(function (ent) {
    return isRevisionPickableAction(ent[1] && ent[1].action);
  });

  if (!entries.length) {
    els.pageEditsRow.classList.add('hidden');
    els.pageEditsRow.innerHTML = '';
    return;
  }

  els.pageEditsRow.classList.remove('hidden');
  els.pageEditsRow.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'webedit-page-edits-label';
  label.textContent = 'Improve an edit on this page';
  els.pageEditsRow.appendChild(label);

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'webedit-page-edits-chips';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'webedit-page-edit-chip webedit-page-edit-chip-clear';
  clearBtn.textContent = 'None';
  clearBtn.addEventListener('click', debounce(async function () {
    clearPanelRevisionSelection();
    await sendToBrain('CANCEL_FLOW');
    renderPageEditsPicker();
  }));
  chipsWrap.appendChild(clearBtn);

  entries.forEach(function (ent) {
    const editId = ent[0];
    const edit = ent[1];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'webedit-page-edit-chip';
    if (panelRevisionEditId === editId) chip.classList.add('active');
    chip.textContent = formatPageEditLabel(edit, editId);
    chip.title = editId;
    chip.addEventListener('click', debounce(async function () {
      if (!isAuthenticated()) {
        showNotification('Please log in to improve an edit');
        return;
      }
      const rawUrl = await getCurrentTabUrl();
      const nk = normalizePageKey(rawUrl);
      if (!nk || !rawUrl.startsWith('http')) {
        showNotification('Open a website tab first');
        return;
      }
      const action = String(edit.action || '').toLowerCase();
      if (action === 'customize') {
        if (!validateBeforeSend('RESUME_CUSTOMIZE_EDIT', { editId: editId, url: nk })) return;
        const resp = await sendToBrain('RESUME_CUSTOMIZE_EDIT', { editId: editId, url: nk });
        if (!resp.success) {
          showNotification(resp.error || 'Could not open customization');
          return;
        }
        panelRevisionEditId = editId;
        panelRevisionKind = 'customize';
        addChatMessage('system', 'Reference: customization — ' + formatPageEditLabel(edit, editId) + '. Adjust styles in the dashboard, then Apply.');
        renderPageEditsPicker();
        return;
      }
      if (action === 'add' || action === 'text') {
        if (!validateBeforeSend('ARM_REVISE_ADD', { editId: editId, url: nk })) return;
        const resp = await sendToBrain('ARM_REVISE_ADD', { editId: editId, url: nk });
        if (!resp.success) {
          showNotification(resp.error || 'Could not arm revise mode');
          return;
        }
        openKeepAlivePort();
        panelRevisionEditId = editId;
        panelRevisionKind = 'add';
        addChatMessage('system', 'Reference: Add feature — ' + formatPageEditLabel(edit, editId) + '. Describe changes below; when the preview looks right, use Apply.');
        renderPageEditsPicker();
      }
    }));
    chipsWrap.appendChild(chip);
  });

  els.pageEditsRow.appendChild(chipsWrap);
}

async function refreshBlueprintsAndPicker() {
  const url = await getCurrentTabUrl();
  const nk = normalizePageKey(url);
  if (nk !== currentBlueprintPageKey) {
    clearPanelRevisionSelection();
  }
  if (!url || !url.startsWith('http')) {
    activeBlueprints = {};
    currentBlueprintPageKey = '';
    renderPageEditsPicker();
    return;
  }
  const bpResp = await sendToBrain('GET_ACTIVE_BLUEPRINTS', { url: url });
  if (bpResp.success) {
    activeBlueprints = bpResp.blueprints || {};
    currentBlueprintPageKey = normalizePageKey(bpResp.pageKey || url);
  }
  renderPageEditsPicker();
}

function renderBlueprintList() {
  if (els.blueprintList) els.blueprintList.innerHTML = '';
  renderPageEditsPicker();
}

async function loadEditHistory(forceRefresh) {
  if (!isAuthenticated()) {
    historyLoading = false;
    historyError = '';
    setHistorySites([]);
    renderEditHistoryView();
    return;
  }

  if (historyLoading) return;
  if (!forceRefresh && historySites.length > 0) {
    renderEditHistoryView();
    return;
  }

  historyLoading = true;
  historyError = '';
  renderEditHistoryView();

  const resp = await sendToBrain('FETCH_FULL_HISTORY');
  historyLoading = false;
  if (resp.success) {
    historyError = '';
    setHistorySites(resp.sites);
  } else {
    historyError = resp.error || 'Unknown error';
    setHistorySites([]);
  }
  renderEditHistoryView();
  }

  function getSessionDisplayName(session) {
  if (session?.title && String(session.title).trim()) return String(session.title).trim();
  if (session?.preview && String(session.preview).trim()) {
    const p = String(session.preview).trim();
    return p.length > 60 ? p.substring(0, 57) + '...' : p;
  }
  return 'Untitled chat';
  }

  function closeActiveHistoryRenameForm() {
    if (activeHistoryRenameForm && activeHistoryRenameForm.parentNode) {
    try { activeHistoryRenameForm.parentNode.removeChild(activeHistoryRenameForm); } catch (_) {}
    }
    activeHistoryRenameForm = null;
  }

  function openHistoryRenameInput(session, hostEl) {
    closeActiveHistoryRenameForm();
    if (!hostEl) return;

  const form = document.createElement('form');
  form.className = 'webedit-history-rename-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'webedit-history-rename-input';
    input.maxLength = 80;
    input.value = getSessionDisplayName(session);
    form.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'webedit-history-rename-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'webedit-history-rename-save';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'webedit-history-rename-cancel';
  cancelBtn.textContent = 'Cancel';

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

  const commit = function (shouldSave) {
      if (shouldSave) {
      sendToBrain('RENAME_CHAT_SESSION', { sessionId: session.id, title: input.value.trim() });
      }
      closeActiveHistoryRenameForm();
    loadChatSessions();
  };

  form.addEventListener('click', function (e) { e.stopPropagation(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); commit(true); });
  cancelBtn.addEventListener('click', function (e) { e.preventDefault(); commit(false); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); commit(false); } });
  input.addEventListener('blur', function (e) {
      if (e.relatedTarget === saveBtn || e.relatedTarget === cancelBtn) return;
      commit(true);
    });

    hostEl.appendChild(form);
    activeHistoryRenameForm = form;
    input.focus();
    input.select();
  }

function renderHistoryList() {
    if (!els.historyList) return;

  if (!isAuthenticated()) {
    els.historyList.innerHTML = '<div class="webedit-history-list-empty">Log in to view history</div>';
      return;
    }

  if (!Array.isArray(chatSessions) || chatSessions.length === 0) {
      closeActiveHistoryRenameForm();
      els.historyList.innerHTML = '<div class="webedit-history-list-empty">No history yet</div>';
      return;
    }

    closeActiveHistoryRenameForm();
  els.historyList.innerHTML = '';

  chatSessions
      .slice()
    .sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); })
    .forEach(function (session) {
      const item = document.createElement('div');
      item.className = 'webedit-history-item' + (session.id === currentSessionId ? ' active' : '');

      const main = document.createElement('div');
      main.className = 'webedit-history-item-main';

      const titleEl = document.createElement('div');
      titleEl.className = 'webedit-history-title';
        titleEl.textContent = getSessionDisplayName(session);
        main.appendChild(titleEl);

      const renameBtn = document.createElement('button');
      renameBtn.className = 'webedit-history-rename-btn';
      renameBtn.type = 'button';
      renameBtn.setAttribute('aria-label', 'Rename chat');
      renameBtn.innerHTML = '&#9998;';
      renameBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openHistoryRenameInput(session, item);
        });
        main.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'webedit-history-delete-btn';
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', 'Delete chat');
      deleteBtn.innerHTML = '&#128465;';
      deleteBtn.addEventListener('click', debounce(async function (e) {
          e.stopPropagation();
        await sendToBrain('DELETE_CHAT_SESSION', { sessionId: session.id });
        if (currentSessionId === session.id) {
          currentSessionId = null;
          chatMessages = [];
          renderChatMessages();
        }
        loadChatSessions();
      }));
        main.appendChild(deleteBtn);

      const dateEl = document.createElement('div');
      dateEl.className = 'webedit-history-date';
      dateEl.textContent = new Date(session.timestamp || Date.now()).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const previewEl = document.createElement('div');
      previewEl.className = 'webedit-history-preview';
      previewEl.textContent = session.preview || 'New chat';

        item.appendChild(main);
        item.appendChild(dateEl);
        item.appendChild(previewEl);
      item.addEventListener('click', debounce(async function () {
        const resp = await sendToBrain('GET_CHAT_SESSION', { sessionId: session.id });
        if (resp.success && resp.session) {
          currentSessionId = resp.session.id;
          chatMessages = filterOutStaleAddSpecPending(
            Array.isArray(resp.session.messages) ? resp.session.messages : []
          );
          renderChatMessages();
          renderHistoryList();
        }
      }));
        els.historyList.appendChild(item);
      });
  }

function updateAuthUI() {
  if (els.authGuard) {
    els.authGuard.classList.toggle('hidden', isAuthenticated());
  }
  if (!isAuthenticated()) {
    if (els.authGuardTitle) els.authGuardTitle.textContent = 'Log in to use WebEdit AI';
    if (els.authGuardMessage) els.authGuardMessage.textContent = 'Sign in or create an account to continue.';
    if (els.authGuardSignin) { els.authGuardSignin.textContent = 'Log in'; els.authGuardSignin.hidden = false; }
  }

  if (els.newChatBtn) {
    if ('disabled' in els.newChatBtn) els.newChatBtn.disabled = !isAuthenticated();
    els.newChatBtn.setAttribute('aria-disabled', isAuthenticated() ? 'false' : 'true');
  }
  if (!isAuthenticated()) {
    currentPaymentPlan = 'Free';
  }
  updateChatPlanControls();

  if (currentUser) {
    renderSignedInButton(currentUser);
  } else {
    renderSignInButton();
  }

  updateHistorySidebarProfile();
  renderHistoryList();
  if (!isAuthenticated()) {
    chatMessages = [];
    historyError = '';
    historyLoading = false;
    setHistorySites([]);
    renderChatMessages();
    if (currentPanelMode === 'profile') {
      setPanelMode('chat');
    }
  } else if (currentPanelMode === 'history' && historySites.length === 0 && !historyLoading) {
    loadEditHistory(false);
  }
  renderEditHistoryView();
  if (isAuthenticated() && currentPanelMode === 'profile') {
    renderProfileView();
  }
}

function renderSignInButton() {
  if (!els.signinBtn) return;
  els.signinBtn.className = 'webedit-nav-btn signin-btn';
  els.signinBtn.textContent = 'Log in';
  els.signinBtn.onclick = function () {
    window.open('https://webeditai.com/#/signup?from=extension', '_blank');
  };
}

function renderSignedInButton(user) {
  if (!els.signinBtn) return;
  els.signinBtn.className = 'webedit-nav-btn signin-btn webedit-avatar-container';
  els.signinBtn.title = user?.email || 'Account';
  els.signinBtn.innerHTML = '';

  const avatarUrl = getUserAvatarUrl(user);
  if (avatarUrl) {
    const img = document.createElement('img');
    img.className = 'webedit-avatar webedit-avatar-img';
    img.src = avatarUrl;
    img.alt = '';
    img.width = 32;
    img.height = 32;
    els.signinBtn.appendChild(img);
  } else {
    const avatar = document.createElement('div');
    avatar.className = 'webedit-avatar';
    avatar.textContent = (user?.email || 'U')[0].toUpperCase();
    els.signinBtn.appendChild(avatar);
  }

  els.signinBtn.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    openProfile();
  };
}

function setSelectedFeature(tool) {
  selectedFeature = tool;
  els.featureButtons.forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
}

function setPanelMode(mode) {
  if (mode === 'history') {
    currentPanelMode = 'history';
  } else if (mode === 'profile') {
    currentPanelMode = 'profile';
  } else if (mode === 'presequences') {
    currentPanelMode = 'presequences';
  } else {
    currentPanelMode = 'chat';
  }

  const showHistory      = currentPanelMode === 'history';
  const showProfile      = currentPanelMode === 'profile';
  const showPresequences = currentPanelMode === 'presequences';
  const showNonChat      = showHistory || showProfile || showPresequences;

  if (els.chatPanel) {
    els.chatPanel.classList.toggle('webedit-panel-mode-history',      showHistory);
    els.chatPanel.classList.toggle('webedit-panel-mode-profile',      showProfile);
    els.chatPanel.classList.toggle('webedit-panel-mode-presequences', showPresequences);
  }

  els.blueprintList?.classList.toggle('hidden', showNonChat);
  els.chatMessages?.classList.toggle('hidden', showNonChat);
  els.editHistoryView?.classList.toggle('hidden', !showHistory || showProfile);
  els.profileView?.classList.toggle('hidden', !showProfile);
  els.presequencesView?.classList.toggle('hidden', !showPresequences);
  els.bottomControls?.classList.toggle('hidden', showNonChat);
  els.inputContainer?.classList.toggle('hidden', showNonChat);
  els.mainContent?.classList.toggle('history-mode', showNonChat);

  if (showHistory) {
    loadEditHistory(false);
  } else if (showPresequences) {
    if (window.WebEditPresequences && typeof window.WebEditPresequences.render === 'function') {
      window.WebEditPresequences.render();
    }
  } else if (!showProfile) {
    renderChatMessages();
    renderBlueprintList();
    renderPageEditsPicker();
  }
  updateBottomNavActive();
  updateChatHomeVisibility();
}

function toggleHistorySidebar(forceState) {
  if (!els.historySidebar) return;
  const willShow = forceState === undefined
    ? !els.historySidebar.classList.contains('visible')
    : !!forceState;
  els.historySidebar.classList.toggle('visible', willShow);
}

// Helper: persist current chat session to Brain (fire-and-forget)
function persistCurrentSession() {
  if (!isAuthenticated() || !currentSessionId) return;
  const firstUserMsg = chatMessages.find(function (m) { return m.type === 'user' && m.content; });
  const preview = firstUserMsg ? String(firstUserMsg.content).trim() : 'New chat';
  const title = preview.length > 40 ? preview.substring(0, 37) + '...' : preview;
  sendToBrain('SAVE_CHAT_SESSION', {
    sessionId: currentSessionId,
    messages: chatMessages,
    title: title,
    preview: preview,
  });
}

// Helper: load chat sessions from Brain and re-render sidebar
async function loadChatSessions() {
  const resp = await sendToBrain('GET_CHAT_SESSIONS');
  if (resp.success && Array.isArray(resp.sessions)) {
    chatSessions = resp.sessions;
  }
  renderHistoryList();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: The Brain Inbox
// Listens for ALL broadcasts pushed by the Brain.
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener(function (message) {
  if (!message?.type) return;

  switch (message.type) {
    case 'WEBEDIT_SESSION_UPDATED': {
      const session = message.session || null;
      const user = session?.user || null;
      currentUser = user;
      authState = user ? 'authenticated' : 'unauthenticated';
      updateAuthUI();
      if (isAuthenticated()) {
        loadChatSessions();
        syncPlanFromBrain();
      }
      break;
    }

    case 'WEBEDIT_PLAN_UPDATED': {
      if (message.plan) {
        currentPaymentPlan = message.plan;
      }
      void refreshFreeAddUsage().then(function () {
        updateChatPlanControls();
        if (currentPanelMode === 'profile') {
          renderProfileView();
        }
      });
      break;
    }

    case 'WEBEDIT_GATE_BLOCKED':
      if (message.message) {
        showNotification(message.message);
      }
      break;

    case 'BLUEPRINTS_UPDATED':
      if (!message.pageKey || normalizePageKey(message.pageKey) === currentBlueprintPageKey) {
        activeBlueprints = message.blueprints || {};
        if (message.pageKey) {
          currentBlueprintPageKey = normalizePageKey(message.pageKey);
        }
        renderBlueprintList();
      }
      break;

    case 'EDIT_HISTORY_UPDATED':
      historyLoading = false;
      historyError = message.error || '';
      setHistorySites(message.sites);
      renderEditHistoryView();
      break;

    case 'FLOW_STATE_CHANGED': {
      const st = message.state;
      const feat = message.feature;
      if (feat === 'add' && (st === 'PICKING' || st === 'PREVIEWING' || st === 'PROCESSING')) {
        addBrainFlowActive = true;
      } else if (st === 'IDLE' || feat !== 'add') {
        addBrainFlowActive = false;
      }

      if (st === 'PICKING' && message.feature) {
        clearPanelRevisionSelection();
        showNotification('Pick an element on the page for: ' + message.feature);
        renderPageEditsPicker();
      }
      if (st === 'IDLE') {
        stripAddSpecPendingFromChat();
        closeKeepAlivePort();
        clearPanelRevisionSelection();
        renderPageEditsPicker();
        void refreshFreeAddUsage().then(function () {
          updateChatPlanControls();
        });
      } else {
        updateChatPlanControls();
      }
      break;
    }

    case 'WEBEDIT_FLOW_CANCELLED':
      if (message.text) {
        showNotification(message.text);
      }
      break;

    case 'PICK_COMPLETED': {
      const label = message.summary || 'an element';
      chatMessages.push({
        type: 'system',
        content: 'Element selected: ' + label,
        editId: message.editId || null,
        url: message.url || '',
        editStatus: 'active',
        timestamp: Date.now()
      });
      if (chatMessages.length > MAX_MESSAGES) {
        chatMessages = chatMessages.slice(-MAX_MESSAGES);
      }
      renderChatMessages();
      persistCurrentSession();
      break;
    }

    case 'CUSTOMIZE_DASHBOARD_OPEN':
      if (window.WebEditPanel && typeof window.WebEditPanel.openCustomizeDashboard === 'function') {
        window.WebEditPanel.openCustomizeDashboard(message.selector, message.summary, message.url, {
          initialStyles: message.initialStyles || {},
          initialTextContent: message.initialTextContent != null ? String(message.initialTextContent) : '',
          resumeEditId: message.resumeEditId || null
        });
      }
      break;

    case 'CUSTOMIZE_COMPLETED': {
      const custLabel = message.summary || 'an element';
      chatMessages.push({
        type: 'system',
        content: 'Customized: ' + custLabel,
        editId: message.editId || null,
        url: message.url || '',
        editStatus: 'active',
        timestamp: Date.now()
      });
      if (chatMessages.length > MAX_MESSAGES) {
        chatMessages = chatMessages.slice(-MAX_MESSAGES);
      }
      renderChatMessages();
      persistCurrentSession();
      break;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Event Listener Registration
// One listener per button. Pattern: debounce -> validate -> sendToBrain.
// ═══════════════════════════════════════════════════════════════════════════════

let panelInteractionListenersBound = false;

async function runHistoryModifyFromHistory(modifyBtn) {
  if (!isAuthenticated()) {
    showNotification('Please log in to modify an edit');
    return;
  }
  const editId = modifyBtn.dataset.editId || '';
  const pageKeyAttr = modifyBtn.dataset.pageKey || '';
  const historyCat = String(modifyBtn.dataset.historyCat || '').toLowerCase();
  if (!editId) {
    showNotification('Could not read this edit. Try refreshing Edit History.');
    return;
  }
  const resolved = findHistoryEntryById(editId);
  const edit = resolved && resolved.edit;
  if (!edit) {
    showNotification('Could not find this edit');
    return;
  }
  const rawUrl = await getCurrentTabUrl();
  if (!rawUrl || !rawUrl.startsWith('http')) {
    showNotification('Open a website tab first');
    return;
  }
  const nk = normalizePageKey(rawUrl);
  if (normalizePageKey(pageKeyAttr) !== nk) {
    showNotification('Open the tab where this edit was made, then try again.');
    return;
  }
  if (!validateBeforeSend('SYNC_LEDGER_PAGE', { url: nk })) return;
  const syncResp = await sendToBrain('SYNC_LEDGER_PAGE', { url: nk });
  if (!syncResp.success) {
    showNotification(syncResp.error || 'Could not sync edits for this page');
    return;
  }
  const cat = historyCat || resolved.category;
  const label = historyEditLabelForReference(edit, cat);
  if (cat === 'customize') {
    if (!validateBeforeSend('RESUME_CUSTOMIZE_EDIT', { editId: editId, url: nk })) return;
    const resp = await sendToBrain('RESUME_CUSTOMIZE_EDIT', { editId: editId, url: nk });
    if (!resp.success) {
      showNotification(resp.error || 'Could not open customization');
      return;
    }
    panelRevisionEditId = editId;
    panelRevisionKind = 'customize';
    addChatMessage('system', 'Reference: customization — ' + label + '. Adjust styles in the dashboard, then Apply.');
  } else {
    if (!validateBeforeSend('ARM_REVISE_ADD', { editId: editId, url: nk })) return;
    const resp = await sendToBrain('ARM_REVISE_ADD', { editId: editId, url: nk });
    if (!resp.success) {
      showNotification(resp.error || 'Could not arm revise mode');
      return;
    }
    openKeepAlivePort();
    panelRevisionEditId = editId;
    panelRevisionKind = 'add';
    addChatMessage('system', 'Reference: Add feature — ' + label + '. Describe changes below; when the preview looks right, use Apply.');
  }
  setPanelMode('chat');
  toggleHistorySidebar(false);
  await refreshBlueprintsAndPicker();
}

function registerEventListeners() {
  if (panelInteractionListenersBound) return;
  panelInteractionListenersBound = true;

  // Header
  if (els.headerHamburger && els.historySidebar) {
    els.headerHamburger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleHistorySidebar();
    });
    document.addEventListener('click', function (e) {
      if (!els.historySidebar.classList.contains('visible')) return;
      if (els.historySidebar.contains(e.target)) return;
      if (els.headerHamburger.contains(e.target)) return;
      if (els.bottomNav && els.bottomNav.contains(e.target)) return;
      if (els.signinBtn && els.signinBtn.contains(e.target)) return;
      if (els.headerUpgrade && els.headerUpgrade.contains(e.target)) return;
      toggleHistorySidebar(false);
    });
  }

  if (els.homeBtn) {
    els.homeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      setPanelMode('chat');
      toggleHistorySidebar(false);
    });
  }

  els.navChat?.addEventListener('click', function () {
    setPanelMode('chat');
    toggleHistorySidebar(false);
  });

  els.navHistory?.addEventListener('click', function () {
    setPanelMode('history');
    toggleHistorySidebar(false);
  });

  els.navBrowse?.addEventListener('click', function () {
    const url = 'https://webeditai.com/';
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url }).catch(function () {
        window.open(url, '_blank');
      });
    } else {
      window.open(url, '_blank');
    }
  });

  els.sidebarNavNewChat?.addEventListener('click', function () {
    startNewChatSession();
  });

  els.sidebarNavRecentEdits?.addEventListener('click', function () {
    setPanelMode('history');
    toggleHistorySidebar(false);
  });

  els.sidebarNavSettings?.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (isAuthenticated()) {
      openProfile();
    } else {
      openAccountMenu();
    }
    toggleHistorySidebar(false);
  });

  els.sidebarNavPresequences?.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    setPanelMode('presequences');
    toggleHistorySidebar(false);
  });

  els.profileBack?.addEventListener('click', function (e) {
    e.preventDefault();
    closeProfile();
  });

  els.profileOverflow?.addEventListener('click', function () {
    window.open(WEBEDIT_SITE_URL, '_blank');
  });

  function openPricingPage() {
    window.open(WEBEDIT_PRICING_URL, '_blank');
  }

  els.profileUpgrade?.addEventListener('click', openPricingPage);
  els.profilePricingLink?.addEventListener('click', function (e) {
    e.preventDefault();
    if (isLifetimePlan()) {
      window.open(WEBEDIT_SITE_URL, '_blank');
    } else {
      openPricingPage();
    }
  });

  els.headerUpgrade?.addEventListener('click', function (e) {
    e.preventDefault();
    openPricingPage();
  });

  els.profileAvatarEdit?.addEventListener('click', function () {
    window.open(WEBEDIT_SITE_URL, '_blank');
  });

  els.profilePrefAccount?.addEventListener('click', function () {
    window.open(WEBEDIT_SITE_URL, '_blank');
  });
  els.profilePrefNotifications?.addEventListener('click', function () {
    window.open(WEBEDIT_SITE_URL, '_blank');
  });
  els.profilePrefPrivacy?.addEventListener('click', function () {
    window.open(WEBEDIT_SITE_URL, '_blank');
  });

  els.profileLogout?.addEventListener('click', function () {
    sendToBrain('WEBEDIT_SIGN_OUT');
    setPanelMode('chat');
  });

  // Auth guard sign-in
  els.authGuardSignin?.addEventListener('click', function () {
    window.open('https://webeditai.com/#/signup?from=extension', '_blank');
  });

  // New Chat
  els.newChatBtn?.addEventListener('click', debounce(function () {
    startNewChatSession();
  }));

  // Feature buttons: Remove, Customize, Add
  els.featureButtons.forEach(function (btn) {
    btn.addEventListener('click', debounce(async function () {
      const tool = btn.dataset.tool || 'remove';
      setSelectedFeature(tool);
      if (!isAuthenticated()) { showNotification('Please log in to use ' + tool); return; }
      if (!validateBeforeSend('START_PICK_MODE', { feature: tool })) return;
      const resp = await sendToBrain('START_PICK_MODE', { feature: tool });
      if (!resp.success) {
        showNotification(resp.error === 'FLOW_CONFLICT'
          ? 'Another feature flow is already active. Cancel it first.'
          : 'Could not start ' + tool + ': ' + (resp.error || 'unknown'));
      } else if (tool === 'add') {
        openKeepAlivePort();
      }
    }));
  });

  // Chat Send
  const handleSend = debounce(async function () {
    const text = (els.chatInput?.value || '').trim();
    if (!text) return;
    if (!isAuthenticated()) { showNotification('Please log in to use WebEdit'); return; }

    if (!isLifetimePlan() && !addBrainFlowActive) {
      els.chatInput.value = '';
      addChatMessage('user', text);
      const exhausted = freeAddUsageCount >= freeAddMax;
      addChatMessage(
        'assistant',
        exhausted
          ? 'You’ve used your free Add. Use Upgrade in the header for unlimited AI chat and edits.'
          : 'To use the chat here, start the Add flow: tap Add below, pick where the feature goes on the page, then describe it in this box. Full AI chat for every tool is a Lifetime feature.'
      );
      persistCurrentSession();
      return;
    }

    els.chatInput.value = '';
    addChatMessage('user', text);
    // Mark with isProcessingMsg so stripProcessingMessages() can reliably remove
    // it without accidentally removing another message (e.g. ADD_SPEC_READY) that
    // arrives while the Brain is working.
    addChatMessage('system', 'Processing…', { isProcessingMsg: true });

    if (!validateBeforeSend('GENERATE_FEATURE', { prompt: text })) return;
    const resp = await sendToBrain('GENERATE_FEATURE', { prompt: text, feature: selectedFeature });

    if (!resp.success) {
      // Remove the "Processing…" placeholder, then show the error.
      stripProcessingMessages();
      addChatMessage('assistant', resp.error || 'Something went wrong. Please try again with a clearer or smaller step-by-step description.');
    } else if (selectedFeature !== 'add') {
      // Non-add features resolve synchronously.
      stripProcessingMessages();
      addChatMessage('assistant', 'Feature spec generated. Preview coming soon.');
    }
    // For the 'add' feature: ADD_SPEC_READY broadcast (handled in add-panel.js)
    // will call WebEditPanel.stripProcessingMessages() and then add the spec-ready
    // message with Apply / Refine / Cancel buttons.  Do NOT pop() here.
  });

  els.sendBtn?.addEventListener('click', handleSend);
  els.chatInput?.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  els.editHistoryView?.addEventListener('click', function (e) {
    const siteTab = e.target.closest('.webedit-edit-history-site-tab');
    if (siteTab?.dataset?.pageKey) {
      selectedHistoryPageKey = siteTab.dataset.pageKey;
      selectedHistoryCategory = 'all';
      renderEditHistoryView();
      return;
    }

    const catTab = e.target.closest('.webedit-edit-history-cat-tab');
    if (catTab?.dataset?.cat) {
      selectedHistoryCategory = catTab.dataset.cat;
      renderEditHistoryView();
        return;
      }

    const modifyHistBtn = e.target.closest('.webedit-edit-modify-btn');
    if (modifyHistBtn?.dataset?.editId) {
      modifyHistBtn.disabled = true;
      runHistoryModifyFromHistory(modifyHistBtn).finally(function () {
        modifyHistBtn.disabled = false;
      });
      return;
    }

    const actionBtn = e.target.closest('.webedit-edit-action-btn');
    if (!actionBtn?.dataset?.editId) return;

    const payload = {
      editId: actionBtn.dataset.editId,
      pageKey: actionBtn.dataset.pageKey || ''
    };
    if (!validateBeforeSend('TOGGLE_HISTORY_EDIT', payload)) return;

    actionBtn.disabled = true;
    sendToBrain('TOGGLE_HISTORY_EDIT', payload).then(function (resp) {
      actionBtn.disabled = false;
      if (!resp.success) {
        showNotification(resp.error || 'Could not update edit history');
      return;
    }
      historyError = '';
      setHistorySites(resp.sites);
      renderEditHistoryView();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Init Sequence
// On Panel load, ask the Brain for everything we need, then start listening.
// ═══════════════════════════════════════════════════════════════════════════════

registerEventListeners();

(async function init() {
  // 1. Check Brain is alive
  await pingBrain();

  // 2. Get auth state from Brain
  const authResp = await sendToBrain('WEBEDIT_GET_SESSION');
  if (authResp.success || authResp.ok) {
    const session = authResp.session || null;
    currentUser = session?.user || null;
    authState = currentUser ? 'authenticated' : 'unauthenticated';
  }
  updateAuthUI();
  await syncPlanFromBrain();

  // 3. Get active blueprints for current tab
  const url = await getCurrentTabUrl();
  if (url) {
    const bpResp = await sendToBrain('GET_ACTIVE_BLUEPRINTS', { url });
    if (bpResp.success) {
      activeBlueprints = bpResp.blueprints || {};
      currentBlueprintPageKey = normalizePageKey(bpResp.pageKey || url);
    }
  }
  renderBlueprintList();

  // 4. Get chat sessions for history sidebar and restore last session
  if (isAuthenticated()) {
    await loadChatSessions();
    if (chatSessions.length > 0) {
      const lastSession = chatSessions[0];
      const chatResp = await sendToBrain('GET_CHAT_SESSION', { sessionId: lastSession.id });
      if (chatResp.success && chatResp.session) {
        currentSessionId = chatResp.session.id;
        chatMessages = filterOutStaleAddSpecPending(
          Array.isArray(chatResp.session.messages) ? chatResp.session.messages : []
        );
      }
    }
  }

  // 5. Start periodic Dead Receiver ping (every 30s)
  setInterval(pingBrain, 30000);

  // 6. Finish UI (DOM listeners already registered synchronously below)
  setSelectedFeature(selectedFeature);
    renderChatMessages();
  renderEditHistoryView();
  setPanelMode(currentPanelMode);

  chrome.tabs.onActivated.addListener(function () {
    refreshBlueprintsAndPicker();
  });
  })();

// Expose a minimal API so per-feature panel modules can display messages
window.WebEditPanel = {
  showNotification: showNotification,
  addChatMessage: addChatMessage,
  stripProcessingMessages: stripProcessingMessages,
  openCustomizeDashboard: null,
  closeCustomizeDashboard: null,
};

})();