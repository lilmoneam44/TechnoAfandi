function dispatchAction(element, event) {
  const action = element.dataset.action;
  const handler = window[action];
  if (typeof handler !== 'function') return;
  if (element.matches('a[href]')) event?.preventDefault();

  let result;
  if (action === 'openExternal') result = handler(element.href);
  else if (action === 'selectMode' || action === 'selectModeModal') result = handler(element.dataset.mode);
  else if (action === 'selectCancelChoice') result = handler(element.dataset.choice);
  else if (action === 'closeModal') result = handler(element.dataset.target);
  else result = handler();

  if (result && typeof result.catch === 'function') result.catch((error) => console.error(error));
}

document.addEventListener('click', (event) => {
  const element = event.target.closest('[data-action]');
  if (!element || element.disabled) return;
  dispatchAction(element, event);
});

document.querySelectorAll('.modal-overlay').forEach((dialog) => {
  const heading = dialog.querySelector('.title, h1, h2');
  if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  if (heading) {
    if (!heading.id) heading.id = `${dialog.id || 'modal'}-title`;
    dialog.setAttribute('aria-labelledby', heading.id);
  }
  dialog.setAttribute('aria-hidden', String(!dialog.classList.contains('active')));
});

let activeDialog = null;
let returnFocus = null;

function syncActiveDialog() {
  const next = [...document.querySelectorAll('.modal-overlay.active')].at(-1) || null;
  document.querySelectorAll('.modal-overlay').forEach((dialog) => {
    dialog.setAttribute('aria-hidden', String(dialog !== next));
  });
  if (next === activeDialog) return;

  if (next) {
    if (!activeDialog) returnFocus = document.activeElement;
    activeDialog = next;
    queueMicrotask(() => {
      if (activeDialog !== next) return;
      const first = [...next.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].find((element) => element.getClientRects().length > 0);
      (first || next.querySelector('[aria-labelledby]'))?.focus?.({ preventScroll: true });
    });
    return;
  }

  activeDialog = null;
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected && !returnFocus.matches(':disabled')) {
    returnFocus.focus({ preventScroll: true });
  }
  returnFocus = null;
}

new MutationObserver((records) => {
  if (records.some((record) => record.target.matches('.modal-overlay'))) syncActiveDialog();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
syncActiveDialog();

document.addEventListener('keydown', (event) => {
  const modeOption = event.target.closest('.mode-option[role="radio"][data-mode]');
  if (modeOption && typeof window.handleModeOptionKey === 'function') {
    window.handleModeOptionKey(event, modeOption.dataset.mode, Boolean(modeOption.closest('#mode-warning-modal')));
    return;
  }

  const cancelOption = event.target.closest('#cancel-modal .choice-option[data-choice]');
  if (cancelOption && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const options = [...document.querySelectorAll('#cancel-modal .choice-option[data-choice]')];
    const index = options.indexOf(cancelOption);
    const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    next.focus();
    dispatchAction(next, event);
    return;
  }
  if (cancelOption && ['Enter', ' ', 'Spacebar'].includes(event.key)) {
    event.preventDefault();
    dispatchAction(cancelOption, event);
    return;
  }

  if (activeDialog && event.key === 'Escape') {
    if (activeDialog.id === 'error-modal' && !document.getElementById('btn-cancel-scan')?.hidden) {
      event.preventDefault();
      window.cancelGameScan?.();
      return;
    }
    const escapeActions = {
      'startup-modal': () => window.closeStartupModal?.(),
      'mode-warning-modal': () => window.closeModal?.('mode-warning-modal'),
      'error-modal': () => window.closeModal?.('error-modal'),
      'update-modal': () => window.continueToVersionSkippingUpdate?.(),
      'path-confirm-modal': () => window.closeModal?.('path-confirm-modal'),
      'path-success-modal': () => window.closeModal?.('path-success-modal'),
      'result-modal': () => window.closeResultModal?.(),
    };
    if (activeDialog.id === 'cancel-modal' && !activeDialog.classList.contains('cancelling')) {
      event.preventDefault();
      window.selectCancelChoice?.('resume');
      window.submitCancelChoice?.();
      return;
    }
    if (escapeActions[activeDialog.id]) {
      event.preventDefault();
      const result = escapeActions[activeDialog.id]();
      if (result && typeof result.catch === 'function') result.catch((error) => console.error(error));
      return;
    }
  }

  if (!activeDialog || event.key !== 'Tab') return;
  const focusable = [...activeDialog.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    activeDialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
});

function updateCancelChoiceState() {
  const options = [...document.querySelectorAll('#cancel-modal .choice-option[data-choice]')];
  options.forEach((option) => {
    const selected = option.classList.contains('selected');
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  });
}

document.addEventListener('click', (event) => {
  if (event.target.closest('#cancel-modal .choice-option[data-choice]')) {
    queueMicrotask(updateCancelChoiceState);
  }
});
updateCancelChoiceState();

document.querySelectorAll('img[data-logo-fallback]').forEach((image) => {
  image.addEventListener('error', () => {
    if (image.dataset.logoFallback === 'used') {
      image.hidden = true;
      return;
    }
    image.dataset.logoFallback = 'used';
    const sourceFile = location.pathname.toLowerCase().includes('/src/');
    image.src = new URL(sourceFile ? '../public/logo.png' : 'logo.png', location.href).href;
  });
});

const particles = document.getElementById('particles');
if (particles && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const positions = [12, 22, 35, 48, 58, 68, 78, 88, 15, 62, 42, 82];
  positions.forEach((left, index) => {
    const particle = document.createElement('div');
    particle.className = `particle ${index % 2 ? 'purple' : 'teal'}`;
    particle.style.left = `${left}%`;
    particle.style.bottom = '0px';
    particle.style.animationDelay = `${(index * 1.2) % 5.5}s`;
    particle.style.animationDuration = `${6.2 + (index % 7) * 0.25}s`;
    particles.appendChild(particle);
  });
}
