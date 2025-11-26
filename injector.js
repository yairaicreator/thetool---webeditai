// WebEdit AI - Feature Injector Module
// Handles mounting, unmounting, and updating dynamically added features using Shadow DOM

console.log('📦 injector.js: Loading...');

/**
 * FeatureSpec Type Definition
 * @typedef {Object} FeatureSpec
 * @property {string} id - Unique identifier for this feature
 * @property {string} selector - CSS selector where to attach the feature
 * @property {string} position - Position relative to target: "before" | "after" | "inside"
 * @property {string} html - Widget markup (HTML content)
 * @property {string} [css] - Optional styles for the feature
 * @property {string} [js] - Optional JavaScript behavior (for future use)
 */

/**
 * MountedFeatureHandle Type Definition
 * @typedef {Object} MountedFeatureHandle
 * @property {string} id - Feature ID
 * @property {HTMLElement} host - Host element containing the shadow root
 * @property {ShadowRoot} shadowRoot - The shadow root instance
 * @property {function} unmount - Function to remove the feature from DOM
 */

// In-memory map of mounted features: id -> MountedFeatureHandle
const mountedFeatures = new Map();

// Configuration
const CONFIG = {
  MAX_HTML_SIZE: 20 * 1024, // 20 KB
  MAX_CSS_SIZE: 10 * 1024,  // 10 KB
  RETRY_TIMEOUT_MS: 10000,  // 10 seconds
  OBSERVER_DEBOUNCE_MS: 100 // Debounce observer checks
};

// ============================================
// STEP 4: Validation
// ============================================

/**
 * Validate a FeatureSpec before injection
 * @param {FeatureSpec} spec - The feature specification to validate
 * @returns {{ok: true} | {ok: false, reason: string}} Validation result
 */
function validateFeatureSpec(spec) {
  // Check required fields
  if (!spec || typeof spec !== 'object') {
    return { ok: false, reason: 'Feature spec must be an object' };
  }
  
  if (!spec.id || typeof spec.id !== 'string') {
    return { ok: false, reason: 'Feature spec must have a valid id string' };
  }
  
  if (!spec.selector || typeof spec.selector !== 'string') {
    return { ok: false, reason: 'Feature spec must have a valid selector string' };
  }
  
  // Safety check: prevent dangerous selectors
  const trimmedSelector = spec.selector.trim();
  if (trimmedSelector === '' || trimmedSelector === '*') {
    return { ok: false, reason: 'Selector cannot be empty or wildcard (*)' };
  }
  
  // Check position
  if (!spec.position || !['before', 'after', 'inside'].includes(spec.position)) {
    return { ok: false, reason: 'Position must be "before", "after", or "inside"' };
  }
  
  // Check html content
  if (!spec.html || typeof spec.html !== 'string') {
    return { ok: false, reason: 'Feature spec must have valid html string' };
  }
  
  if (spec.html.length > CONFIG.MAX_HTML_SIZE) {
    return { ok: false, reason: `HTML content is too large (max ${CONFIG.MAX_HTML_SIZE / 1024} KB)` };
  }
  
  // Check optional css
  if (spec.css && typeof spec.css !== 'string') {
    return { ok: false, reason: 'CSS must be a string if provided' };
  }
  
  if (spec.css && spec.css.length > CONFIG.MAX_CSS_SIZE) {
    return { ok: false, reason: `CSS content is too large (max ${CONFIG.MAX_CSS_SIZE / 1024} KB)` };
  }
  
  // All checks passed
  return { ok: true };
}

// ============================================
// STEP 5: Error UI
// ============================================

let toastContainer = null;

/**
 * Initialize the global toast container for error messages
 */
function initToastContainer() {
  if (toastContainer) return;
  
  toastContainer = document.createElement('div');
  toastContainer.id = 'webedit-toast-root';
  toastContainer.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    z-index: 2147483645;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 400px;
    pointer-events: none;
  `;
  
  document.body.appendChild(toastContainer);
  console.log('✅ Toast container initialized');
}

/**
 * Show an error message to the user via toast notification
 * @param {string} message - Error message to display
 */
function showInjectionError(message) {
  console.error('[WebEdit Injector] Error:', message);
  
  // Ensure toast container exists
  initToastContainer();
  
  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'webedit-error-toast';
  toast.style.cssText = `
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    pointer-events: auto;
    animation: webeditSlideIn 0.3s ease-out;
    border-left: 4px solid rgba(255, 255, 255, 0.5);
    max-width: 100%;
    word-wrap: break-word;
  `;
  
  // Add icon and message
  const content = document.createElement('div');
  content.style.cssText = 'display: flex; align-items: flex-start; gap: 8px;';
  
  const icon = document.createElement('span');
  icon.textContent = '⚠️';
  icon.style.cssText = 'font-size: 18px; flex-shrink: 0;';
  
  const text = document.createElement('div');
  text.textContent = message;
  text.style.cssText = 'flex: 1;';
  
  content.appendChild(icon);
  content.appendChild(text);
  toast.appendChild(content);
  
  // Add animation keyframes if not already added
  if (!document.getElementById('webedit-toast-animations')) {
    const style = document.createElement('style');
    style.id = 'webedit-toast-animations';
    style.textContent = `
      @keyframes webeditSlideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes webeditSlideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  // Append toast to container
  toastContainer.appendChild(toast);
  
  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'webeditSlideOut 0.3s ease-out';
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, 300);
  }, 5000);
}

