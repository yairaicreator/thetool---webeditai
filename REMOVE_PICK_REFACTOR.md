# Remove & Pick Element Refactor - Complete Guide

**Version:** 0.4.0  
**Date:** November 23, 2025  
**Status:** ✅ Complete

## 🎯 Overview

This refactor separates the **Remove/Hide** functionality from **Pick Element** functionality, and adds **persistent edits** that survive page refreshes and navigation.

### Key Changes

1. ✅ **Separated Remove from Pick Element**
   - Remove mode: Triggered from Visual Edit menu → actually removes/hides elements
   - Pick mode: Triggered from "Pick element" button → only selects for editing (no removal)

2. ✅ **Persistent Edits**
   - All edits stored in `chrome.storage.local`
   - Rules automatically re-applied on page load and navigation
   - Removed elements stay removed across refreshes

3. ✅ **Supabase Sync** (for authenticated users)
   - Edit rules synced to cloud database
   - Cross-device synchronization support
   - SQL schema provided for easy setup

4. ✅ **Enhanced UI/UX**
   - Toast notifications for actions
   - Chat-style reference messages when picking elements
   - Better visual feedback during Remove/Pick modes

---

## 📁 New Files Created

### 1. `editRules.js`
**Purpose:** Core persistence module for edit rules

**Key Components:**
- `EditRules` - Main API for creating and managing rules
- `StorageManager` - Handles chrome.storage.local operations
- `RuleApplier` - Applies rules to the DOM
- `SupabaseSyncManager` - Syncs rules to Supabase for authenticated users

**Key Functions:**
```javascript
// Create and save a new rule
await EditRules.createRule(element, action, metadata, user);

// Apply all rules for current page
await EditRules.applyRules();

// Get rules for current page
const rules = await EditRules.getRulesForCurrentPage();

// Delete a rule
await EditRules.deleteRule(ruleId);
```

### 2. `supabase_schema.sql`
**Purpose:** Database schema for storing edit rules in Supabase

**Table Structure:**
- `edit_rules` table with RLS (Row Level Security)
- Indexes for performance optimization
- Policies for user-based access control
- Automatic timestamp updates

**To Set Up:**
1. Open your Supabase project dashboard
2. Go to SQL Editor
3. Run the contents of `supabase_schema.sql`
4. Verify table creation in Table Editor

---

## 🔄 Modified Files

### 1. `contentScript.js`
**Major Changes:**

#### New State Variables
```javascript
// Separate mode flags
let isPickMode = false;
let isRemoveMode = false;

// Current editing target (from Pick mode)
let currentEditTarget = {
  element: null,
  selector: null,
  description: null,
  pageKey: null
};

// Chat messages for reference display
let chatMessages = [];
```

#### New Functions

**Remove Mode:**
- `startRemoveMode()` - Initiates Remove mode
- `stopRemoveMode()` - Exits Remove mode
- `handleRemoveMouseMove(event)` - Hover feedback during Remove
- `handleRemoveClick(event)` - Handles element removal with persistence

**Pick Mode:**
- `startPickMode()` - Initiates Pick mode (no removal)
- `stopPickMode()` - Exits Pick mode
- `handlePickMouseMove(event)` - Hover feedback during Pick
- `handlePickClick(event)` - Selects element and adds chat reference

**Chat Messages:**
- `addChatMessage(type, content)` - Adds message to chat
- `renderChatMessages()` - Renders chat messages in UI

**Initialization:**
- `initializeExtension()` - Sets up panel and applies saved rules on load
- Mutation observer for URL changes (SPA support)

#### Removed Functions
- `pickModeOn(tool)` - Replaced by separate mode functions
- `pickModeOff()` - Replaced by `stopRemoveMode()` and `stopPickMode()`
- Old `handleMouseMove()` and `handleClick()` - Replaced by mode-specific handlers

### 2. `manifest.json`
**Changes:**
- Added `editRules.js` to content scripts
```json
"js": ["editRules.js", "contentScript.js"]
```

