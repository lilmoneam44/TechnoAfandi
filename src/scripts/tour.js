import { t, currentLanguage } from './i18n.js';

/**
 * TechnoAfandi FC — Interactive Tour System
 * Runs a guided spotlight tour across home and version pages.
 */

// ───────────────────────── helpers ─────────────────────────
const SS_KEY = 'ta_tour_step';

function setStep(n) { try { sessionStorage.setItem(SS_KEY, n); } catch (_) {} }
function getStep()  { try { return parseInt(sessionStorage.getItem(SS_KEY) ?? '-1'); } catch (_) { return -1; } }
function clearTour(){ try { sessionStorage.removeItem(SS_KEY); } catch (_) {} }

// ───────────────────────── spotlight UI ─────────────────────
let overlay, spotlight, tooltip;
let currentTooltipOptions = null;
let tourReturnFocus = null;

function buildOverlay() {
  if (document.getElementById('ta-tour-overlay')) return;

  overlay = document.createElement('div');
  overlay.id = 'ta-tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('tour.heading'));
  overlay.tabIndex = -1;
  tourReturnFocus = document.activeElement;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    pointerEvents: 'all', // BLOCK ALL CLICKS TO PAGE
  });

  // SVG spotlight mask
  spotlight = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spotlight.setAttribute('id', 'ta-tour-spotlight');
  Object.assign(spotlight.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
  });
  spotlight.innerHTML = `
    <defs>
      <mask id="ta-hole-mask">
        <rect width="100%" height="100%" fill="white"/>
        <rect id="ta-hole" rx="12" ry="12" fill="black"/>
      </mask>
    </defs>
    <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#ta-hole-mask)"/>
    <rect id="ta-hole-border" rx="12" ry="12" fill="none" stroke="#7CFFE1" stroke-width="2" opacity="0.85"/>
  `;

  // Tooltip
  tooltip = document.createElement('div');
  tooltip.id = 'ta-tour-tooltip';
  overlay.setAttribute('aria-describedby', tooltip.id);
  Object.assign(tooltip.style, {
    position: 'absolute',
    background: 'linear-gradient(180deg,rgba(18,28,26,0.96) 0%,rgba(10,12,11,0.98) 100%)',
    border: '1.5px solid rgba(124,255,225,0.45)',
    borderRadius: '14px',
    padding: '16px 18px 14px',
    width: 'min(320px, calc(100vw - 20px))',
    maxWidth: 'calc(100vw - 20px)',
    minWidth: '0',
    boxShadow: '0 0 40px rgba(124,255,225,0.2), 0 8px 32px rgba(0,0,0,0.6)',
    fontFamily: "'Noto Sans Arabic','Inter',sans-serif",
    color: '#F5F5F7',
    pointerEvents: 'all',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    opacity: '0',
    transform: 'translateY(8px)',
  });

  overlay.appendChild(spotlight);
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);
}

function showSpotlight(el, pad = 10) {
  const r = el.getBoundingClientRect();
  const hole   = document.getElementById('ta-hole');
  const border = document.getElementById('ta-hole-border');
  const attrs = {
    x: r.left - pad, y: r.top - pad,
    width: r.width + pad * 2, height: r.height + pad * 2,
  };
  ['x','y','width','height'].forEach(k => {
    hole.setAttribute(k, attrs[k]);
    border.setAttribute(k, attrs[k]);
  });

  // Position tooltip after DOM updates from showTooltip
  requestAnimationFrame(() => {
    const tt = tooltip;
    const ttW = tt.offsetWidth > 0 ? tt.offsetWidth : 280;
    const ttH = tt.offsetHeight > 0 ? tt.offsetHeight : 160;
    let top = r.bottom + pad + 14;
    let left = r.left + r.width / 2 - ttW / 2;

    // if placing it below overflows the window, place it above
    if (top + ttH > window.innerHeight - 20) {
        top = r.top - ttH - pad - 14;
    }
    
    // ensure it doesn't go off screen
    if (top < 10) top = 10;
    if (left < 10) left = 10;
    if (left + ttW > window.innerWidth - 10) left = window.innerWidth - ttW - 10;

    tt.style.top  = top  + 'px';
    tt.style.left = left + 'px';
  });
}