// ============================================
// STEP 1: Shadow DOM Mount
// ============================================

/**
 * Mount a feature into the page using Shadow DOM
 * @param {FeatureSpec} spec - Feature specification
 * @param {Document} [hostDocument=document] - Document to inject into
 * @returns {MountedFeatureHandle | null} Handle to the mounted feature, or null on failure
 */
function mountFeature(spec, hostDocument = document) {
  console.log('[WebEdit Injector] Mounting feature:', spec.id);
  
  try {
    // Validate spec first (STEP 4)
    const validation = validateFeatureSpec(spec);
    if (!validation.ok) {
      showInjectionError(`Cannot add feature: ${validation.reason}`);
      return null;
    }
    
    // Find the target element
    const targetEl = hostDocument.querySelector(spec.selector);
    
    if (!targetEl) {
      console.warn(`[WebEdit Injector] Target element not found: ${spec.selector}`);
      return null; // Caller should use retry logic
    }
    
    // Check if feature is already mounted
    if (mountedFeatures.has(spec.id)) {
      console.warn(`[WebEdit Injector] Feature ${spec.id} is already mounted, unmounting first`);
      unmountFeature(spec.id);
    }
    
    // Create host element with stable ID
    const host = hostDocument.createElement('div');
    host.id = `webedit-feature-${spec.id}`;
    host.className = 'webedit-feature-host';
    host.setAttribute('data-webedit-feature-id', spec.id);
    
    // Attach Shadow DOM (mode: 'open' for debugging)
    const shadowRoot = host.attachShadow({ mode: 'open' });
    
    // Create container inside shadow root
    const container = hostDocument.createElement('div');
    container.className = 'webedit-feature-container';
    
    // Inject CSS if provided
    if (spec.css) {
      const style = hostDocument.createElement('style');
      style.textContent = spec.css;
      shadowRoot.appendChild(style);
    }
    
    // Add default base styles to prevent inheritance issues
    const baseStyle = hostDocument.createElement('style');
    baseStyle.textContent = `
      :host {
        display: block;
        box-sizing: border-box;
      }
      .webedit-feature-container {
        all: initial;
        display: block;
        box-sizing: border-box;
      }
      .webedit-feature-container * {
        box-sizing: border-box;
      }
    `;
    shadowRoot.appendChild(baseStyle);
    
    // Inject HTML content
    container.innerHTML = spec.html;
    shadowRoot.appendChild(container);
    
    // Attach event listeners for button features (security: use data attributes instead of onclick)
    const button = container.querySelector('.webedit-feature-button');
    if (button) {
      const featureName = button.getAttribute('data-feature-name') || '';
      const featureContent = button.getAttribute('data-feature-content') || '';
      button.addEventListener('click', () => {
        alert(featureName + ': ' + featureContent);
      });
    }
    
    // Insert host into DOM based on position
    switch (spec.position) {
      case 'before':
        targetEl.parentElement.insertBefore(host, targetEl);
        break;
      
      case 'inside':
        targetEl.insertBefore(host, targetEl.firstChild);
        break;
      
      case 'after':
      default:
        if (targetEl.nextSibling) {
          targetEl.parentElement.insertBefore(host, targetEl.nextSibling);
        } else {
          targetEl.parentElement.appendChild(host);
        }
        break;
    }
    
    // Create handle for this mounted feature
    const handle = {
      id: spec.id,
      host: host,
      shadowRoot: shadowRoot,
      unmount: () => unmountFeature(spec.id)
    };
    
    // Store in map
    mountedFeatures.set(spec.id, handle);
    
    console.log(`[WebEdit Injector] ✅ Feature mounted successfully: ${spec.id}`);
    return handle;
    
  } catch (error) {
    console.error('[WebEdit Injector] ❌ Error mounting feature:', error);
    showInjectionError(`Failed to add feature: ${error.message}`);
    return null;
  }
}

// ============================================
// STEP 2: Unmount & Update Helpers
// ============================================

/**
 * Unmount a feature by ID
 * @param {string} id - Feature ID to unmount
 */
