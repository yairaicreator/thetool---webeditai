// WebEdit AI - Supabase Edit Persistence Module
// Handles saving Add/Remove/Customize edits to Supabase

console.log('📦 saveEdit.js: Loading...');

/**
 * @typedef {Object} Website
 * @property {string} id - UUID
 * @property {string} origin - e.g., "https://example.com"
 * @property {string} path - e.g., "/blog/post-1"
 * @property {string} full_url - Complete URL
 * @property {string} title - Page title
 * @property {string} user_id - User UUID
 * @property {string} created_at - ISO timestamp
 * @property {string} updated_at - ISO timestamp
 */

/**
 * @typedef {Object} Edit
 * @property {string} id - UUID
 * @property {string} website_id - Foreign key to Websites
 * @property {string} type - 'add' | 'remove' | 'customize'
 * @property {string} name - Edit name
 * @property {string} description - Edit description
 * @property {Object} payload - Edit details (selectors, styles, etc.)
 * @property {string|null} before_image_url - Before screenshot URL
 * @property {string|null} after_image_url - After screenshot URL
 * @property {string} status - 'active' | 'undone'
 * @property {string} user_id - User UUID
 * @property {string} created_at - ISO timestamp
 * @property {string} updated_at - ISO timestamp
 */

/**
 * @typedef {Object} SaveEditParams
 * @property {'add'|'remove'|'customize'} type - Edit type
 * @property {string} [name] - Edit name (optional, will be auto-generated)
 * @property {string} [description] - Edit description (optional)
 * @property {Object} payload - Edit payload (selectors, styles, etc.)
 * @property {string} [beforeImageUrl] - Before screenshot URL
 * @property {string} [afterImageUrl] - After screenshot URL
 */

/**
 * Get the Supabase client (if available)
 * @returns {Object|null} Supabase client or null
 */
function getSupabaseClient() {
  if (typeof SupabaseClient === 'undefined') {
    console.warn('[SaveEdit] SupabaseClient not available');
    return null;
  }
  return SupabaseClient;
}

/**
 * Get the current session and access token
 * @returns {Promise<{token: string, userId: string}|null>}
 */
async function getAuthToken() {
  const client = getSupabaseClient();
  if (!client) return null;
  
  try {
    const { data: { session } } = await client.getSession();
    
    if (!session || !session.access_token) {
      console.log('[SaveEdit] No active session - user not authenticated');
      return null;
    }
    
    // Check if session is expired
    if (client.isSessionExpired(session)) {
      console.log('[SaveEdit] Session expired - user needs to re-authenticate');
      return null;
    }
    
    return {
      token: session.access_token,
      userId: session.user.id
    };
  } catch (error) {
    console.error('[SaveEdit] Error getting auth token:', error);
    return null;
  }
}

/**
 * Make a REST API call to Supabase
 * @param {string} endpoint - API endpoint (e.g., '/rest/v1/websites')
 * @param {Object} options - Fetch options
 * @returns {Promise<any>}
 */
async function supabaseRestCall(endpoint, options = {}) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client not available');
  }
  
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
  
  const response = await fetch(url, {
    ...options,
    headers
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
    // For table endpoints (/rest/v1/websites, /rest/v1/edits), any 404 likely means table doesn't exist
    const isTableEndpoint = endpoint.includes('/rest/v1/websites') || endpoint.includes('/rest/v1/edits');
    
    if (response.status === 404 || (errorData && errorData.code === 'PGRST205')) {
      const errorMsg = errorData.message || errorText;
      
      // If it's a table endpoint and we get a 404, treat it as table not found
      // OR if the error message explicitly mentions table-related issues (regardless of endpoint)
      if (isTableEndpoint || 
          errorMsg.includes('Could not find the table') || 
          errorMsg.includes('relation') && errorMsg.includes('does not exist') ||
          errorMsg.includes('schema cache')) {
        // Table doesn't exist or schema cache is stale - this is expected if tables haven't been created yet
        console.log('ℹ️ Supabase table not found or schema cache stale - operation skipped');
        throw new Error('TABLE_NOT_FOUND'); // Special error code for graceful handling
      }
    }
    
    throw new Error(`Supabase API error: ${response.status} - ${errorData.message || errorText}`);
  }
  
  // Some operations (like INSERT with RETURNING) return data
  const text = await response.text();
  if (text) {
    return JSON.parse(text);
  }
  return null;
}

