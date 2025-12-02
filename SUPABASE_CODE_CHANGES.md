# Supabase Integration - Code Changes Reference

## Overview

This document shows the exact code changes made to integrate Supabase persistence into the WebEdit AI Chrome extension.

---

## File 1: saveEdit.js (NEW FILE)

**Location:** `saveEdit.js` (root directory)

**Purpose:** Complete persistence layer for saving edits to Supabase

**Key Functions:**

### Authentication
```javascript
async function getAuthToken() {
  const client = getSupabaseClient();
  if (!client) return null;
  
  const { data: { session } } = await client.getSession();
  
  if (!session || !session.access_token) {
    console.log('[SaveEdit] No active session - user not authenticated');
    return null;
  }
  
  if (client.isSessionExpired(session)) {
    console.log('[SaveEdit] Session expired');
    return null;
  }
  
  return {
    token: session.access_token,
    userId: session.user.id
  };
}
```

### REST API Calls
```javascript
async function supabaseRestCall(endpoint, options = {}) {
  const client = getSupabaseClient();
  const auth = await getAuthToken();
  
  if (!auth) {
    throw new Error('Not authenticated - please sign in');
  }
  
  const url = `${client.url}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': client.anonKey,
    'Authorization': `Bearer ${auth.token}`,
    ...options.headers
  };
  
  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error: ${response.status} - ${errorText}`);
  }
  
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
```

### Get or Create Website
```javascript
async function getOrCreateWebsiteForCurrentPage() {
  console.log('[SaveEdit] Getting or creating Website row');
  
  try {
    const origin = window.location.origin;
    const path = window.location.pathname + window.location.search;
    const fullUrl = window.location.href;
    const title = document.title || 'Untitled Page';
    
    const auth = await getAuthToken();
    if (!auth) {
      console.log('[SaveEdit] User not authenticated');
      return null;
    }
    
    // Query existing Website
    const queryParams = new URLSearchParams({
      user_id: `eq.${auth.userId}`,
      origin: `eq.${origin}`,
      path: `eq.${path}`,
      select: 'id,origin,path,full_url,title'
    });
    
    const existingWebsites = await supabaseRestCall(
      `/rest/v1/websites?${queryParams.toString()}`,
      { method: 'GET' }
    );
    
    if (existingWebsites && existingWebsites.length > 0) {
      console.log('[SaveEdit] ✅ Found existing Website:', existingWebsites[0].id);
      return { id: existingWebsites[0].id };
    }
    
    // Create new Website
    console.log('[SaveEdit] Creating new Website row...');
    const newWebsite = await supabaseRestCall(
      '/rest/v1/websites',
      {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          origin,
          path,
          full_url: fullUrl,
          title,
          user_id: auth.userId
        })
      }
    );
    
    if (newWebsite && newWebsite.length > 0) {
      console.log('[SaveEdit] ✅ Created new Website:', newWebsite[0].id);
      return { id: newWebsite[0].id };
    }
    
    return null;
  } catch (error) {
    console.error('[SaveEdit] Error getting/creating Website:', error);
    return null;
  }
}
```

### Save Edit to Supabase
```javascript
async function saveEditToSupabase(params) {
  console.log('[SaveEdit] Saving edit to Supabase:', params.type);
  
  try {
    const auth = await getAuthToken();
    if (!auth) {
      console.log('[SaveEdit] User not authenticated, skipping save');
      return { success: false, error: 'Not authenticated' };
    }
    
    const website = await getOrCreateWebsiteForCurrentPage();
    if (!website) {
      console.error('[SaveEdit] Failed to get/create Website row');
      return { success: false, error: 'Failed to get/create Website' };
    }
    
    const name = params.name || generateEditName(params.type, params.payload);
    const description = params.description || generateEditDescription(params.type, params.payload);
    
    const editData = {
      website_id: website.id,
      type: params.type,
      name,
      description,
      payload: params.payload,
      before_image_url: params.beforeImageUrl || null,
      after_image_url: params.afterImageUrl || null,
      status: 'active',
      user_id: auth.userId
    };
    
    console.log('[SaveEdit] Inserting edit:', { type: params.type, name });
    
    const insertedEdit = await supabaseRestCall(
      '/rest/v1/edits',
      {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(editData)
      }
    );
    
    if (insertedEdit && insertedEdit.length > 0) {
      console.log('[SaveEdit] ✅ Edit saved successfully:', insertedEdit[0].id);
      return { success: true, editId: insertedEdit[0].id };
    }
    
    return { success: false, error: 'No data returned from insert' };
  } catch (error) {
    console.error('[SaveEdit] Error saving edit to Supabase:', error);
    return { success: false, error: error.message };
  }
}
```

