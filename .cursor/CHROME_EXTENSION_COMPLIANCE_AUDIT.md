# Chrome Extension Compliance Audit — Purple Potassium (Excessive Permissions)

**Goal:** Pass Chrome Web Store "Purple Potassium" review by removing `tabs` permission and using `activeTab`, with minimal host permissions.

---

## 1. chrome.tabs Usage Audit

### 1.1 background.js

| Line(s) | Usage | User-triggered? | Verdict |
|--------|--------|------------------|--------|
| 46–48 | `chrome.tabs.onActivated.addListener` | **No** — runs on any tab switch | **REMOVE** — automatic access triggers rejection without `tabs` |
| 50–54 | `chrome.tabs.onUpdated.addListener` | **No** — runs on any tab load | **REMOVE** — same as above |
| 72–74 | `chrome.tabs.query({ active: true, lastFocusedWindow: true })` | No (used when side panel sends message) | **REPLACE** — use stored tab ID from action click (activeTab) |
| 81 | `chrome.tabs.sendMessage(tabId, …)` | N/A — messaging is fine | **KEEP** — no tabs permission needed for sendMessage |
| 201, 228 | `chrome.tabs.sendMessage(tabId, …)` | Yes (relay from side panel for current tab) | **KEEP** — use tabId from stored “active tab” |
| 253–256 | `chrome.tabs.query({}, …)` then `sendMessage` to every tab | No | **REMOVE** — broadcast to all tabs requires `tabs`; use only `chrome.runtime.sendMessage` for extension pages |
| 313–316 | Same as above (sign-out broadcast) | No | **REMOVE** — same |
| 328 | `chrome.tabs.create({ url: WEBEDIT_LOGIN_URL })` | Yes (user clicked Log in) | **REPLACE** — open from side panel with `window.open()` so background doesn’t need `tabs` |
| 335 | `chrome.tabs.create({ url: WEBEDIT_HISTORY_URL })` | Yes | **REPLACE** — same |

**Note:** No use of `tab.url`, `tab.title`, or `tab.favIconUrl` in this file. Page URL/title are obtained in the content script via `location.href` and `document.title` (GET_PAGE_CONTEXT), which is correct for activeTab.

### 1.2 sidepanel.js

| Line | Usage | User-triggered? | Verdict |
|------|--------|------------------|--------|
| 707 | `chrome.tabs.create({ url: "https://webeditai.com/" })` | Yes (Home button click) | **REPLACE** with `window.open("https://webeditai.com/", "_blank")` — no `tabs` needed from extension page |

### 1.3 Documentation / markdown (ghost code)

- **REMOVE_PICK_REFACTOR.md** (lines 595, 602), **ARCHITECTURE.md** (19, 123), **IMPLEMENTATION_COMPLETE.md** (167), **DIRECT_TOGGLE_UPDATE.md** (133) contain example snippets with `chrome.tabs.sendMessage`. These are not executed but can be flagged by automated scans. **Recommendation:** Remove or rewrite those code blocks to use “sendMessage to current tab” wording without `chrome.tabs` if you want to be safe.

---

## 2. Permission Check (Sensitive APIs)

- **bookmarks:** Not used.
- **history:** Not used.
- **cookies:** Not used.

No other sensitive APIs outside the manifest were found. Current manifest uses: `sidePanel`, `tabs`, `storage`, `activeTab`, `scripting`. After changes, `tabs` is removed.

---

## 3. Ghost Code / Commented Chrome API References

- No **commented-out** `chrome.tabs` or other Chrome API code was found in `.js` files.
- Inline comments that mention `chrome.runtime` / `chrome.storage` are explanatory (e.g. background.js relay comments, editRules.js context check). No change needed.
- Documentation `.md` files contain example code with `chrome.tabs` (see 1.3).

---

## 4. Data Transmission (fetch / XHR)

All `fetch()` calls in extension code (excluding node_modules) target:

| File | Target | Allowed by |
|------|--------|------------|
| contentScript.js | `auth.url` (Supabase REST) | host_permissions |
| supabaseClient.js | `SUPABASE_URL` (functions, auth/v1) | host_permissions |
| saveEdit.js | `client.url` (Supabase) | host_permissions |
| editRules.js | `getSupabaseUrl()` (Supabase REST) | host_permissions |

No `XMLHttpRequest` in extension code. All network calls go to:

- `https://eqfjkvjwsswjxkmomxax.supabase.co` (API, auth, functions)
- Optionally `https://webeditai.com` (OAuth / site; bridge-listener runs there)