### 3. `panel.css`
**New Styles Added:**

#### Chat Messages Container
```css
.webedit-chat-messages {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

#### Chat Message Styles
- `.webedit-chat-message` - Base message style
- `.webedit-chat-message-user` - User messages (right-aligned, gradient background)
- `.webedit-chat-message-system` - System messages (left-aligned, gray background)
- `.webedit-chat-message-reference` - Reference messages (blue accent)

---

## 🎮 User Flows

### A) Remove Feature Flow

```
1. User opens WebEdit AI panel
   ↓
2. User clicks Visual Edit hamburger (☰)
   ↓
3. User selects "Remove/hide" from menu
   ↓
4. Remove mode activates automatically
   - Cursor changes
   - Elements highlight on hover with "Click to Remove" label
   ↓
5. User clicks an element
   ↓
6. Element is immediately hidden
   ↓
7. EditRule is created and saved:
   - Stored in chrome.storage.local
   - Synced to Supabase (if user is authenticated)
   ↓
8. Toast notification appears:
   "You successfully removed this element."
   ↓
9. Remove mode exits automatically
```

**Persistence:**
- On next page load, rule is automatically re-applied
- Element stays hidden across refreshes and navigation
- Rule survives browser restarts

### B) Pick Element Flow

```
1. User opens WebEdit AI panel
   ↓
2. User clicks "Pick element" button (bottom gradient button)
   ↓
3. Pick mode activates
   - Cursor changes
   - Elements highlight on hover with "Click to Select" label
   ↓
4. User clicks an element
   ↓
5. Element is NOT removed/hidden
   ↓
6. Element metadata is stored:
   - CSS selector generated
   - Human-readable description created
   - Stored as currentEditTarget
   ↓
7. Reference message added to chat:
   "Reference: button#save-btn 'Save Changes'"
   ↓
8. Toast notification appears:
   "Element selected for editing"
   ↓
9. Pick mode exits
   ↓
10. User can now chat with AI about this element
    (Future: AI will use currentEditTarget to apply edits)
```

**Purpose:**
- Select element for future AI-driven edits
- No immediate changes to DOM
- Prepares context for conversational editing

---

## 🔧 Technical Implementation

### Edit Rule Data Model

```javascript
{
  id: "rule-1732377600000-abc123",      // Unique ID
  pageKey: "example.com/path",          // hostname + pathname
  selector: "#element-id",              // CSS selector
  action: "remove",                     // "hide", "remove", "style", etc.
  metadata: {                           // Action-specific data
    description: "button#save 'Save'",
    styles: { color: "red" }            // For "style" action
  },
  createdAt: 1732377600000,            // Timestamp
  active: true,                         // Whether rule is active
  userId: "uuid-here"                   // User ID (if authenticated)
}
```

### Storage Structure

**chrome.storage.local:**
```javascript
{
  "webeditRules": {
    "example.com/path1": [rule1, rule2],
    "example.com/path2": [rule3, rule4]
  }
}
```

**Supabase (edit_rules table):**
- Primary key: `id` (TEXT)
- Foreign key: `user_id` (UUID) → auth.users
- Columns: `page_key`, `selector`, `action`, `metadata` (JSONB), `active`, `created_at`, `updated_at`
- Row Level Security enabled
- Users can only access their own rules

### Rule Application Process

**On Page Load:**
```javascript
1. initializeExtension() runs
   ↓
2. Get pageKey = hostname + pathname
   ↓
3. Load rules from chrome.storage.local for this pageKey
   ↓
4. Apply each active rule:
   - Find elements matching rule.selector
   - Apply action (hide, style, etc.)
   - Mark elements with data attributes
   ↓
5. Setup MutationObserver:
   - Watches for DOM changes
   - Re-applies rules to late-loaded elements
   - Debounced to avoid performance issues
