'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Gatekeeper — payment plan cache, Free-tier quotas, LifeTime bypass
// Loaded via importScripts from background.js after supabaseClient.js
// ═══════════════════════════════════════════════════════════════════════════════

const WEBEDIT_PLAN_PREFIX = 'webedit_plan::';
const WEBEDIT_USAGE_PREFIX = 'webedit_usage::';

const WEBEDIT_GATE_LIMITS = {
  add: { maxCount: 1, maxOrigins: 1 },
  customize: { maxCount: 3, maxOrigins: 3 },
  remove: { maxCount: 5, maxOrigins: 4 }
};

function webeditPlanStorageKey(userId) {
  return WEBEDIT_PLAN_PREFIX + userId;
}

function webeditUsageStorageKey(userId) {
  return WEBEDIT_USAGE_PREFIX + userId;
}

function webeditNormalizePlanValue(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'lifetime' || s === 'life_time' || s === 'lifetimes') return 'LifeTime';
  return 'Free';
}

function webeditOriginFromPageUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch (_) {
    return '';
  }
}

async function webeditFetchPaymentPlanFromSupabase(accessToken, userId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken || !userId) {
    return 'Free';
  }
  const url =
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    console.warn('[Gatekeeper] profiles fetch failed:', response.status, response.statusText);
    return 'Free';
  }
  const rows = await response.json().catch(function () {
    return [];
  });
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row || typeof row !== 'object') return 'Free';
  const raw = row.Payment_plan != null ? row.Payment_plan : row.payment_plan;
  return webeditNormalizePlanValue(raw);
}

async function webeditGetCachedPlanForUser(userId) {
  if (!userId) return 'Free';
  const key = webeditPlanStorageKey(userId);
  const result = await chrome.storage.local.get([key]);
  const rec = result[key];
  if (rec && rec.plan) {
    return webeditNormalizePlanValue(rec.plan) === 'LifeTime' ? 'LifeTime' : 'Free';
  }
  return 'Free';
}

async function webeditRefreshCachedPlan(reason) {
  let plan = 'Free';
  try {
    const { data, error } = await SupabaseClient.getSession({ allowRefresh: true });
    const session = data?.session;
    if (error || !session?.access_token || !session?.user?.id) {
      return null;
    }
    const userId = session.user.id;
    plan = await webeditFetchPaymentPlanFromSupabase(session.access_token, userId);
    await chrome.storage.local.set({
      [webeditPlanStorageKey(userId)]: {
        plan: plan,
        fetchedAt: Date.now(),
        reason: reason || ''
      }
    });
    chrome.runtime
      .sendMessage({
        type: 'WEBEDIT_PLAN_UPDATED',
        plan: plan,
        fetchedAt: Date.now()
      })
      .catch(function () {});
    return plan;
  } catch (e) {
    console.warn('[Gatekeeper] refreshCachedPlan failed:', e.message);
    return plan;
  }
}

function webeditNotifyGateBlocked(message, code) {
  chrome.runtime
    .sendMessage({
      type: 'WEBEDIT_GATE_BLOCKED',
      message: message || 'This action is not available on your plan.',
      code: code || 'GATE'
    })
    .catch(function () {});
}

async function webeditLoadUsage(userId) {
  const key = webeditUsageStorageKey(userId);
  const result = await chrome.storage.local.get([key]);
  const d = result[key] || {};
  function bucket(name) {
    const b = d[name] || {};
    return {
      count: Math.max(0, Number(b.count) || 0),
      origins: Array.isArray(b.origins) ? b.origins.slice() : []
    };
  }
  return {
    add: bucket('add'),
    customize: bucket('customize'),
    remove: bucket('remove')
  };
}

async function webeditSaveUsage(userId, usage) {
  await chrome.storage.local.set({ [webeditUsageStorageKey(userId)]: usage });
}

