# Supabase Persistence Integration Guide

## Overview

Successfully integrated Supabase persistence into the WebEdit AI Chrome extension. All Add/Remove/Customize edits are now automatically saved to the Supabase database with proper authentication and error handling.

---

## 🎯 What Was Implemented

### 1. **saveEdit.js** (NEW - 470+ lines)
Complete persistence layer for saving edits to Supabase.

**Key Features:**
- ✅ REST API integration with Supabase
- ✅ Automatic Website row creation/retrieval
- ✅ Edit persistence with full metadata
- ✅ Authentication handling (uses stored session)
- ✅ Graceful error handling (doesn't break extension)
- ✅ Non-blocking saves (UX remains fast)

**Exported Functions:**
```javascript
window.SaveEdit = {
  saveEditToSupabase(params),
  saveAddFeature(featureSpec),
  saveRemoveEdit(element, rule),
  saveCustomizeEdit(element, rule),
  getOrCreateWebsiteForCurrentPage()
}
```

### 2. **manifest.json** (Updated)
Added `supabaseClient.js` and `saveEdit.js` to content scripts load order.

```json
"js": [
  "supabaseClient.js",  // ← Added
  "messages.js",
  "editRules.js",
  "injector.js",
  "saveEdit.js",        // ← Added
  "contentScript.js"
]
```

### 3. **contentScript.js** (3 Integration Points)
Wired Supabase saves into existing edit flows:

**a) Add Feature** (line ~925)
```javascript
// After local storage save
await saveAddedFeature(spec);

// Save to Supabase (non-blocking)
if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
  window.SaveEdit.saveAddFeature(spec).catch(err => {
    console.error('[Add Feature] Failed to save to Supabase:', err);
  });
}
```

**b) Remove Element** (line ~1419)
```javascript
const rule = await editRules.createRule(el, "remove", {}, currentUser);

// Save to Supabase (non-blocking)
if (window.SaveEdit && window.SaveEdit.saveRemoveEdit) {
  window.SaveEdit.saveRemoveEdit(el, rule).catch(err => {
    console.error('[Remove] Failed to save to Supabase:', err);
  });
}
```

**c) Customize Element** (line ~1046)
```javascript
const rule = await editRules.createRule(targetEl, "style", { styles }, currentUser);

// Save to Supabase (non-blocking)
if (window.SaveEdit && window.SaveEdit.saveCustomizeEdit) {
  window.SaveEdit.saveCustomizeEdit(targetEl, rule).catch(err => {
    console.error('[Customize] Failed to save to Supabase:', err);
  });
}
```

---

## 📊 Database Schema

### **Websites Table**
```sql
CREATE TABLE websites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin TEXT NOT NULL,              -- e.g., "https://example.com"
  path TEXT NOT NULL,                -- e.g., "/blog/post-1"
  full_url TEXT NOT NULL,            -- Complete URL
  title TEXT,                        -- Page title
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### **Edits Table**
```sql
CREATE TABLE edits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID REFERENCES websites(id),
  type TEXT NOT NULL,                -- 'add' | 'remove' | 'customize'
  name TEXT NOT NULL,                -- Edit name
  description TEXT,                  -- Edit description
  payload JSONB NOT NULL,            -- Edit details (selectors, styles, etc.)
  before_image_url TEXT,             -- Screenshot before (future)
  after_image_url TEXT,              -- Screenshot after (future)
  status TEXT DEFAULT 'active',      -- 'active' | 'undone'
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 🔑 Key Design Decisions

### 1. **Non-Blocking Saves**
Supabase saves are fire-and-forget to ensure fast UX:
```javascript
// Don't await - let it happen in background
window.SaveEdit.saveAddFeature(spec).catch(err => {
  console.error('[Add Feature] Failed to save to Supabase:', err);
});
```

**Why:** User experience remains instant even if Supabase is slow or fails.

### 2. **Graceful Degradation**
Extension works perfectly even if:
- User is not authenticated
- Supabase is unreachable
- Database schema changes

**Example:**
```javascript
if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
  // SaveEdit module loaded
  window.SaveEdit.saveAddFeature(spec).catch(...);
} else {
  // SaveEdit not available - extension still works
  console.log('SaveEdit not available, edit saved locally only');
}
```

### 3. **Automatic Website Creation**
Extension automatically creates Website rows on first edit:
```javascript
// 1. Check if Website exists for this page
// 2. If not, create it
// 3. Return website_id for Edit insertion
const website = await getOrCreateWebsiteForCurrentPage();
```

### 4. **Authentication from Stored Session**
Uses the same session mechanism as the website:
```javascript
// Reads from chrome.storage.local
const { data: { session } } = await SupabaseClient.getSession();
const token = session.access_token;
const userId = session.user.id;
```

