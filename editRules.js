// WebEdit AI - Edit Rules Persistence Module
// Manages persistent edit rules for DOM modifications across page loads

console.log('📦 editRules.js: Starting to load...');

// Track which authenticated user is allowed to read/write local rules
let activeUserId = null;

function cssEscape(value) {
  if (!value) {
    return '';
  }
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => {
    const hex = char.codePointAt(0).toString(16).padStart(2, '0');
    return `\\${hex} `;
  });
}

function setActiveUserContext(user) {
  activeUserId = user?.id || null;
  if (!activeUserId) {
    console.log('ℹ️ EditRules: Cleared active user context');
  } else {
    console.log('ℹ️ EditRules: Active user set', activeUserId);
  }
}

function getActiveUserId() {
  return activeUserId;
}

/**
 * EditRule Type Definition
 * @typedef {Object} EditRule
 * @property {string} id - Unique identifier for the rule
 * @property {string} pageKey - Page identifier (hostname + pathname)
 * @property {string} selector - CSS selector for the target element
 * @property {string} action - Type of edit action ("hide", "remove", "style", etc.)
 * @property {Object} [metadata] - Additional metadata (e.g., style values, element description)
 * @property {number} createdAt - Timestamp when rule was created
 * @property {boolean} active - Whether the rule is currently active
 * @property {string} [userId] - User ID if authenticated (for Supabase sync)
 */

/**
 * Generate a unique page key from current URL
 * @returns {string} Page key in format "hostname:pathname"
 */
function getPageKey() {
  const { hostname, pathname } = window.location;
  return `${hostname}${pathname}`;
}

/**
 * Generate a unique rule ID
 * @returns {string} Unique rule ID
 */
function generateRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a CSS selector for an element
 * Tries to create the most specific selector possible
 * @param {HTMLElement} element - The target element
 * @returns {string} CSS selector
 */
