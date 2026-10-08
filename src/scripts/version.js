import './ui.js';
import { resumeTourIfActive } from './tour.js';
import { initI18n, t, currentLanguage, localizeProgressLabel } from './i18n.js';

initI18n();

let activeStatusKey = 'version.ready';
function setStatus(key) {
  activeStatusKey = key;
  const status = document.getElementById('status-text');
  if (status) status.textContent = t(key);
}

// ===== Tauri v2 API helpers =====
const TAURI = window.__TAURI__;
const invoke = TAURI ? TAURI.core.invoke : null;
const listen = TAURI ? TAURI.event.listen : null;
let backendListenersReady = !listen;
if (listen) document.getElementById('start-btn')?.setAttribute('disabled', '');

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

// ===== Navigation =====
history.pushState(null, null, location.href);
window.addEventListener('popstate', (e) => {
  const btnBack = document.getElementById('btn-back');
  if (btnBack && btnBack.disabled) {
    history.pushState(null, null, location.href);
    if (typeof cancelActivation === 'function') cancelActivation();
  } else {
    window.location.href = 'home_page_v2.html';
  }
});

function goBack() {
  window.location.href = 'home_page_v2.html';
}

function closeResultModal() {
  activeResult = null;
  document.getElementById('result-modal').classList.remove('active');
  window.location.href = 'home_page_v2.html';
}

// ===== Activation state =====
function setActivating(active) {
  document.getElementById('start-btn').disabled = active;
  document.getElementById('btn-back').disabled = active;
  const cancelBtn = document.getElementById('cancel-btn');
  const pauseBtn = document.getElementById('pause-btn');
  if (active) {
    cancelBtn.classList.add('active');
    pauseBtn.classList.add('active');
  } else {
    cancelBtn.classList.remove('active');
    pauseBtn.classList.remove('active');
    pauseBtn.classList.remove('paused');
    setPauseLabel('version.pause');
  }
}

function setPauseLabel(key) {
  const labelEl = document.getElementById('pause-label');
  if (labelEl) labelEl.textContent = t(key);
}

let lastProgressPercent = 0;
let lastProgressLabel = '';
let activeResult = null;
let activationStartPending = false;
let demoActivationTimer = null;
let pendingCancelChoice = null;
let pendingActivationDoneResolve = null;

// ===== UI =====
function updateProgress(percent, text) {
  const value = Number(percent);
  const safePercent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  lastProgressPercent = Math.floor(safePercent);
  const labelChanged = lastProgressLabel !== text;
  lastProgressLabel = text;
  document.getElementById('progress-container').classList.add('active');
  document.getElementById('progress-fill').style.width = safePercent + '%';
  document.getElementById('progress-text-content').textContent = localizeProgressLabel(text);
  document.getElementById('progress-pct').textContent = `${lastProgressPercent}%`;
  const progressBar = document.getElementById('activation-progressbar');
  if (progressBar) {
    progressBar.setAttribute('aria-valuenow', String(lastProgressPercent));
    progressBar.setAttribute('aria-valuetext', `${localizeProgressLabel(text)} ${lastProgressPercent}%`);
  }
  const announcement = document.getElementById('progress-announcer');
  const progressBucket = Math.floor(lastProgressPercent / 10) * 10;
  if (announcement && (labelChanged || announcement.dataset.bucket !== String(progressBucket))) {
    announcement.textContent = `${localizeProgressLabel(text)} ${progressBucket}%`;
    announcement.dataset.bucket = String(progressBucket);
  }
}

function refreshResultText() {
  if (!activeResult) return;
  const { success, customMessage } = activeResult;
  const title = document.getElementById('result-title');
  const message = document.getElementById('result-message');
  title.textContent = t(success ? 'result.success.title' : 'result.failure.title');
  message.textContent = customMessage || t(success ? 'result.success.message' : 'result.failure.message');
  document.getElementById('result-status-text').textContent = t(success ? 'result.success.status' : 'result.failure.status');

  const btn = document.getElementById('result-btn');
  const icon = document.createElement('i');
  icon.id = 'result-btn-icon';
  icon.style.fontSize = '15px';
  if (success) {
    btn.className = 'btn-success';
    icon.className = 'ti ti-arrow-right';
    btn.replaceChildren(icon, document.createTextNode(` ${t('result.home')}`));
    btn.dataset.action = 'closeResultModal';
  } else {
    btn.className = 'btn-fail';
    icon.className = 'ti ti-refresh';
    btn.replaceChildren(icon, document.createTextNode(` ${t('result.retry')}`));
    btn.dataset.action = 'retryActivation';
  }
}