function showTooltip(options) {
  currentTooltipOptions = options;
  const { ar, en, step, total, onNext, onPrev, nextLabel = 'التالي', color = '#7CFFE1' } = options;
  tooltip.style.opacity = '0';
  tooltip.style.transform = 'translateY(8px)';

  const language = currentLanguage();
  const direction = language === 'ar' ? 'rtl' : 'ltr';
  const alignment = language === 'ar' ? 'right' : 'left';
  const description = language === 'ar' ? ar : en;
  const actionKey = nextLabel === 'الصفحة التالية'
    ? 'tour.nextPage'
    : nextLabel === 'ابدأ محاكاة'
      ? 'tour.simulate'
      : nextLabel === 'إنهاء الجولة ✓'
        ? 'tour.finish'
        : 'tour.next';

  tooltip.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <span style="width:6px;height:6px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};flex-shrink:0;display:inline-block"></span>
      <span style="font-family:'Inter','Tahoma',sans-serif;font-size:11px;color:${color}">${t('tour.heading', language)} · ${step}/${total}</span>
    </div>
    <p id="ta-tour-description" style="font-size:14px;line-height:1.7;margin-bottom:14px;direction:${direction};text-align:${alignment};color:#F5F5F7">${description || ''}</p>
    <div style="display:flex;gap:8px;direction:${direction}">
      <button id="ta-tour-prev" style="flex:1;padding:9px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-family:'Inter','Tahoma',sans-serif;font-size:12px;background:rgba(255,255,255,0.04);color:#A6A4B8">${t('tour.previous', language)}</button>
      <button id="ta-tour-next" style="flex:2;padding:9px 12px;border-radius:9px;border:none;cursor:pointer;font-family:'Inter','Tahoma',sans-serif;font-size:13px;font-weight:600;background:linear-gradient(90deg,${color},#9B6EF3);color:#03100c;box-shadow:0 4px 14px rgba(124,255,225,0.3);white-space:nowrap">${t(actionKey, language)}</button>
    </div>
  `;

  document.getElementById('ta-tour-next').addEventListener('click', onNext);
  document.getElementById('ta-tour-prev').addEventListener('click', () => {
    if (onPrev) {
      onPrev();
    } else {
      const isHome = window.location.pathname.includes('home_page_v2');
      if (isHome) {
        if (step > 1) {
          document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
          runHomeStep(step - 1);
        }
      } else {
        if (step > TOTAL_HOME_STEPS + 1) {
          document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
          runVersionStep(step - 1);
        } else if (step === TOTAL_HOME_STEPS + 1) {
          // Go back to home page, last step
          sessionStorage.setItem('ta_tour_step', TOTAL_HOME_STEPS.toString());
          window.location.href = 'home_page_v2.html';
        }
      }
    }
  });

  overlay.setAttribute('aria-label', t('tour.heading', language));
  overlay.setAttribute('aria-describedby', 'ta-tour-description');
  document.getElementById('ta-tour-next').focus({ preventScroll: true });

  requestAnimationFrame(() => {
    tooltip.style.opacity = '1';
    tooltip.style.transform = 'translateY(0)';
  });
}

document.addEventListener('ta-language-changed', () => {
  if (tooltip && currentTooltipOptions) showTooltip(currentTooltipOptions);
});

document.addEventListener('keydown', (event) => {
  if (!overlay) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    endTour();
    return;
  }
  if (event.key !== 'Tab') return;
  const buttons = [...overlay.querySelectorAll('button:not([disabled])')];
  if (!buttons.length) {
    event.preventDefault();
    overlay.focus();
    return;
  }
  const first = buttons[0];
  const last = buttons.at(-1);
  if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
});

function endTour() {
  clearTour();
  if (overlay) overlay.remove();
  overlay = spotlight = tooltip = null;
  currentTooltipOptions = null;
  const savedFocus = tourReturnFocus;
  tourReturnFocus = null;
  if (savedFocus instanceof HTMLElement && savedFocus.isConnected && savedFocus.getClientRects().length > 0) {
    savedFocus.focus({ preventScroll: true });
  } else {
    document.querySelector('#start-btn:not([disabled]), .app-panel .btn-start:not([disabled])')?.focus({ preventScroll: true });
  }
}

// ───────────────────────── scroll to element ────────────────
function scrollIntoViewAndWait(el) {
  return new Promise(res => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(res, 450);
  });
}

// ───────────────────────── Home Page Tour Steps ─────────────
const HOME_STEPS = [
  // Step 1 – link buttons
  async function step1() {
    const links = document.querySelector('.links');
    await scrollIntoViewAndWait(links);
    showSpotlight(links, 6);
    showTooltip({
      ar: 'دي لينكات اشهر صفحاتنا ديسكورد و FC 27 page و صفحة التواصل معانا وصفحة اليوتيوب',
      en: 'Discord server , FC 27 page , Social links , YouTube page',
      step: 1, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => runHomeStep(2),
    });
  },

  // Step 2 – mode options
  async function step2() {
    const modes = document.querySelector('.modes');
    await scrollIntoViewAndWait(modes);
    showSpotlight(modes, 6);
    showTooltip({
      ar: 'خيارات تشغيل اللعبة المتاحة FMM | Live Editor',
      en: 'Game launch options FMM | Live Editor',
      step: 2, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      onNext: () => runHomeStep(3),
    });
  },

  // Step 3 – continue button
  async function step3() {
    const btn = document.querySelector('.btn-start');
    await scrollIntoViewAndWait(btn);
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'لما تختار الوضع، اضغط على الزر ده وهيوديك لصفحة الإصدار للتحقق من إصدار لعبتك.',
      en: 'After selecting a mode, press this button to go to the version review page.',
      step: 3, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      onNext: () => runHomeStep(4),
    });
  },

  // Step 4 – Mode Selection Required modal
  async function step4() {
    const modalOverlay = document.getElementById('mode-warning-modal');
    modalOverlay.classList.add('active'); // Show the modal
    
    // Wait for the modal transition to complete
    await new Promise(r => setTimeout(r, 200));
    
    const modal = modalOverlay.querySelector('.modal');
    showSpotlight(modal, 10);
    showTooltip({
      ar: 'اختر مود من مودات التشغيل FMM | Live Editor',
      en: 'Please Choose game run option FMM | Live Editor',
      step: 4, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => {
        modalOverlay.classList.remove('active'); // Hide it when moving to next
        runHomeStep(5);
      },
    });
  },

  // Step 5 – Game Folder Not Found modal
  async function step5() {
    const modalOverlay = document.getElementById('error-modal');
    modalOverlay.classList.add('active'); // Show the modal
    
    // Wait for the modal transition to complete
    await new Promise(r => setTimeout(r, 200));
    
    const modal = modalOverlay.querySelector('.modal');
    showSpotlight(modal, 10);
    showTooltip({
      ar: 'انقل الاداة جوا فولدر اللعبة',
      en: 'Please move the tool into the game folder',
      step: 5, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => {
        modalOverlay.classList.remove('active'); // Hide it when moving to next
        runHomeStep(6);
      },
    });
  },

  // Step 6 – Auto Locate button in error modal
  async function step6() {
    const modalOverlay = document.getElementById('error-modal');
    modalOverlay.classList.add('active'); // Show the modal
    
    // Wait for the modal transition to complete
    await new Promise(r => setTimeout(r, 200));
    
    const btn = document.getElementById('btn-auto-locate');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'الخيار ده هيدور على فولدر اللعبة على جهازك وينقل الاداة فيه ويشغلهالك تاني',
      en: 'it will look up for the game folder in ur device and relaunh the tool again',
      step: 6, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => {
        modalOverlay.classList.remove('active'); // Hide it when moving to next
        runHomeStep(7);
      },
    });
  },

  // Step 7 – Manually Locate button in error modal
  async function step7() {
    const modalOverlay = document.getElementById('error-modal');
    modalOverlay.classList.add('active'); // Show the modal
    
    // Wait for the modal transition to complete
    await new Promise(r => setTimeout(r, 200));
    
    const btn = document.querySelector('.btn-manual');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'الخيار ده هيفتحلك نافذة تختار منها فولدر اللعبة وينقل الاداة فيها ويشغلها تاني',
      en: 'it will open a window to manually select the game folder and relaunch the tool again',
      step: 7, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => {
        modalOverlay.classList.remove('active'); // Hide it when moving to next
        runHomeStep(8);
      },
    });
  },

  // Step 8 – Update modal
  async function step8() {
    const modalOverlay = document.getElementById('update-modal');
    modalOverlay.classList.add('active'); // Show the modal
    
    // Wait for the modal transition to complete
    await new Promise(r => setTimeout(r, 200));
    
    const modal = modalOverlay.querySelector('.modal');
    showSpotlight(modal, 10);
    showTooltip({
      ar: 'هتظهرلك لو في تحديث نزل للاداة',
      en: 'it will appear when there is an update for the tool',
      step: 8, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => {
        runHomeStep(9);
      },
    });
  },

  // Step 9 – Update Now button
  async function step9() {
    const modalOverlay = document.getElementById('update-modal');
    modalOverlay.classList.add('active'); // Ensure it is shown
    
    await new Promise(r => setTimeout(r, 100));
    
    const btn = document.querySelector('.btn-update');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هيحملك الاصدار الجديد بتاع الاداة ويسطبهولك ويشغلهالك',
      en: 'it will download the newest tool version and install it then relaunch the tool',
      step: 9, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => {
        runHomeStep(10);
      },
    });
  },

  // Step 10 – Remind Me Later button
  async function step10() {
    const modalOverlay = document.getElementById('update-modal');
    modalOverlay.classList.add('active'); // Ensure it is shown
    
    await new Promise(r => setTimeout(r, 100));
    
    const btn = document.querySelector('.btn-close');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هيسكبلك خطوة الابديت',
      en: 'it will skip the update option',
      step: 10, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      nextLabel: 'الصفحة التالية',
      onNext: () => {
        modalOverlay.classList.remove('active');
        try { sessionStorage.setItem('ta_mode', 'FMM'); } catch(_) {}
        setStep(11); // jump to version page steps
        window.location.href = 'version_page_v2.html';
      },
    });
  },
];
const TOTAL_HOME_STEPS = HOME_STEPS.length;

function runHomeStep(n) {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  setStep(n);
  HOME_STEPS[n - 1]?.();
}

// ───────────────────────── Version Page Tour Steps ──────────
const VERSION_STEPS = [
  // Step 10 – version card
  async function step10() {
    const card = document.querySelector('.version-card');
    if (!card) { runVersionStep(12); return; }
    
    const vmain = document.getElementById('vmain');
    const vsem = document.getElementById('vsem');
    if (vmain && (vmain.innerText.includes('Loading') || vmain.innerText.includes('Unknown'))) {
      vmain.innerText = ' 1.0.138.16746 ';
    }
    if (vsem && (vsem.innerText.includes('...') || vsem.innerText.includes('Unknown'))) {
      vsem.innerText = ' 1.6.4 ';
    }

    await scrollIntoViewAndWait(card);
    showSpotlight(card, 8);
    showTooltip({
      ar: 'ده اصدار اللعبة الحالي عندك',
      en: "it's ur game version",
      step: TOTAL_HOME_STEPS + 1, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      onNext: () => runVersionStep(12)
    });
  },

  // Step 11 – start activation button
  async function step11() {
    const btn = document.getElementById('start-btn');
    await scrollIntoViewAndWait(btn);
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هيبدا عملية التنزيل والتفعيل',
      en: 'it starts downloading and activation steps',
      step: TOTAL_HOME_STEPS + 2, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      nextLabel: 'ابدأ محاكاة',
      onNext: () => runVersionStep(13)
    });
  },

  // Step 12 – fake activation demo
  async function step12() {
    const container = document.getElementById('progress-container');
    if (!container) { runVersionStep(14); return; }
    container.style.display = 'block';
    
    // set initial status for tour step
    const fill = document.getElementById('progress-fill');
    const pct  = document.getElementById('progress-pct');
    const txt  = document.getElementById('progress-text-content');
    if(fill) fill.style.width = '42%';
    if(pct) pct.textContent = '42%';
    if(txt) txt.textContent = 'Downloading patch files...';

    // Show action buttons so they look natural
    const pauseBtn = document.getElementById('pause-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    if (pauseBtn) pauseBtn.classList.add('active');
    if (cancelBtn) cancelBtn.classList.add('active');

    await scrollIntoViewAndWait(container);
    showSpotlight(container, 8);
    showTooltip({
      ar: 'خطوات التحميل للملفات والتفعيل لحد ماللعبة تشتغل',
      en: 'files downloading steps and activation till run the game',
      step: TOTAL_HOME_STEPS + 3, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      onNext: () => runVersionStep(14)
    });
  },

  // Step 13 – pause button
  async function step13() {
    const btn = document.getElementById('pause-btn');
    if (btn) btn.classList.add('active'); // ensure it's visible
    await scrollIntoViewAndWait(btn);
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هيوقف عملية التحميل لحد ماتستكملها',
      en: 'it pauses the downloads and activation',
      step: TOTAL_HOME_STEPS + 4, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#A855F7',
      onNext: () => runVersionStep(15)
    });
  },

  // Step 14 – cancel button
  async function step14() {
    const btn = document.getElementById('cancel-btn');
    if (btn) btn.classList.add('active'); // ensure it's visible
    await scrollIntoViewAndWait(btn);
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هيلغي عمليات التحميل والتفعيل الجارية',
      en: 'it cancels downloads and activation running',
      step: TOTAL_HOME_STEPS + 5, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#A855F7',
      onNext: () => runVersionStep(16)
    });
  },

  // Step 15 – cancel modal
  async function step15() {
    const modalOverlay = document.getElementById('cancel-modal');
    modalOverlay.classList.add('active');
    await new Promise(r => setTimeout(r, 200));
    const modal = modalOverlay.querySelector('.modal');
    showSpotlight(modal, 10);
    showTooltip({
      ar: 'تاكيد انك عايز تلغي التفعيل الجاري',
      en: 'confirms u wanna to cancel activation running',
      step: TOTAL_HOME_STEPS + 6, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => runVersionStep(17)
    });
  },

  // Step 16 – Resume choice
  async function step16() {
    const modalOverlay = document.getElementById('cancel-modal');
    modalOverlay.classList.add('active');
    await new Promise(r => setTimeout(r, 100));
    const choice = document.querySelector('.choice-option:nth-child(1)');
    showSpotlight(choice, 6);
    showTooltip({
      ar: 'استكمال عملية التفعيل الجارية',
      en: 'resume activation running',
      step: TOTAL_HOME_STEPS + 7, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => runVersionStep(18)
    });
  },

  // Step 17 – Keep files choice
  async function step17() {
    const modalOverlay = document.getElementById('cancel-modal');
    modalOverlay.classList.add('active');
    await new Promise(r => setTimeout(r, 100));
    const choice = document.querySelector('.choice-option:nth-child(2)');
    showSpotlight(choice, 6);
    showTooltip({
      ar: 'الغاء عملية التفعيل مع الاحتفاظ بالملفات ا',
      en: 'cancel the activation with keep files',
      step: TOTAL_HOME_STEPS + 8, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => runVersionStep(19)
    });
  },

  // Step 18 – Delete files choice
  async function step18() {
    const modalOverlay = document.getElementById('cancel-modal');
    modalOverlay.classList.add('active');
    await new Promise(r => setTimeout(r, 100));
    const choice = document.querySelector('.choice-option:nth-child(3)');
    showSpotlight(choice, 6);
    showTooltip({
      ar: 'الغاء عملية التفعيل مع عدم الاحتفاظ بالملفات',
      en: 'cancel the activation with no keep files',
      step: TOTAL_HOME_STEPS + 9, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => runVersionStep(20)
    });
  },

  // Step 19 – Sure about my choice
  async function step19() {
    const modalOverlay = document.getElementById('cancel-modal');
    modalOverlay.classList.add('active');
    await new Promise(r => setTimeout(r, 100));
    const btn = document.querySelector('#cancel-modal .btn-cancel');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'تاكيد لاختيارك السابق',
      en: 'confirms ur choice',
      step: TOTAL_HOME_STEPS + 10, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => {
        modalOverlay.classList.remove('active');
        runVersionStep(21);
      }
    });
  },

  // Step 20 – links
  async function step20() {
    const links = document.querySelector('.links');
    await scrollIntoViewAndWait(links);
    showSpotlight(links, 6);
    showTooltip({
      ar: 'نفس اللينكات من الصفحة الرئيسية — موجودة هنا برضو للوصول السريع أثناء التفعيل.',
      en: 'Same community links are available here too for quick access during activation.',
      step: TOTAL_HOME_STEPS + 11, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FFD54A',
      onNext: () => runVersionStep(22)
    });
  },

  // Step 21 – Failure popup
  async function step21() {
    if (typeof window.showFailure === 'function') window.showFailure();
    await new Promise(r => setTimeout(r, 200));
    const modal = document.querySelector('#result-modal .modal');
    showSpotlight(modal, 10);
    showTooltip({
      ar: 'هتظهرلك في حالة فشل التفعيل',
      en: 'it appears when activation fails',
      step: TOTAL_HOME_STEPS + 12, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FF4D4D',
      onNext: () => runVersionStep(23)
    });
  },

  // Step 22 – Reactivate button
  async function step22() {
    const modalOverlay = document.getElementById('result-modal');
    if (modalOverlay) modalOverlay.classList.add('active'); // Ensure it stays open
    await new Promise(r => setTimeout(r, 100));
    const btn = document.getElementById('result-btn');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هتعيد خطوات تفعيل اللعبة تاني',
      en: 'it will retry the activation again',
      step: TOTAL_HOME_STEPS + 13, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FF4D4D',
      onNext: () => runVersionStep(24)
    });
  },

  // Step 23 – Close button
  async function step23() {
    const modalOverlay = document.getElementById('result-modal');
    if (modalOverlay) modalOverlay.classList.add('active'); // Ensure it stays open
    await new Promise(r => setTimeout(r, 100));
    const btn = document.querySelector('#result-modal .btn-close');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هيقفل الاداة',
      en: 'it will close the tool',
      step: TOTAL_HOME_STEPS + 14, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#FF4D4D',
      onNext: () => {
        if (modalOverlay) modalOverlay.classList.remove('active');
        runVersionStep(25);
      }
    });
  },

  // Step 24 – Success popup
  async function step24() {
    if (typeof window.showSuccess === 'function') window.showSuccess();
    await new Promise(r => setTimeout(r, 200));
    const modal = document.querySelector('#result-modal .modal');
    showSpotlight(modal, 10);
    showTooltip({
      ar: 'تم التفعيل بنجاح',
      en: 'successfully activated',
      step: TOTAL_HOME_STEPS + 15, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      onNext: () => runVersionStep(26)
    });
  },

  // Step 25 – Return To Home button
  async function step25() {
    const modalOverlay = document.getElementById('result-modal');
    if (modalOverlay) modalOverlay.classList.add('active'); // Ensure it stays open
    await new Promise(r => setTimeout(r, 100));
    const btn = document.getElementById('result-btn');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'العودة لصفحة الهوم',
      en: 'return to home page',
      step: TOTAL_HOME_STEPS + 16, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      onNext: () => runVersionStep(27)
    });
  },

  // Step 26 – Close button
  async function step26() {
    const modalOverlay = document.getElementById('result-modal');
    if (modalOverlay) modalOverlay.classList.add('active'); // Ensure it stays open
    await new Promise(r => setTimeout(r, 100));
    const btn = document.querySelector('#result-modal .btn-close');
    showSpotlight(btn, 6);
    showTooltip({
      ar: 'هتقفلك الاداة',
      en: 'closes the tool',
      step: TOTAL_HOME_STEPS + 17, total: TOTAL_VERSION_STEPS + TOTAL_HOME_STEPS,
      color: '#7CFFE1',
      nextLabel: 'إنهاء الجولة ✓',
      onNext: () => {
        if (modalOverlay) modalOverlay.classList.remove('active');
        endTour();
        window.location.href = 'home_page_v2.html?tour_done=1';
      }
    });
  }
];
const TOTAL_VERSION_STEPS = VERSION_STEPS.length;

function runVersionStep(n) {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  setStep(n);
  const idx = n - TOTAL_HOME_STEPS - 1;
  VERSION_STEPS[idx]?.();
}

// ───────────────────────── Fake Activation Demo ─────────────
async function runFakeActivation(container, onDone) {
  const fill = document.getElementById('progress-fill');
  const pct  = document.getElementById('progress-pct');
  const txt  = document.getElementById('progress-text-content');
  if (!fill || !pct || !txt) { onDone(); return; }

  // Disable next button during demo
  const nextBtn = document.getElementById('ta-tour-next');
  if (nextBtn) nextBtn.disabled = true;

  const stages = [
    { p:  5, en: 'Connecting to server...', ar: 'جارٍ الاتصال بالخادم...' },
    { p: 15, en: 'Authenticating session...', ar: 'جارٍ التحقق من الجلسة...' },
    { p: 28, en: 'Fetching patch manifest...', ar: 'جارٍ تجهيز قائمة الملفات...' },
    { p: 42, en: 'Downloading patch files...', ar: 'جارٍ تنزيل ملفات التفعيل...' },
    { p: 58, en: 'Downloading patch files...', ar: 'جارٍ تنزيل ملفات التفعيل...' },
    { p: 72, en: 'Verifying integrity...', ar: 'جارٍ التحقق من الملفات...' },
    { p: 85, en: 'Applying activation patch...', ar: 'جارٍ تطبيق التفعيل...' },
    { p: 95, en: 'Writing configuration...', ar: 'جارٍ حفظ الإعدادات...' },
    { p:100, en: 'Done! ✓', ar: 'اكتمل ✓' },
  ];

  for (const s of stages) {
    fill.style.width = s.p + '%';
    fill.style.transition = 'width 0.5s ease';
    pct.textContent = s.p + '%';
    txt.textContent = currentLanguage() === 'ar' ? s.ar : s.en;
    await new Promise(r => setTimeout(r, 520));
  }

  await new Promise(r => setTimeout(r, 600));
  fill.style.width = '0%';
  pct.textContent  = '0%';
  txt.textContent  = currentLanguage() === 'ar' ? 'جارٍ التهيئة' : 'Initializing';

  if (nextBtn) nextBtn.disabled = false;
  onDone();
}

// ───────────────────────── Tour Done Banner ─────────────────
function showTourDone() {
  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%) translateY(60px)',
    background: 'linear-gradient(90deg,#7CFFE1,#A855F7)',
    borderRadius: '50px', padding: '12px 24px',
    fontFamily: "'Inter',sans-serif", fontWeight: '700', fontSize: '13px', color: '#04140f',
    boxShadow: '0 4px 28px rgba(124,255,225,0.5)', zIndex: '99999',
    transition: 'transform 0.4s cubic-bezier(.34,1.56,.64,1)',
    whiteSpace: 'nowrap',
  });
  banner.textContent = t('tour.done');
  document.body.appendChild(banner);
  requestAnimationFrame(() => {
    banner.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    banner.style.transform = 'translateX(-50%) translateY(80px)';
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 400);
  }, 3500);
}

// ───────────────────────── Public API ───────────────────────
export function startTour() {
  buildOverlay();
  setStep(1);
  runHomeStep(1);
}

export function resumeTourIfActive() {
  const step = getStep();
  if (step < 1) return false;

  buildOverlay();

  const isHome = window.location.pathname.includes('home_page_v2');
  if (isHome) {
    if (step <= TOTAL_HOME_STEPS) {
      setTimeout(() => runHomeStep(step), 600);
    } else {
      // Should not be here, but if so, redirect to version page
      window.location.href = 'version_page_v2.html';
    }
  } else {
    if (step > TOTAL_HOME_STEPS) {
      setTimeout(() => runVersionStep(step), 600);
    } else {
      // Should not be here, but if so, redirect to home page
      window.location.href = 'home_page_v2.html';
    }
  }
  return true;
}
window.showTourDone = showTourDone;