function generateSelector(element) {
  // Try ID first (most specific)
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  // Try unique class combination
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-'));
    if (classes.length > 0) {
      const safeClasses = classes.map(cssEscape);
      const classSelector = element.tagName.toLowerCase() + '.' + safeClasses.join('.');
      // Check if this selector is unique
      if (document.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }
    }
  }

  // Build path from body
  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${cssEscape(current.id)}`;
      path.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-'));
      if (classes.length > 0) {
        const safeClasses = classes.slice(0, 2).map(cssEscape);
        selector += '.' + safeClasses.join('.');
      }
    }

    // Add nth-child if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        el => el.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = parent;
  }

  return path.join(' > ');
}

/**
 * Generate a human-readable description of an element
 * @param {HTMLElement} element - The target element
 * @returns {string} Human-readable description
 */
function generateElementDescription(element) {
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = element.className && typeof element.className === 'string'
    ? '.' + element.className.trim().split(/\s+/).filter(c => c && !c.startsWith('webedit-')).join('.')
    : '';

  let description = tagName + id + classes;

  // Add text content if short enough
  const text = element.textContent?.trim() || '';
  if (text && text.length < 50) {
    description += ` "${text}"`;
  } else if (text && text.length >= 50) {
    description += ` "${text.substring(0, 47)}..."`;
  }

  // Add href for links
  if (element.tagName === 'A' && element.href) {
    description += ` → ${element.href}`;
  }

  // Add src for images
  if (element.tagName === 'IMG' && element.src) {
    description += ` src="${element.src}"`;
  }

  return description;
}

/**
 * Check if extension context is valid
 * In content scripts, chrome.runtime.id should always exist if we're in extension context
 * This distinguishes between:
 * - Content script context (valid) - chrome.runtime.id exists
 * - Page world context (invalid) - chrome is undefined or chrome.runtime.id doesn't exist
 * - Extension context invalidated (invalid) - chrome exists but APIs throw errors
 * @returns {boolean} True if extension context is available and valid
 */
function isExtensionContextValid() {
  try {
    // In content scripts, chrome should always be defined
    if (typeof chrome === 'undefined') {
      return false; // Running in page world, not extension context
    }

    // chrome.runtime.id is the definitive check - it only exists in extension context
    // If it doesn't exist, we're in page world (not extension context)
    if (!chrome.runtime || typeof chrome.runtime.id === 'undefined') {
      return false; // Not in extension context
    }

    // Check if chrome.storage exists (should always exist in content scripts)
    if (!chrome.storage || !chrome.storage.local) {
      return false; // Storage API not available
    }

    return true; // All checks passed - we're in valid extension context
  } catch (error) {
    // Any error accessing chrome APIs means context is invalidated
    return false;
  }
}

/**
 * Storage Manager - handles chrome.storage.local operations
 */
const StorageManager = {
  STORAGE_KEY: 'webeditRules',

  getStorageKey() {
    const userId = getActiveUserId();
    if (!userId) {
      return null;
    }
    return `${this.STORAGE_KEY}::${userId}`;
  },

  /**
   * Get all rules from storage
   * @returns {Promise<Object>} Object with pageKey as keys, arrays of rules as values
   */
  async getAllRules() {
    return new Promise((resolve) => {
      // Early bailout if extension context is invalid (page world, not extension context)
      if (!isExtensionContextValid()) {
        // Not in extension context - silently resolve with empty object
        // This is normal if running in page world, not an error
        resolve({});
        return;
      }

      const storageKey = this.getStorageKey();
      if (!storageKey) {
        resolve({});
        return;
      }

      try {
        chrome.storage.local.get([storageKey, this.STORAGE_KEY], (result) => {
          // Check for errors AFTER the callback
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);

            // Only treat "Extension context invalidated" as a real error
            // Other errors (like quota exceeded) are different issues
            if (errorMsg.includes('Extension context invalidated') ||
              errorMsg.includes('context invalidated')) {
              // Context was invalidated AFTER we checked - this is a real error
              // Log once, then resolve empty to prevent spam
              console.warn('⚠️ Extension context invalidated - rules cannot be loaded');
              resolve({});
              return;
            } else {
              // Other storage errors (quota, etc.) - log but don't treat as context invalidated
              console.error('❌ Error loading rules:', chrome.runtime.lastError);
              resolve({});
              return;
            }
          }

          let rulesByPage = result[storageKey];

          // Migrate legacy storage (without user scoping) to the new user-scoped key
          if (!rulesByPage && result[this.STORAGE_KEY]) {
            rulesByPage = result[this.STORAGE_KEY];
            chrome.storage.local.set({ [storageKey]: rulesByPage });
            chrome.storage.local.remove(this.STORAGE_KEY);
            console.log('🔄 Migrated legacy rules store to user-scoped key');
          }

          // Success - return the rules
          resolve(rulesByPage || {});
        });
      } catch (error) {
        // Synchronous errors (shouldn't happen in content scripts, but handle gracefully)
        const errorMsg = error.message || String(error);
        if (errorMsg.includes('Extension context invalidated') ||
          errorMsg.includes('context invalidated')) {
          // Context invalidated - log once
          console.warn('⚠️ Extension context invalidated - rules cannot be loaded');
        } else {
          // Other errors
          console.error('❌ Error accessing storage:', error);
        }
        resolve({}); // Resolve with empty object instead of rejecting
      }
    });
  },

  /**
   * Get rules for a specific page
   * @param {string} pageKey - The page key
   * @returns {Promise<EditRule[]>} Array of rules for the page
   */
  async getRulesForPage(pageKey) {
    const allRules = await this.getAllRules();
    return allRules[pageKey] || [];
  },

  /**
   * Save a new rule
   * @param {EditRule} rule - The rule to save
   * @returns {Promise<boolean>} Success status
   */
  async saveRule(rule) {
    try {
      const storageKey = this.getStorageKey();
      if (!storageKey) {
        console.warn('⚠️ No active user - skipping rule save');
        return false;
      }
      const allRules = await this.getAllRules();
      const pageKey = rule.pageKey;

      if (!allRules[pageKey]) {
        allRules[pageKey] = [];
      }

      // Check if rule already exists (by selector and action)
      const existingIndex = allRules[pageKey].findIndex(
        r => r.selector === rule.selector && r.action === rule.action
      );

      if (existingIndex >= 0) {
        // Update existing rule
        allRules[pageKey][existingIndex] = rule;
      } else {
        // Add new rule
        allRules[pageKey].push(rule);
      }

      return new Promise((resolve) => {
        // Early bailout if extension context is invalid (page world, not extension context)
        if (!isExtensionContextValid()) {
          // Not in extension context - can't save
          resolve(false);
          return;
        }

        try {
          chrome.storage.local.set({ [storageKey]: allRules }, () => {
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
              // Only log "Extension context invalidated" as a warning (real error)
              // Other errors are different issues
              if (errorMsg.includes('Extension context invalidated') ||
                errorMsg.includes('context invalidated')) {
                console.warn('⚠️ Extension context invalidated - rule cannot be saved');
              } else {
                console.error('❌ Error saving rule:', chrome.runtime.lastError);
              }
              resolve(false);
              return;
            }
            console.log('✅ Rule saved:', rule.id);
            resolve(true);
          });
        } catch (error) {
          const errorMsg = error.message || String(error);
          if (errorMsg.includes('Extension context invalidated') ||
            errorMsg.includes('context invalidated')) {
            console.warn('⚠️ Extension context invalidated - rule cannot be saved');
          } else {
            console.error('❌ Error accessing storage:', error);
          }
          resolve(false);
        }
      });
    } catch (error) {
      console.error('❌ Error saving rule:', error);
      return false;
    }
  },

  /**
   * Delete a rule by ID
   * @param {string} pageKey - The page key
   * @param {string} ruleId - The rule ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteRule(pageKey, ruleId) {
    try {
      const storageKey = this.getStorageKey();
      if (!storageKey) {
        console.warn('⚠️ No active user - skipping rule delete');
        return false;
      }
      const allRules = await this.getAllRules();

      if (!allRules[pageKey]) {
        return true;
      }

      allRules[pageKey] = allRules[pageKey].filter(r => r.id !== ruleId);

      // Remove page key if no rules left
      if (allRules[pageKey].length === 0) {
        delete allRules[pageKey];
      }

      return new Promise((resolve) => {
        // Early bailout if extension context is invalid
        if (!isExtensionContextValid()) {
          resolve(false);
          return;
        }

        try {
          chrome.storage.local.set({ [storageKey]: allRules }, () => {
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
              if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('context invalidated')) {
                console.warn('⚠️ Extension context invalidated - rule cannot be deleted');
              } else {
                console.error('❌ Error deleting rule:', chrome.runtime.lastError);
              }
              resolve(false);
              return;
            }
            console.log('✅ Rule deleted:', ruleId);
            resolve(true);
          });
        } catch (error) {
          const errorMsg = error.message || String(error);
          if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('context invalidated')) {
            console.warn('⚠️ Extension context invalidated - rule cannot be deleted');
          } else {
            console.error('❌ Error accessing storage:', error);
          }
          resolve(false);
        }
      });
    } catch (error) {
      console.error('❌ Error deleting rule:', error);
      return false;
    }
  },

  /**
   * Clear all rules for a specific page
   * @param {string} pageKey - The page key
   * @returns {Promise<boolean>} Success status
   */
  async clearPageRules(pageKey) {
    try {
      const storageKey = this.getStorageKey();
      if (!storageKey) {
        console.warn('⚠️ No active user - skipping clearPageRules');
        return false;
      }
      const allRules = await this.getAllRules();
      delete allRules[pageKey];

      return new Promise((resolve) => {
        // Early bailout if extension context is invalid
        if (!isExtensionContextValid()) {
          resolve(false);
          return;
        }

        try {
          chrome.storage.local.set({ [storageKey]: allRules }, () => {
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
              if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('context invalidated')) {
                console.warn('⚠️ Extension context invalidated - rules cannot be cleared');
              } else {
                console.error('❌ Error clearing rules:', chrome.runtime.lastError);
              }
              resolve(false);
              return;
            }
            console.log('✅ Rules cleared for page:', pageKey);
            resolve(true);
          });
        } catch (error) {
          const errorMsg = error.message || String(error);
          if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('context invalidated')) {
            console.warn('⚠️ Extension context invalidated - rules cannot be cleared');
          } else {
            console.error('❌ Error accessing storage:', error);
          }
          resolve(false);
        }
      });
    } catch (error) {
      console.error('❌ Error clearing rules:', error);
      return false;
    }
  }
};

/**
 * Rule Applier - applies rules to the DOM
 */
const RuleApplier = {
  _appliedEffects: new Map(),

  /**
   * Apply a single rule to the DOM
   * @param {EditRule} rule - The rule to apply
   * @returns {number} Number of elements affected
   */
  applyRule(rule) {
    if (!rule.active) return 0;

    try {
      const elements = document.querySelectorAll(rule.selector);

      if (elements.length === 0) {
        console.warn(`⚠️ No elements found for selector: ${rule.selector}`);
        return 0;
      }

      // Reset stored effects for this rule before reapplying
      this._appliedEffects.set(rule.id, []);

      elements.forEach(el => {
        // Skip WebEdit panel elements
        if (el.closest('#webedit-chat-panel')) return;

        const effectRecord = {
          element: el,
          action: rule.action,
          attr: null,
          previousDisplay: null,
          properties: []
        };

        switch (rule.action) {
          case 'hide':
            effectRecord.attr = 'data-webedit-hidden';
            effectRecord.previousDisplay = el.style.getPropertyValue('display') || null;
            el.style.display = 'none';
            el.setAttribute('data-webedit-hidden', rule.id);
            break;

          case 'remove':
            effectRecord.attr = 'data-webedit-removed';
            effectRecord.previousDisplay = el.style.getPropertyValue('display') || null;
            el.style.display = 'none';
            el.setAttribute('data-webedit-removed', rule.id);
            break;

          case 'style':
            if (rule.metadata?.styles) {
              Object.entries(rule.metadata.styles).forEach(([prop, value]) => {
                // Convert camelCase to kebab-case for CSS properties
                const cssProperty = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
                const previousValue = el.style.getPropertyValue(cssProperty) || null;
                const previousPriority = el.style.getPropertyPriority(cssProperty) || '';
                effectRecord.properties.push({
                  name: cssProperty,
                  previousValue,
                  previousPriority
                });
                // Apply with !important to ensure styles override existing ones
                el.style.setProperty(cssProperty, value, 'important');
              });
              effectRecord.attr = 'data-webedit-styled';
              el.setAttribute('data-webedit-styled', rule.id);
            }
            break;

          default:
            console.warn(`⚠️ Unknown action: ${rule.action}`);
        }

        const storedEffects = this._appliedEffects.get(rule.id) || [];
        storedEffects.push(effectRecord);
        this._appliedEffects.set(rule.id, storedEffects);
      });

      console.log(`✅ Applied rule ${rule.id} to ${elements.length} element(s)`);
      return elements.length;

    } catch (error) {
      console.error(`❌ Error applying rule ${rule.id}:`, error);
      return 0;
    }
  },

  /**
   * Apply all rules for the current page
   * @returns {Promise<number>} Total number of elements affected
   */
  async applyAllRulesForCurrentPage(suppressNoRulesLog = false) {
    // Early bailout if extension context is invalid (page world, not extension context)
    if (!isExtensionContextValid()) {
      // Not in extension context - can't apply rules
      // This is normal if running in page world, not an error
      return 0;
    }

    if (!getActiveUserId()) {
      if (!suppressNoRulesLog) {
        console.log('ℹ️ No authenticated user - skipping rule application');
      }
      return 0;
    }

    try {
      const pageKey = getPageKey();
      const rules = await StorageManager.getRulesForPage(pageKey);

      if (!rules || rules.length === 0) {
        // Only log if not suppressed (to reduce noise from mutation observer)
        if (!suppressNoRulesLog) {
          console.log('ℹ️ No rules to apply for this page');
        }
        return 0;
      }

      console.log(`📋 Applying ${rules.length} rule(s) for page: ${pageKey}`);

      let totalAffected = 0;
      rules.forEach(rule => {
        totalAffected += this.applyRule(rule);
      });

      return totalAffected;
    } catch (error) {
      // Handle errors
      const errorMsg = error.message || String(error);
      if (errorMsg.includes('Extension context invalidated') ||
        errorMsg.includes('context invalidated')) {
        // Context invalidated - log once, then return
        console.warn('⚠️ Extension context invalidated - cannot apply rules');
        return 0;
      } else {
        console.error('❌ Error applying rules:', error);
      }
      return 0; // Return 0 instead of throwing
    }
  },

  /**
   * Reapply rules (useful after DOM changes)
   * @param {number} debounceMs - Debounce delay in milliseconds
   * @param {boolean} suppressNoRulesLog - If true, suppress "No rules to apply" log
   */
  reapplyWithDebounce(debounceMs = 100, suppressNoRulesLog = true) {
    // Early bailout if extension context is invalid (page world, not extension context)
    if (!isExtensionContextValid()) {
      // Not in extension context - can't reapply
      // This is normal if running in page world, not an error
      return;
    }

    if (!getActiveUserId()) {
      return;
    }

    if (this._reapplyTimeout) {
      clearTimeout(this._reapplyTimeout);
    }

    this._reapplyTimeout = setTimeout(() => {
      // Check again before applying (context might have been invalidated during debounce)
      if (!isExtensionContextValid()) {
        return;
      }

      // Catch any promise rejections to prevent uncaught errors
      this.applyAllRulesForCurrentPage(suppressNoRulesLog).catch((error) => {
        // Handle errors - only log non-context-invalidated errors
        const errorMsg = error.message || String(error);
        if (!errorMsg.includes('Extension context invalidated') &&
          !errorMsg.includes('context invalidated')) {
          console.error('❌ Unhandled error in reapplyWithDebounce:', error);
        }
      });
    }, debounceMs);
  },

  /**
   * Clear all applied rule effects from the DOM (used on logout/user switch)
   */
  clearAppliedEffects() {
    this._appliedEffects.forEach((effects, ruleId) => {
      effects.forEach(effect => {
        try {
          if (!effect || !effect.element) {
            return;
          }

          if (effect.action === 'hide' || effect.action === 'remove') {
            if (effect.previousDisplay && effect.previousDisplay.length > 0) {
              effect.element.style.setProperty('display', effect.previousDisplay);
            } else {
              effect.element.style.removeProperty('display');
            }
          } else if (effect.action === 'style' && Array.isArray(effect.properties)) {
            effect.properties.forEach(prop => {
              if (!prop || !prop.name) {
                return;
              }
              if (prop.previousValue && prop.previousValue.length > 0) {
                effect.element.style.setProperty(prop.name, prop.previousValue, prop.previousPriority || '');
              } else {
                effect.element.style.removeProperty(prop.name);
              }
            });
          }

          if (effect.attr) {
            effect.element.removeAttribute(effect.attr);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to clear applied effect for rule ${ruleId}:`, error);
        }
      });
    });

    if (this._appliedEffects.size > 0) {
      console.log(`🧹 Cleared applied DOM effects for ${this._appliedEffects.size} rule(s)`);
    }
    this._appliedEffects.clear();
  }
};