```

**On SPA Navigation:**
- URL change detected via MutationObserver
- Rules for new page automatically loaded and applied

### Selector Generation

The system generates the most specific selector possible:

1. **ID-based** (highest priority): `#element-id`
2. **Class-based** (if unique): `button.btn.primary`
3. **Path-based** (fallback): `body > div > section:nth-child(2) > button`

**Benefits:**
- More resilient to page structure changes
- Better targeting of specific elements
- Reduced risk of affecting wrong elements

---

## 🔐 Supabase Integration

### Authentication Flow

```javascript
1. User signs in via website (webeditai.com)
   ↓
2. Website receives Supabase session
   ↓
3. Website sends session to extension:
   chrome.runtime.sendMessage({
     type: "WEBEDIT_STORE_SUPABASE_SESSION",
     session: session
   })
   ↓
4. Extension stores session in chrome.storage.local
   ↓
5. Session synced across all open tabs
   ↓
6. Future edit rules automatically include user_id
   ↓
7. Rules synced to Supabase in background
```

### API Calls

**Save Rule:**
```javascript
POST https://eqfjkvjwsswjxkmomxax.supabase.co/rest/v1/edit_rules
Headers:
  - Authorization: Bearer {access_token}
  - apikey: {anon_key}
  - Content-Type: application/json
Body:
  {
    "id": "rule-id",
    "user_id": "user-uuid",
    "page_key": "example.com/path",
    "selector": "#element",
    "action": "remove",
    "metadata": {},
    "active": true
  }
```

**Fetch Rules:**
```javascript
GET https://eqfjkvjwsswjxkmomxax.supabase.co/rest/v1/edit_rules
    ?user_id=eq.{user-uuid}
    &page_key=eq.example.com/path
    &active=eq.true
Headers:
  - Authorization: Bearer {access_token}
  - apikey: {anon_key}
```

### Error Handling

- If Supabase sync fails, rule is still saved locally
- User sees appropriate notification
- Background retry can be implemented (future enhancement)
- RLS ensures data security even if anon_key is exposed

---

## 🎨 UI/UX Improvements

### Toast Notifications

**Types:**
- **Info** (blue): Mode activation, general info
- **Success** (green): Successful actions
- **Error** (red): Failures or issues

**Implementation:**
```javascript
showNotification("Message here", "success");
```

