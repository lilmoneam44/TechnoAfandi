/**
 * @file home.js
 * @description Production-grade home controller for Techno Afandi FC27 Tool.
 * Features: Unique operation IDs for scan cancellation, requestAnimationFrame progress debouncing,
 * keyboard accessible mode selection, explicit Action Registry registration, and quick-launch support.
 */

import { registerActions, openDialog, closeDialog } from './ui.js';
import { startTour, resumeTourIfActive } from './tour.js';
import { initI18n, t, currentLanguage, localizeProgressLabel } from './i18n.js';
import { getGamePath, setGamePath, getLastSelectedMode, setLastSelectedMode } from './store.js';

// --- State Management ---
let selectedMode = null;
let exeDir = null;
let autoLocateInProgress = false;
let gameScanCancelRequested = false;
let currentScanSessionId = 0;
let pendingProgressPayload = null;
let progressFrameHandle = null;

// --- Tauri IPC Wrappers ---
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

// --- Action Registry Implementation (Explicitly registering all home page actions) ---
registerActions({
  toggleLanguage() {
    if (typeof window.toggleLanguage === 'function') {
      window.toggleLanguage();
    }
  },

  selectMode(element) {
    const mode = element.dataset.mode;
    if (mode) handleSelectMode(mode);
  },

  selectModeModal(element) {
    const mode = element.dataset.mode;
    if (mode) handleSelectMode(mode);
  },

  submitMode() {
    if (!selectedMode) {
      openDialog('mode-warning-modal');
      return;
    }
    closeDialog('mode-warning-modal');
    continueToVersion();
  },

  continueToVersion() {
    continueToVersion();
  },

  continueToVersionSkippingUpdate() {
    closeDialog('update-modal');
    navigateToVersionPage();
  },

  doUpdate() {
    handlePerformUpdate();
  },

  autoLocateGame() {
    autoLocateGame();
  },

  selectGameFolder() {
    handleBrowseFolder();
  },

  confirmSavePath() {
    handleConfirmSavePath();
  },

  cancelGameScan() {
    cancelGameScan();
  },

  closeModal(element) {
    const modal = element.closest('.modal-overlay, .modal-backdrop, [role="dialog"]');
    if (modal) closeDialog(modal);
  },

  closeStartupModal() {
    closeStartupModal();
  },

  startTourFromWelcome() {
    closeStartupModal();
    startTour();
  },

  quickLaunch() {
    handleQuickLaunch();
  }
});

// --- Mode Selection with Keyboard Accessibility ---
function handleSelectMode(mode) {
  selectedMode = mode;
  setLastSelectedMode(mode).catch(() => {});

  const modeGroup = document.querySelector('.mode-group, [role="radiogroup"]');
  const options = document.querySelectorAll('.mode-option, [role="radio"]');

  options.forEach((opt) => {
    const isSelected = opt.dataset.mode === mode;
    opt.classList.toggle('selected', isSelected);
    opt.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    opt.setAttribute('tabindex', isSelected ? '0' : '-1');
  });

  const launchBtn = document.getElementById('launch-btn');
  if (launchBtn) {
    launchBtn.removeAttribute('disabled');
    launchBtn.classList.add('ready');
  }
}

/**
 * Keyboard navigation between radio mode options (Left/Right, Up/Down).
 */
function setupModeKeyboardNav() {
  const modeGroup = document.querySelector('.mode-group, [role="radiogroup"]');
  if (!modeGroup) return;

  modeGroup.addEventListener('keydown', (e) => {
    const options = Array.from(modeGroup.querySelectorAll('.mode-option, [role="radio"]'));
    const currentIndex = options.findIndex((opt) => opt.dataset.mode === selectedMode);

    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
    }

    if (nextIndex >= 0 && options[nextIndex]) {
      const nextMode = options[nextIndex].dataset.mode;
      handleSelectMode(nextMode);
      options[nextIndex].focus();
    }
  });
}

// --- Automated Game Location with Unique Operation IDs & Saturation Debouncing ---
export async function autoLocateGame() {
  if (autoLocateInProgress) return;

  autoLocateInProgress = true;
  gameScanCancelRequested = false;
  const thisScanSessionId = ++currentScanSessionId;

  // UI status update
  const scanModal = document.getElementById('game-scan-modal') || document.getElementById('startup-modal');
  if (scanModal) openDialog(scanModal);

  const statusLabel = document.getElementById('scan-status-text') || document.querySelector('.scan-status');
  if (statusLabel) statusLabel.textContent = t('home.locate.scanning');

  try {
    // Setup debounced listener for Tauri scan events
    const tauri = getTauri();
    if (tauri?.event?.listen) {
      await tauri.event.listen('game-scan-progress', (event) => {
        // Discard stale events from canceled or expired sessions
        if (thisScanSessionId !== currentScanSessionId || gameScanCancelRequested) {
          return;
        }
        bufferScanProgress(event.payload);
      });
    }

    const detectedPath = await tauriInvoke('auto_locate_game');

    // Terminal state verification: check if cancelled during backend operation
    if (thisScanSessionId !== currentScanSessionId || gameScanCancelRequested) {
      console.log(`[GameScan] Discarded result from canceled session #${thisScanSessionId}`);
      return;
    }

    if (detectedPath && typeof detectedPath === 'string') {
      exeDir = detectedPath;
      await setGamePath(detectedPath);
      showPathSuccess(detectedPath);
    } else {
      showPathNotFound();
    }
  } catch (err) {
    if (thisScanSessionId === currentScanSessionId && !gameScanCancelRequested) {
      console.error('[GameScan] Auto-locate encountered an error:', err);
      showPathNotFound();
    }
  } finally {
    if (thisScanSessionId === currentScanSessionId) {
      autoLocateInProgress = false;
    }
  }
}

