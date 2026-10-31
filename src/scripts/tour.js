/**
 * @file tour.js
 * @description Complete, production-grade onboarding spotlight tour for Techno Afandi FC27 Tool.
 * Language-independent navigation (supports Arabic RTL and English LTR), viewport boundary clamping,
 * missing target fallback, clean listener teardown, and cross-page state resumption.
 */

import { t } from './i18n.js';

let activeStepIndex = 0;
let tourOverlayElement = null;
let tourTooltipElement = null;
let keyListener = null;
let resizeListener = null;

/**
 * Standard onboarding tour sequence definitions.
 */
export const DEFAULT_TOUR_STEPS = [
  {
    id: 'step_titlebar',
    page: 'home',
    targetSelector: '.titlebar',
    titleKey: 'tour.titlebar.title',
    descKey: 'tour.titlebar.desc',
    defaultTitle: 'شريط العنوان والتحكم | Window Titlebar',
    defaultDesc: 'يمكنك التحكم بالنافذة وتغيير لغة التطبيق من هنا في أي وقت. Control window states and toggle languages anytime here.'
  },
  {
    id: 'step_mode',
    page: 'home',
    targetSelector: '.mode-group, [role="radiogroup"], #opt-fmm',
    titleKey: 'tour.mode.title',
    descKey: 'tour.mode.desc',
    defaultTitle: 'اختيار نمط التشغيل | Mode Selection',
    defaultDesc: 'اختر بين نمط FMM للأطقم والمودات أو Live Editor للتعديل المباشر. Toggle between FMM for custom mods or Live Editor for memory editing.'
  },
  {
    id: 'step_launch',
    page: 'home',
    targetSelector: '#launch-btn, [data-action="continueToVersion"], .btn-neon',
    titleKey: 'tour.launch.title',
    descKey: 'tour.launch.desc',
    defaultTitle: 'زر الإطلاق والتفعيل | Launch & Activation',
    defaultDesc: 'اضغط هنا للتحقق التلقائي من مسار اللعبة والانتقال لشاشة التفعيل. Verify game folder and proceed to activation.'
  },
  {
    id: 'step_activation',
    page: 'version',
    targetSelector: '#btn-start-activation, .btn-action-start, .circular-progress',
    titleKey: 'tour.activation.title',
    descKey: 'tour.activation.desc',
    defaultTitle: 'بدء التفعيل والتشغيل | Start Activation',
    defaultDesc: 'ابدأ عملية فحص وتطبيق ملفات التفعيل مع إمكانية الإيقاف المؤقت أو الإلغاء. Start patching and activation with pause/resume support.'
  }
];

/**
 * Creates the SVG spotlight overlay and dialog container in the DOM.
 */
function createTourDOM() {
  if (tourOverlayElement || tourTooltipElement) {
    destroyTourDOM();
  }

  if (typeof document === 'undefined') return;

  // 1. Fullscreen SVG Mask Overlay
  tourOverlayElement = document.createElement('div');
  tourOverlayElement.className = 'tour-spotlight-backdrop';
  tourOverlayElement.setAttribute('aria-hidden', 'true');
  tourOverlayElement.style.cssText = `
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    z-index: 99998;
    pointer-events: auto;
  `;

  tourOverlayElement.innerHTML = `
    <svg width="100%" height="100%" style="position: absolute; inset: 0;">
      <defs>
        <mask id="tour-spotlight-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect id="tour-spotlight-cutout" x="0" y="0" width="0" height="0" rx="8" ry="8" fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(10, 10, 13, 0.78)" mask="url(#tour-spotlight-mask)" />
    </svg>
  `;

  // 2. Accessible Tooltip Dialog
  tourTooltipElement = document.createElement('div');
  tourTooltipElement.className = 'tour-tooltip-card';
  tourTooltipElement.setAttribute('role', 'dialog');
  tourTooltipElement.setAttribute('aria-modal', 'true');
  tourTooltipElement.style.cssText = `
    position: fixed;
    z-index: 99999;
    width: min(360px, calc(100vw - 32px));
    background: rgba(18, 18, 24, 0.94);
    border: 1px solid var(--teal-1, #8CFFF0);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 16px rgba(140, 255, 240, 0.2);
    border-radius: 12px;
    padding: 16px;
    backdrop-filter: blur(16px);
    color: #F5F5F7;
    font-size: 13px;
    box-sizing: border-box;
    transition: top 0.2s ease, left 0.2s ease;
  `;

  document.body.appendChild(tourOverlayElement);
  document.body.appendChild(tourTooltipElement);
}