function showSuccess(customMessage) {
  activeResult = { success: true, customMessage };
  const box = document.getElementById('result-modal-box');
  box.className = 'modal res-success';
  document.getElementById('result-badge-icon').className = 'ti ti-check';
  refreshResultText();

  document.getElementById('result-modal').classList.add('active');
  setActivating(false);
}

function showFailure(customMessage) {
  activeResult = { success: false, customMessage };
  const box = document.getElementById('result-modal-box');
  box.className = 'modal res-fail';
  document.getElementById('result-badge-icon').className = 'ti ti-x';
  refreshResultText();

  document.getElementById('result-modal').classList.add('active');
  setActivating(false);
}



function renderMode() {
  let mode = null;
  try { mode = sessionStorage.getItem('ta_mode'); } catch (e) {}
  if (!mode) mode = 'FMM';

  const chip = document.getElementById('mode-chip');
  const val = document.getElementById('mode-value');
  val.textContent = mode.toUpperCase();

  chip.classList.remove('live');
  if (mode.toUpperCase() === 'LIVE EDITOR') {
    chip.classList.add('live');
  }
}

async function startActivation() {
  const startBtn = document.getElementById('start-btn');
  const backBtn = document.getElementById('btn-back');
  if (activationStartPending || startBtn.disabled || !backendListenersReady) return;

  // Lock synchronously before awaiting Tauri so double clicks cannot spawn two
  // activation workers or reset their shared pause/cancel flags.
  activationStartPending = true;
  startBtn.disabled = true;
  backBtn.disabled = true;
  try {
    let exeDir = null;
    if (invoke) {
      try { exeDir = await tauriInvoke('get_exe_dir'); } catch (e) { console.error(e); }
    }
    let selection = null;
    try { selection = sessionStorage.getItem('ta_mode'); } catch (e) {}

    if (invoke && (!exeDir || exeDir.trim() === '')) {
      showFailure(currentLanguage() === 'en' ? 'The game folder path is not saved. Return home and choose the folder again.' : 'مسار مجلد اللعبة غير محفوظ. ارجع للصفحة الرئيسية وحدد المجلد مرة أخرى.');
      return;
    }
    if (!selection || selection.trim() === '') {
      showFailure(currentLanguage() === 'en' ? 'No activation method is selected. Return and choose FMM or Live Editor.' : 'لم تختر طريقة التفعيل. ارجع واختر FMM أو Live Editor.');
      return;
    }

    setActivating(true);
    setStatus('version.activating');

    if (invoke) {
      try {
        await tauriInvoke('start_activation', { exeDir, selection });
      } catch (e) {
        setActivating(false);
        showFailure(String(e));
      }
    } else {
      // Browser preview uses a local-only demo; it never touches game files.
      let p = 0;
      demoActivationTimer = setInterval(() => {
        if (document.getElementById('pause-btn').classList.contains('paused')) return;
        p += 5;
        updateProgress(p, `Task progress ${p}%`);
        if (p >= 100) {
          clearInterval(demoActivationTimer);
          demoActivationTimer = null;
          showSuccess();
        }
      }, 500);
    }
  } finally {
    activationStartPending = false;
    if (!document.getElementById('pause-btn').classList.contains('active')) {
      startBtn.disabled = false;
      backBtn.disabled = false;
    }
  }
}

async function togglePause() {
  const btn = document.getElementById('pause-btn');
  if (btn.classList.contains('paused')) {
    btn.classList.remove('paused');
    setPauseLabel('version.pause');
    setStatus('version.activating');
    if (invoke) {
      try { await tauriInvoke('resume_activation'); } catch (e) { console.error(e); }
    }
  } else {
    btn.classList.add('paused');
    setPauseLabel('version.resume');
    setStatus('version.paused');
    if (invoke) {
      try { await tauriInvoke('pause_activation'); } catch (e) { console.error(e); }
    }
  }
}