### Convenience Functions
```javascript
async function saveAddFeature(featureSpec) {
  return await saveEditToSupabase({
    type: 'add',
    name: featureSpec.name,
    description: featureSpec.purpose,
    payload: {
      id: featureSpec.id,
      selector: featureSpec.selector,
      position: featureSpec.position,
      type: featureSpec.type,
      name: featureSpec.name,
      purpose: featureSpec.purpose,
      html: featureSpec.html,
      css: featureSpec.css,
      domain: featureSpec.domain,
      pageKey: featureSpec.pageKey
    }
  });
}

async function saveRemoveEdit(element, rule) {
  return await saveEditToSupabase({
    type: 'remove',
    name: 'Remove element',
    description: rule.metadata?.description || `Removed element: ${rule.selector}`,
    payload: {
      ruleId: rule.id,
      selector: rule.selector,
      action: rule.action,
      pageKey: rule.pageKey,
      description: rule.metadata?.description
    }
  });
}

async function saveCustomizeEdit(element, rule) {
  return await saveEditToSupabase({
    type: 'customize',
    name: 'Customize element',
    description: rule.metadata?.description || `Customized element: ${rule.selector}`,
    payload: {
      ruleId: rule.id,
      selector: rule.selector,
      action: rule.action,
      styles: rule.metadata?.styles || {},
      pageKey: rule.pageKey,
      description: rule.metadata?.description
    }
  });
}
```

### Export
```javascript
if (typeof window !== 'undefined') {
  window.SaveEdit = {
    saveEditToSupabase,
    saveAddFeature,
    saveRemoveEdit,
    saveCustomizeEdit,
    getOrCreateWebsiteForCurrentPage
  };
  console.log('✅ SaveEdit module initialized');
}
```

---

## File 2: manifest.json (UPDATED)

**Change:** Added `supabaseClient.js` and `saveEdit.js` to content scripts

**Before:**
```json
"js": ["messages.js", "editRules.js", "injector.js", "contentScript.js"]
```

**After:**
```json
"js": [
  "supabaseClient.js",  // ← ADDED
  "messages.js",
  "editRules.js",
  "injector.js",
  "saveEdit.js",        // ← ADDED
  "contentScript.js"
]
```

---

## File 3: contentScript.js (UPDATED - 3 Places)

### Change 1: Add Feature Flow

**Location:** Around line 925

**Before:**
```javascript
// Save to storage
await saveAddedFeature(spec);

// Show success
showNotification("Feature created successfully!", "success");
```

**After:**
```javascript
// Save to local storage
await saveAddedFeature(spec);

// Save to Supabase (non-blocking - don't wait for it)
if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
  window.SaveEdit.saveAddFeature(spec).catch(err => {
    console.error('[Add Feature] Failed to save to Supabase:', err);
    // Don't show error to user - local save succeeded
  });
}

// Show success
showNotification("Feature created successfully!", "success");
```

### Change 2: Remove Element Flow

**Location:** Around line 1419

**Before:**
```javascript
if (editRules) {
  try {
    const rule = await editRules.createRule(el, "remove", {}, currentUser);
    console.log("✅ Rule created and saved:", rule);

    showNotification("You successfully removed this element.", "success");
  } catch (error) {
    console.error("❌ Error creating rule:", error);
    showNotification("Element removed, but couldn't save rule.", "error");
  }
}
```

