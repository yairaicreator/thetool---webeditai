# Migration Guide: v0.3.0 → v0.4.0

## 🎯 Quick Overview

Version 0.4.0 introduces **persistent edits** and **separates Remove from Pick Element**. This is a significant architectural change that improves functionality without breaking existing features.

## 🚀 What's New

### For Users

1. **Removed elements stay removed** - No more disappearing on refresh!
2. **Two separate tools**:
   - **Remove/Hide** (from Visual Edit menu) - Permanently removes elements
   - **Pick Element** (bottom button) - Selects elements for editing without removing them
3. **Better notifications** - Toast messages instead of alerts
4. **Cloud sync** - Your edits sync across devices if you're signed in
5. **Reference system** - See what element you selected in the chat

### For Developers

1. **New persistence layer** (`editRules.js`)
2. **Supabase integration** for cloud storage
3. **Separate mode handlers** (Remove vs Pick)
4. **Chat message system** for future AI integration
5. **Mutation observer** for SPA support

## 📥 Installation Steps

### 1. Update Extension Files

If you're running locally:

```bash
# Pull latest changes
git pull origin main

# No npm install needed (vanilla JS)

# Reload extension in chrome://extensions
```

### 2. Set Up Supabase (Optional but Recommended)

If you want cloud sync for authenticated users:

1. **Create/Open Supabase Project**
   - Go to https://supabase.com
   - Create new project or use existing

2. **Run SQL Schema**
   - Copy contents of `supabase_schema.sql`
   - Go to Supabase → SQL Editor
   - Paste and run the SQL
   - Verify `edit_rules` table created

3. **Update Connection** (if using different Supabase project)
   - Edit `editRules.js`
   - Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` constants

4. **Test Sync**
   - Sign in to extension
   - Remove an element
   - Check Supabase Table Editor → `edit_rules`
   - You should see the new rule

### 3. Reload Extension

```
1. Open chrome://extensions
2. Find "WebEdit AI"
3. Click reload icon (🔄)
4. Test on any website
```

## 🔄 Breaking Changes

### Removed Functions

These functions are **no longer available**:

```javascript
// ❌ OLD (removed)
pickModeOn(tool);
pickModeOff();

// ✅ NEW (use instead)
startRemoveMode();  // For removing elements
stopRemoveMode();

startPickMode();    // For selecting elements
stopPickMode();
```

### Changed Behavior

#### Remove/Hide Button

**v0.3.0 Behavior:**
```
Click "Remove/hide" → Click "Pick element" → Click element → Element hidden
```

**v0.4.0 Behavior:**
```
Click "Remove/hide" → Remove mode starts immediately → Click element → Element hidden + rule saved
```

**Impact:** Remove mode now starts automatically when selecting the tool from the menu. No need to click "Pick element" separately.

#### Pick Element Button

**v0.3.0 Behavior:**
```
Click "Pick element" → Click element → Behavior depends on selected tool
```

**v0.4.0 Behavior:**
```
Click "Pick element" → Pick mode starts → Click element → Element selected (NOT removed) → Reference added to chat
```

**Impact:** Pick element now NEVER removes anything. It only selects elements for future editing.

## 🔧 Code Migration

### If You Extended the Extension

#### Scenario 1: Custom Pick Logic

**Before:**
```javascript
function myCustomPick() {
  currentTool = "remove";
  pickModeOn(currentTool);
}
```

**After:**
```javascript
function myCustomPick() {
  startRemoveMode(); // Or startPickMode() if selecting for edit
}
```

#### Scenario 2: Checking Pick State

**Before:**
```javascript
if (isPicking) {
  // Do something
}
```

**After:**
```javascript
if (isRemoveMode || isPickMode) {
  // Do something
}

// Or be specific:
if (isRemoveMode) {
  // Removing elements
}