/**
 * Supabase Sync Manager - syncs rules to Supabase for authenticated users
 */
const SupabaseSyncManager = {
  /**
   * Get the auth token for the current user
   * @returns {Promise<string|null>} Auth token or null
   */
  async getAuthToken() {
    return new Promise((resolve) => {
      // Early bailout if extension context is invalid
      if (!isExtensionContextValid()) {
        resolve(null);
        return;
      }

      try {
        chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
            if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('context invalidated')) {
              console.warn('⚠️ Extension context invalidated - cannot get auth token');
            } else {
              console.error('❌ Error getting auth token:', chrome.runtime.lastError);
            }
            resolve(null);
            return;
          }
          const session = result.webeditSupabaseSession;
          if (session && session.access_token) {
            resolve(session.access_token);
          } else {
            resolve(null);
          }
        });
      } catch (error) {
        const errorMsg = error.message || String(error);
        if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('context invalidated')) {
          console.warn('⚠️ Extension context invalidated - cannot get auth token');
        } else {
          console.error('❌ Error accessing storage:', error);
        }
        resolve(null);
      }
    });
  },

  getSupabaseUrl() {
    return window.SupabaseClient ? window.SupabaseClient.url : "https://eqfjkvjwsswjxkmomxax.supabase.co";
  },

  getSupabaseKey() {
    return window.SupabaseClient ? window.SupabaseClient.anonKey : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZmprdmp3c3N3anhrbW9teGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMTU1MDYsImV4cCI6MjA3MTY5MTUwNn0.sh5d5Hj5hshIOndyAodK_rlP0K1pERYyWyNqNxp-E7k";
  },

  /**
   * Sync a rule to Supabase
   * @param {EditRule} rule - The rule to sync
   * @param {Object} user - The authenticated user
   * @returns {Promise<boolean>} Success status
   */
  async syncRule(rule, user) {
    if (!user || !user.id) {
      console.log('ℹ️ No user authenticated, skipping Supabase sync');
      return false;
    }

    try {
      const token = await this.getAuthToken();
      if (!token) {
        console.log('ℹ️ No auth token available, skipping Supabase sync');
        return false;
      }

      // Prepare rule data for Supabase
      const ruleData = {
        id: rule.id,
        user_id: user.id,
        page_key: rule.pageKey,
        selector: rule.selector,
        action: rule.action,
        metadata: rule.metadata || {},
        active: rule.active,
        created_at: new Date(rule.createdAt).toISOString()
      };

      console.log('🔄 Syncing rule to Supabase:', rule.id);

      // Make REST API call to Supabase
      const response = await fetch(`${this.getSupabaseUrl()}/rest/v1/edit_rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.getSupabaseKey(),
          'Authorization': `Bearer ${token}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(ruleData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        // Handle 404 (table doesn't exist) or PGRST205 (schema cache issue) gracefully
        if (response.status === 404 || (errorData && errorData.code === 'PGRST205')) {
          console.log('ℹ️ Supabase table not found or schema cache stale - sync skipped');
          return false; // Return false but don't log as error
        }

        // Handle other errors
        console.error('❌ Supabase sync error:', response.status, errorData.message || errorText);
        return false;
      }

      console.log('✅ Rule synced to Supabase:', rule.id);
      return true;

    } catch (error) {
      // Network errors or other exceptions - log but don't break rule saving
      const errorMsg = error.message || String(error);
      // Don't spam console with network errors
      if (!errorMsg.includes('Failed to fetch') && !errorMsg.includes('NetworkError')) {
        console.error('❌ Error syncing to Supabase:', error);
      }
      return false;
    }
  },

  /**
   * Fetch rules from Supabase for the current user
   * @param {Object} user - The authenticated user
   * @param {string} pageKey - Optional page key to filter by
   * @returns {Promise<EditRule[]>} Array of rules
   */
  async fetchRules(user, pageKey = null) {
    if (!user || !user.id) {
      console.log('ℹ️ No user authenticated, skipping Supabase fetch');
      return [];
    }

    try {
      const token = await this.getAuthToken();
      if (!token) {
        console.log('ℹ️ No auth token available, skipping Supabase fetch');
        return [];
      }

      let url = `${this.getSupabaseUrl()}/rest/v1/edit_rules?user_id=eq.${user.id}&active=eq.true`;
      if (pageKey) {
        url += `&page_key=eq.${encodeURIComponent(pageKey)}`;
      }

      console.log(`📥 Fetching rules from Supabase for user ${user.id}${pageKey ? ` on ${pageKey}` : ''}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': this.getSupabaseKey(),
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        // Handle 404 (table doesn't exist) or PGRST205 (schema cache issue) gracefully
        if (response.status === 404 || (errorData && errorData.code === 'PGRST205')) {
          console.log('ℹ️ Supabase table not found or schema cache stale - fetch skipped');
          return []; // Return empty array but don't log as error
        }

        // Handle 401 (JWT expired) - log info but don't treat as error
        if (response.status === 401) {
          console.log('ℹ️ Supabase auth expired - fetch skipped');
          return []; // Return empty array
        }

        // Handle other errors
        console.error('❌ Supabase fetch error:', response.status, errorData.message || errorText);
        return [];
      }

      const data = await response.json();
      console.log(`✅ Fetched ${data.length} rule(s) from Supabase for user ${user.id}`);

      // Convert Supabase format to EditRule format
      return data.map(item => ({
        id: item.id,
        pageKey: item.page_key,
        selector: item.selector,
        action: item.action,
        metadata: item.metadata || {},
        createdAt: new Date(item.created_at).getTime(),
        active: item.active,
        userId: item.user_id
      }));

    } catch (error) {
      // Network errors or other exceptions - log but don't break rule loading
      const errorMsg = error.message || String(error);
      // Don't spam console with network errors
      if (!errorMsg.includes('Failed to fetch') && !errorMsg.includes('NetworkError')) {
        console.error('❌ Error fetching from Supabase:', error);
      }
      return [];
    }
  }
};

/**
 * Main EditRules API
 */
const EditRules = {
  /**
   * Create and save a new edit rule
   * @param {HTMLElement} element - The target element
   * @param {string} action - The action type ("hide", "remove", etc.)
   * @param {Object} metadata - Optional metadata
   * @param {Object} user - Optional authenticated user
   * @param {string} selector - Optional pre-generated selector (avoids duplicate generation)
   * @returns {Promise<EditRule>} The created rule
   */
  async createRule(element, action, metadata = {}, user = null, selector = null) {
    if (!user || !user.id) {
      throw new Error('Authenticated user is required to create rules');
    }

    if (!getActiveUserId() || getActiveUserId() !== user.id) {
      setActiveUserContext(user);
    }
    // Use provided selector if available, otherwise generate one
    const finalSelector = selector || generateSelector(element);

    const rule = {
      id: generateRuleId(),
      pageKey: getPageKey(),
      selector: finalSelector,
      action: action,
      metadata: {
        ...metadata,
        description: generateElementDescription(element)
      },
      createdAt: Date.now(),
      active: true,
      userId: user.id
    };

    const saved = await StorageManager.saveRule(rule);

    // Throw error if saving failed - this ensures callers know the rule wasn't persisted
    if (!saved) {
      throw new Error('Failed to save rule to storage');
    }

    if (user) {
      // Sync to Supabase in background (don't fail if this fails)
      SupabaseSyncManager.syncRule(rule, user).catch(err => {
        console.error('❌ Failed to sync to Supabase:', err);
      });
    }

    return rule;
  },

  /**
   * Apply all rules for the current page
   * @returns {Promise<number>} Number of elements affected
   */
  async applyRules() {
    return RuleApplier.applyAllRulesForCurrentPage();
  },

  /**
   * Apply all rules for the current page (alias for applyRules)
   * @param {boolean} suppressNoRulesLog - If true, suppress "No rules to apply" log
   * @returns {Promise<number>} Number of elements affected
   */
  async applyAllRulesForCurrentPage(suppressNoRulesLog = false) {
    return RuleApplier.applyAllRulesForCurrentPage(suppressNoRulesLog);
  },

  /**
   * Fetch rules from Supabase for authenticated user
   * @param {Object} user - The authenticated user
   * @param {string} pageKey - Optional page key to filter by
   * @returns {Promise<EditRule[]>} Array of rules
   */
  async fetchRules(user, pageKey = null) {
    return SupabaseSyncManager.fetchRules(user, pageKey);
  },

  /**
   * Delete a rule
   * @param {string} ruleId - The rule ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteRule(ruleId) {
    const pageKey = getPageKey();
    return StorageManager.deleteRule(pageKey, ruleId);
  },

  /**
   * Get all rules for current page
   * @returns {Promise<EditRule[]>} Array of rules
   */
  async getRulesForCurrentPage() {
    const pageKey = getPageKey();
    return StorageManager.getRulesForPage(pageKey);
  },

  /**
   * Clear all rules for current page
   * @returns {Promise<boolean>} Success status
   */
  async clearAllRulesForCurrentPage() {
    const pageKey = getPageKey();
    return StorageManager.clearPageRules(pageKey);
  },

  /**
   * Set or clear the active authenticated user context
   * @param {Object|null} user
   */
  setActiveUser(user) {
    setActiveUserContext(user);
  },

  /**
   * Clear all locally stored rules for the current authenticated user
   * @returns {Promise<boolean>}
   */
  async clearLocalRulesForCurrentUser() {
    const storageKey = StorageManager.getStorageKey();
    if (!storageKey) {
      return false;
    }

    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve(false);
        return;
      }

      chrome.storage.local.remove(storageKey, () => {
        if (chrome.runtime.lastError) {
          console.error('❌ Error clearing user rules:', chrome.runtime.lastError);
          resolve(false);
          return;
        }
        console.log('🧹 Cleared local rules for active user');
        resolve(true);
      });
    });
  },

  /**
   * Setup mutation observer to reapply rules on DOM changes
   */
  setupMutationObserver() {
    // Only setup if not already set up
    if (this._mutationObserver) {
      return;
    }

    // Don't setup if extension context is invalid (page world, not extension context)
    if (!isExtensionContextValid()) {
      // Not in extension context - can't setup observer
      // This is normal if running in page world, not an error
      return;
    }

    let mutationCount = 0;
    const observer = new MutationObserver((mutations) => {
      // Check if context is still valid before processing
      if (!isExtensionContextValid()) {
        // Disconnect observer if context is invalidated
        observer.disconnect();
        this._mutationObserver = null;
        return;
      }

      // Filter out mutations that are likely from our own rule application
      const relevantMutations = mutations.filter(mutation => {
        // Skip if mutation is on WebEdit panel elements
        if (mutation.target.closest && mutation.target.closest('#webedit-chat-panel')) {
          return false;
        }
        // Skip attribute-only changes (we mainly care about element additions/removals)
        if (mutation.type === 'attributes' && mutation.attributeName !== 'style') {
          return false;
        }
        return true;
      });

      // Only reapply if there are relevant mutations
      if (relevantMutations.length > 0) {
        mutationCount++;
        // Use longer debounce and suppress logs to reduce noise
        RuleApplier.reapplyWithDebounce(500, true);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'id'] // Only watch relevant attributes
    });

    this._mutationObserver = observer;
    console.log('👀 Mutation observer setup for rule reapplication');
  },

  /**
   * Apply all rules for the current page (alias for applyRules)
   * This method is called by contentScript.js during initialization
   * @param {boolean} suppressNoRulesLog - If true, suppress "No rules to apply" log
   * @returns {Promise<number>} Total number of elements affected
   */
  async applyAllRulesForCurrentPage(suppressNoRulesLog = false) {
    return RuleApplier.applyAllRulesForCurrentPage(suppressNoRulesLog);
  },

  /**
   * Fetch rules from Supabase for the current user
   * @param {Object} user - The authenticated user
   * @param {string} pageKey - Optional page key to filter by
   * @returns {Promise<EditRule[]>} Array of rules
   */
  async fetchRules(user, pageKey = null) {
    return SupabaseSyncManager.fetchRules(user, pageKey);
  },

  /**
   * Clear any DOM manipulations applied by rules (used on logout)
   */
  resetAppliedRuleEffects() {
    RuleApplier.clearAppliedEffects();
  }
};

// Export for use in content script - set immediately after EditRules is defined
// This ensures window.EditRules is available as soon as possible
if (typeof window !== 'undefined') {
  try {
    window.EditRules = EditRules;
    console.log('✅ EditRules initialized and exported to window.EditRules');
  } catch (error) {
    console.error('❌ Failed to export EditRules to window:', error);
  }
} else {
  console.warn('⚠️ window is not available - EditRules cannot be exported');
}

