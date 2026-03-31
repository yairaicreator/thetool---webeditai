'use strict';

/**
 * Shared helpers for human-readable element names (service worker + fallbacks).
 * Avoids showing minified CSS class names like "mqNsCe" as the element title.
 */

function looksLikeObfuscatedClass(name) {
  if (!name || typeof name !== 'string') return true;
  const s = name.trim();
  if (s.length < 4 || s.length > 40) return false;
  const lower = s.toLowerCase();
  if (/^(css|js|jsx|ng|v|sc|st|mui|chakra|tw)-/.test(lower)) return true;
  if (/^[a-z]{1,3}-[a-z0-9]{4,}$/i.test(s)) return true;
  if (/[0-9]/.test(s) && /^[a-zA-Z0-9_-]+$/.test(s) && s.length <= 12) return true;
  if (/^[a-z]{2,5}[A-Z][a-zA-Z0-9_-]*$/.test(s)) return true;
  return false;
}

function tagFriendlyName(tag) {
  const t = String(tag || '').toLowerCase();
  const map = {
    nav: 'Navigation',
    header: 'Header',
    footer: 'Footer',
    aside: 'Sidebar',
    main: 'Main content',
    article: 'Article',
    section: 'Section',
    img: 'Image',
    svg: 'Icon',
    button: 'Button',
    a: 'Link',
    input: 'Input',
    select: 'Dropdown',
    textarea: 'Text field',
    form: 'Form',
    ul: 'List',
    ol: 'List',
    li: 'List item',
    table: 'Table',
    iframe: 'Embedded frame',
    video: 'Video',
    audio: 'Audio player',
    canvas: 'Canvas',
    label: 'Label',
    h1: 'Heading',
    h2: 'Heading',
    h3: 'Heading',
    h4: 'Heading',
    h5: 'Heading',
    h6: 'Heading',
    p: 'Paragraph',
    span: 'Text',
    div: 'Block',
    time: 'Time',
    figure: 'Figure',
  };
  return map[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Element');
}

/**
 * Best-effort label from a CSS selector when we don't have live DOM or humanLabel.
 */
function selectorToHumanLabel(selector) {
  if (!selector || typeof selector !== 'string') return 'Selected element';

  const s = selector.trim();
  if (!s) return 'Selected element';

  const idMatch = s.match(/#([a-zA-Z][\w-]*)/);
  if (idMatch) {
    const id = idMatch[1].replace(/[-_]/g, ' ');
    if (!looksLikeObfuscatedClass(id)) {
      return id.charAt(0).toUpperCase() + id.slice(1);
    }
  }

  const classes = s.match(/\.([a-zA-Z_][\w-]*)/g) || [];
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i].slice(1);
    if (c && !looksLikeObfuscatedClass(c)) {
      const words = c.replace(/[-_]/g, ' ');
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  }

  const tagMatch = s.match(/^([a-z][a-z0-9]*)/i);
  if (tagMatch) {
    return tagFriendlyName(tagMatch[1]);
  }

  const short = s.length > 48 ? s.substring(0, 45) + '…' : s;
  return 'Selection (' + short + ')';
}

function getDefaultSummary(category, elementLabel) {
  const label = String(elementLabel || '').trim() || 'Selected element';
  if (category === 'remove') return 'Hidden: ' + label;
  if (category === 'add') return 'Added near ' + label;
  return 'Styled: ' + label;
}

function getDefaultDescription(category, elementLabel) {
  const label = String(elementLabel || '').trim() || 'the selected element';
  if (category === 'remove') {
    return 'This edit hides “' + label + '” from the page.';
  }
  if (category === 'add') {
    return 'This edit adds new content near “' + label + '”.';
  }
  return 'This edit changes how “' + label + '” looks on the page.';
}

// ─── Friendly site names (Edit History tabs, ensureWebsiteRow title) ─────────

function titleCaseSegment(s) {
  if (!s) return '';
  return s.split(/[\s-]+/).filter(Boolean).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function hostnameToFriendlySiteName(hostname) {
  const raw = String(hostname || '').trim().replace(/^www\./i, '');
  if (!raw) return 'Site';
  const h = raw.toLowerCase();
  const known = {
    'translate.google.com': 'Google Translate',
    'accounts.google.com': 'Google Account',
    'mail.google.com': 'Gmail',
    'drive.google.com': 'Google Drive',
    'github.com': 'GitHub',
    'gist.github.com': 'GitHub Gist',
    'twitter.com': 'X (Twitter)',
    'x.com': 'X',
    'linkedin.com': 'LinkedIn',
    'linear.app': 'Linear',
    'google.com': 'Google',
    'youtube.com': 'YouTube',
    'reddit.com': 'Reddit',
    'stackoverflow.com': 'Stack Overflow',
  };
  if (known[h]) return known[h];
  const parts = h.split('.').filter(Boolean);
  if (parts.length >= 3 && parts[parts.length - 2] === 'google' && parts[parts.length - 1] === 'com') {
    return 'Google ' + titleCaseSegment(parts[0]);
  }
  if (parts.length >= 2) {
    const sld = parts[parts.length - 2];
    if (sld && sld !== 'co' && sld !== 'com') {
      return titleCaseSegment(sld.replace(/-/g, ' '));
    }
  }
  return titleCaseSegment(parts[0] || raw);
}

function isProbablyUrl(str) {
  return /https?:\/\//i.test(String(str)) || String(str).includes('://');
}

function siteTabDisplayName(site) {
  const t = String(site.siteTitle || '').trim();
  const hostLc = String(site.hostname || '').toLowerCase();
  if (t && !isProbablyUrl(t) && t.length < 80 && t.toLowerCase() !== hostLc) {
    return t;
  }
  if (site.hostname) return hostnameToFriendlySiteName(site.hostname);
  try {
    return hostnameToFriendlySiteName(new URL(site.pageKey).hostname);
  } catch (_) {
    return 'Site';
  }
}

function pageKeyToFriendlySiteName(pageKey) {
  if (!pageKey) return 'Site';
  try {
    return hostnameToFriendlySiteName(new URL(pageKey).hostname);
  } catch (_) {
    const s = String(pageKey).replace(/^https?:\/\//i, '').split('/')[0] || '';
    return hostnameToFriendlySiteName(s);
  }
}