if (isPickMode) {
  // Selecting for editing
}
```

#### Scenario 3: Accessing Selected Element

**Before:**
```javascript
if (selectedEl) {
  console.log("Selected:", selectedEl);
}
```

**After:**
```javascript
// Still works for immediate selection
if (selectedEl) {
  console.log("Selected:", selectedEl);
}

// But for Pick mode, also check:
if (currentEditTarget.element) {
  console.log("Edit target:", currentEditTarget.selector);
  console.log("Description:", currentEditTarget.description);
}
```

### If You Built Custom Tools

#### Adding a New Action Type

**Example: Add a "highlight" action**

1. **Add action to editRules.js:**
```javascript
// In RuleApplier.applyRule()
switch (rule.action) {
  case 'hide':
    // ... existing code
    break;
    
  case 'highlight':  // NEW
    el.style.backgroundColor = rule.metadata.color || 'yellow';
    el.setAttribute('data-webedit-highlighted', rule.id);
    break;
}
```

2. **Create tool handler in contentScript.js:**
```javascript
function startHighlightMode(color = 'yellow') {
  // Similar to startRemoveMode
  // ... set up listeners
}

function handleHighlightClick(event) {
  const el = event.target;
  // Apply highlight
  el.style.backgroundColor = color;
  
  // Save rule
  await EditRules.createRule(el, 'highlight', { color }, currentUser);
  
  showNotification('Element highlighted!', 'success');
  stopHighlightMode();
}
```

3. **Add to Visual Edit menu:**
```javascript
// In createPanel()
<button class="webedit-tool-btn" data-tool="highlight">Highlight</button>
```

## 💾 Data Storage

### What Gets Stored

#### Local Storage (chrome.storage.local)

```javascript
{
  "webeditRules": {
    "example.com/": [
      {
        "id": "rule-1732377600000-abc123",
        "pageKey": "example.com/",
        "selector": "#unwanted-ad",
        "action": "remove",
        "metadata": { "description": "div#unwanted-ad 'Ad Content'" },
        "createdAt": 1732377600000,
        "active": true,
        "userId": null  // or user UUID if signed in
      }
    ]
  },
  "webeditSupabaseSession": { /* auth session */ }
}
```

#### Supabase (Cloud)

Only if user is authenticated:

```sql
SELECT * FROM edit_rules WHERE user_id = 'user-uuid';
```

Returns same structure as local storage.

### Storage Limits

- **chrome.storage.local**: ~5MB total
  - Each rule: ~500 bytes
  - Capacity: ~10,000 rules
  - Per page: Recommended max 50 rules

- **Supabase**: Depends on plan
  - Free tier: 500MB database
  - Practically unlimited rules

### Clearing Storage

**Clear Local Rules:**
```javascript
// Clear all rules
chrome.storage.local.remove(['webeditRules']);

// Clear rules for current page only
await EditRules.clearAllRulesForCurrentPage();
```

**Clear Supabase Rules:**
```sql
-- In Supabase SQL Editor
DELETE FROM edit_rules WHERE user_id = 'your-user-id';
```

## 🧪 Testing Your Migration

### Basic Functionality Test

```javascript
// 1. Open DevTools console on any page
// 2. Open WebEdit AI panel
// 3. Click Visual Edit → Remove/hide
// 4. Click any element → should disappear
// 5. Run in console:
chrome.storage.local.get(['webeditRules'], (result) => {
  console.log('Stored rules:', result.webeditRules);
});
// You should see your rule

// 6. Refresh page
// 7. Element should stay removed

// 8. Clear rules:
await EditRules.clearAllRulesForCurrentPage();
// 9. Refresh page
// 10. Element should reappear
```

### Pick Mode Test

```javascript
// 1. Click "Pick element" button
// 2. Click any element → should NOT disappear
// 3. Check chat area → should see reference message
// 4. Run in console:
console.log('Current edit target:', currentEditTarget);
// Should show selector, description, etc.
```

### Supabase Sync Test

```javascript
// 1. Sign in to extension
// 2. Remove an element
// 3. Open Supabase dashboard
// 4. Go to Table Editor → edit_rules
// 5. Should see new row with your rule
```

## ⚠️ Known Issues & Solutions

### Issue 1: Rules Not Loading

**Symptom:** Removed elements reappear on refresh

**Solution:**
```javascript
// Check if rules are being stored:
chrome.storage.local.get(['webeditRules'], console.log);

