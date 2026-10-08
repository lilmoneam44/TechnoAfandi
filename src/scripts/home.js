import './ui.js';
import { startTour, resumeTourIfActive } from './tour.js';
import { initI18n, t, currentLanguage, localizeProgressLabel } from './i18n.js';
import { check as checkTauriUpdate } from '@tauri-apps/plugin-updater';

initI18n();


// ===== Tauri v2 API helpers =====
const TAURI = window.__TAURI__;
const invoke = TAURI ? TAURI.core.invoke : null;
const listen = TAURI ? TAURI.event.listen : null;
let scanProgressUnlisten = null;
const scanProgressListenerReady = listen
  ? listen('game-scan-progress', ({ payload }) => renderScanProgress(payload))
      .then((unlisten) => { scanProgressUnlisten = unlisten; })
      .catch((error) => console.error('Game scan progress listener:', error))
  : Promise.resolve();

async function tauriInvoke(cmd, args) {
  if (!invoke) throw new Error("Tauri not available");
  return await invoke(cmd, args || {});
}

async function openExternal(url) {
  if (invoke) {
    try { await tauriInvoke('open_url', { url }); } catch (e) { console.error(e); }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
window.openExternal = openExternal;

// ===== Update System =====
let pendingUpdate = null;
let updateStatusState = { key: 'update.preparing' };
let updateInProgress = false;
let lastUpdatePaintAt = 0;

function renderUpdateStatus() {
  const status = document.getElementById('update-status');
  if (!status) return;
  if (updateStatusState.raw !== undefined) {
    status.textContent = localizeProgressLabel(updateStatusState.raw);
  } else {
    const suffix = updateStatusState.suffix ? ` ${updateStatusState.suffix}` : '';
    status.textContent = `${t(updateStatusState.key)}${suffix}`;
  }
}

async function checkForUpdate() {
  if (!TAURI) return null;
  try {
    return await checkTauriUpdate();
  } catch (e) {
    console.log('Update check:', e);
    return null;
  }
}

function showUpdateModal(update) {
  pendingUpdate = update;
  const version = update.version || '0.0.0';
  const currentVersion = window.APP_VERSION || '1.2.5';
  const versionChip = document.querySelector('#update-modal .version-chip');
  if (versionChip) {
    const current = document.createElement('div');
    current.className = 'ver';
    current.textContent = `V ${currentVersion}`;
    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    const next = document.createElement('div');
    next.className = 'ver new';
    next.textContent = `V ${version}`;
    versionChip.replaceChildren(current, arrow, next);
    versionChip.style.direction = 'ltr';
  }
  
  document.getElementById('update-modal').classList.add('active');
}

async function doUpdate() {
  if (!pendingUpdate || updateInProgress) return;
  updateInProgress = true;
  const update = pendingUpdate;
  const updateButton = document.querySelector('#update-modal .btn-update');
  const laterButton = document.querySelector('#update-modal .btn-close');
  if (updateButton) updateButton.disabled = true;
  if (laterButton) laterButton.disabled = true;
  const progress = document.getElementById('update-progress');
  const bar = document.getElementById('update-bar');
  const progressTrack = document.getElementById('update-bar-track');
  const status = document.getElementById('update-status');
  const announcer = document.getElementById('update-announcer');
  progress.style.display = 'block';
  status.style.color = '';
  progressTrack.setAttribute('aria-busy', 'true');
  let installed = false;
  try {
    if (!invoke) throw new Error('Updater is only available in the desktop app.');
    let contentLength = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        contentLength = event.data.contentLength || 0;
        progressTrack.classList.toggle('is-indeterminate', contentLength <= 0);
        progressTrack.removeAttribute('aria-valuenow');
        progressTrack.setAttribute('aria-valuetext', t('update.downloading'));
        bar.style.width = contentLength > 0 ? '0%' : '35%';
        updateStatusState = { key: 'update.downloading' };
        renderUpdateStatus();
        if (announcer) announcer.textContent = t('update.downloading');
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        if (Date.now() - lastUpdatePaintAt < 250) return;
        lastUpdatePaintAt = Date.now();
        const percent = contentLength > 0 ? Math.min(99, Math.floor((downloaded / contentLength) * 100)) : null;
        if (percent !== null) {
          progressTrack.setAttribute('aria-valuenow', String(percent));
          progressTrack.setAttribute('aria-valuetext', `${t('update.downloading')} ${percent}%`);
          bar.style.width = `${percent}%`;
          updateStatusState = { key: 'update.downloading', suffix: `${percent}%` };
        } else {
          updateStatusState = { key: 'update.downloading' };
        }
        renderUpdateStatus();
      } else if (event.event === 'Finished') {
        progressTrack.classList.remove('is-indeterminate');
        progressTrack.setAttribute('aria-valuenow', '100');
        progressTrack.setAttribute('aria-valuetext', t('update.installing'));
        bar.style.width = '100%';
        updateStatusState = { key: 'update.installing' };
        renderUpdateStatus();
        if (announcer) announcer.textContent = t('update.installing');
      }
    });
    installed = true;
    progressTrack.setAttribute('aria-busy', 'false');
    progressTrack.setAttribute('aria-valuenow', '100');
    progressTrack.setAttribute('aria-valuetext', t('update.complete'));
    updateStatusState = { key: 'update.complete' };
    renderUpdateStatus();
    if (announcer) announcer.textContent = t('update.complete');
  } catch (e) {
    progressTrack.setAttribute('aria-busy', 'false');
    progressTrack.classList.remove('is-indeterminate');
    progressTrack.removeAttribute('aria-valuenow');
    progressTrack.setAttribute('aria-valuetext', `${t('update.failed')} ${String(e)}`);
    updateStatusState = { key: 'update.failed', suffix: String(e) };
    renderUpdateStatus();
    if (announcer) announcer.textContent = `${t('update.failed')} ${String(e)}`;
    status.style.color = 'var(--red-1)';
  } finally {
    if (installed && pendingUpdate === update) {
      pendingUpdate = null;
      try { await update.close(); } catch (_) {}
    }
    updateInProgress = false;
    if (updateButton) updateButton.disabled = false;
    if (laterButton) laterButton.disabled = false;
  }
}

