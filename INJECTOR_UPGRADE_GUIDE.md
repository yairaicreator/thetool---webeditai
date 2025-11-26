# WebEdit AI - Injector Upgrade Guide

## Overview

The Add feature injector has been upgraded with 5 major improvements:

1. ✅ **Shadow DOM containers** - Isolated styling and DOM structure
2. ✅ **Mount/unmount/update helpers** - Clean lifecycle management
3. ✅ **MutationObserver retry logic** - Handles dynamic content and SPAs
4. ✅ **Safety validation** - Prevents injection of invalid or dangerous specs
5. ✅ **User-visible error UI** - Toast notifications for injection failures

## Files Changed

### 1. **injector.js** (NEW - 500+ lines)
Complete Shadow DOM injector module with all core functionality.

### 2. **contentScript.js** (Updated)
Integrated with the new injector, added migration support for old features.

### 3. **manifest.json** (Updated)
Added `injector.js` to content scripts load order.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Content Script                        │
│  - User interaction (Add feature flow)                   │
│  - Storage management (save/restore)                     │
│  - Calls injector API                                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ mountFeatureWithRetry(spec)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Injector Module                         │
│  - Shadow DOM creation                                   │
│  - Validation                                            │
│  - MutationObserver retry                                │
│  - Error UI                                              │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ Creates & mounts
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Target Page DOM                             │
│                                                          │
│  <div id="webedit-feature-xxx">  ← Host element          │
│    #shadow-root (open)           ← Shadow DOM            │
│      <style>...</style>          ← Isolated CSS          │
│      <div>                       ← Feature content       │
│        [User's HTML here]                                │
│      </div>                                              │
│  </div>                                                  │
└─────────────────────────────────────────────────────────┘
```

## Core API

### FeatureSpec Type

```javascript
type FeatureSpec = {
  id: string;                      // Unique identifier
  selector: string;                // CSS selector for target element
  position: "before" | "after" | "inside";  // Insertion position
  html: string;                    // Widget HTML markup
  css?: string;                    // Optional isolated styles
  js?: string;                     // Optional JS (not yet implemented)
};
```

### Main Functions

#### 1. `mountFeatureWithRetry(spec, options?)`

**Primary function for adding features with automatic retry.**

```javascript
const handle = window.WebEditInjector.mountFeatureWithRetry(spec, {
  timeoutMs: 10000  // Optional: wait up to 10 seconds for selector
});

// Returns MountedFeatureHandle if mounted immediately
// Returns null if will mount asynchronously (when selector appears)
```

**When to use:**
- Adding features where the target element might not exist yet
- SPA pages with dynamic content
- Any time you're not sure if the selector exists

**Behavior:**
1. Tries immediate mount first
2. If selector not found, sets up MutationObserver
3. Waits for selector to appear (up to timeout)
4. Auto-mounts when selector appears
5. Shows error toast if timeout expires

#### 2. `mountFeature(spec, hostDocument?)`

**Direct mount without retry.**

```javascript
const handle = window.WebEditInjector.mountFeature(spec);

if (handle) {
  console.log('Mounted:', handle.id);
  // Access: handle.host, handle.shadowRoot, handle.unmount()
} else {
  console.log('Failed to mount - selector not found or validation failed');
}
```

**When to use:**
- When you know the selector exists
- When you want to handle retry logic yourself
- For testing/debugging

#### 3. `unmountFeature(id)`

**Remove a mounted feature by ID.**

```javascript
window.WebEditInjector.unmountFeature('feature-123-abc');
```

**Behavior:**
- Removes host element from DOM
- Cleans up internal references
- Safe to call even if feature isn't mounted

#### 4. `updateFeature(spec)`

**Update an existing feature with new spec.**

```javascript
window.WebEditInjector.updateFeature({
  id: 'feature-123-abc',
  selector: '.container',
  position: 'after',
  html: '<div>Updated content</div>',
  css: 'div { color: blue; }'
});
```

**Behavior:**
- Unmounts existing feature if present
- Remounts with new spec
- Atomic operation - old feature removed before new one added

#### 5. `validateFeatureSpec(spec)`

**Validate a spec before mounting.**

```javascript
const validation = window.WebEditInjector.validateFeatureSpec(spec);

if (validation.ok) {
  // Safe to mount
} else {
  console.error('Invalid spec:', validation.reason);
}
```

**Validation checks:**
- ✅ Required fields present (id, selector, position, html)
- ✅ Selector is not empty or wildcard (`*`)
- ✅ HTML size under 20 KB
- ✅ CSS size under 10 KB (if provided)
- ✅ Position is one of: "before", "after", "inside"

#### 6. `showInjectionError(message)`

**Show error toast to user.**

```javascript
window.WebEditInjector.showInjectionError('Custom error message');
```

**Behavior:**
- Shows red gradient toast in top-right corner
- Auto-dismisses after 5 seconds
- Slide-in/slide-out animations

### Query Functions

```javascript
// Check if feature is mounted
const isMounted = window.WebEditInjector.isFeatureMounted('feature-123-abc');

// Get feature handle
const handle = window.WebEditInjector.getMountedFeature('feature-123-abc');

// Get all mounted feature IDs
const allIds = window.WebEditInjector.getAllMountedFeatureIds();
console.log('Mounted features:', allIds);
```

## How to Use from Add Feature Flow

### Current Integration in contentScript.js

The content script now uses the injector automatically:

```javascript
// 1. User picks element and enters description
// 2. Generate feature spec
const spec = await generateFeatureSpecFromChat({
  userText: "Add a note box here",
  selector: ".container"
});

// 3. Inject feature (automatically uses injector with retry)
await injectFeature(spec);

// 4. Save to storage
await saveAddedFeature(spec);

// That's it! The feature is now:
// - Mounted with Shadow DOM
// - Using retry logic if needed
// - Validated before injection
// - Will show error toast if it fails
```

### Manual Usage Example

If you want to use the injector directly (bypassing the content script helpers):

```javascript
// Create a feature spec
const spec = {
  id: 'my-feature-' + Date.now(),
  selector: 'div.article-content',
  position: 'after',
  html: `
    <div class="note-box">
      <h3>Important Note</h3>
      <p>This is a dynamically added note!</p>
    </div>
  `,
  css: `
    .note-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
      border-radius: 8px;
      margin: 16px 0;
    }
    .note-box h3 {
      margin: 0 0 8px 0;
      font-size: 18px;
    }
    .note-box p {
      margin: 0;
      line-height: 1.6;
    }
  `
};

// Mount with retry (recommended)
window.WebEditInjector.mountFeatureWithRetry(spec);

// Or mount directly (no retry)
const handle = window.WebEditInjector.mountFeature(spec);
if (handle) {
  console.log('Mounted successfully!');
  
  // Later, you can unmount it
  // handle.unmount();
  // or
  // window.WebEditInjector.unmountFeature(spec.id);
}
```

## Shadow DOM Benefits

### Style Isolation

Features are completely isolated from page styles:

```javascript
// Page has this CSS:
// div { color: red; background: yellow; }

// Your feature CSS won't be affected:
const spec = {
  html: '<div class="my-widget">Hello</div>',
  css: 'div { color: blue; }' // ✅ Works as expected, not overridden
};
```

### No Class Name Conflicts

```javascript
// Page has <div class="container">...</div>
// Your feature can safely use the same class name:
const spec = {
  html: '<div class="container">My content</div>',
  css: '.container { padding: 20px; }' // ✅ Only affects your feature
};
```

### Encapsulated Structure

```html
<!-- Page DOM -->
<div class="article">
  <!-- Your feature's host -->
  <div id="webedit-feature-123">
    #shadow-root (open)
      <!-- Completely isolated from page -->
      <style>/* Your CSS */</style>
      <div><!-- Your HTML --></div>
  </div>
</div>
```

## MutationObserver Retry Logic

### Problem it Solves

Many modern websites load content dynamically:
- SPAs (React, Vue, Angular)
- Lazy-loaded sections
- Infinite scroll
- Modal dialogs

The selector might not exist when the feature is first added.

### How it Works

```javascript
// 1. Try immediate mount
const handle = mountFeature(spec);
if (handle) return handle; // ✅ Success

// 2. Selector not found - set up observer
const observer = new MutationObserver(() => {
  const target = document.querySelector(spec.selector);
  if (target) {
    // ✅ Found it! Mount now
    mountFeature(spec);
    observer.disconnect();
  }
});

// 3. Watch for DOM changes
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// 4. Set timeout
setTimeout(() => {
  observer.disconnect();
  showInjectionError('Element not found: ' + spec.selector);
}, 10000); // Default: 10 seconds
```

### Configuration

```javascript
// Default timeout: 10 seconds
mountFeatureWithRetry(spec);

// Custom timeout: 30 seconds
mountFeatureWithRetry(spec, { timeoutMs: 30000 });

// Access config
console.log(window.WebEditInjector.CONFIG);
// {
//   MAX_HTML_SIZE: 20480,    // 20 KB
//   MAX_CSS_SIZE: 10240,     // 10 KB
//   RETRY_TIMEOUT_MS: 10000, // 10 seconds
//   OBSERVER_DEBOUNCE_MS: 100 // 100 ms
// }
```

## Safety Validation

### What's Checked

```javascript
// ❌ FAILS validation
{
  id: '',                    // Empty id
  selector: '*',             // Wildcard selector
  position: 'middle',        // Invalid position
  html: '<script>...</script>'.repeat(10000), // Too large (>20 KB)
  css: 'body { ... }'.repeat(5000)  // Too large (>10 KB)
}

// ✅ PASSES validation
{
  id: 'feature-123',
  selector: 'div.content',
  position: 'after',
  html: '<div>Hello world</div>',
  css: 'div { color: blue; }'
}
```

### Manual Validation

```javascript
const spec = { /* ... */ };

const result = window.WebEditInjector.validateFeatureSpec(spec);

if (!result.ok) {
  console.error('Validation failed:', result.reason);
  // Reasons include:
  // - "Feature spec must have a valid selector string"
  // - "Selector cannot be empty or wildcard (*)"
  // - "HTML content is too large (max 20 KB)"
  // - "Position must be 'before', 'after', or 'inside'"
  // etc.
}
```

## Error UI

### Toast Appearance

```
┌────────────────────────────────────────┐
│  ⚠️ Could not add feature: Element    │
│     "#missing-selector" not found     │
│     on page                            │
└────────────────────────────────────────┘
```

**Styling:**
- Red gradient background (#ef4444 → #dc2626)
- Top-right corner, below exit button (if present)
- Auto-dismiss after 5 seconds
- Slide-in/out animations
- Warning emoji icon

### When Errors Are Shown

1. **Validation fails**
   - Invalid selector
   - Content too large
   - Missing required fields

2. **Selector timeout**
   - Element not found after 10 seconds (default)
   - MutationObserver gives up

3. **Unexpected errors**
   - DOM exceptions
   - JavaScript errors during mount

### Custom Error Messages

```javascript
// Show custom error
window.WebEditInjector.showInjectionError('Custom error message here');

// From content script
showNotification('User-friendly message', 'error'); // Still works
```

## Migration from Old Format

The injector automatically migrates old features:

```javascript
// Old format (before Shadow DOM)
{
  id: 'feature-123',
  selector: '.container',
  position: 'after',
  content: 'Simple text content'  // ← Old format
}

// Automatically converted to:
{
  id: 'feature-123',
  selector: '.container',
  position: 'after',
  html: '<div class="feature-content">...✨ Simple text content...</div>',
  css: '/* Gradient styling */'
}
```

**Migration happens automatically:**
- On page load during `restoreAddedFeatures()`
- Old features still work
- New features use Shadow DOM
- No user action required

## Testing Checklist

### Basic Functionality
- [x] Mount feature with valid spec → appears on page
- [x] Unmount feature → disappears from page
- [x] Update feature → old removed, new appears
- [x] Mount with retry → waits for selector

### Shadow DOM
- [x] Feature styles don't affect page
- [x] Page styles don't affect feature
- [x] Class name conflicts avoided
- [x] DOM structure isolated

### Validation
- [x] Empty selector rejected
- [x] Wildcard selector rejected
- [x] Oversized HTML rejected
- [x] Oversized CSS rejected
- [x] Invalid position rejected

### Error UI
- [x] Toast appears on validation error
- [x] Toast appears on timeout
- [x] Toast auto-dismisses
- [x] Multiple toasts stack correctly

### Retry Logic
- [x] Immediate mount when selector exists
- [x] Observer waits when selector missing
- [x] Mounts when selector appears
- [x] Timeout triggers error after 10s

### Integration
- [x] Old Remove/Customize still work
- [x] Auth still works
- [x] Pick Element still works
- [x] Old features migrate automatically

## Console Logging

All injector operations log with `[WebEdit Injector]` prefix:

```javascript
// Success
[WebEdit Injector] Mounting feature: feature-123-abc
[WebEdit Injector] ✅ Feature mounted successfully: feature-123-abc

// Retry
[WebEdit Injector] Target not found, setting up observer retry
[WebEdit Injector] Observer set up, waiting up to 10000ms for: .lazy-content
[WebEdit Injector] ✅ Feature mounted after retry: feature-123-abc

// Error
[WebEdit Injector] Error: Cannot add feature: Selector cannot be empty or wildcard (*)
[WebEdit Injector] ❌ Timeout waiting for selector: .never-appears

// Unmount
[WebEdit Injector] Unmounting feature: feature-123-abc
[WebEdit Injector] ✅ Feature unmounted successfully: feature-123-abc
```

## Future Enhancements

### Planned Features

1. **JavaScript Execution** (spec.js)
   ```javascript
   const spec = {
     html: '<button id="my-btn">Click me</button>',
     js: 'document.getElementById("my-btn").onclick = () => alert("Hello!");'
   };
   ```

2. **Feature Templates**
   ```javascript
   const spec = window.WebEditInjector.createFromTemplate('note-box', {
     title: 'Important',
     content: 'Read this!'
   });
   ```

3. **Animation Support**
   ```javascript
   const spec = {
     html: '<div class="animated">...</div>',
     css: '/* animations */',
     animation: { entrance: 'fade-in', exit: 'slide-out' }
   };
   ```

4. **Feature Interactions**
   ```javascript
   // Allow features to communicate
   window.WebEditInjector.on('feature-clicked', (featureId) => {
     console.log('User clicked:', featureId);
   });
   ```

## Troubleshooting

### Feature not appearing?

1. **Check console for errors**
   - Look for `[WebEdit Injector]` messages
   - Check validation errors

2. **Verify selector**
   ```javascript
   // Test in console
   document.querySelector(spec.selector); // Should return element
   ```

3. **Check timeout**
   ```javascript
   // Increase timeout for slow-loading content
   mountFeatureWithRetry(spec, { timeoutMs: 30000 });
   ```

### Styles not working?

1. **Check Shadow DOM isolation**
   - Page styles won't affect your feature
   - Need to include all styles in `spec.css`

2. **Include base styles**
   ```javascript
   const css = `
     /* Reset inherited styles */
     * { margin: 0; padding: 0; box-sizing: border-box; }
     
     /* Your styles */
     .my-widget { color: blue; }
   `;
   ```

### Feature disappears on page navigation?

1. **SPA navigation**
   - Features are removed when DOM changes
   - Restore features on SPA route changes
   - Consider watching history API

2. **Use storage**
   ```javascript
   // Save to storage
   await saveAddedFeature(spec);
   
   // Restore on init
   await restoreAddedFeatures();
   ```

## Summary

The upgraded injector provides:

✅ **Shadow DOM** - Isolated, encapsulated features
✅ **Retry logic** - Handles dynamic content automatically  
✅ **Validation** - Prevents invalid/dangerous injections
✅ **Error UI** - User-friendly error messages
✅ **Clean API** - Easy to use, well-documented
✅ **Migration** - Backward compatible with old features
✅ **No breaking changes** - Remove/Customize still work

**To use it:**

```javascript
// Simple case
const spec = {
  id: 'my-feature-' + Date.now(),
  selector: '.target',
  position: 'after',
  html: '<div>Content</div>',
  css: 'div { color: blue; }'
};

window.WebEditInjector.mountFeatureWithRetry(spec);
```

That's it! The injector handles all the complexity for you. 🎉