/**
 * Debounces rapid backend progress events via requestAnimationFrame.
 */
function bufferScanProgress(payload) {
  pendingProgressPayload = payload;
  if (!progressFrameHandle && typeof requestAnimationFrame !== 'undefined') {
    progressFrameHandle = requestAnimationFrame(() => {
      progressFrameHandle = null;
      if (pendingProgressPayload) {
        renderScanProgress(pendingProgressPayload);
      }
    });
  }
}

function renderScanProgress(payload) {
  const countEl = document.getElementById('scan-count') || document.querySelector('.scan-count');
  const barEl = document.getElementById('scan-progress-fill') || document.querySelector('.modal-progress-bar');
  const labelEl = document.getElementById('scan-status-text') || document.querySelector('.scan-status');

  if (countEl && payload?.count !== undefined) {
    countEl.textContent = String(payload.count);
  }
  if (barEl && payload?.percent !== undefined) {
    barEl.style.width = `${Math.min(100, Math.max(0, payload.percent))}%`;
  }
  if (labelEl && payload?.current_dir) {
    labelEl.textContent = payload.current_dir;
  }
}

/**
 * Cancels active game scan with session invalidation.
 */
export function cancelGameScan() {
  if (!autoLocateInProgress || gameScanCancelRequested) return;

  gameScanCancelRequested = true;
  currentScanSessionId++; // Invalidate active session immediately
  autoLocateInProgress = false;

  const statusLabel = document.getElementById('scan-status-text') || document.querySelector('.scan-status');
  if (statusLabel) statusLabel.textContent = t('home.locate.cancelled');

  tauriInvoke('cancel_game_scan').catch(() => {});

  setTimeout(() => {
    closeDialog('game-scan-modal');
  }, 400);
}

// --- Folder Browsing & Validation ---
async function handleBrowseFolder() {
  const tauri = getTauri();
  let selected = null;

  if (tauri?.dialog?.open) {
    selected = await tauri.dialog.open({ directory: true, multiple: false, title: t('btn.browse') });
  } else {
    // Check common default install paths as intelligent suggestion
    const defaultPaths = [
      'C:\\Program Files\\EA Games\\EA SPORTS FC 27',
      'C:\\Program Files (x86)\\Origin Games\\EA SPORTS FC 27',
      'D:\\Games\\EA SPORTS FC 27'
    ];
    selected = prompt(t('btn.browse'), defaultPaths[0]);
  }

  if (selected && typeof selected === 'string') {
    const isValid = await tauriInvoke('check_game_folder', { exeDir: selected });
    if (isValid) {
      exeDir = selected;
      await setGamePath(selected);
      showPathSuccess(selected);
    } else {
      showPathError(selected);
    }
  }
}

function showPathSuccess(path) {
  const pathDisplay = document.getElementById('detected-path-text');
  if (pathDisplay) pathDisplay.textContent = path;
  openDialog('path-success-modal');
}

function showPathError(path) {
  const errPath = document.getElementById('error-path-text');
  if (errPath) errPath = path;
  openDialog('game-error-modal');
}

function showPathNotFound() {
  openDialog('path-confirm-modal');
}

function handleConfirmSavePath() {
  closeDialog('path-success-modal');
  closeDialog('path-confirm-modal');
}

// --- Launch Sequence & Quick Launch ---
export async function continueToVersion() {
  if (!selectedMode) {
    openDialog('mode-warning-modal');
    return;
  }

  // Ensure game path is available
  if (!exeDir) {
    exeDir = await getGamePath();
  }

  if (!exeDir) {
    autoLocateGame();
    return;
  }

  // Validate folder before proceeding
  const isValid = await tauriInvoke('check_game_folder', { exeDir });
  if (isValid === false) {
    openDialog('game-error-modal');
    return;
  }

  navigateToVersionPage();
}

async function handleQuickLaunch() {
  const savedPath = await getGamePath();
  const savedMode = await getLastSelectedMode();

  if (savedPath && savedMode) {
    exeDir = savedPath;
    selectedMode = savedMode;
    const isValid = await tauriInvoke('check_game_folder', { exeDir: savedPath });
    if (isValid) {
      navigateToVersionPage();
      return;
    }
  }
  // Fallback to normal flow if quick launch prerequisites aren't ready
  continueToVersion();
}

function navigateToVersionPage() {
  try {
    sessionStorage.setItem('ta_mode', selectedMode || 'FMM');
    if (exeDir) sessionStorage.setItem('ta_exe_dir', exeDir);
  } catch {}
  window.location.href = 'version_page_v2.html';
}

function closeStartupModal() {
  closeDialog('startup-modal');
  try {
    sessionStorage.setItem('ta_startup_seen', '1');
  } catch {}
}

async function handlePerformUpdate() {
  const updateStatus = document.getElementById('update-status');
  if (updateStatus) updateStatus.textContent = t('progress.downloading', { file: 'Update', percent: '0', speed: '' });
  // Invoke updater if plugin present
}

// --- App Initialization Lifecycle ---
window.addEventListener('load', async () => {
  initI18n();
  setupModeKeyboardNav();

  // Restore cached mode and game path if previously saved
  const cachedMode = await getLastSelectedMode();
  if (cachedMode) handleSelectMode(cachedMode);

  exeDir = await getGamePath();

  // Check if guided tour should resume
  resumeTourIfActive();

  // Show welcome startup dialog on first run
  try {
    if (sessionStorage.getItem('ta_startup_seen') !== '1') {
      const startup = document.getElementById('startup-modal');
      if (startup) openDialog(startup);
    }
  } catch {}
});
