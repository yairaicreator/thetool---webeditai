// WebEdit AI - Supabase Edit Persistence Module
// Handles saving Add/Remove/Customize edits to Supabase

console.log('📦 saveEdit.js: Loading...');

// ============================================
// Types (Internal)
// ============================================

/**
 * @typedef {Object} Website
 * @property {string} id - UUID
 * @property {string} full_url - Exact page URL the user was on
 * @property {string} origin - Domain / site origin
 * @property {string} path - Path portion after the origin
 * @property {string} title - Human-readable page title
 * @property {string} user_id - User UUID (optional)
 */

/**
 * @typedef {Object} Edit
 * @property {string} id - UUID
 * @property {string} website_id - Foreign key to websites
 * @property {string} edit_type - "add" | "remove" | "customize"
 * @property {string} status - Edit status (default: active)
 * @property {string} name - Human-readable edit name
 * @property {string} description - Short text explaining the edit
 * @property {Object} payload - JSON data with full details
 * @property {string|null} before_image_url - Optional before image reference
 * @property {string|null} after_image_url - Optional after image reference
 * @property {string} created_at - Timestamp
 * @property {string} user_id - User UUID (optional)
 */

// ============================================
// Helpers
// ============================================

/**
 * Get the Supabase client
 */
let hasRequestedSupabaseClient = false;

function requestSupabaseClientInjection() {
  if (hasRequestedSupabaseClient) return;
  hasRequestedSupabaseClient = true;
  try {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
      return;
    }
    chrome.runtime.sendMessage(
      { type: "WEBEDIT_ENSURE_CONTENT_SCRIPTS", files: ["supabaseClient.js"] },
      () => {
        // Ignore errors; this is best-effort self-healing.
        hasRequestedSupabaseClient = false;
      }
    );
  } catch (_) {
    hasRequestedSupabaseClient = false;
  }
}

function getClient() {
  if (typeof window.SupabaseClient !== 'undefined') {
    return window.SupabaseClient;
  }
  // Try to find it in the global scope if window is not ready
  if (typeof SupabaseClient !== 'undefined') {
    return SupabaseClient;
  }
  requestSupabaseClientInjection();
  console.warn('[SaveEdit] SupabaseClient not found. Attempting to re-inject supabaseClient.js...');
  return null;
}

/**
 * Get Auth Token and User ID
 */
async function getAuth() {
  const client = getClient();
  if (!client) return null;

  try {
    const { data: { session } } = await client.getSession();
    if (!session || !session.access_token) return null;
    if (client.isSessionExpired(session)) return null;

    return {
      token: session.access_token,
      userId: session.user?.id
    };
  } catch (e) {
    console.error('[SaveEdit] Auth check failed:', e);
    return null;
  }
}

/**
 * Generic REST Helper
 */
