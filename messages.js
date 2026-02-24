// WebEdit AI - Message Types and Constants
// Defines all message types used for communication between content script, background, and panel

/**
 * Message Types
 */
const MessageTypes = {
  // Panel toggle
  TOGGLE_PANEL: "WEBEDIT_TOGGLE_PANEL",
  
  // Authentication
  GET_SESSION: "WEBEDIT_GET_SESSION",
  STORE_SESSION: "WEBEDIT_STORE_SUPABASE_SESSION",
  SESSION_UPDATED: "WEBEDIT_SESSION_UPDATED",
  SIGN_OUT: "WEBEDIT_SIGN_OUT",
  OPEN_LOGIN_TAB: "WEBEDIT_OPEN_LOGIN_TAB",
  OPEN_HISTORY: "WEBEDIT_OPEN_HISTORY",
  
  // Add Feature
  ADD_FEATURE: "WEBEDIT_ADD_FEATURE",

  // FeatureSpec AI actions
  GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
  GET_SITE_CAPABILITIES: "GET_SITE_CAPABILITIES",
  APPLY_FEATURE_SPEC: "APPLY_FEATURE_SPEC",
  
  // Ping
  PING: "PING"
};

const FeaturePipelineStages = {
  PARSE: "parse",
  CAPABILITY: "capability",
  COMPLEXITY: "complexity",
  DECOMPOSITION: "decomposition",
  GENERATION: "generation",
  GENERATION_QUALITY_FAILED: "generation_quality_failed",
  VALIDATION: "validation",
  APPLY: "apply"
};

const FeatureComplexityReasons = {
  CROSS_SURFACE: "cross_surface",
  REQUIRES_INTERNAL_API: "requires_internal_api",
  REQUIRES_DRAGDROP: "requires_dragdrop",
  HIGH_RUNTIME_RISK: "high_runtime_risk",
  LOW_PAGE_CAPABILITY: "low_page_capability"
};

/**
 * AddFeatureRequest Type Definition
 * @typedef {Object} AddFeatureRequest
 * @property {string} id - Unique identifier for the feature
 * @property {string} selector - CSS selector for the target element
 * @property {string} position - Position relative to target: "before" | "after" | "inside"
 * @property {string} content - User-provided description/content for the feature
 * @property {string} pageKey - Page identifier (hostname + pathname)
 * @property {number} createdAt - Timestamp when feature was created
 */

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.MessageTypes = MessageTypes;
  window.FeaturePipelineStages = FeaturePipelineStages;
  window.FeatureComplexityReasons = FeatureComplexityReasons;
  console.log('✅ MessageTypes loaded');
}