document.addEventListener('ta-language-changed', renderUpdateStatus);
document.addEventListener('ta-language-changed', () => {
  const track = document.getElementById('update-bar-track');
  if (!track) return;
  const text = updateStatusState.raw !== undefined
    ? localizeProgressLabel(updateStatusState.raw)
    : `${t(updateStatusState.key)}${updateStatusState.suffix ? ` ${updateStatusState.suffix}` : ''}`;
  track.setAttribute('aria-valuetext', text);
});
window.addEventListener('pagehide', () => scanProgressUnlisten?.(), { once: true });

// ===== State =====
let selectedMode = null;
let exeDir = null;
let autoLocateInProgress = false;
let gameScanCancelRequested = false;
let gameScanCommandStarted = false;
let lastGameScanProgress = { scanned_dirs: 0, current_drive: '' };

function renderScanProgress(progress = {}) {
  lastGameScanProgress = progress;
  const scanned = Math.max(0, Number(progress.scanned_dirs) || 0);
  const bar = document.getElementById('scan-progress');
  const fill = document.getElementById('scan-progress-fill');
  const count = document.getElementById('scan-count');
  if (!bar || !fill || !count) return;

  bar.setAttribute('aria-valuetext', `${new Intl.NumberFormat(currentLanguage()).format(scanned)} ${t('home.locate.scanned')}`);
  const drive = progress.current_drive ? ` · ${progress.current_drive}` : '';
  count.textContent = `${new Intl.NumberFormat(currentLanguage()).format(scanned)} ${t('home.locate.scanned')}${drive}`;
}
document.addEventListener('ta-language-changed', () => renderScanProgress(lastGameScanProgress));

async function cancelGameScan() {
  if (!autoLocateInProgress || gameScanCancelRequested) return;
  gameScanCancelRequested = true;
  const button = document.getElementById('btn-cancel-scan');
  if (button) {
    button.disabled = true;
    setLocalizedText(button, 'home.locate.cancelling');
  }
  const status = document.getElementById('locate-status');
  if (status) setLocalizedText(status, 'home.locate.cancelling');
  if (!gameScanCommandStarted) return;
  try {
    await tauriInvoke('cancel_game_scan');
  } catch (error) {
    console.error('Could not cancel game scan:', error);
    gameScanCancelRequested = false;
    if (button) {
      button.disabled = false;
      setLocalizedText(button, 'home.locate.cancelSearch');
    }
    if (status) setLocalizedText(status, 'home.locate.cancelError');
  }
}
window.cancelGameScan = cancelGameScan;