function showCancelModal() {
  // Pause in backend
  if (invoke) {
    tauriInvoke('pause_activation').catch((e) => console.error(e));
  }
  const btn = document.getElementById('pause-btn');
  btn.classList.add('paused');
  setPauseLabel('version.resume');
  setStatus('version.paused');

  // Update modal progress
  document.getElementById('cancel-progress-fill').style.width = lastProgressPercent + '%';
  document.getElementById('cancel-progress-pct').textContent = lastProgressPercent + '%';
  document.getElementById('cancel-progress-meta').textContent = localizeProgressLabel(lastProgressLabel);
  document.getElementById('cancel-vmain').textContent = document.getElementById('vmain').textContent;

  currentCancelChoice = 'resume';
  selectCancelChoice('resume');
  const confirmButton = document.querySelector('#cancel-modal .actions .btn-cancel');
  const waiting = document.getElementById('cancel-waiting');
  confirmButton.disabled = false;
  waiting.hidden = true;
  document.getElementById('cancel-modal').classList.remove('cancelling');
  document.getElementById('cancel-modal').classList.add('active');
}

let currentCancelChoice = 'resume';
function selectCancelChoice(choice) {
  if (pendingCancelChoice) return;
  currentCancelChoice = choice;
  const options = document.querySelectorAll('#cancel-modal .choice-option');
  options.forEach((option) => {
    const selected = option.dataset.choice === choice;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  });
}
window.selectCancelChoice = selectCancelChoice;

async function submitCancelChoice() {
  if (currentCancelChoice === 'resume') {
    document.getElementById('cancel-modal').classList.remove('active');
    const btn = document.getElementById('pause-btn');
    btn.classList.remove('paused');
    setPauseLabel('version.pause');
    setStatus('version.activating');
    if (invoke) {
      try { await tauriInvoke('resume_activation'); } catch (e) { console.error(e); }
    }
    return;
  }

  const choice = currentCancelChoice;
  const confirmButton = document.querySelector('#cancel-modal .actions .btn-cancel');
  const waiting = document.getElementById('cancel-waiting');
  confirmButton.disabled = true;
  waiting.textContent = t('cancel.waiting');
  waiting.hidden = false;
  document.getElementById('cancel-modal').classList.add('cancelling');

  if (!invoke) {
    if (demoActivationTimer !== null) clearInterval(demoActivationTimer);
    demoActivationTimer = null;
    pendingCancelChoice = null;
    waiting.hidden = true;
    document.getElementById('cancel-modal').classList.remove('active');
    document.getElementById('cancel-modal').classList.remove('cancelling');
    setActivating(false);
    window.location.href = 'home_page_v2.html';
    return;
  }

  pendingCancelChoice = choice;
  const activationDone = new Promise((resolve) => { pendingActivationDoneResolve = resolve; });
  try {
    await tauriInvoke('cancel_activation');
    await activationDone;
    if (choice === 'delete') await tauriInvoke('clean_temp_files');
    waiting.hidden = true;
    document.getElementById('cancel-modal').classList.remove('active');
    document.getElementById('cancel-modal').classList.remove('cancelling');
    confirmButton.disabled = false;

    if (isExiting) {
      await tauriInvoke('exit_app');
    } else {
      setActivating(false);
      window.location.href = 'home_page_v2.html';
    }
  } catch (e) {
    pendingCancelChoice = null;
    pendingActivationDoneResolve = null;
    waiting.textContent = `${t('cancel.stopFailed')} ${e}`;
    confirmButton.disabled = false;
    document.getElementById('cancel-modal').classList.remove('cancelling');
  }
}
window.submitCancelChoice = submitCancelChoice;

async function cancelActivation() {
  showCancelModal();
}
window.cancelActivation = cancelActivation;

// ===== Event listeners for backend =====
let isExiting = false;
async function setupEventListeners() {
  if (!listen) return;

  await listen('activation-progress', (event) => {
    const { percent, label } = event.payload || {};
    const pct = typeof percent === 'number' ? Math.floor(percent) : 0;
    updateProgress(pct, label || 'Working');
  });

  await listen('activation-done', (event) => {
    const { success, message } = event.payload || {};
    if (pendingCancelChoice) {
      pendingCancelChoice = null;
      const resolve = pendingActivationDoneResolve;
      pendingActivationDoneResolve = null;
      if (resolve) resolve({ success, message });
      return;
    }
    if (success) {
      updateProgress(100, 'Complete (100%)');
      showSuccess(message);
    } else {
      showFailure(message);
    }
  });

  await listen('show-exit-modal', () => {
    isExiting = true;
    const isActivating = document.getElementById('start-btn').disabled; // true if active
    if (isActivating) {
      showCancelModal();
    } else {
      // Just close the app, no download is active
      if (invoke) tauriInvoke('exit_app').catch((error) => console.error(error));
    }
  });
  backendListenersReady = true;
  const startBtn = document.getElementById('start-btn');
  if (startBtn && !activationStartPending) startBtn.disabled = false;
}

