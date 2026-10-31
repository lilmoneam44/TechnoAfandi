/**
 * @file modal_fit.js
 * @description Responsive modal layout engine for Techno Afandi FC27 Tool.
 * Enforces readable scale floor (0.85), sticky action buttons, scoped mutation observation,
 * and internal scrolling to prevent content clipping or microscopic shrinking.
 */

const MIN_SCALE_FLOOR = 0.85; // Never scale below 85% to preserve legibility and click targets
const VIEWPORT_PADDING = 24;  // Screen margin in pixels

let resizeObserver = null;
let mutationObserver = null;
let scheduledFrame = null;

/**
 * Calculates and applies responsive sizing and scale constraints on active modals.
 */
export function fitActiveModals() {
  scheduledFrame = null;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const activeModals = document.querySelectorAll(
    '.modal-overlay.active, .modal-backdrop.active, [role="dialog"].active'
  );
  if (!activeModals.length) return;

  const vWidth = window.innerWidth;
  const vHeight = window.innerHeight;

  const availableWidth = Math.max(280, vWidth - VIEWPORT_PADDING * 2);
  const availableHeight = Math.max(340, vHeight - VIEWPORT_PADDING * 2);

  activeModals.forEach((modal) => {
    const wrap = modal.querySelector('.modal-wrap, .w-modal-wrap, .modal-card') || modal.firstElementChild;
    if (!wrap) return;

    // Reset styles temporarily to read natural dimensions accurately
    wrap.style.transform = 'none';
    const rect = wrap.getBoundingClientRect();
    const naturalWidth = rect.width || 440;
    const naturalHeight = rect.height || 520;

    const scaleX = availableWidth / naturalWidth;
    const scaleY = availableHeight / naturalHeight;

    // Calculate ideal scale without exceeding 1.0 (no upscaling)
    let calculatedScale = Math.min(scaleX, scaleY, 1.0);

    // Apply scale floor: never shrink below readable threshold
    if (calculatedScale < MIN_SCALE_FLOOR) {
      calculatedScale = MIN_SCALE_FLOOR;
      // Enable internal scrolling when the dialog exceeds viewport bounds at the scale floor
      const maxScrollHeight = Math.floor(availableHeight / calculatedScale);
      wrap.style.maxHeight = `${maxScrollHeight}px`;
      wrap.style.overflowY = 'auto';

      // Keep action buttons sticky inside the scrollable modal wrapper
      const actionFooters = wrap.querySelectorAll('.modal-footer, .modal-actions, .confirm-actions, .startup-buttons');
      actionFooters.forEach((footer) => {
        footer.style.position = 'sticky';
        footer.style.bottom = '0';
        footer.style.zIndex = '10';
        footer.style.backdropFilter = 'blur(12px)';
      });
    } else {
      wrap.style.maxHeight = '';
      wrap.style.overflowY = '';
    }

    wrap.style.setProperty('--modal-fit-scale', calculatedScale.toFixed(3));
    wrap.style.transform = `scale(${calculatedScale})`;
    wrap.style.transformOrigin = 'center center';
  });
}

/**
 * Debounced scheduling via requestAnimationFrame to avoid layout thrashing.
 */
function scheduleFit() {
  if (scheduledFrame === null && typeof requestAnimationFrame !== 'undefined') {
    scheduledFrame = requestAnimationFrame(fitActiveModals);
  }
}

/**
 * Initializes listeners and scoped observers.
 */
export function initModalFit() {
  if (typeof window === 'undefined') return;

  window.addEventListener('resize', scheduleFit, { passive: true });

  // 1. Efficient ResizeObserver on document body
  if (typeof ResizeObserver !== 'undefined' && document.body) {
    resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(document.body);
  }

  // 2. Scoped MutationObserver: Targets ONLY modal overlays, not entire document tree
  if (typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver((mutations) => {
      let shouldFit = false;
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style')) {
          shouldFit = true;
          break;
        }
      }
      if (shouldFit) {
        scheduleFit();
      }
    });

    const modalContainers = document.querySelectorAll(
      '.modal-overlay, .modal-backdrop, [role="dialog"], #startup-modal, #path-confirm-modal, #mode-warning-modal, #update-modal, #game-scan-modal, #cancel-modal'
    );
    modalContainers.forEach((el) => {
      mutationObserver.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    });
  }

  scheduleFit();
}

/**
 * Cleanup helper for memory safety and test teardown.
 */
export function destroyModalFit() {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', scheduleFit);
  }
  if (scheduledFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(scheduledFrame);
    scheduledFrame = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

// Auto-run when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalFit);
  } else {
    initModalFit();
  }
}