---

## 🧪 How to Test

### Prerequisites
1. **User must be authenticated** in the extension
   - Click "Sign in" button in extension panel
   - Sign in via the website
   - Session is automatically stored in chrome.storage.local

2. **Supabase tables must exist** (already created)
   - `websites` table with correct schema
   - `edits` table with correct schema
   - RLS policies enabled for user access

### Test 1: Add Feature → Supabase

1. **Open any website** (e.g., https://example.com)

2. **Open WebEdit AI extension**

3. **Ensure you're signed in**
   - Check if avatar appears in top-right
   - If not, click "Sign in" and authenticate

4. **Create an Add feature:**
   - Click hamburger menu → "Add"
   - Click "Pick section on page"
   - Click an element
   - Fill form:
     - Name: "Test Note"
     - Type: "Note"
     - Purpose: "Testing Supabase persistence"
   - Click "Create Feature"

5. **Check browser console:**
```javascript
[SaveEdit] Getting or creating Website row for current page
[SaveEdit] Current page: {origin: "https://example.com", path: "/", ...}
[SaveEdit] Querying existing Website...
[SaveEdit] ✅ Found existing Website: abc-123-def
[SaveEdit] Saving edit to Supabase: add
[SaveEdit] Inserting edit: {type: "add", name: "Test Note"}
[SaveEdit] ✅ Edit saved successfully: xyz-789-ghi
```

6. **Verify in Supabase:**
   - Open Supabase Dashboard
   - Navigate to Table Editor
   - Check `websites` table:
     - Should have row for example.com
     - `origin` = "https://example.com"
     - `path` = "/"
     - `title` = page title
   - Check `edits` table:
     - Should have new row
     - `type` = "add"
     - `name` = "Test Note"
     - `payload` contains feature spec
     - `website_id` matches Website row
     - `user_id` matches your user ID

### Test 2: Remove Element → Supabase

1. **Click hamburger menu → "Remove/hide"**

2. **Click an element on the page** (e.g., a heading)

3. **Check browser console:**
```javascript
🗑️ Removing element: <h1>
✅ Rule created and saved: {id: "rule-123", ...}
[SaveEdit] Saving edit to Supabase: remove
[SaveEdit] ✅ Edit saved successfully: xyz-456-abc
```

4. **Verify in Supabase `edits` table:**
   - New row with `type` = "remove"
   - `name` = "Remove element"
   - `payload` contains selector and rule details

### Test 3: Customize Element → Supabase

1. **Click hamburger menu → "Customize"**

2. **Click "Pick element"**

3. **Click an element on the page**

4. **In Customize panel:**
   - Change background color
   - Change text color
   - Change font size
   - Click "Apply"

5. **Check browser console:**
```javascript
🎨 Applying styles: {backgroundColor: "#ff0000", ...}
✅ Styles applied to element
[SaveEdit] Saving edit to Supabase: customize
[SaveEdit] ✅ Edit saved successfully: xyz-789-xyz
```

6. **Verify in Supabase `edits` table:**
   - New row with `type` = "customize"
   - `name` = "Customize element"
   - `payload` contains styles object

### Test 4: Not Authenticated

1. **Sign out** from the extension

2. **Create an Add feature**

3. **Check browser console:**
```javascript
[SaveEdit] User not authenticated, skipping save to Supabase
```

4. **Verify:**
   - ✅ Feature still appears on page (local save works)
   - ✅ No new row in Supabase
   - ✅ No error shown to user

### Test 5: Multiple Edits, Same Page

1. **On example.com homepage:**
   - Create 2 Add features
   - Remove 1 element
   - Customize 1 element

2. **Verify in Supabase:**
   - 1 Website row for example.com
   - 4 Edit rows, all with same `website_id`

3. **Navigate to example.com/page2**

4. **Create 1 Add feature**

5. **Verify in Supabase:**
   - 2 Website rows (one for "/" and one for "/page2")
   - 5 Edit rows total

### Test 6: Error Handling

1. **Temporarily break Supabase connection:**
   - Edit `supabaseClient.js`
   - Change `SUPABASE_URL` to invalid URL
   - Reload extension

2. **Create an Add feature**

3. **Verify:**
   - ✅ Feature appears on page (local save works)
   - ✅ Console shows error: `[SaveEdit] Error saving edit to Supabase: ...`
   - ✅ User sees success notification (not error)
   - ✅ Extension continues to work normally

---

## 📋 Edit Payload Structures

### Add Feature Payload
```json
{
  "id": "feature-1234567890-abc",
  "selector": "div.container",
  "position": "after",
  "type": "note",
  "name": "Important Note",
  "purpose": "Testing Supabase",
  "html": "<div>...</div>",
  "css": ".webedit-feature-note {...}",
  "domain": "example.com",
  "pageKey": "example.com/"
}
```

### Remove Edit Payload
```json
{
  "ruleId": "rule-1234567890-abc",
  "selector": "h1.title",
  "action": "remove",
  "pageKey": "example.com/",
  "description": "h1.title \"Page Title\""
}
```

### Customize Edit Payload
```json
{
  "ruleId": "rule-1234567890-abc",
  "selector": "div.content",
  "action": "style",
  "styles": {
    "backgroundColor": "#ff0000",
    "color": "#ffffff",
    "fontSize": "20px"
  },
  "pageKey": "example.com/",
  "description": "div.content"
}
```

---

## 🔍 Console Logging

### Successful Save Flow
```javascript
// Module loads
✅ SaveEdit module initialized and exported to window.SaveEdit

// User creates Add feature
➕ Generated feature spec: {...}
[WebEdit Add] Injecting feature {...}
[SaveEdit] Getting or creating Website row for current page
[SaveEdit] Current page: {origin: "https://example.com", ...}
[SaveEdit] Querying existing Website...
[SaveEdit] ✅ Found existing Website: abc-123
[SaveEdit] Saving edit to Supabase: add
[SaveEdit] Inserting edit: {type: "add", name: "Test Note"}
[SaveEdit] ✅ Edit saved successfully: xyz-789
```

### Not Authenticated
```javascript
[SaveEdit] User not authenticated, skipping save to Supabase
```

### Network Error
```javascript
[Add Feature] Failed to save to Supabase: Error: Supabase API error: 500 - ...
```

---

## 🛠️ Troubleshooting

### Problem: No rows in Supabase

**Check:**
1. Is user authenticated? (Avatar visible in panel)
2. Are RLS policies correct? (User should see own rows)
3. Check browser console for errors
4. Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `supabaseClient.js`

### Problem: "Not authenticated" in console

**Solution:**
1. Click "Sign in" in extension
2. Sign in via website
3. Ensure session is stored (check chrome.storage.local)

### Problem: Website row not found

**Possible causes:**
1. RLS policy prevents reading
2. Network error during query
3. Invalid authentication token

**Solution:**
1. Check Supabase logs in dashboard
2. Verify RLS policies allow SELECT for user
3. Check session validity

### Problem: Edit saves locally but not to Supabase

**This is expected behavior if:**
- User is not authenticated
- Network is unavailable
- Supabase returns error

**The extension is designed to work this way** - local functionality is prioritized.

---

## 🎨 Architecture

```
User creates edit
    ↓
contentScript.js
    ├─ Save to local storage (chrome.storage.local)
    ├─ Apply to page (inject/remove/style)
    └─ Fire-and-forget Supabase save
         ↓
    saveEdit.js
         ├─ Get auth token
         ├─ Get/create Website row
         └─ Insert Edit row
              ↓
         Supabase REST API
              ├─ websites table
              └─ edits table
```

**Key Points:**
- Local save happens first (guaranteed)
- Supabase save is async (non-blocking)
- Errors don't affect user experience
- Extension works without Supabase

---

## 📈 What's Next

### Future Enhancements

1. **Screenshot Support**
   - Capture before/after screenshots
   - Upload to Supabase Storage
   - Store URLs in `before_image_url` / `after_image_url`

2. **Sync from Supabase**
   - Load user's edits from Supabase on page load
   - Merge with local edits
   - Enable cross-device sync

3. **Edit History UI**
   - Show user's edit history in extension
   - Allow undo/redo
   - View edit details

4. **Conflict Resolution**
   - Handle conflicts between local and Supabase edits
   - Implement "last write wins" or manual resolution

5. **Batch Operations**
   - Queue multiple edits
   - Send batch requests to Supabase
   - Reduce network overhead

---

## ✅ Summary

**Implemented:**
- ✅ Supabase REST API integration
- ✅ Automatic Website row creation
- ✅ Edit persistence with full metadata
- ✅ Authentication handling
- ✅ Graceful error handling
- ✅ Non-blocking saves
- ✅ Add/Remove/Customize integration

**Files Changed:** 3
1. `saveEdit.js` (NEW) - 470+ lines
2. `manifest.json` (UPDATED) - Added scripts
3. `contentScript.js` (UPDATED) - 3 integration points

**Zero Breaking Changes:**
- ✅ Extension works without authentication
- ✅ Extension works if Supabase fails
- ✅ Local functionality unchanged
- ✅ Fast user experience maintained

**Ready for Production!** 🚀

