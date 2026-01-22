// WebEdit AI - Feature Store (no-build safe)
// Persists committed features and replays them deterministically.

const FeatureStore = (() => {
  const STORE_KEY = "webeditCommittedFeaturesV1";
  const undoStack = [];
  const redoStack = [];

  function isExtensionContextValid() {
    try {
      if (typeof chrome === "undefined") return false;
      if (!chrome.storage || !chrome.storage.local) return false;
      return true;
    } catch {
      return false;
    }
  }

  function getScopeKey() {
    return `${location.origin}${location.pathname || "/"}`;
  }

  async function loadCommittedFeatures() {
    if (!isExtensionContextValid()) return [];
    return new Promise((resolve) => {
      chrome.storage.local.get([STORE_KEY], (result) => {
        const store = result?.[STORE_KEY] || {};
        const list = Array.isArray(store?.[getScopeKey()]) ? store[getScopeKey()] : [];
        resolve(list);
      });
    });
  }

  async function saveCommittedFeatures(list) {
    if (!isExtensionContextValid()) return false;
    return new Promise((resolve) => {
      chrome.storage.local.get([STORE_KEY], (result) => {
        const store = result?.[STORE_KEY] || {};
        store[getScopeKey()] = Array.isArray(list) ? list : [];
        chrome.storage.local.set({ [STORE_KEY]: store }, () => {
          resolve(!chrome.runtime.lastError);
        });
      });
    });
  }

  async function addCommittedFeature(record) {
    const list = await loadCommittedFeatures();
    if (list.some((r) => r.id === record.id)) return { ok: true, replayed: true };
    list.push(record);
    await saveCommittedFeatures(list);
    undoStack.push(record);
    redoStack.length = 0;
    return { ok: true };
  }

  async function removeCommittedFeature(id) {
    const list = await loadCommittedFeatures();
    const next = list.filter((r) => r.id !== id);
    await saveCommittedFeatures(next);
    return { ok: true };
  }

  async function restoreCommittedFeatures() {
    const list = await loadCommittedFeatures();
    if (!window.FeatureEngine) return { ok: false, error: "FeatureEngine not available" };
    let applied = 0;
    for (const record of list) {
      const res = window.FeatureEngine.applyFeature(record, "commit", { id: record.id });
      if (res?.ok) applied += 1;
    }
    return { ok: true, applied, total: list.length };
  }

  async function undoLastCommit() {
    const record = undoStack.pop();
    if (!record) return { ok: false, error: "Nothing to undo" };
    const res = window.FeatureEngine?.undoCommit?.(record);
    if (res?.ok) {
      await removeCommittedFeature(record.id);
      redoStack.push(record);
      return { ok: true };
    }
    return { ok: false, error: res?.error || "Undo failed" };
  }

  async function redoLastCommit() {
    const record = redoStack.pop();
    if (!record) return { ok: false, error: "Nothing to redo" };
    const res = window.FeatureEngine?.applyFeature?.(record, "commit", { id: record.id });
    if (res?.ok) {
      await addCommittedFeature(record);
      return { ok: true };
    }
    return { ok: false, error: res?.error || "Redo failed" };
  }

  return {
    restoreCommittedFeatures,
    addCommittedFeature,
    undoLastCommit,
    redoLastCommit
  };
})();

if (typeof window !== "undefined") {
  window.FeatureStore = FeatureStore;
  console.log("✅ FeatureStore loaded");
}

