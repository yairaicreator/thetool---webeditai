'use strict';

(function () {

  // ─── Local State (The Local Memory) ─────────────────────────────────────────
  let activeBlueprints = {};

  // ─── Utility: Debounce ──────────────────────────────────────────────────────
  function blueprintsToMap(blueprints) {
    if (!Array.isArray(blueprints)) return blueprints || {};
    var map = {};
    for (var i = 0; i < blueprints.length; i++) {
      map[blueprints[i].editId] = blueprints[i];
    }
    return map;
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ─── The CSS Muscle: Idempotent Blueprint Executor ──────────────────────────
  function applyAllBlueprints() {
    // Garbage Collection: tear down style tags for edits the Brain no longer considers active
    const existingTags = document.querySelectorAll('style[id^="webedit-style-"]');
    existingTags.forEach((tag) => {
      const editId = tag.id.slice('webedit-style-'.length);
      if (!activeBlueprints[editId]) {
        tag.remove();
      }
    });

    for (const [editId, edit] of Object.entries(activeBlueprints)) {
      if (edit.action !== 'remove') continue;

      const styleId = 'webedit-style-' + editId;
      if (document.getElementById(styleId)) continue;

      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = edit.selector + ' { display: none !important; }';
      document.head.appendChild(style);
    }
  }

  // ─── The Nervous System: Initialization ─────────────────────────────────────
  chrome.runtime.sendMessage(
    { command: 'GET_ACTIVE_BLUEPRINTS', url: window.location.href },
    function (response) {
      if (chrome.runtime.lastError) {
        console.warn('[Hands] Init failed:', chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.success) {
        console.warn('[Hands] Brain returned no active blueprints.');
        return;
      }
      activeBlueprints = blueprintsToMap(response.blueprints);
      applyAllBlueprints();
    }
  );

  // ─── The Spinal Listener: Live Updates from the Brain ───────────────────────
  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message.command === 'BLUEPRINTS_UPDATED') {
      activeBlueprints = blueprintsToMap(message.blueprints);
      applyAllBlueprints();
      sendResponse({ success: true });
    } else if (message.type === 'START_PICK_MODE') {
      startPickMode(message.reason);
      sendResponse({ ok: true });
    } else if (message.type === 'EXIT_FEATURES') {
      exitPickMode();
      sendResponse({ ok: true });
    }
    return true;
  });

  // ─── Pick Mode Logic ────────────────────────────────────────────────────────
  let isPickModeActive = false;
  let hoveredElement = null;
  let originalOutline = '';

  function generateSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id;
        path.unshift(selector);
        break;
      } else {
        let sib = el, nth = 1;
        while (sib = sib.previousElementSibling) {
          if (sib.nodeName.toLowerCase() == selector) nth++;
        }
        if (nth != 1) selector += ":nth-of-type(" + nth + ")";
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(" > ");
  }

  function handleMouseOver(e) {
    if (!isPickModeActive) return;
    e.stopPropagation();
    if (hoveredElement) {
      hoveredElement.style.outline = originalOutline;
    }
    hoveredElement = e.target;
    originalOutline = hoveredElement.style.outline;
    hoveredElement.style.outline = '2px solid #007bff';
    hoveredElement.style.outlineOffset = '-2px';
  }

  function handleMouseOut(e) {
    if (!isPickModeActive) return;
    e.stopPropagation();
    if (hoveredElement) {
      hoveredElement.style.outline = originalOutline;
      hoveredElement = null;
    }
  }

  function handleClick(e) {
    if (!isPickModeActive) return;
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target;
    const selector = generateSelector(target);
    const description = target.innerText ? target.innerText.slice(0, 30) : target.tagName.toLowerCase();
    
    exitPickMode();
    
    chrome.runtime.sendMessage({
      type: "WEBEDIT_ELEMENT_PICKED",
      payload: { selector, description }
    }).catch(() => {});
  }

  function startPickMode(reason) {
    if (isPickModeActive) return;
    isPickModeActive = true;
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);
  }

  function exitPickMode() {
    if (!isPickModeActive) return;
    isPickModeActive = false;
    if (hoveredElement) {
      hoveredElement.style.outline = originalOutline;
      hoveredElement = null;
    }
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
  }

  // ─── The Watchdog: Debounced MutationObserver ───────────────────────────────
  const debouncedApply = debounce(applyAllBlueprints, 50);
  const observer = new MutationObserver(debouncedApply);

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

})();
