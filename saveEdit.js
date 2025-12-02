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
function getClient() {
  if (typeof window.SupabaseClient === 'undefined') {
    console.warn('[SaveEdit] SupabaseClient not found. Make sure supabaseClient.js is loaded.');
    return null;
  }
  return window.SupabaseClient;
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

  const headers = {
    'Content-Type': 'application/json',
    'apikey': client.anonKey,
    'Authorization': `Bearer ${auth.token}`,
    'Prefer': 'return=representation' // Ask Supabase to return the inserted row
  };

  const response = await fetch(`${client.url}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase error ${response.status}: ${text}`);
  }

  const json = await response.json();
  return json && json.length > 0 ? json[0] : null;
}

// ============================================
// Core Logic
// ============================================

/**
 * Step A: Ensure a row exists in the 'websites' table
 * Uses full_url as the unique key (conceptually)
 */
async function getOrCreateWebsite() {
  const fullUrl = window.location.href;
  const title = document.title || 'Untitled Page';
  let origin = window.location.origin || '';
  let path = window.location.pathname || '/';

  try {
    const urlObj = new URL(fullUrl);
    origin = urlObj.origin || origin;
    const pathPart = `${urlObj.pathname || '/'}${urlObj.search || ''}${urlObj.hash || ''}`;
    path = pathPart || '/';
  } catch (error) {
    console.warn('[SaveEdit] Failed to parse URL, falling back to location parts:', error);
  }

  const auth = await getAuth();
  if (!auth) return null;

  try {
    // 1. Try to SELECT existing website by full_url
    // Note: In a real app, we'd likely use origin or normalized URL. 
    // For MVP, we query exact match on full_url for this user.
    const query = new URLSearchParams({
      full_url: `eq.${fullUrl}`,
      select: 'id'
    });

    const existing = await dbRequest(`/rest/v1/websites?${query.toString()}`, 'GET');
    if (existing) {
      console.log('[SaveEdit] ✅ Found existing website:', existing.id);
      return existing;
    }

    // 2. INSERT if not found
    console.log('[SaveEdit] Creating new website row...');
    const newSite = await dbRequest('/rest/v1/websites', 'POST', {
      full_url: fullUrl,
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
    // description fallback
    const desc = params.description || params.name || `New ${params.type || 'add'} edit`;

    // payload is the full details
    const payload = params.payload || {};
    const name = params.name || desc;

    // 3. INSERT into edits table
    const editRow = {
      website_id: website.id,
      user_id: auth.userId,
      edit_type: params.type || 'add',
      status: params.status || 'active',
      name,
      description: desc,
      payload: payload,
      before_image_url: params.beforeImageUrl || params.beforeImage || null,
      after_image_url: params.afterImageUrl || params.afterImage || null
      // created_at is default now()
    };

    const savedEdit = await dbRequest('/rest/v1/edits', 'POST', editRow);

    console.log('[SaveEdit] ✅ Edit saved to Supabase:', savedEdit);

  } catch (error) {
    console.error('[SaveEdit] Failed to save edit:', error);
    // Optional: Show non-intrusive UI message here if desired
  }
}

// ============================================
// Wrappers for Content Script
// ============================================

async function saveAddFeature(spec) {
  return saveEditToSupabase({
    type: 'add',
    name: spec.name,
    description: spec.purpose || spec.name,
    payload: spec
  });
}

async function saveRemoveEdit(el, rule) {
  return saveEditToSupabase({
    type: 'remove',
    name: 'Remove Element',
    description: `Removed ${rule.selector}`,
    payload: rule
  });
}

async function saveCustomizeEdit(el, rule) {
  return saveEditToSupabase({
    type: 'customize',
    name: 'Customize Element',
    description: `Styled ${rule.selector}`,
    payload: rule
  });
}

// Export
if (typeof window !== 'undefined') {
  window.SaveEdit = {
    saveEditToSupabase,
    saveAddFeature,
    saveRemoveEdit,
    saveCustomizeEdit
  };
  console.log('✅ SaveEdit module ready');
}