**After:**
```javascript
if (editRules) {
  try {
    const rule = await editRules.createRule(el, "remove", {}, currentUser);
    console.log("✅ Rule created and saved:", rule);

    // Save to Supabase (non-blocking)
    if (window.SaveEdit && window.SaveEdit.saveRemoveEdit) {
      window.SaveEdit.saveRemoveEdit(el, rule).catch(err => {
        console.error('[Remove] Failed to save to Supabase:', err);
        // Don't show error to user - local save succeeded
      });
    }

    showNotification("You successfully removed this element.", "success");
  } catch (error) {
    console.error("❌ Error creating rule:", error);
    showNotification("Element removed, but couldn't save rule.", "error");
  }
}
```

### Change 3: Customize Element Flow

**Location:** Around line 1046

**Before:**
```javascript
if (editRules) {
  try {
    await editRules.createRule(targetEl, "style", { styles }, currentUser);
    showNotification("Styles applied successfully!", "success");
  } catch (error) {
    console.error("❌ Error saving style rule:", error);
    showNotification("Styles applied, but couldn't save rule.", "error");
  }
}
```

**After:**
```javascript
if (editRules) {
  try {
    const rule = await editRules.createRule(targetEl, "style", { styles }, currentUser);
    
    // Save to Supabase (non-blocking)
    if (window.SaveEdit && window.SaveEdit.saveCustomizeEdit) {
      window.SaveEdit.saveCustomizeEdit(targetEl, rule).catch(err => {
        console.error('[Customize] Failed to save to Supabase:', err);
        // Don't show error to user - local save succeeded
      });
    }
    
    showNotification("Styles applied successfully!", "success");
  } catch (error) {
    console.error("❌ Error saving style rule:", error);
    showNotification("Styles applied, but couldn't save rule.", "error");
  }
}
```

---

## Key Patterns Used

### 1. Non-Blocking Pattern
```javascript
// DON'T wait for Supabase
if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
  window.SaveEdit.saveAddFeature(spec).catch(err => {
    console.error('[Add Feature] Failed to save to Supabase:', err);
  });
}
// Continue immediately
```

### 2. Graceful Checking Pattern
```javascript
// Check if SaveEdit module is available
if (window.SaveEdit && window.SaveEdit.saveAddFeature) {
  // Module loaded, safe to call
} else {
  // Module not loaded, extension still works
}
```

### 3. Error Handling Pattern
```javascript
// Catch errors but don't show to user
window.SaveEdit.saveAddFeature(spec).catch(err => {
  console.error('[Add Feature] Failed to save to Supabase:', err);
  // Local functionality already succeeded
  // User sees success notification regardless
});
```

---

## Testing Commands

### Check if SaveEdit loaded:
```javascript
// In browser console
console.log(window.SaveEdit);
// Should show object with methods
```

### Manually trigger save:
```javascript
// In browser console after creating an edit
window.SaveEdit.getOrCreateWebsiteForCurrentPage().then(console.log);
```

### Check authentication:
```javascript
// In browser console
chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
  console.log('Session:', result.webeditSupabaseSession);
});
```

---

## Summary

**Files Changed:** 3
1. `saveEdit.js` (NEW) - 470+ lines
2. `manifest.json` (UPDATED) - 2 script additions
3. `contentScript.js` (UPDATED) - 3 integration points

**Lines Added:** ~500 total

**Design Principles:**
- ✅ Non-blocking (fast UX)
- ✅ Graceful degradation (works without auth/Supabase)
- ✅ Error handling (logs but doesn't break)
- ✅ Local-first (chrome.storage.local always succeeds)

**Zero Breaking Changes:**
- Extension works identically if user is not authenticated
- Extension works identically if Supabase is down
- All existing features continue to work

**Ready to deploy!** 🚀