function webeditGateQuotaMessage(feature, kind, lim) {
  const names = { add: 'Add', customize: 'Customize', remove: 'Remove' };
  const n = names[feature] || feature;
  const pricing = 'https://www.webeditai.com/#/pricing';
  if (kind === 'count') {
    return (
      'Free plan: you have reached the limit for ' +
      n +
      ' (' +
      lim.maxCount +
      ' edit' +
      (lim.maxCount === 1 ? '' : 's') +
      '). Upgrade for unlimited access: ' +
      pricing
    );
  }
  return (
    'Free plan: ' +
    n +
    ' is limited to ' +
    lim.maxOrigins +
    ' website' +
    (lim.maxOrigins === 1 ? '' : 's') +
    '. Upgrade for unlimited access: ' +
    pricing
  );
}

async function webeditAssertGate(feature, context) {
  const ctx = context || {};
  const { data } = await SupabaseClient.getSession({ allowRefresh: false });
  const uid = data?.session?.user?.id;
  if (!uid) {
    return { ok: false, code: 'AUTH', message: 'Please log in to continue.' };
  }
  const plan = await webeditGetCachedPlanForUser(uid);
  if (plan === 'LifeTime') {
    return { ok: true, code: null, message: '' };
  }
  if (feature === 'chat') {
    return {
      ok: false,
      code: 'GATE_CHAT',
      message:
        'AI chat is a Lifetime feature. Upgrade to unlock unlimited chat and edits: https://www.webeditai.com/#/pricing'
    };
  }
  const pageUrl = String(ctx.url || '').trim();
  const origin = webeditOriginFromPageUrl(pageUrl);
  if (!origin) {
    return { ok: false, code: 'BAD_URL', message: 'Could not determine the website for this action.' };
  }
  const lim = WEBEDIT_GATE_LIMITS[feature];
  if (!lim) {
    return { ok: true, code: null, message: '' };
  }
  const usage = await webeditLoadUsage(uid);
  const bucket = usage[feature] || { count: 0, origins: [] };
  const originsSet = new Set(bucket.origins);
  const wouldAddOrigin = !originsSet.has(origin);
  const nextCount = bucket.count + 1;
  const nextOriginCount = wouldAddOrigin ? originsSet.size + 1 : originsSet.size;

  if (nextCount > lim.maxCount) {
    return {
      ok: false,
      code: 'GATE_' + String(feature).toUpperCase() + '_COUNT',
      message: webeditGateQuotaMessage(feature, 'count', lim)
    };
  }
  if (nextOriginCount > lim.maxOrigins) {
    return {
      ok: false,
      code: 'GATE_' + String(feature).toUpperCase() + '_SITES',
      message: webeditGateQuotaMessage(feature, 'sites', lim)
    };
  }
  return { ok: true, code: null, message: '' };
}

async function webeditRecordUsage(feature, pageUrl) {
  const { data } = await SupabaseClient.getSession({ allowRefresh: false });
  const uid = data?.session?.user?.id;
  if (!uid) return;
  const plan = await webeditGetCachedPlanForUser(uid);
  if (plan === 'LifeTime') return;
  const origin = webeditOriginFromPageUrl(String(pageUrl || '').trim());
  if (!origin) return;
  const usage = await webeditLoadUsage(uid);
  const bucket = usage[feature] || { count: 0, origins: [] };
  const originsSet = new Set(bucket.origins);
  originsSet.add(origin);
  usage[feature] = {
    count: bucket.count + 1,
    origins: Array.from(originsSet)
  };
  await webeditSaveUsage(uid, usage);
}

// `var` so the object is visible across importScripts in the service worker global.
var WebeditGatekeeper = {
  refreshCachedPlan: webeditRefreshCachedPlan,
  getCachedPlanForUser: webeditGetCachedPlanForUser,
  fetchPaymentPlanFromSupabase: webeditFetchPaymentPlanFromSupabase,
  assertGate: webeditAssertGate,
  recordUsage: webeditRecordUsage,
  notifyGateBlocked: webeditNotifyGateBlocked
};
