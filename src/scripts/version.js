/**
 * @file version.js
 * @description Production-grade activation controller for Techno Afandi FC27 Tool.
 * Manages activation state machine, pause/resume flags, circular progress animation,
 * structured i18n status mapping, and explicit Action Registry binding.
 */

import { registerActions, openDialog, closeDialog } from './ui.js';
import { resumeTourIfActive } from './tour.js';
import { initI18n, t, formatProgressEvent, localizeProgressLabel } from './i18n.js';

// --- State Variables ---
let isActivating = false;
let isPaused = false;
let activeCancelChoice = 'resume'; // 'resume' or 'abort'
let pendingProgressPayload = null;
let animFrameHandle = null;

function getTauri() {
  return typeof window !== 'undefined' ? window.__TAURI__ : null;
}

async function tauriInvoke(cmd, args = {}) {
  const tauri = getTauri();
  if (tauri?.core?.invoke) {
    return tauri.core.invoke(cmd, args);
  }
  console.warn(`[Tauri Mock] invoke("${cmd}") called outside Tauri desktop environment.`);
  return null;
}

// --- Action Registry Binding ---
registerActions({
  goBack() {
    handleGoBack();
  },

  startActivation() {
    handleStartActivation();
  },

  togglePause() {
    handleTogglePause();
  },

  cancelActivation() {
    handleCancelActivation();
  },

  selectCancelChoice(element) {
    handleSelectCancelChoice(element);
  },

  submitCancelChoice() {
    handleSubmitCancelChoice();
  },

  closeResultModal() {
    closeDialog('result-modal');
  },

  exitApp() {
    handleExitApp();
  }
});

// --- Activation Workflow Handlers ---
async function handleStartActivation() {
  if (isActivating) return;

  isActivating = true;
  isPaused = false;
  updateControlsState();

  const statusLabel = document.getElementById('activation-status-text');
  if (statusLabel) statusLabel.textContent = t('progress.scanning');

  try {
    const tauri = getTauri();
    if (tauri?.event?.listen) {
      await tauri.event.listen('activation-progress', (event) => {
        bufferProgressEvent(event.payload);
      });

      await tauri.event.listen('activation-finish', (event) => {
        handleActivationFinish(event.payload);
      });
    }

    const gameDir = sessionStorage.getItem('ta_exe_dir') || '';
    const selectedMode = sessionStorage.getItem('ta_mode') || 'FMM';

    await tauriInvoke('start_activation', { exeDir: gameDir, selection: selectedMode, exe_dir: gameDir, mode: selectedMode });
  } catch (err) {
    console.error('[Activation] Failed to start activation:', err);
    handleActivationFinish({ success: false, message: String(err) });
  }
}

function bufferProgressEvent(payload) {
  pendingProgressPayload = payload;
  if (!animFrameHandle && typeof requestAnimationFrame !== 'undefined') {
    animFrameHandle = requestAnimationFrame(() => {
      animFrameHandle = null;
      if (pendingProgressPayload) {
        renderActivationProgress(pendingProgressPayload);
      }
    });
  }
}

function renderActivationProgress(payload) {
  const percentText = document.getElementById('progress-percent');
  const progressBar = document.getElementById('progress-bar-fill');
  const statusLabel = document.getElementById('activation-status-text');

  const percent = typeof payload === 'object' ? payload.percent : 0;
  const label = typeof payload === 'object' ? (payload.label || payload.message) : String(payload);

  if (percentText && percent !== undefined) {
    percentText.textContent = `${Math.min(100, Math.max(0, Math.round(percent)))}%`;
  }
  if (progressBar && percent !== undefined) {
    progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }
  if (statusLabel && label) {
    statusLabel.textContent = formatProgressEvent(label);
  }
}

async function handleTogglePause() {
  if (!isActivating) return;

  isPaused = !isPaused;
  const pauseBtn = document.getElementById('btn-pause');
  const statusLabel = document.getElementById('activation-status-text');

  if (isPaused) {
    if (pauseBtn) pauseBtn.textContent = t('btn.resume');
    if (statusLabel) statusLabel.textContent = t('progress.paused');
    await tauriInvoke('pause_activation');
  } else {
    if (pauseBtn) pauseBtn.textContent = t('btn.pause');
    if (statusLabel) statusLabel.textContent = t('progress.scanning');
    await tauriInvoke('resume_activation');
  }
}

function handleCancelActivation() {
  openDialog('cancel-modal');
}

function handleSelectCancelChoice(element) {
  const choice = element.dataset.choice || 'resume';
  activeCancelChoice = choice;

  document.querySelectorAll('[data-action="selectCancelChoice"]').forEach((el) => {
    const isChosen = (el.dataset.choice === choice);
    el.classList.toggle('selected', isChosen);
    el.setAttribute('aria-checked', isChosen ? 'true' : 'false');
  });
}

async function handleSubmitCancelChoice() {
  closeDialog('cancel-modal');

  if (activeCancelChoice === 'abort') {
    isActivating = false;
    isPaused = false;
    updateControlsState();
    await tauriInvoke('cancel_activation');
    const statusLabel = document.getElementById('activation-status-text');
    if (statusLabel) statusLabel.textContent = t('home.locate.cancelled');
  } else {
    // Resume operation
    if (isPaused) {
      handleTogglePause();
    }
  }
}

function handleActivationFinish(result) {
  isActivating = false;
  isPaused = false;
  updateControlsState();

  const resultTitle = document.getElementById('result-title');
  const resultMessage = document.getElementById('result-message');

  if (result?.success) {
    if (resultTitle) resultTitle.textContent = t('progress.completed');
    if (resultMessage) resultMessage.textContent = t('app.status.ready');
  } else {
    if (resultTitle) resultTitle.textContent = t('modal.error.title');
    if (resultMessage) resultMessage.textContent = result?.message || t('error.general');
  }

  openDialog('result-modal');
}

function updateControlsState() {
  const startBtn = document.getElementById('btn-start-activation');
  const pauseBtn = document.getElementById('btn-pause');
  const cancelBtn = document.getElementById('btn-cancel');

  if (startBtn) startBtn.disabled = isActivating;
  if (pauseBtn) pauseBtn.disabled = !isActivating;
  if (cancelBtn) cancelBtn.disabled = !isActivating;
}

function handleGoBack() {
  window.location.href = 'home_page_v2.html';
}

function handleExitApp() {
  tauriInvoke('exit_app').catch(() => {
    window.close();
  });
}

// Lifecycle
window.addEventListener('load', () => {
  initI18n();
  updateControlsState();
  resumeTourIfActive();
});
