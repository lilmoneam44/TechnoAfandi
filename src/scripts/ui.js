/**
 * @file ui.js
 * @description Secure Action Registry, accessible modal focus controller, and event delegator for Techno Afandi FC27 Tool.
 * Eliminates arbitrary window reflection, traps keyboard focus, and manages Escape key dialog teardown.
 */

// Centralized Action Registry: All valid actions must be explicitly registered
const ACTION_REGISTRY = new Map();

// Track previous active element for focus restoration
let lastFocusedElement = null;

/**
 * Registers an action handler in the Action Registry.
 * @param {string} actionName 
 * @param {(element: HTMLElement, event: Event) => void} handler 
 */
export function registerAction(actionName, handler) {
  if (typeof actionName !== 'string' || typeof handler !== 'function') {
    console.error(`[UI Registry] Invalid action registration for "${actionName}"`);
    return;
  }
  ACTION_REGISTRY.set(actionName, handler);
}

/**
 * Registers multiple actions at once.
 * @param {Record<string, (element: HTMLElement, event: Event) => void>} actionMap 
 */
export function registerActions(actionMap) {
  if (!actionMap || typeof actionMap !== 'object') return;
  for (const [name, handler] of Object.entries(actionMap)) {
    registerAction(name, handler);
  }
}

/**
 * Dispatches an action by name from the registry.
 * Completely eliminates arbitrary `window[action]` reflection.
 * @param {string} action 
 * @param {HTMLElement} element 
 * @param {Event} event 
 */
export function dispatchAction(action, element, event) {
  if (!action) return;

  const handler = ACTION_REGISTRY.get(action);
  if (handler) {
    try {
      handler(element, event);
    } catch (err) {
      console.error(`[UI Action] Error executing "${action}":`, err);
    }
  } else {
    console.warn(`[UI Action Blocked] Unregistered or unknown action "${action}" triggered by`, element);
  }
}

/**
 * Common default actions pre-registered for the application
 */
function registerDefaultActions() {
  // 1. Modal close action
  registerAction('closeModal', (element) => {
    const modalId = element.dataset.modal || element.closest('.modal-overlay, .modal-backdrop, [role="dialog"]')?.id;
    if (modalId) {
      closeDialog(modalId);
    } else {
      const parentModal = element.closest('.modal-overlay, .modal-backdrop, [role="dialog"]');
      if (parentModal) {
        parentModal.classList.remove('active');
        restoreFocus();
      }
    }
  });

  // 2. External URL opener
  registerAction('openExternal', (element) => {
    const url = element.dataset.url || element.getAttribute('href');
    if (!url) return;

    if (typeof window !== 'undefined' && window.__TAURI__?.opener?.openUrl) {
      window.__TAURI__.opener.openUrl(url).catch((err) => {
        console.error('[UI] Failed to open URL via Tauri opener:', err);
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    } else if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
      window.__TAURI__.core.invoke('open_url', { url }).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  });

  // 3. Language toggle bridge
  registerAction('toggleLanguage', () => {
    if (typeof window !== 'undefined' && typeof window.toggleLanguage === 'function') {
      window.toggleLanguage();
    }
  });
}

/**
 * Opens a modal dialog with accessibility focus management.
 * @param {string|HTMLElement} modalOrId 
 */
export function openDialog(modalOrId) {
  const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!modal) return;

  lastFocusedElement = document.activeElement;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');

  // Focus the first focusable element inside the modal
  requestAnimationFrame(() => {
    const focusable = modal.querySelector(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable) {
      focusable.focus();
    } else {
      modal.setAttribute('tabindex', '-1');
      modal.focus();
    }
  });
}

/**
 * Closes a modal dialog and restores focus to previous element.
 * @param {string|HTMLElement} modalOrId 
 */
export function closeDialog(modalOrId) {
  const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!modal) return;

  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  restoreFocus();
}

/**
 * Restores keyboard focus to the element that was focused before opening the dialog.
 */
function restoreFocus() {
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    try {
      lastFocusedElement.focus();
    } catch {}
    lastFocusedElement = null;
  }
}

/**
 * Keyboard trap and Escape listener
 * @param {KeyboardEvent} event 
 */
function handleKeyDown(event) {
  const activeModal = document.querySelector('.modal-overlay.active, .modal-backdrop.active, [role="dialog"].active');
  if (!activeModal) return;

  // Escape key closes top modal
  if (event.key === 'Escape') {
    event.preventDefault();
    const closeBtn = activeModal.querySelector('[data-action="closeModal"], [data-action="cancelModal"], .modal-close');
    if (closeBtn) {
      closeBtn.click();
    } else {
      closeDialog(activeModal);
    }
    return;
  }

  // Focus trap inside active modal
  if (event.key === 'Tab') {
    const focusables = Array.from(
      activeModal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusables.length) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
}

/**
 * Image fallback handler
 */
function setupImageFallbacks() {
  document.querySelectorAll('img[data-logo-fallback]').forEach((img) => {
    img.addEventListener('error', () => {
      if (img.dataset.hasFailedFallback) return;
      img.dataset.hasFailedFallback = 'true';
      img.src = img.dataset.fallbackSrc || 'logo.png';
    });
  });
}

/**
 * Global initialization
 */
export function initUI() {
  registerDefaultActions();

  document.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      dispatchAction(action, actionEl, event);
    }
  });

  document.addEventListener('keydown', handleKeyDown);
  setupImageFallbacks();
}

// Auto-run if loaded in browser
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
}