// Called when user clicks NEGLECT — skips update and continues
async function continueAfterUpdateCheck() {
  const update = await checkForUpdate();
  if (update) {
    showUpdateModal(update);
    return;
  }

  try { sessionStorage.setItem('ta_mode', selectedMode); } catch (e) {}
  if (exeDir) {
    try { sessionStorage.setItem('ta_exe_dir', exeDir); } catch (e) {}
  }

  if (invoke) {
    try {
      const ok = await tauriInvoke('check_game_folder', { exeDir });
      if (ok) {
        window.location.href = 'version_page_v2.html';
      } else {
        await showErrorModalWithDiagnostics();
      }
    } catch (e) {
      console.error(e);
      await showErrorModalWithDiagnostics();
    }
  } else {
    window.location.href = 'version_page_v2.html';
  }
}

function selectMode(mode) {
  if (mode === 'FMM' || mode === 'Live Editor') {
    selectedMode = mode;
    const fmmEl = document.getElementById('opt-fmm');
    const liveEl = document.getElementById('opt-live');
    setModeOption(fmmEl, mode === 'FMM');
    setModeOption(liveEl, mode === 'Live Editor');
  } else {
    window.gameMode = mode;
    const onlineEl = document.getElementById('mode-online');
    const offlineEl = document.getElementById('mode-offline');
    if (onlineEl) onlineEl.classList.toggle('selected', mode === 'online');
    if (offlineEl) offlineEl.classList.toggle('selected', mode === 'offline');
  }
}

function setModeOption(element, selected) {
  if (!element) return;
  element.classList.toggle('selected', selected);
  element.setAttribute('aria-checked', String(selected));
  element.tabIndex = selected ? 0 : -1;
}

function handleModeOptionKey(event, mode, isModal = false) {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    if (isModal) selectModeModal(mode);
    else selectMode(mode);
    return;
  }

  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const options = isModal
    ? ['modal-opt-fmm', 'modal-opt-live']
    : ['opt-fmm', 'opt-live'];
  const currentIndex = options.indexOf(event.target.closest('.mode-option')?.id);
  const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
  const nextIndex = (currentIndex + delta + options.length) % options.length;
  const next = document.getElementById(options[nextIndex]);
  if (next) {
    next.focus();
    if (isModal) selectModeModal(nextIndex === 0 ? 'FMM' : 'Live Editor');
    else selectMode(nextIndex === 0 ? 'FMM' : 'Live Editor');
  }
}
window.handleModeOptionKey = handleModeOptionKey;

function selectModeModal(mode) {
  selectedMode = mode;
  const fmmEl = document.getElementById('modal-opt-fmm');
  const liveEl = document.getElementById('modal-opt-live');
  setModeOption(fmmEl, mode === 'FMM');
  setModeOption(liveEl, mode === 'Live Editor');
  
  const mainFmmEl = document.getElementById('opt-fmm');
  const mainLiveEl = document.getElementById('opt-live');
  setModeOption(mainFmmEl, mode === 'FMM');
  setModeOption(mainLiveEl, mode === 'Live Editor');
  
  const errEl = document.getElementById('mode-error');
  if (errEl) errEl.style.display = 'none';
}
window.selectModeModal = selectModeModal;

async function submitMode() {
  if (!selectedMode) {
    const errEl = document.getElementById('mode-error');
    if (errEl) errEl.style.display = 'block';
    return;
  }
  document.getElementById('mode-warning-modal').classList.remove('active');
  await continueToVersion();
}


async function showErrorModalWithDiagnostics() {
  const setVal = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '—';
    el.classList.remove('ok', 'miss');
    if (cls) el.classList.add(cls);
  };

  setVal('err-path', exeDir || 'UNKNOWN');

  document.getElementById('error-modal').classList.add('active');

  if (invoke && exeDir) {
    try {
      const diag = await tauriInvoke('get_folder_diagnostics', { exeDir });
      setVal('err-path', diag.exe_dir);
      const setFlag = (id, found) => {
        const element = document.getElementById(id);
        if (!element) return;
        const key = found ? 'error.found' : 'error.missing';
        element.dataset.i18n = key;
        element.textContent = t(key);
        element.classList.toggle('found', Boolean(found));
        element.classList.toggle('miss', !found);
      };
      setFlag('err-installer-flag', diag.installer_dir_found);
      setFlag('err-installer-file-flag', diag.installer_found);
      setFlag('err-dbdata-flag', diag.dbdata_found);
    } catch (e) {
      console.error("diagnostics failed:", e);
    }
  }
}