/**
 * Removes all tour elements from the DOM.
 */
function destroyTourDOM() {
  if (tourOverlayElement && tourOverlayElement.parentNode) {
    tourOverlayElement.parentNode.removeChild(tourOverlayElement);
  }
  if (tourTooltipElement && tourTooltipElement.parentNode) {
    tourTooltipElement.parentNode.removeChild(tourTooltipElement);
  }
  tourOverlayElement = null;
  tourTooltipElement = null;
}

/**
 * Positions tooltip relative to target rect with boundary clamping.
 * @param {DOMRect} targetRect 
 * @param {HTMLElement} tooltip 
 */
function positionTooltip(targetRect, tooltip) {
  if (typeof window === 'undefined') return;

  const vWidth = window.innerWidth || 1024;
  const vHeight = window.innerHeight || 768;
  const tRect = tooltip.getBoundingClientRect();
  const margin = 14;

  let top = targetRect.bottom + margin;
  let left = targetRect.left + (targetRect.width - tRect.width) / 2;

  // Flip above target if bottom clips
  if (top + tRect.height > vHeight - margin) {
    top = targetRect.top - tRect.height - margin;
  }

  // Fallback: If top also clips (target is very tall), align to top of target
  if (top < margin) {
    top = margin;
  }

  // Horizontal screen boundary clamping
  left = Math.max(margin, Math.min(left, vWidth - tRect.width - margin));
  top = Math.max(margin, Math.min(top, vHeight - tRect.height - margin));

  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.style.left = `${Math.round(left)}px`;
}

/**
 * Renders a specific step in the tour.
 * @param {Array} steps 
 * @param {number} index 
 */
