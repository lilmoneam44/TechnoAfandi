/**
 * @file store.js
 * @description Production-grade configuration and settings store for Techno Afandi FC27 Tool.
 * Compatible with Tauri v2 @tauri-apps/plugin-store with robust in-memory/localStorage fallback,
 * mutex-guarded initialization, and explicit error propagation.
 */

let storeInstance = null;
let storeInitPromise = null;
const SETTINGS_FILE = 'settings.json';

/**
 * Safely resolves or initializes the Tauri v2 Store instance.
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
      // 1. Try global Tauri v2 namespace
      if (typeof window !== 'undefined' && window.__TAURI__?.store?.load) {
        storeInstance = await window.__TAURI__.store.load(SETTINGS_FILE, { autoSave: true });
        return storeInstance;
      }

      // 2. Try ES module import if bundler environment supports it
      try {
        const tauriStorePlugin = await import('@tauri-apps/plugin-store');
        if (typeof tauriStorePlugin.load === 'function') {
          storeInstance = await tauriStorePlugin.load(SETTINGS_FILE, { autoSave: true });
          return storeInstance;
        } else if (typeof tauriStorePlugin.Store === 'function') {
          const store = new tauriStorePlugin.Store(SETTINGS_FILE);
          storeInstance = store;
          return storeInstance;
        }
      } catch {
        // Module not found or running in test/browser environment
      }

      // 3. Fallback to resilient WebStorage adapter
      storeInstance = createWebStorageAdapter();
      return storeInstance;
    } catch (err) {
      console.warn('[Store] Initializing Tauri store failed, falling back to WebStorage adapter:', err);
      storeInstance = createWebStorageAdapter();
      return storeInstance;
    } finally {
      storeInitPromise = null;
    }
  })();

  return storeInitPromise;
}

/**
 * Resilient WebStorage (localStorage) adapter implementing the Tauri v2 Store contract.
 */
function createWebStorageAdapter() {
  return {
    async get(key) {
      if (typeof key !== 'string' || !key.trim()) return null;
      try {
        const raw = localStorage.getItem(`ta_cfg_${key}`);
        return raw !== null ? JSON.parse(raw) : null;
      } catch (err) {
        console.error(`[StoreAdapter] Error reading key "${key}":`, err);
        return null;
      }
    },
    async set(key, value) {
      if (typeof key !== 'string' || !key.trim()) {
        throw new Error('[StoreAdapter] Invalid setting key');
      }
      try {
        localStorage.setItem(`ta_cfg_${key}`, JSON.stringify(value));
      } catch (err) {
        console.error(`[StoreAdapter] Error persisting key "${key}":`, err);
        throw new Error(`Failed to persist key "${key}" to local storage: ${err.message}`);
      }
    },
    async delete(key) {
      if (typeof key !== 'string' || !key.trim()) return;
      try {
        localStorage.removeItem(`ta_cfg_${key}`);
      } catch (err) {
        console.error(`[StoreAdapter] Error deleting key "${key}":`, err);
        throw new Error(`Failed to delete key "${key}": ${err.message}`);
      }
    },
    async save() {
      // localStorage writes synchronously
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
  const cleanPath = path.trim();
  return setSetting('gamePath', cleanPath);
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
