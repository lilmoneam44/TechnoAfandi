const OVERLAY_SELECTOR = '.modal-overlay';
const WRAPPER_SELECTOR = ':scope > .modal-wrap, :scope > .w-modal-wrap';
const FIT_GUTTER = 8;

function getWrapper(overlay) {
  return overlay.querySelector(WRAPPER_SELECTOR);
}

function fitOverlay(overlay) {
  const wrapper = getWrapper(overlay);
  if (!wrapper || !overlay.isConnected) return;

  const overlayStyle = getComputedStyle(overlay);
  const availableWidth = Math.max(
    0,
    overlay.clientWidth - parseFloat(overlayStyle.paddingLeft) - parseFloat(overlayStyle.paddingRight) - FIT_GUTTER,
  );
  const availableHeight = Math.max(
    0,
    overlay.clientHeight - parseFloat(overlayStyle.paddingTop) - parseFloat(overlayStyle.paddingBottom) - FIT_GUTTER,
  );
  const naturalWidth = wrapper.offsetWidth;
  const naturalHeight = wrapper.offsetHeight;

  if (!naturalWidth || !naturalHeight || !availableWidth || !availableHeight) return;

  const scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
  wrapper.style.setProperty('--modal-fit-scale', String(Math.max(0.01, scale)));
}

let scheduled = false;
const pendingOverlays = new Set();

function scheduleFit(overlay) {
  if (overlay?.matches(OVERLAY_SELECTOR)) pendingOverlays.add(overlay);
  if (scheduled) return;

  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const pending of pendingOverlays) fitOverlay(pending);
    pendingOverlays.clear();
  });
}

function scheduleAll() {
  document.querySelectorAll(OVERLAY_SELECTOR).forEach(scheduleFit);
}

const resizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const overlay = entry.target.matches(OVERLAY_SELECTOR)
      ? entry.target
      : entry.target.closest(OVERLAY_SELECTOR);
    scheduleFit(overlay);
  }
});

function observeOverlay(overlay) {
  const wrapper = getWrapper(overlay);
  if (!wrapper || wrapper.dataset.modalFitObserved) return;

  wrapper.dataset.modalFitObserved = 'true';
  resizeObserver.observe(overlay);
  resizeObserver.observe(wrapper);
  scheduleFit(overlay);
}

document.querySelectorAll(OVERLAY_SELECTOR).forEach(observeOverlay);

const mutationObserver = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes' && record.target.matches(OVERLAY_SELECTOR)) {
      scheduleFit(record.target);
    }

    if (record.type === 'childList') {
      if (record.target.matches?.(OVERLAY_SELECTOR)) observeOverlay(record.target);
      record.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.(OVERLAY_SELECTOR)) observeOverlay(node);
        node.querySelectorAll?.(OVERLAY_SELECTOR).forEach(observeOverlay);
        const overlay = node.closest?.(OVERLAY_SELECTOR);
        if (overlay) scheduleFit(overlay);
      });
      const overlay = record.target.closest?.(OVERLAY_SELECTOR);
      if (overlay) scheduleFit(overlay);
    }
  }
});

mutationObserver.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['class'],
});

window.addEventListener('resize', scheduleAll, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleAll, { passive: true });
window.addEventListener('load', scheduleAll, { once: true });
document.fonts?.ready.then(scheduleAll);
scheduleAll();