async function continueToVersion() {
  if (!selectedMode) {
    document.getElementById('mode-warning-modal').classList.add('active');
    return;
  }

  // 1. Check Folder first!
  if (invoke) {
    try {
      const ok = await tauriInvoke('check_game_folder', { exeDir });
      if (!ok) {
        await showErrorModalWithDiagnostics();
        return; // Don't check for updates if folder is wrong
      }
    } catch (e) {
      console.error(e);
      await showErrorModalWithDiagnostics();
      return;
    }
  }

  // 2. Check for update only if folder is correct
  const update = await checkForUpdate();
  if (update) {
    showUpdateModal(update);
    return;
  }

  // 3. Save state and navigate
  try { sessionStorage.setItem('ta_mode', selectedMode); } catch (e) {}
  if (exeDir) {
    try { sessionStorage.setItem('ta_exe_dir', exeDir); } catch (e) {}
  }

  window.location.href = 'version_page_v2.html';
}

async function continueToVersionSkippingUpdate() {
  if (updateInProgress) return;
  document.getElementById('update-modal').classList.remove('active');
  if (pendingUpdate) {
    try { await pendingUpdate.close(); } catch (_) {}
    pendingUpdate = null;
  }
  try { sessionStorage.setItem('ta_mode', selectedMode); } catch (e) {}
  if (exeDir) {
    try { sessionStorage.setItem('ta_exe_dir', exeDir); } catch (e) {}
  }

  window.location.href = 'version_page_v2.html';
}
window.continueToVersionSkippingUpdate = continueToVersionSkippingUpdate;

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function closeStartupModal() {
  document.getElementById('startup-modal').classList.remove('active');
  try { sessionStorage.setItem('ta_startup_seen', '1'); } catch (e) {}
}

window.addEventListener('load', async () => {
  resumeTourIfActive();
  // Check if we need to auto-relocate after update
  if (invoke) {
    // Relocation logic removed to prevent auto-relocate loop on startup
  }

  // Welcome modal logic
  let seen = false;
  try {
    seen = sessionStorage.getItem('ta_startup_seen') === '1';
  } catch (e) {}

  if (!seen || window.location.search.includes('tour_done=1')) {
    document.getElementById('startup-modal').classList.add('active');
  }

  if (window.location.search.includes('tour_done=1')) {
    if (typeof window.showTourDone === 'function') {
      setTimeout(() => window.showTourDone(), 500); // Small delay to let the page render
    }
  }

  // Fetch exe dir once
  if (invoke) {
    try {
      exeDir = await tauriInvoke('get_exe_dir');
    } catch (e) {
      console.error("Failed to get exe dir:", e);
    }
    
    // Set version badge
    try {
      const version = await tauriInvoke('get_app_version');
      window.APP_VERSION = version; // Store for global use
      const badge = document.getElementById('version-badge');
      if (badge && version) {
        const icon = document.createElement('i');
        icon.className = 'ti ti-info-circle';
        badge.replaceChildren(icon, document.createTextNode(` V ${version}`));
      }
      const welcomeBadge = document.getElementById('welcome-version-badge');
      if (welcomeBadge && version) {
        welcomeBadge.innerText = version;
      }
    } catch (e) {
      console.error("Failed to set app version:", e);
    }
  }
});

// Global exports for inline HTML handlers
window.openExternal = openExternal;
window.selectMode = selectMode;
window.continueToVersion = continueToVersion;
window.closeModal = closeModal;
window.closeStartupModal = closeStartupModal;
window.doUpdate = doUpdate;
window.continueAfterUpdateCheck = continueAfterUpdateCheck;

window.startTourFromWelcome = () => {
  closeStartupModal();
  startTour();
};


window.takeTour = function() {
    // Take tour functionality to be added later
};

window.submitMode = submitMode;

window.pendingGamePath = null;

function setLocalizedText(element, key, suffix = '') {
  if (!element) return;
  element.dataset.i18n = key;
  if (suffix) element.dataset.i18nSuffix = suffix;
  else delete element.dataset.i18nSuffix;
  element.textContent = `${t(key)}${suffix ? ` ${suffix}` : ''}`;
}

async function handleFoundGameFolder(folderPath) {
  document.getElementById('error-modal')?.classList.remove('active');
  const statusEl = document.getElementById('locate-status');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#32cd32';
    setLocalizedText(statusEl, 'home.locate.found');
  }
  
  window.pendingGamePath = folderPath;
  const pathTextEl = document.getElementById('path-confirm-text');
  if (pathTextEl) {
    pathTextEl.textContent = folderPath;
  }
  document.getElementById('path-confirm-modal').classList.add('active');
}

window.confirmSavePath = async function() {
  const folderPath = window.pendingGamePath;
  if (!folderPath) return;
  
  closeModal('path-confirm-modal');
  const statusEl = document.getElementById('locate-status');
  
  try {
      const currentExePath = await tauriInvoke('get_current_exe_path');
      const exeName = currentExePath.split('\\').pop().split('/').pop();
      const targetPath = folderPath + '\\' + exeName;
      
      if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#fff';
          setLocalizedText(statusEl, 'home.locate.copying');
      }
      
      await tauriInvoke('copy_and_relaunch', { targetPath });
  } catch (e) {
      alert(t('home.locate.moveError') + ' ' + e);
  }
}