/**
 * Get or create a Website row for the current page
 * @returns {Promise<{id: string}|null>} Website with id, or null on error
 */
async function getOrCreateWebsiteForCurrentPage() {
  console.log('[SaveEdit] Getting or creating Website row for current page');
  
  try {
    // Get current page info
    const origin = window.location.origin;
    const path = window.location.pathname + window.location.search;
    const fullUrl = window.location.href;
    const title = document.title || 'Untitled Page';
    
    const auth = await getAuthToken();
    if (!auth) {
      console.log('[SaveEdit] User not authenticated, skipping Website creation');
      return null;
    }
    
    console.log('[SaveEdit] Current page:', { origin, path, fullUrl, title });
    
    // Try to find existing Website row
    // Query by user_id, origin, and path
    const queryParams = new URLSearchParams({
      user_id: `eq.${auth.userId}`,
      origin: `eq.${origin}`,
      path: `eq.${path}`,
      select: 'id,origin,path,full_url,title'
    });
    
    console.log('[SaveEdit] Querying existing Website...');
    const existingWebsites = await supabaseRestCall(
      `/rest/v1/websites?${queryParams.toString()}`,
      { method: 'GET' }
    );
    
    if (existingWebsites && existingWebsites.length > 0) {
      console.log('[saveEdit] Websites select result', { data: existingWebsites[0], error: null });
      console.log('[SaveEdit] ✅ Found existing Website:', existingWebsites[0].id);
      return { id: existingWebsites[0].id };
    }
    
    // No existing row found, create new one
    console.log('[SaveEdit] Creating new Website row...');
    const newWebsite = await supabaseRestCall(
      '/rest/v1/websites',
      {
        method: 'POST',
        headers: {
          'Prefer': 'return=representation'
        },
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
      console.log('[saveEdit] Websites insert result', { data: newWebsite[0], error: null });
      console.log('[SaveEdit] ✅ Created new Website:', newWebsite[0].id);
      return { id: newWebsite[0].id };
    }
    
    console.error('[SaveEdit] Failed to create Website - no data returned');
    console.log('[saveEdit] Websites insert result', { data: null, error: 'No data returned' });
    return null;
    
  } catch (error) {
    const errorMsg = error.message || String(error);
    console.log('[saveEdit] Websites error', { data: null, error: errorMsg });
    
    // Handle missing table gracefully (table not created yet)
    if (errorMsg === 'TABLE_NOT_FOUND' || 
        errorMsg.includes('Could not find the table') ||
        errorMsg.includes('schema cache')) {
      console.log('[SaveEdit] Websites table not found - skipping Supabase save (table may not be created yet)');
      return null;
    }
    
    // Log other errors but don't spam console
    if (!errorMsg.includes('Failed to fetch') && !errorMsg.includes('NetworkError')) {
      console.error('[SaveEdit] Error getting/creating Website:', errorMsg);
    }
    return null;
  }
}

/**
 * Generate a default name for an edit based on its type
 * @param {string} type - Edit type ('add' | 'remove' | 'customize')
 * @param {Object} payload - Edit payload
 * @returns {string} Generated name
 */
function generateEditName(type, payload) {
  switch (type) {
    case 'add':
      return payload.name || `Add ${payload.type || 'feature'}`;
    case 'remove':
      return 'Remove element';
    case 'customize':
      return 'Customize element';
    default:
      return 'Edit';
  }
}

/**
 * Generate a default description for an edit
 * @param {string} type - Edit type
 * @param {Object} payload - Edit payload
 * @returns {string} Generated description
 */
function generateEditDescription(type, payload) {
  switch (type) {
    case 'add':
      return payload.purpose || payload.description || `Added a ${payload.type || 'feature'} to the page`;
    case 'remove':
      return `Removed element: ${payload.selector || 'unknown'}`;
    case 'customize':
      if (payload.styles) {
        const styleKeys = Object.keys(payload.styles || {});
        return `Customized styles: ${styleKeys.join(', ')}`;
      }
      return 'Customized element appearance';
    default:
      return 'Page edit';
  }
}

/**
 * Save an edit to Supabase
 * @param {SaveEditParams} params - Edit parameters
 * @returns {Promise<{success: boolean, editId?: string, error?: string}>}
 */
async function saveEditToSupabase(params) {
  console.log('[SaveEdit] Saving edit to Supabase:', params.type);
  
  try {
    // Check if user is authenticated
    const auth = await getAuthToken();
    if (!auth) {
      console.log('[SaveEdit] User not authenticated, skipping save to Supabase');
      return { success: false, error: 'Not authenticated' };
    }
    
    // Get or create Website row
    const website = await getOrCreateWebsiteForCurrentPage();
    if (!website) {
      console.error('[SaveEdit] Failed to get/create Website row');
      return { success: false, error: 'Failed to get/create Website' };
    }
    
    // Generate name and description if not provided
    const name = params.name || generateEditName(params.type, params.payload);
    const description = params.description || generateEditDescription(params.type, params.payload);
    
    // Prepare edit data
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
    
    // Insert edit
    const insertedEdit = await supabaseRestCall(
      '/rest/v1/edits',
      {
        method: 'POST',
        headers: {
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(editData)
      }
    );
    
    console.log('[saveEdit] Edits insert result', { data: insertedEdit ? insertedEdit[0] : null, error: null });
    
    if (insertedEdit && insertedEdit.length > 0) {
      console.log('[SaveEdit] ✅ Edit saved successfully:', insertedEdit[0].id);
      return { success: true, editId: insertedEdit[0].id };
    }
    
    console.error('[SaveEdit] Failed to save edit - no data returned');
    return { success: false, error: 'No data returned from insert' };
    
  } catch (error) {
    const errorMsg = error.message || String(error);
    console.log('[saveEdit] Edits insert result', { data: null, error: errorMsg });
    
    // Handle missing table gracefully (table not created yet)
    if (errorMsg === 'TABLE_NOT_FOUND' || 
        errorMsg.includes('Could not find the table') ||
        errorMsg.includes('schema cache')) {
      console.log('[SaveEdit] Supabase tables not found - skipping save (tables may not be created yet)');
      return { success: false, error: 'Tables not found' };
    }
    
    // Log other errors but don't spam console
    if (!errorMsg.includes('Failed to fetch') && !errorMsg.includes('NetworkError')) {
      console.error('[SaveEdit] Error saving edit to Supabase:', errorMsg);
    }
    return { success: false, error: errorMsg };
  }
}

/**
 * Save an Add feature edit
 * @param {Object} featureSpec - Feature specification
 * @returns {Promise<{success: boolean, editId?: string}>}
 */
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

/**
 * Save a Remove edit
 * @param {HTMLElement} element - Element that was removed
 * @param {Object} rule - Edit rule
 * @returns {Promise<{success: boolean, editId?: string}>}
 */
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

/**
 * Save a Customize edit
 * @param {HTMLElement} element - Element that was customized
 * @param {Object} rule - Edit rule with styles
 * @returns {Promise<{success: boolean, editId?: string}>}
 */
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

// Export for use in content script
if (typeof window !== 'undefined') {
  window.SaveEdit = {
    saveEditToSupabase,
    saveAddFeature,
    saveRemoveEdit,
    saveCustomizeEdit,
    getOrCreateWebsiteForCurrentPage
  };
  console.log('✅ SaveEdit module initialized and exported to window.SaveEdit');
} else {
  console.warn('⚠️ window is not available - SaveEdit cannot be exported');
}

