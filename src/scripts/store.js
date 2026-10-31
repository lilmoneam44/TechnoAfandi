/**
 * @file store.js
 * @description Production-grade configuration and settings store for Techno Afandi FC27 Tool.
 * Uses persistent local webview storage with mutex-guarded initialization, input validation,
 * and explicit error propagation. Avoids uninstalled package dependencies so Vite/Rollup builds cleanly.
 */

let storeInstance = null;
let storeInitPromise = null;
const SETTINGS_KEY_PREFIX = 'ta_cfg_';

/**
 * Resolves the active storage adapter.
 * Uses a promise lock to prevent concurrent initialization race conditions.
 * @returns {Promise<any>}
 */
export async function getStore() {
  if (storeInstance) {
    return storeInstance;
  }

  if (storeInitPromise) {
    return storeInitPromise;
  }

  storeInitPromise = (async () => {
    try {
      // 1. If Tauri store is injected globally at runtime, use it
      if (typeof window !== 'undefined' && window.__TAURI__?.store?.load) {
        try {
          storeInstance = await window.__TAURI__.store.load('settings.json', { autoSave: true });
          return storeInstance;
        } catch (e) {
          console.warn('[Store] Global Tauri store.load failed, falling back to WebStorage:', e);
        }
      }

      // 2. Persistent WebStorage adapter (native to WebView2 on Windows, persists across restarts)
      storeInstance = createPersistentStorageAdapter();
      return storeInstance;
    } finally {
      storeInitPromise = null;
    }
  })();

  return storeInitPromise;
}

/**
 * Robust persistent storage adapter implementing standard asynchronous store contract.
 */
function createPersistentStorageAdapter() {
  return {
    async get(key) {
      if (typeof key !== 'string' || !key.trim()) return null;
      try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(`${SETTINGS_KEY_PREFIX}${key.trim()}`);
        return raw !== null ? JSON.parse(raw) : null;
      } catch (err) {
        console.error(`[StoreAdapter] Error reading key "${key}":`, err);
        return null;
      }
    },

    async set(key, value) {
      if (typeof key !== 'string' || !key.trim()) {
        throw new Error('[StoreAdapter] Key must be a non-empty string');
      }
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(`${SETTINGS_KEY_PREFIX}${key.trim()}`, JSON.stringify(value));
      } catch (err) {
        console.error(`[StoreAdapter] Error persisting key "${key}":`, err);
        throw new Error(`Failed to persist key "${key}": ${err.message || String(err)}`);
      }
    },

    async delete(key) {
      if (typeof key !== 'string' || !key.trim()) return;
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(`${SETTINGS_KEY_PREFIX}${key.trim()}`);
      } catch (err) {
        console.error(`[StoreAdapter] Error deleting key "${key}":`, err);
        throw new Error(`Failed to delete key "${key}": ${err.message || String(err)}`);
      }
    },

    async save() {
      // WebStorage writes synchronously to local disk
      return true;
    }
  };
}

/**
 * Retrieves a setting with an optional default value.
 * @param {string} key 
 * @param {any} [defaultValue=null] 
 * @returns {Promise<any>}
 */
export async function getSetting(key, defaultValue = null) {
  if (typeof key !== 'string' || !key.trim()) {
    return defaultValue;
  }
  try {
    const store = await getStore();
    const val = await store.get(key);
    return val !== null && val !== undefined ? val : defaultValue;
  } catch (err) {
    console.error(`[Store] Failed to read setting "${key}":`, err);
    return defaultValue;
  }
}

/**
 * Persists a setting to storage with error propagation.
 * @param {string} key 
 * @param {any} value 
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setSetting(key, value) {
  if (typeof key !== 'string' || !key.trim()) {
    return { success: false, error: 'Invalid key: Key must be a non-empty string.' };
  }
  try {
    const store = await getStore();
    await store.set(key, value);
    if (typeof store.save === 'function') {
      await store.save();
    }
    return { success: true };
  } catch (err) {
    const errorMsg = `Failed to save setting "${key}": ${err.message || String(err)}`;
    console.error(`[Store] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Removes a setting from storage with error propagation.
 * @param {string} key 
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteSetting(key) {
  if (typeof key !== 'string' || !key.trim()) {
    return { success: false, error: 'Invalid key: Key must be a non-empty string.' };
  }
  try {
    const store = await getStore();
    await store.delete(key);
    if (typeof store.save === 'function') {
      await store.save();
    }
    return { success: true };
  } catch (err) {
    const errorMsg = `Failed to delete setting "${key}": ${err.message || String(err)}`;
    console.error(`[Store] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// --- Specific Application State Helpers ---

/**
 * Sets and validates the EA SPORTS FC 27 installation folder.
 * @param {string} path 
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setGamePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    return { success: false, error: 'Invalid game path: path cannot be empty.' };
  }
  return setSetting('gamePath', path.trim());
}

/**
 * Retrieves the persisted game installation folder.
 * @returns {Promise<string|null>}
 */
export async function getGamePath() {
  return getSetting('gamePath', null);
}

/**
 * Clears the persisted game installation folder with error reporting.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function clearGamePath() {
  return deleteSetting('gamePath');
}

/**
 * Retrieves the last chosen launcher mode ('FMM' or 'Live Editor').
 * @returns {Promise<string|null>}
 */
export async function getLastSelectedMode() {
  return getSetting('lastSelectedMode', null);
}

/**
 * Persists the last chosen launcher mode.
 * @param {'FMM'|'Live Editor'} mode 
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setLastSelectedMode(mode) {
  if (mode !== 'FMM' && mode !== 'Live Editor') {
    return { success: false, error: 'Invalid mode: must be "FMM" or "Live Editor"' };
  }
  return setSetting('lastSelectedMode', mode);
}