async function selectGameFolder() {
  const statusEl = document.getElementById('locate-status');
  if (statusEl) statusEl.style.display = 'none';

  let selected = null;
  try {
    selected = await tauriInvoke('plugin:dialog|open', { options: { directory: true, multiple: false } });
  } catch (e) {
    console.error("Dialog error:", e);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#FF4D4D';
      setLocalizedText(statusEl, 'home.locate.dialogError', String(e));
    }
  }

  if (selected) {
    try {
      // In Tauri v2, dialog return might be an array or object depending on plugin version/options
      let folderPath = selected;
      if (typeof selected === 'object') {
        if (Array.isArray(selected)) folderPath = selected[0];
        else if (selected.path) folderPath = selected.path;
        else if (selected.filePaths) folderPath = selected.filePaths[0];
        else folderPath = JSON.stringify(selected);
      }

      const isValid = await tauriInvoke('check_game_folder', { exeDir: folderPath });
      if (isValid) {
        await handleFoundGameFolder(folderPath);
      } else {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#FF4D4D';
          setLocalizedText(statusEl, 'home.locate.filesMissing', folderPath);
        }
      }
    } catch (err) {
      console.error("Check folder error:", err);
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#FF4D4D';
        setLocalizedText(statusEl, 'home.locate.checkError', String(err));
      }
    }
  }
}
window.selectGameFolder = selectGameFolder;

async function autoLocateGame() {
  if (autoLocateInProgress) return;
  autoLocateInProgress = true;
  gameScanCancelRequested = false;
  const button = document.getElementById('btn-auto-locate');
  const manualButton = document.querySelector('#error-modal .btn-manual');
  const cancelButton = document.getElementById('btn-cancel-scan');
  const scanProgress = document.getElementById('scan-progress');
  const statusEl = document.getElementById('locate-status');
  const btnText = document.getElementById('btn-auto-text');
  if (button) button.disabled = true;
  if (manualButton) manualButton.disabled = true;
  if (cancelButton) {
    cancelButton.hidden = false;
    cancelButton.disabled = false;
    setLocalizedText(cancelButton, 'home.locate.cancelSearch');
  }
  if (scanProgress) scanProgress.hidden = false;
  renderScanProgress({ scanned_dirs: 0 });
  
  setLocalizedText(btnText, 'home.locate.searching');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--ghost)';
    setLocalizedText(statusEl, 'home.locate.scanning');
  }
  
  try {
    await scanProgressListenerReady;
    if (gameScanCancelRequested) throw new Error('Game folder search cancelled.');
    gameScanCommandStarted = true;
    const foundPath = await tauriInvoke('auto_locate_game');
    if (foundPath) {
      await handleFoundGameFolder(foundPath);
    } else {
      setLocalizedText(btnText, 'error.auto');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#FF4D4D';
        setLocalizedText(statusEl, 'home.locate.notFound');
      }
    }
  } catch (err) {
    setLocalizedText(btnText, 'error.auto');
    if (statusEl) {
      statusEl.style.display = 'block';
      if (gameScanCancelRequested || String(err).toLowerCase().includes('cancelled')) {
        statusEl.style.color = 'var(--ghost)';
        setLocalizedText(statusEl, 'home.locate.cancelled');
      } else {
        statusEl.style.color = '#FF4D4D';
        setLocalizedText(statusEl, 'home.locate.searchError', String(err));
      }
    }
  } finally {
    autoLocateInProgress = false;
    gameScanCommandStarted = false;
    if (button) button.disabled = false;
    if (manualButton) manualButton.disabled = false;
    if (cancelButton) {
      cancelButton.hidden = true;
      cancelButton.disabled = false;
    }
    if (scanProgress) scanProgress.hidden = true;
    setLocalizedText(btnText, 'error.auto');
  }
}
window.autoLocateGame = autoLocateGame;

// Prevent forward history navigation from Home page
window.addEventListener('pageshow', () => {
  history.pushState(null, null, location.href);
});
window.addEventListener('popstate', () => {
  history.pushState(null, null, location.href);
});

// Also prevent default mouse back/forward button behavior on this page
window.addEventListener('mouseup', (e) => {
  if (e.button === 3 || e.button === 4) {
    e.preventDefault();
  }
});
window.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) {
    e.preventDefault();
  }
});