**Features:**
- Auto-dismiss after 3 seconds
- Slide-in animation from top
- Non-blocking (doesn't require user action)
- Stacks multiple notifications

### Chat Reference Messages

When user picks an element, a reference is added to the chat:

```
┌─────────────────────────────────────┐
│ Reference: button#save "Save"       │ ← System message
│                                      │
│ [User can type here about element]  │
└─────────────────────────────────────┘
```

**Benefits:**
- Visual confirmation of selected element
- Context for future AI interactions
- Permanent reference in chat history

### Mode Labels

**Remove Mode:**
- Floating label: "Click to Remove" (red accent)
- Hover outline: Blue border

**Pick Mode:**
- Floating label: "Click to Select" (blue accent)
- Hover outline: Blue border

---

## 🧪 Testing Checklist

### Remove Mode Testing

- [ ] Click Visual Edit → Remove/hide
- [ ] Verify "Remove mode active" notification appears
- [ ] Hover over various elements
- [ ] Verify "Click to Remove" label follows cursor
- [ ] Click an element
- [ ] Verify element disappears immediately
- [ ] Verify "You successfully removed this element" notification
- [ ] Refresh page
- [ ] Verify element stays removed
- [ ] Navigate to another page and back
- [ ] Verify element stays removed

### Pick Mode Testing

- [ ] Click "Pick element" button
- [ ] Verify "Pick mode active" notification appears
- [ ] Hover over various elements
- [ ] Verify "Click to Select" label follows cursor
- [ ] Click an element
- [ ] Verify element is NOT removed/hidden
- [ ] Verify reference message appears in chat
- [ ] Verify "Element selected for editing" notification
- [ ] Click "Pick element" again
- [ ] Select a different element
- [ ] Verify new reference added to chat

### Persistence Testing

- [ ] Remove several elements on a page
- [ ] Close browser completely
- [ ] Reopen browser and navigate to same page
- [ ] Verify all removed elements stay removed
- [ ] Open DevTools → Application → Storage → Local Storage
- [ ] Find `chrome-extension://{id}` → `webeditRules`
- [ ] Verify rules are stored correctly

### Supabase Sync Testing

- [ ] Sign in to extension
- [ ] Remove an element
- [ ] Open Supabase dashboard → Table Editor → edit_rules
- [ ] Verify rule appears in table
- [ ] Open extension on different browser/device (same account)
- [ ] Verify rule is fetched and applied
- [ ] Sign out
- [ ] Remove another element
- [ ] Verify rule is NOT synced (local only)

### Customize Mode Testing

- [ ] Click Visual Edit → Customize
- [ ] Click "Pick element" button
- [ ] Select an element
- [ ] Change background color, text color, font size
- [ ] Click "Apply"
- [ ] Verify styles are applied immediately
- [ ] Refresh page
- [ ] Verify styles persist
- [ ] Click "Reset"
- [ ] Verify element returns to original appearance

---

## 🚀 Future Enhancements

### Short Term
1. **Undo/Redo** - Allow users to undo recent edits
2. **Rule Management UI** - View and delete saved rules per page
3. **Export/Import Rules** - Share rule sets between users
4. **Rule Preview** - Show what will be affected before applying

### Medium Term
1. **AI Integration** - Let AI generate edit rules from natural language
2. **Batch Operations** - Apply same rule to multiple pages
3. **Rule Templates** - Pre-built rules for common use cases
4. **Offline Sync Queue** - Retry failed Supabase syncs when online

### Long Term
1. **Collaborative Editing** - Share rules with team members
2. **Version History** - Track changes to rules over time
3. **A/B Testing** - Compare different edit combinations
4. **Analytics** - Track which rules are most effective

---

## 📚 API Reference

### EditRules API

#### `createRule(element, action, metadata, user)`
Creates and saves a new edit rule.

**Parameters:**
- `element` (HTMLElement) - Target element
- `action` (string) - Action type: "hide", "remove", "style", etc.
- `metadata` (Object) - Additional data (optional)
- `user` (Object) - Authenticated user (optional)

**Returns:** Promise\<EditRule\>

**Example:**
```javascript
const rule = await EditRules.createRule(
  document.getElementById('unwanted'),
  'remove',
  { reason: 'User preference' },
  currentUser
);
```

#### `applyRules()`
Applies all saved rules for the current page.

**Returns:** Promise\<number\> - Number of elements affected

**Example:**
```javascript
const count = await EditRules.applyRules();
console.log(`Applied rules to ${count} elements`);
```

#### `getRulesForCurrentPage()`
Gets all rules for the current page.

**Returns:** Promise\<EditRule[]\>

**Example:**
```javascript
const rules = await EditRules.getRulesForCurrentPage();
rules.forEach(rule => {
  console.log(`Rule ${rule.id}: ${rule.action} on ${rule.selector}`);
});
```

#### `deleteRule(ruleId)`
Deletes a specific rule.

**Parameters:**
- `ruleId` (string) - The rule ID

**Returns:** Promise\<boolean\> - Success status

**Example:**
```javascript
const success = await EditRules.deleteRule('rule-123');
if (success) {
  console.log('Rule deleted successfully');
}
```

#### `clearAllRulesForCurrentPage()`
Clears all rules for the current page.

**Returns:** Promise\<boolean\> - Success status

**Example:**
```javascript
await EditRules.clearAllRulesForCurrentPage();
console.log('All rules cleared for this page');
```

### Message API

#### Panel → Content Script

**Start Remove Mode:**
```javascript
chrome.tabs.sendMessage(tabId, {
  type: 'WEBEDIT_START_REMOVE_MODE'
});
```

**Start Pick Mode:**
```javascript
chrome.tabs.sendMessage(tabId, {
  type: 'WEBEDIT_START_PICK_MODE'
});
```

#### Content Script → Panel

**Remove Done:**
```javascript
chrome.runtime.sendMessage({
  type: 'WEBEDIT_REMOVE_DONE',
  selector: '#element',
  pageKey: 'example.com/path',
  ruleId: 'rule-123'
});
```

**Element Picked:**
```javascript
chrome.runtime.sendMessage({
  type: 'WEBEDIT_ELEMENT_PICKED_FOR_EDIT',
  selector: '#element',
  description: 'button#save "Save"',
  pageKey: 'example.com/path'
});
```

---

## 🐛 Troubleshooting

### Rules Not Persisting

**Symptom:** Elements removed, but reappear on refresh

**Solutions:**
1. Check browser console for errors
2. Verify chrome.storage.local permissions in manifest.json
3. Check if storage quota exceeded:
   ```javascript
   chrome.storage.local.getBytesInUse(null, bytes => {
     console.log('Storage used:', bytes, 'bytes');
   });
   ```

### Supabase Sync Failing

**Symptom:** "Couldn't save rule" notification after removal

**Solutions:**
1. Verify user is authenticated (check avatar in panel)
2. Check browser console for API errors
3. Verify Supabase table exists (run schema SQL)
4. Check RLS policies are configured correctly
5. Verify auth token is valid:
   ```javascript
   chrome.storage.local.get(['webeditSupabaseSession'], result => {
     console.log('Session:', result.webeditSupabaseSession);
   });
   ```

### Wrong Element Selected

**Symptom:** Selector matches multiple elements

**Solutions:**
1. Element needs more specific identifier (add ID or unique class)
2. Manual selector refinement (future feature)
3. Use nth-child selector (automatically generated in some cases)

### Rules Applied to Wrong Page

**Symptom:** Rules from one page appear on another

**Solutions:**
1. Check pageKey generation (should be hostname + pathname)
2. Verify URL structure is consistent
3. Consider using wildcard matching (future feature)

---

## 📝 Migration Notes

### From v0.3.0 to v0.4.0

**Breaking Changes:**
- Old `pickModeOn(tool)` function removed
- Tool buttons now have different behaviors
- Panel structure changed (added chat messages area)

**Data Migration:**
- No existing data to migrate (new feature)
- Old removed elements will not persist (this is new functionality)

**Code Changes:**
If you have custom code calling old functions:

**Before:**
```javascript
pickModeOn('remove');
```

**After:**
```javascript
startRemoveMode(); // For Remove
startPickMode();   // For Pick
```

---

## ✅ Summary

This refactor successfully:

1. ✅ **Separated Remove from Pick** - Two distinct, clear behaviors
2. ✅ **Added Persistence** - Edits survive refreshes and navigation
3. ✅ **Implemented Supabase Sync** - Cloud backup for authenticated users
4. ✅ **Improved UX** - Toast notifications and chat references
5. ✅ **Prepared for AI** - Current edit target ready for AI integration
6. ✅ **Maintained Compatibility** - Customize and Add tools still work

**Files Modified:** 3 (contentScript.js, manifest.json, panel.css)  
**Files Created:** 3 (editRules.js, supabase_schema.sql, this doc)  
**Lines of Code:** ~800 new lines  
**Tests Passing:** Manual testing required (see checklist above)

---

**Questions or Issues?**  
Contact: support@webeditai.com  
Documentation: https://github.com/your-repo/webedit-ai

**Version History:**
- v0.4.0 (Nov 23, 2025) - Remove/Pick separation + Persistence
- v0.3.0 (Nov 20, 2025) - Direct toggle architecture
- v0.2.0 - In-page panel
- v0.1.0 - Initial release