// If empty, rules aren't saving. Check console for errors.
// Common cause: chrome.storage.local permissions missing
```

**Fix:** Verify `manifest.json` has:
```json
"permissions": ["storage"]
```

### Issue 2: Supabase 403 Error

**Symptom:** "Couldn't save rule" notification, 403 in console

**Solution:**
```sql
-- Check RLS policies in Supabase SQL Editor
SELECT * FROM pg_policies WHERE tablename = 'edit_rules';

-- If empty, run supabase_schema.sql again
```

### Issue 3: Multiple Elements Affected

**Symptom:** Removing one element removes others too

**Solution:**
The generated selector is too broad. This is currently expected behavior if elements have similar structure. Future enhancement will allow manual selector refinement.

**Workaround:** Add unique IDs or classes to elements you want to target specifically.

### Issue 4: SPA Not Detecting Navigation

**Symptom:** Rules not applied after navigating on single-page apps

**Solution:**
The URL change detector should catch this automatically, but some frameworks (React Router, Vue Router) may need explicit support.

**Workaround:** Close and reopen the panel to trigger reinitialization.

## 🎓 Best Practices

### For Users

1. **Sign in** to enable cloud sync
2. **Test removes** on test pages first
3. **Use Pick** to explore elements before removing
4. **Check reference** messages to verify correct element selected
5. **Clear rules** for pages you no longer visit (storage management)

### For Developers

1. **Always check `window.EditRules` exists** before using
   ```javascript
   if (window.EditRules) {
     await EditRules.createRule(...);
   }
   ```

2. **Use try-catch** for async operations
   ```javascript
   try {
     await EditRules.applyRules();
   } catch (error) {
     console.error('Failed to apply rules:', error);
   }
   ```

3. **Provide user feedback** for all actions
   ```javascript
   showNotification('Action completed', 'success');
   ```

4. **Generate specific selectors** when possible
   ```javascript
   // Good: Unique and specific
   '#user-profile-menu'
   
   // Bad: Too broad
   'div'
   ```

5. **Include metadata** for debugging
   ```javascript
   await EditRules.createRule(el, 'remove', {
     description: 'Removed by user action',
     reason: 'Privacy concern',
     timestamp: Date.now()
   }, currentUser);
   ```

## 📞 Support

### Getting Help

1. **Check documentation**: `REMOVE_PICK_REFACTOR.md`
2. **Review examples**: See code in `contentScript.js`
3. **Enable verbose logging**:
   ```javascript
   // Add to contentScript.js
   window.WEBEDIT_DEBUG = true;
   ```

4. **Common issues**: See troubleshooting section above

### Reporting Bugs

If you encounter issues:

1. Open browser DevTools console
2. Reproduce the issue
3. Copy console errors
4. Note:
   - Browser version
   - Extension version (0.4.0)
   - Steps to reproduce
5. Create GitHub issue or email support@webeditai.com

---

## ✅ Migration Checklist

Use this checklist to verify successful migration:

- [ ] Extension reloaded in browser
- [ ] Supabase schema executed (if using cloud sync)
- [ ] Old `pickModeOn` calls updated (if any custom code)
- [ ] Remove mode test passed
- [ ] Pick mode test passed
- [ ] Persistence test passed (refresh after remove)
- [ ] Supabase sync test passed (if authenticated)
- [ ] No console errors
- [ ] Customize tool still works
- [ ] Add tool still works

---

**Migration Complete!** 🎉

You're now running WebEdit AI v0.4.0 with persistent edits and separated Remove/Pick functionality.

Enjoy the improved experience!