**Recommendation:** Set `host_permissions` to only these domains (see Section 6). Content scripts with `"matches": ["<all_urls>"]` do not require `<all_urls>` in host_permissions for injection; script execution on the “current tab” is covered by user gesture + activeTab when the user opens the panel.

---

## 5. PII and Logs

- **Email:** Used only for:
  - Supabase session (auth) — `session.user.email`
  - UI display (avatar initial, menu label) — sidepanel.js
  - Logging in bridge-listener and supabaseClient (e.g. “Loaded session for …”)  
  Matches justification: authentication and UX only.

- **IP address:** No collection or logging of user IP in extension code. (References to “IP” in node_modules are unrelated.)

- **Recommendation:** Optional: reduce or remove `console.log` that include email in production builds to minimize PII in logs.

---

## 6. Code Cleanup (Single Purpose)

- No unrelated features (bookmarks, history, etc.) found.
- All code aligns with “AI-powered web editing” (edit rules, Supabase persistence, side panel, content script).

**Suggested manifest permission set (post-fix):**

- **permissions:** `["sidePanel", "storage", "activeTab", "scripting"]` — remove `tabs`.
- **host_permissions:** Explicit API domains plus `<all_urls>` for content script injection:
  - `"https://eqfjkvjwsswjxkmomxax.supabase.co/*"`, `"https://webeditai.com/*"`, `"https://www.webeditai.com/*"` — for fetch() and bridge.
  - `"<all_urls>"` — required so content_scripts with `"matches": ["<all_urls>"]` can inject on arbitrary pages. Without it, injection would fail on non-listed hosts.

---

## 7. Summary of Code Changes Applied

1. **background.js**
   - Remove `chrome.tabs.onActivated` and `chrome.tabs.onUpdated` listeners.
   - Replace `getActiveTabId()` with reading a stored “current tab” ID from `chrome.storage.session`, set when the user clicks the extension action (`chrome.action.onClicked`).
   - Remove all `chrome.tabs.query({}, …)` broadcasts; keep only `chrome.runtime.sendMessage` for `WEBEDIT_SESSION_UPDATED`.
   - Remove `chrome.tabs.create` for login/history; those URLs are opened from the side panel via `window.open()` (handlers can remain and respond with `openUrl` or be removed and fully handled in side panel).
   - Ensure every path that needs “current tab” uses the stored tab ID (or sender.tab when the message comes from a content script).

2. **sidepanel.js**
   - Replace `chrome.tabs.create({ url: "https://webeditai.com/" })` with `window.open("https://webeditai.com/", "_blank")`.
   - Optionally handle “Open login” / “Open history” with `window.open(...)` in the side panel instead of messaging the background (so background doesn’t need to create tabs).

3. **manifest.json**
   - Remove `"tabs"` from `permissions`.
   - Optionally replace `"<all_urls>"` in `host_permissions` with the specific Supabase and webeditai.com origins above.

4. **Documentation**
   - Optionally update or remove `.md` code examples that reference `chrome.tabs` to avoid any automated flags.

---

## 8. Corrected Code Snippets (Reference)

### background.js — getActiveTabId (replace with session-stored ID)

```js
const SESSION_TAB_KEY = "webeditActiveTabId";

async function getStoredActiveTabId() {
  return new Promise((resolve) => {
    if (chrome.storage?.session?.get) {
      chrome.storage.session.get([SESSION_TAB_KEY], (result) => {
        resolve(result[SESSION_TAB_KEY] || null);
      });
    } else {
      resolve(null);
    }
  });
}
```

Set `SESSION_TAB_KEY` in `chrome.action.onClicked`:  
`chrome.storage.session.set({ [SESSION_TAB_KEY]: tab.id });`

Use `getStoredActiveTabId()` instead of `getActiveTabId()` wherever the “current tab” is needed (and when sender.tab is not set).

### background.js — remove broadcast to all tabs

Replace the `broadcast` function body that does `chrome.tabs.query({}, …)` with only:

```js
chrome.runtime.sendMessage({ type: "WEBEDIT_SESSION_UPDATED", session }).catch(() => {});
```

### sidepanel.js — open URL without tabs

```js
// Before:
chrome.tabs.create({ url: "https://webeditai.com/" });

// After:
window.open("https://webeditai.com/", "_blank");
```

Login and History can use the same pattern from the side panel so the background never needs `chrome.tabs.create`.

---

*Audit completed. Apply the changes above and re-test: open side panel from toolbar, run commands, sign in/out, and open login/history/home links from the panel.*