async function dbRequest(endpoint, method, body = null) {
  const client = getClient();
  const auth = await getAuth();
  if (!client || !auth) throw new Error('Not authenticated');

  const safePreview = body
    ? { keys: Object.keys(body), bytes: (() => { try { return JSON.stringify(body).length; } catch (_) { return -1; } })() }
    : null;
  console.log('[SaveEdit] DB request', { method, endpoint, body: safePreview });

  const headers = {
    'Content-Type': 'application/json',
    'apikey': client.anonKey,
    'Authorization': `Bearer ${auth.token}`,
    'Prefer': 'return=representation' // Ask Supabase to return the inserted row
  };

  const hasBody = body !== null && typeof body !== 'undefined';
  let serializedBody = undefined;
  if (hasBody) {
    try {
      serializedBody = JSON.stringify(body);
    } catch (_) {
      const sanitize = (value, seen = new WeakSet()) => {
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.map((v) => sanitize(v, seen));
        if (typeof value !== 'object') return undefined;
        if (seen.has(value)) return undefined;
        seen.add(value);
        const out = {};
        Object.entries(value).forEach(([k, v]) => {
          if (typeof v === 'function' || typeof v === 'symbol') return;
          const next = sanitize(v, seen);
          if (typeof next !== 'undefined') out[k] = next;
        });
        return out;
      };
      serializedBody = JSON.stringify(sanitize(body));
    }
    if (method !== 'GET' && (!serializedBody || serializedBody === 'undefined')) {
      serializedBody = '{}';
    }
  }

  const response = await fetch(`${client.url}${endpoint}`, {
    method,
    headers,
    body: serializedBody
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[SaveEdit] DB request failed', { endpoint, status: response.status, body: text });
    throw new Error(`Supabase error ${response.status}: ${text}`);
  }

  const json = await response.json();
  console.log('[SaveEdit] DB response', { endpoint, ok: true });
  return json && json.length > 0 ? json[0] : null;
}

// ============================================
// Metadata Generation Helpers
// ============================================
const GENERIC_TEXT_PATTERNS = [
  'new add edit',
  'add edit',
  'new edit',
  'add feature',
  'add element',
  'remove element',
  'customize element',
  'customize edit',
  'customized element',
  'new remove edit',
  'new customize edit',
  'saved edit'
];

const SHORT_NAME_ALLOWLIST = ['cta', 'faq'];
const METADATA_PREVIEW_LOG_LIMIT = 5;
let metadataPreviewLogCount = 0;

function collapseWhitespace(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const stringValue = typeof value === 'string' ? value : String(value);
  return stringValue.replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = 60) {
  const text = collapseWhitespace(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function isMeaningfulText(text) {
  const trimmed = collapseWhitespace(text);
  if (!trimmed) return false;
  const lowerTrimmed = trimmed.toLowerCase();
  if (trimmed.length < 4 && !SHORT_NAME_ALLOWLIST.includes(lowerTrimmed)) {
    return false;
  }
  if (/^(removed|remove|styled|style|customize|customized)\s+/i.test(trimmed) && /[#.:>]/.test(trimmed)) {
    return false;
  }
  return !GENERIC_TEXT_PATTERNS.some(pattern =>
    lowerTrimmed === pattern || lowerTrimmed.includes(pattern)
  );
}

function ensureSentence(text) {
  const trimmed = collapseWhitespace(text);
  if (!trimmed) return '';
  if (/[.!?]"?$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function isDevelopmentBuild() {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getManifest !== 'function') {
      return true;
    }
    const manifest = chrome.runtime.getManifest();
    return !manifest || !manifest.update_url;
  } catch (error) {
    return true;
  }
}

function shouldLogMetadataPreview() {
  return isDevelopmentBuild() && metadataPreviewLogCount < METADATA_PREVIEW_LOG_LIMIT;
}

function logMetadataPreview(editType, name, description, targetContext) {
  if (!shouldLogMetadataPreview()) {
    return;
  }
  metadataPreviewLogCount += 1;
  console.log(`[SaveEdit] Metadata preview (${editType}) #${metadataPreviewLogCount}`, {
    name,
    description,
    target: {
      snippet: targetContext?.snippet || null,
      reference: targetContext?.reference || null,
      selector: targetContext?.selector || null
    }
  });
}

function getSiteMetadata(websiteTitle, websiteUrl) {
  const title = collapseWhitespace(
    websiteTitle ||
    (typeof document !== 'undefined' ? document.title : '')
  );
  let hostname = '';
  const urlSource = websiteUrl || (typeof window !== 'undefined' && window.location ? window.location.href : '');
  if (urlSource) {
    try {
      const parsed = new URL(urlSource);
      hostname = parsed.hostname || '';
    } catch (error) {
      hostname = typeof window !== 'undefined' && window.location ? (window.location.hostname || '') : '';
    }
  }
  const displayName = title || hostname || 'this page';
  return {
    title,
    hostname,
    displayName
  };
}

function querySelectorSafe(selector) {
  if (!selector || typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return null;
  }
  try {
    return document.querySelector(selector);
  } catch (error) {
    if (isDevelopmentBuild()) {
      console.warn('[SaveEdit] Invalid selector during metadata lookup:', selector, error);
    }
    return null;
  }
}

function extractSnippetFromElement(element) {
  if (!element) return '';
  const candidates = [];
  if (typeof element.innerText === 'string') {
    candidates.push(element.innerText);
  }
  if (typeof element.textContent === 'string') {
    candidates.push(element.textContent);
  }
  if (typeof element.getAttribute === 'function') {
    const ariaLabel = element.getAttribute('aria-label');
    const alt = element.getAttribute('alt');
    const placeholder = element.getAttribute('placeholder');
    if (ariaLabel) candidates.push(ariaLabel);
    if (alt) candidates.push(alt);
    if (placeholder) candidates.push(placeholder);
  }
  if (typeof element.value === 'string') {
    candidates.push(element.value);
  }
  const firstMeaningful = candidates
    .map(candidate => truncateText(candidate, 60))
    .find(Boolean);
  return firstMeaningful || '';
}

function extractSnippetFromMetadata(description) {
  const text = collapseWhitespace(description);
  if (!text) return '';
  const quoted = text.match(/"([^"]+)"/);
  if (quoted && quoted[1]) {
    return truncateText(quoted[1], 60);
  }
  return '';
}

function extractTagFromMetadata(description) {
  const text = collapseWhitespace(description);
  if (!text) return '';
  const match = text.match(/^[a-z0-9-]+/i);
  return match ? match[0].toLowerCase() : '';
}

function getTargetContext(payload = {}, explicitElement = null, targetInfo = {}) {
  const selector = payload?.selector || payload?.targetSelector || targetInfo?.selector || null;
  const metadataDescription = payload?.metadata?.description || targetInfo?.description || '';
  const providedSnippet = collapseWhitespace(
    targetInfo?.text ||
    targetInfo?.innerText ||
    targetInfo?.label ||
    payload?.targetText ||
    ''
  );
  const element = explicitElement || querySelectorSafe(selector);
  const elementSnippet = extractSnippetFromElement(element);
  const metadataSnippet = extractSnippetFromMetadata(metadataDescription);
  const snippet = truncateText(providedSnippet || elementSnippet || metadataSnippet || '', 40);
  const tagFromInfo = collapseWhitespace(targetInfo?.tag || targetInfo?.tagName);
  const tagName = (tagFromInfo && tagFromInfo.toLowerCase()) ||
    (element && element.tagName ? element.tagName.toLowerCase() : '') ||
    extractTagFromMetadata(metadataDescription);
  const baseLabel = tagName || (selector ? `elements matching ${selector}` : 'page element');
  const descriptiveLabel = collapseWhitespace(
    snippet
      ? `the element containing ${snippet}`
      : baseLabel.startsWith('elements') ? baseLabel : `the ${baseLabel}`
  ) || 'the page element';
  const reference = collapseWhitespace(snippet || baseLabel || 'page element');

  return {
    element,
    selector: selector || null,
    snippet,
    tagName,
    baseLabel,
    descriptiveLabel,
    reference
  };
}

function humanizeTemplateType(typeValue, fallbackName) {
  const raw = collapseWhitespace(typeValue);
  if (raw) {
    const normalized = raw.replace(/[-_]+/g, ' ').trim();
    if (normalized.toLowerCase() === 'cta') {
      return 'CTA';
    }
    return normalized.toLowerCase();
  }
  const fallback = collapseWhitespace(fallbackName);
  if (!fallback) return null;
  return fallback.replace(/^add\s+/i, '').trim();
}

function humanizeCssProp(prop) {
  if (!prop) return 'style';
  return prop
    .toString()
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .trim();
}

function describeStyles(styles) {
  if (!styles || typeof styles !== 'object') return '';
  const entries = Object.entries(styles).filter(([, value]) => collapseWhitespace(value));
  if (entries.length === 0) return '';
  const parts = entries.map(([prop, value]) => `${humanizeCssProp(prop)} to ${collapseWhitespace(value)}`);
  if (parts.length === 1) {
    return parts[0];
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function buildAddName(templateLabel, targetContext) {
  const descriptor = templateLabel || 'content block';
  if (targetContext.reference) {
    return collapseWhitespace(`Add ${descriptor} near ${targetContext.reference}`);
  }
  return collapseWhitespace(`Add ${descriptor}`);
}

function buildRemoveName(targetContext) {
  if (targetContext.reference) {
    return collapseWhitespace(`Remove ${targetContext.reference}`);
  }
  return 'Remove page element';
}

function buildCustomizeName(targetContext) {
  if (targetContext.reference) {
    return collapseWhitespace(`Customize ${targetContext.reference}`);
  }
  return 'Customize page element';
}

function buildEditMetadata(options = {}) {
  const {
    editType = 'add',
    payload = {},
    targetElement = null,
    targetInfo = null,
    userText = {},
    websiteTitle = null,
    websiteUrl = null
  } = options || {};

  const normalizedType = (editType || 'add').toLowerCase();
  const userProvidedName = userText?.name;
  const userProvidedDescription = userText?.description;
  const meaningfulUserName = isMeaningfulText(userProvidedName) ? collapseWhitespace(userProvidedName) : '';
  const meaningfulUserDescription = isMeaningfulText(userProvidedDescription) ? ensureSentence(userProvidedDescription) : '';

  const site = getSiteMetadata(websiteTitle, websiteUrl);
  const targetContext = getTargetContext(payload, targetElement, targetInfo || {});

  let generatedName = '';
  let generatedDescription = '';

  switch (normalizedType) {
    case 'remove':
      generatedName = buildRemoveName(targetContext);
      generatedDescription = `Removes ${targetContext.descriptiveLabel} from ${site.displayName}.`;
      break;
    case 'customize': {
      const styleSummary = describeStyles(
        payload?.metadata?.styles || payload?.styles
      );
      generatedName = buildCustomizeName(targetContext);
      const summaryText = styleSummary || 'the styles';
      generatedDescription = `Updates ${summaryText} for ${targetContext.descriptiveLabel} on ${site.displayName}.`;
      break;
    }
    case 'add':
    default: {
      const templateLabel = humanizeTemplateType(payload?.type, meaningfulUserName || payload?.name);
      generatedName = buildAddName(templateLabel, targetContext);
      const descriptor = templateLabel || 'content block';
      generatedDescription = `Adds a ${descriptor} near ${targetContext.descriptiveLabel} on ${site.displayName}.`;
      break;
    }
  }

  const descriptionParts = [];
  if (meaningfulUserDescription) {
    descriptionParts.push(meaningfulUserDescription);
  }
  if (generatedDescription) {
    descriptionParts.push(ensureSentence(generatedDescription));
  }
  const combinedDescription = descriptionParts.join(' ').trim();

  const finalName = meaningfulUserName || generatedName || `New ${normalizedType} edit`;
  const finalDescription = combinedDescription || ensureSentence(`Auto-generated ${normalizedType} edit on ${site.displayName}.`);

  logMetadataPreview(normalizedType, finalName, finalDescription, targetContext);

  return {
    name: finalName,
    description: finalDescription
  };
}

// ============================================
// Core Logic
// ============================================

/**
 * Step A: Ensure a row exists in the 'websites' table
 * Uses full_url as the unique key (conceptually)
 */
async function getOrCreateWebsite() {
  // Normalize URL to improve SPA persistence:
  // - ignore hash by default (Skool uses /academy# which should map to /academy)
  // - ignore search for now (can be added back if needed)
  const fullUrl = window.location.href;
  const title = document.title || 'Untitled Page';
  let origin = window.location.origin || '';
  let path = window.location.pathname || '/';
  let normalizedFullUrl = `${origin}${path}`;

  try {
    const urlObj = new URL(fullUrl);
    origin = urlObj.origin || origin;
    path = (urlObj.pathname || '/') || '/';
    normalizedFullUrl = `${origin}${path}`;
  } catch (error) {
    console.warn('[SaveEdit] Failed to parse URL, falling back to location parts:', error);
  }

  const auth = await getAuth();
  if (!auth) return null;

  try {
    console.log('[SaveEdit] Website key:', { origin, path, normalizedFullUrl, fullUrl });

    // 1) Prefer SELECT by origin+path (stable across hash changes)
    const byOriginPath = new URLSearchParams({
      origin: `eq.${origin}`,
      path: `eq.${path}`,
      select: 'id,full_url,origin,path'
    });
    const existingByOriginPath = await dbRequest(`/rest/v1/websites?${byOriginPath.toString()}`, 'GET').catch(() => null);
    if (existingByOriginPath) {
      console.log('[SaveEdit] ✅ Found existing website (origin+path):', existingByOriginPath.id);
      return existingByOriginPath;
    }

    // 2) Back-compat: try SELECT existing website by full_url (older rows)
    const byFullUrl = new URLSearchParams({
      full_url: `eq.${fullUrl}`,
      select: 'id,full_url,origin,path'
    });
    const existing = await dbRequest(`/rest/v1/websites?${byFullUrl.toString()}`, 'GET').catch(() => null);
    if (existing) {
      console.log('[SaveEdit] ✅ Found existing website:', existing.id);
      return existing;
    }

    // 3. INSERT if not found
    console.log('[SaveEdit] Creating new website row...');
    const newSite = await dbRequest('/rest/v1/websites', 'POST', {
      full_url: normalizedFullUrl,
      origin,
      path,
      title,
      user_id: auth.userId
    });

    console.log('[SaveEdit] ✅ Created website:', newSite.id);
    return newSite;

  } catch (error) {
    console.error('[SaveEdit] Website upsert failed:', error);
    return null;
  }
}

/**
 * Step B: Insert the edit row
 */
async function saveEditToSupabase(params) {
  // params: { type, name, description, payload, ... }

  const auth = await getAuth();
  if (!auth) {
    console.log('[SaveEdit] User not signed in. Edit saved locally but not to Supabase.');
    return;
  }

  try {
    // 1. Get Website ID
    const website = await getOrCreateWebsite();
    if (!website) throw new Error('Could not get website ID');

    // 2. Prepare Edit Data
    const metadataInput = params.metadataContext || {
      editType: params.type || 'add',
      payload: params.payload || {},
      targetElement: params.targetElement || null,
      userText: {
        name: params.name,
        description: params.description
      }
    };
    const generatedMetadata = buildEditMetadata(metadataInput);

    const payload = params.payload || {};
    const name = generatedMetadata.name;
    const description = generatedMetadata.description;

    // 3. INSERT into edits table
    const editId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    const editRow = {
      id: editId,
      website_id: website.id,
      user_id: auth.userId,
      edit_type: params.type || 'add',
      status: params.status || 'active',
      name,
      description,
      payload: payload,
      before_image_url: params.beforeImageUrl || params.beforeImage || null,
      after_image_url: params.afterImageUrl || params.afterImage || null
      // created_at is default now()
    };

    const savedEdit = await dbRequest('/rest/v1/edits', 'POST', editRow);

    console.log('[SaveEdit] ✅ Edit saved to Supabase:', savedEdit);
    return { ok: true, edit: savedEdit };

  } catch (error) {
    console.error('[SaveEdit] Failed to save edit:', error);
    const message =
      (error && typeof error.message === 'string' && error.message) ||
      (typeof error === 'object' ? JSON.stringify(error) : String(error)) ||
      'Unknown save error';
    return { ok: false, error: message };
  }
}

// ============================================
// Wrappers for Content Script
// ============================================

async function saveAddFeature(spec) {
  const selector = spec?.selector;
  const targetElement = selector ? querySelectorSafe(selector) : null;
  const generatedModule = spec?.generated_module || {};
  const metadataContext = {
    editType: 'add',
    payload: spec,
    targetElement,
    userText: {
      name: spec?.name,
      description: spec?.purpose || spec?.description || spec?.content
    },
    websiteTitle: typeof document !== 'undefined' ? document.title : '',
    websiteUrl: typeof window !== 'undefined' && window.location ? window.location.href : ''
  };

  return saveEditToSupabase({
    type: 'add',
    name: spec.name,
    description: spec.purpose || spec.name,
    payload: {
      action: "add",
      ...spec,
      metadata: {
        ...(spec?.metadata || {}),
        featureClass: (generatedModule?.controller === "folderGeminiController" ? "gemini-folder" : (spec?.metadata?.featureClass || null)),
        persistenceMode: (generatedModule?.controller === "folderGeminiController" ? "cloud_only" : (spec?.metadata?.persistenceMode || null))
      },
      featureArtifact: {
        html: generatedModule?.html || spec?.html || '',
        css: generatedModule?.css || spec?.css || '',
        js: generatedModule?.js || spec?.js || ''
      },
      controller: {
        id: generatedModule?.controller || null,
        config: generatedModule?.config || null
      },
      stateSchema: generatedModule?.stateSchema || spec?.state_model || null,
      migration: {
        schemaVersion: spec?.metadata?.schemaVersion || '2',
        persistenceKey: spec?.persistence?.key || null,
        undoStrategy: spec?.undo_strategy?.mode || 'dom-revert',
        controllerId: generatedModule?.controller || null
      },
      rollback: {
        type: 'spec-undo',
        selector: spec?.selector || spec?.targetSelector || null
      }
    },
    metadataContext
  });
}

async function saveRemoveEdit(el, rule) {
  const metadataContext = {
    editType: 'remove',
    payload: rule,
    targetElement: el || null,
    targetInfo: {
      description: rule?.metadata?.description,
      selector: rule?.selector
    },
    websiteTitle: typeof document !== 'undefined' ? document.title : '',
    websiteUrl: typeof window !== 'undefined' && window.location ? window.location.href : ''
  };

  return saveEditToSupabase({
    type: 'remove',
    name: 'Remove Element',
    description: `Removed ${rule.selector}`,
    payload: rule,
    metadataContext
  });
}

async function saveCustomizeEdit(el, rule) {
  const metadataContext = {
    editType: 'customize',
    payload: rule,
    targetElement: el || null,
    targetInfo: {
      description: rule?.metadata?.description,
      selector: rule?.selector
    },
    userText: {
      description: rule?.metadata?.note || ''
    },
    websiteTitle: typeof document !== 'undefined' ? document.title : '',
    websiteUrl: typeof window !== 'undefined' && window.location ? window.location.href : ''
  };

  return saveEditToSupabase({
    type: 'customize',
    name: 'Customize Element',
    description: `Styled ${rule.selector}`,
    payload: rule,
    metadataContext
  });
}

// Export IMMEDIATELY to avoid race conditions
if (typeof window !== 'undefined') {
  window.SaveEdit = {
    saveEditToSupabase,
    saveAddFeature,
    saveRemoveEdit,
    saveCustomizeEdit
  };
  console.log('✅ SaveEdit module ready and exported to window');
}