function unmountFeature(id) {
  console.log('[WebEdit Injector] Unmounting feature:', id);
  
  const handle = mountedFeatures.get(id);
  
  if (!handle) {
    console.warn(`[WebEdit Injector] Feature ${id} is not mounted`);
    return;
  }
  
  try {
    // Remove host element from DOM
    if (handle.host && handle.host.parentElement) {
      handle.host.remove();
    }
    
    // Remove from map
    mountedFeatures.delete(id);
    
    console.log(`[WebEdit Injector] ✅ Feature unmounted successfully: ${id}`);
    
  } catch (error) {
    console.error('[WebEdit Injector] ❌ Error unmounting feature:', error);
    // Still remove from map even if there was an error
    mountedFeatures.delete(id);
  }
}

/**
 * Update a feature with new spec
 * @param {FeatureSpec} spec - Updated feature specification
 * @returns {MountedFeatureHandle | null} Handle to the remounted feature
 */
function updateFeature(spec) {
  console.log('[WebEdit Injector] Updating feature:', spec.id);
  
  // Unmount existing feature if present
  if (mountedFeatures.has(spec.id)) {
    unmountFeature(spec.id);
  }
  
  // Remount with new spec
  return mountFeature(spec);
}

// ============================================
// STEP 3: MutationObserver Retry Logic
// ============================================

/**
 * Mount a feature with retry logic using MutationObserver
 * Waits for the target selector to appear in the DOM if not immediately available
 * @param {FeatureSpec} spec - Feature specification
 * @param {Object} [options] - Options
 * @param {number} [options.timeoutMs=10000] - Timeout in milliseconds
 * @returns {MountedFeatureHandle | null} Handle to mounted feature, or null if failed
 */
function mountFeatureWithRetry(spec, options = {}) {
  const timeoutMs = options.timeoutMs || CONFIG.RETRY_TIMEOUT_MS;
  
  console.log(`[WebEdit Injector] Mounting feature with retry: ${spec.id}`);
  
  // Try immediate mount first
  const immediateResult = mountFeature(spec);
  if (immediateResult) {
    console.log(`[WebEdit Injector] ✅ Feature mounted immediately: ${spec.id}`);
    return immediateResult;
  }
  
  // If immediate mount failed, set up retry with MutationObserver
  console.log(`[WebEdit Injector] Target not found, setting up observer retry for: ${spec.id}`);
  
  let observer = null;
  let timeoutId = null;
  let debounceTimeout = null;
  
  // Cleanup function
  const cleanup = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }
  };
  
  // Set up timeout
  timeoutId = setTimeout(() => {
    cleanup();
    console.error(`[WebEdit Injector] ❌ Timeout waiting for selector: ${spec.selector}`);
    showInjectionError(`Could not add feature: Element "${spec.selector}" not found on page`);
  }, timeoutMs);
  
  // Debounced check function
  const tryMount = () => {
    // Clear previous debounce
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    
    // Debounce the actual mount attempt
    debounceTimeout = setTimeout(() => {
      const result = mountFeature(spec);
      if (result) {
        console.log(`[WebEdit Injector] ✅ Feature mounted after retry: ${spec.id}`);
        cleanup();
      }
    }, CONFIG.OBSERVER_DEBOUNCE_MS);
  };
  
  // Set up MutationObserver
  observer = new MutationObserver((mutations) => {
    // Check if our selector now exists
    const targetExists = document.querySelector(spec.selector);
    if (targetExists) {
      tryMount();
    }
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log(`[WebEdit Injector] Observer set up, waiting up to ${timeoutMs}ms for: ${spec.selector}`);
  
  // Return null for now - the feature will be mounted asynchronously
  // Caller should check mountedFeatures.get(spec.id) later if needed
  return null;
}

/**
 * Get a mounted feature handle by ID
 * @param {string} id - Feature ID
 * @returns {MountedFeatureHandle | undefined} The feature handle, or undefined if not mounted
 */
function getMountedFeature(id) {
  return mountedFeatures.get(id);
}

/**
 * Get all mounted feature IDs
 * @returns {string[]} Array of mounted feature IDs
 */
function getAllMountedFeatureIds() {
  return Array.from(mountedFeatures.keys());
}

/**
 * Check if a feature is currently mounted
 * @param {string} id - Feature ID
 * @returns {boolean} True if mounted
 */
function isFeatureMounted(id) {
  return mountedFeatures.has(id);
}

// ============================================
// Export API
// ============================================

// Export the injector API to window for use by content script
if (typeof window !== 'undefined') {
  window.WebEditInjector = {
    // Core functions
    mountFeature,
    unmountFeature,
    updateFeature,
    mountFeatureWithRetry,
    
    // Helper functions
    validateFeatureSpec,
    showInjectionError,
    
    // Query functions
    getMountedFeature,
    getAllMountedFeatureIds,
    isFeatureMounted,
    
    // Configuration (read-only)
    CONFIG: Object.freeze({ ...CONFIG })
  };
  
  console.log('✅ WebEditInjector initialized and exported to window.WebEditInjector');
} else {
  console.warn('⚠️ window is not available - WebEditInjector cannot be exported');
}