function renderStep(steps, index) {
  if (!steps || !steps.length || index < 0 || index >= steps.length) {
    endTour();
    return;
  }

  activeStepIndex = index;
  const step = steps[index];

  if (typeof document === 'undefined') return;

  // Missing target handling: look for target element
  let target = null;
  const selectors = step.targetSelector.split(',').map((s) => s.trim());
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      target = el;
      break;
    }
  }

  // If target element is not found on current page/view, advance to next step or finish
  if (!target) {
    if (index + 1 < steps.length) {
      renderStep(steps, index + 1);
    } else {
      endTour();
    }
    return;
  }

  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Update SVG spotlight cutout
  const rect = target.getBoundingClientRect();
  const cutout = document.getElementById('tour-spotlight-cutout');
  const pad = 8;

  if (cutout) {
    cutout.setAttribute('x', String(Math.max(0, rect.left - pad)));
    cutout.setAttribute('y', String(Math.max(0, rect.top - pad)));
    cutout.setAttribute('width', String(rect.width + pad * 2));
    cutout.setAttribute('height', String(rect.height + pad * 2));
  }

  if (!tourTooltipElement) return;

  // Render Tooltip Card safely using DOM nodes
  tourTooltipElement.replaceChildren();

  // 1. Header (Title + Close Button)
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';

  const title = document.createElement('h4');
  title.style.cssText = 'margin: 0; font-size: 14px; font-weight: 700; color: var(--teal-1, #8CFFF0);';
  title.textContent = t(step.titleKey) !== step.titleKey ? t(step.titleKey) : step.defaultTitle;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', t('tour.skip') || 'Skip');
  closeBtn.style.cssText = 'background: transparent; border: none; color: #A6A4B8; cursor: pointer; font-size: 16px; padding: 2px 6px;';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => endTour();

  header.appendChild(title);
  header.appendChild(closeBtn);

  // 2. Body Description
  const desc = document.createElement('p');
  desc.style.cssText = 'margin: 0 0 14px 0; line-height: 1.5; color: #E0DFE8; font-size: 12px;';
  desc.textContent = t(step.descKey) !== step.descKey ? t(step.descKey) : step.defaultDesc;

  // 3. Footer (Progress Counter + Buttons)
  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;';

  const counter = document.createElement('span');
  counter.style.cssText = 'font-size: 11px; color: #8A889A; font-family: monospace;';
  counter.textContent = `${index + 1} / ${steps.length}`;

  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display: flex; gap: 8px;';

  // Previous button (if not first step)
  if (index > 0) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.style.cssText = 'background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #F5F5F7; border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer;';
    prevBtn.textContent = t('tour.prev') || 'السابق | Previous';
    prevBtn.onclick = () => renderStep(steps, index - 1);
    btnGroup.appendChild(prevBtn);
  }

  // Next / Finish button
  const isLast = index === steps.length - 1;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.style.cssText = 'background: linear-gradient(90deg, #0E6B5C, #18A991); border: 1px solid var(--teal-1, #8CFFF0); color: #FFF; border-radius: 6px; padding: 4px 12px; font-size: 11px; font-weight: 600; cursor: pointer;';
  nextBtn.textContent = isLast
    ? (t('tour.finish') || 'إنهاء | Finish')
    : (t('tour.next') || 'التالي | Next');

  nextBtn.onclick = () => {
    if (isLast) {
      endTour();
    } else {
      renderStep(steps, index + 1);
    }
  };
  btnGroup.appendChild(nextBtn);

  footer.appendChild(counter);
  footer.appendChild(btnGroup);

  tourTooltipElement.appendChild(header);
  tourTooltipElement.appendChild(desc);
  tourTooltipElement.appendChild(footer);

  // Position tooltip
  positionTooltip(rect, tourTooltipElement);

  // Save tour progress state for cross-page navigation
  try {
    sessionStorage.setItem('ta_tour_step', String(index));
  } catch {}
}

/**
 * Starts the onboarding tour sequence from the beginning or specified step.
 * @param {Array} [steps=DEFAULT_TOUR_STEPS] 
 * @param {number} [startStep=0] 
 */
export function startTour(steps = DEFAULT_TOUR_STEPS, startStep = 0) {
  endTour();
  createTourDOM();

  try {
    sessionStorage.setItem('ta_tour_active', '1');
    sessionStorage.setItem('ta_tour_step', String(startStep));
  } catch {}

  keyListener = (e) => {
    if (e.key === 'Escape') {
      endTour();
    }
  };
  resizeListener = () => {
    renderStep(steps, activeStepIndex);
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', keyListener);
    window.addEventListener('resize', resizeListener, { passive: true });
  }

  renderStep(steps, startStep);
}

/**
 * Resumes active tour if the user navigated across pages while the tour was running.
 */
export function resumeTourIfActive(steps = DEFAULT_TOUR_STEPS) {
  try {
    if (sessionStorage.getItem('ta_tour_active') === '1') {
      const savedStep = parseInt(sessionStorage.getItem('ta_tour_step') || '0', 10);
      startTour(steps, isNaN(savedStep) ? 0 : savedStep);
    }
  } catch {}
}

/**
 * Cleanly terminates the tour, removes DOM elements, and detaches listeners.
 */
export function endTour() {
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    if (keyListener) {
      window.removeEventListener('keydown', keyListener);
      keyListener = null;
    }
    if (resizeListener) {
      window.removeEventListener('resize', resizeListener);
      resizeListener = null;
    }
  }

  destroyTourDOM();

  try {
    sessionStorage.setItem('ta_tour_active', '0');
    sessionStorage.setItem('ta_tour_done', '1');
  } catch {}
}