window.addEventListener('load', async () => {
  resumeTourIfActive();
  renderMode();
  setStatus('version.ready');
  document.getElementById('vmain').textContent = t('version.loading');
  document.getElementById('progress-text-content').textContent = t('version.initializing');

  // The activation button stays disabled until both backend event handlers are
  // registered, so a quick click cannot miss the completion event.
  try {
    await setupEventListeners();
  } catch (error) {
    console.error('Failed to register backend listeners:', error);
    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.disabled = true;
    showFailure(currentLanguage() === 'en'
      ? 'The app could not connect to its progress events. Restart the tool and try again.'
      : 'تعذر الاتصال بأحداث التقدم. أعد تشغيل الأداة وحاول مرة أخرى.');
    if (startBtn) startBtn.disabled = true;
  }

  // Fetch game version
  if (invoke) {
    let exeDir = null;
    try { exeDir = await tauriInvoke('get_exe_dir'); } catch (e) { console.error(e); }

    if (exeDir) {
      try {
        const result = await tauriInvoke('get_game_version', { exeDir });
        // Rust returns tuple (version1, version2) which arrives as array [v1, v2]
        const [v1, v2] = Array.isArray(result) ? result : [result, ''];
        document.getElementById('vmain').textContent = v1 || 'غير معروف';
        document.getElementById('vsem').textContent = v2 || 'غير معروف';
      } catch (e) {
        console.error("Failed to get game version:", e);
        document.getElementById('vmain').textContent = t('cancel.unknown');
        document.getElementById('vsem').textContent = t('cancel.unknown');
      }
    }
  } else {
    // Browser fallback demo values
    document.getElementById('vmain').textContent = "1.0.138.57785";
    document.getElementById('vsem').textContent = "1.6.5";
  }
});

document.addEventListener('ta-language-changed', () => {
  setStatus(activeStatusKey);
  ['vmain', 'vsem', 'cancel-vmain'].forEach((id) => {
    const element = document.getElementById(id);
    if (element && ['غير معروف', 'Unknown'].includes(element.textContent.trim())) {
      element.textContent = t('cancel.unknown');
    }
  });
  if (document.getElementById('result-modal').classList.contains('active')) refreshResultText();
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn?.classList.contains('active')) {
    setPauseLabel(pauseBtn.classList.contains('paused') ? 'version.resume' : 'version.pause');
  }
  if (document.getElementById('progress-container').classList.contains('active')) {
    document.getElementById('progress-text-content').textContent = localizeProgressLabel(lastProgressLabel);
    document.getElementById('activation-progressbar')?.setAttribute(
      'aria-valuetext',
      `${localizeProgressLabel(lastProgressLabel)} ${lastProgressPercent}%`
    );
    const announcement = document.getElementById('progress-announcer');
    if (announcement) announcement.textContent = `${localizeProgressLabel(lastProgressLabel)} ${Math.floor(lastProgressPercent / 10) * 10}%`;
  }
});

// Global exports for inline HTML handlers
window.goBack = goBack;
window.closeResultModal = closeResultModal;
window.retryActivation = () => {
  activeResult = null;
  document.getElementById('result-modal').classList.remove('active');
  if (typeof window.startActivation === 'function') window.startActivation();
};
window.startActivation = startActivation;
window.togglePause = togglePause;
window.cancelActivation = cancelActivation;
window.openExternal = openExternal;
window.showFailure = showFailure;

// Prevent mouse back/forward navigation
window.addEventListener('mouseup', (e) => {
    if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
    }
});
window.addEventListener('mousedown', (e) => {
    if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
    }
});

window.exitApp = async () => { try { await tauriInvoke('exit_app'); } catch(e){ window.close(); } };
window.showSuccess = showSuccess;
