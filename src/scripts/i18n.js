/**
 * @file i18n.js
 * @description Advanced localization engine for Techno Afandi FC27 Tool.
 * Provides Arabic (RTL) and English (LTR) language support, structured progress event templates,
 * dynamic parameter interpolation, safe DOM updates, and cross-session persistence.
 */

export const DEFAULT_LANGUAGE = 'ar';
export const SUPPORTED_LANGUAGES = ['ar', 'en'];

/**
 * Structured translation dictionary
 */
export const dictionary = {
  // Application & Window
  'app.title': { ar: 'Techno Afandi Launcher – FC 27', en: 'Techno Afandi Launcher – FC 27' },
  'app.version': { ar: 'الإصدار', en: 'Version' },
  'app.status.connected': { ar: 'متصل', en: 'Connected' },
  'app.status.ready': { ar: 'جاهز للاستخدام', en: 'Ready' },

  // Modes
  'mode.fmm.title': { ar: 'FMM Mode (FIFA Mod Manager)', en: 'FMM Mode (FIFA Mod Manager)' },
  'mode.fmm.desc': { ar: 'تشغيل اللعبة مع مود مانجر لإدارة وتثبيت المودات والأطقم.', en: 'Launch game with FIFA Mod Manager for custom kits and mods.' },
  'mode.live.title': { ar: 'Live Editor Mode', en: 'Live Editor Mode' },
  'mode.live.desc': { ar: 'تشغيل اللعبة مع أداة Live Editor لتعديل خصائص اللعبة مباشرة.', en: 'Launch game with Live Editor for real-time memory and player editing.' },
  'mode.warning.title': { ar: 'تنبيه اختيار النمط', en: 'Mode Selection Required' },
  'mode.warning.desc': { ar: 'يرجى اختيار نمط التشغيل أولاً (FMM أو Live Editor) للمتابعة.', en: 'Please select a launcher mode (FMM or Live Editor) to proceed.' },

  // Buttons & Controls
  'btn.launch': { ar: 'بدء تشغيل اللعبة', en: 'Launch Game' },
  'btn.quick_launch': { ar: 'تشغيل فوري (Quick Launch)', en: 'Quick Launch' },
  'btn.continue': { ar: 'متابعة', en: 'Continue' },
  'btn.cancel': { ar: 'إلغاء', en: 'Cancel' },
  'btn.pause': { ar: 'إيقاف مؤقت', en: 'Pause' },
  'btn.resume': { ar: 'استئناف', en: 'Resume' },
  'btn.retry': { ar: 'إعادة المحاولة', en: 'Retry' },
  'btn.browse': { ar: 'تحديد المجلد يدوياً', en: 'Browse Folder' },
  'btn.auto_locate': { ar: 'البحث التلقائي عن مسار اللعبة', en: 'Auto-Locate Game' },
  'btn.close': { ar: 'إغلاق', en: 'Close' },
  'btn.exit': { ar: 'خروج', en: 'Exit' },
  'btn.back': { ar: 'رجوع', en: 'Back' },
  'btn.update': { ar: 'تحديث الآن', en: 'Update Now' },
  'btn.skip_update': { ar: 'تخطي التحديث', en: 'Skip Update' },

  // Game Scan & Path Detection
  "home.path.title": { ar: "مسار اللعبة:", en: "Game Folder:" },
  "home.path.unselected": { ar: "لم يتم تحديد المسار (انقر للتحديد)", en: "No folder selected (click to browse)" },
  "home.path.invalid": { ar: "مسار غير صالح - انقر للتصحيح", en: "Invalid folder - click to correct" },
  "btn.diagnostics": { ar: "تشخيص ملفات اللعبة", en: "Diagnostics" },
  "diag.title": { ar: "فحص وتشخيص ملفات اللعبة", en: "Game Installation Diagnostics" },
  "diag.path": { ar: "المسار المحدد:", en: "Selected Path:" },
  "diag.dbdata": { ar: "ملف dbdata.dll:", en: "dbdata.dll File:" },
  "diag.xml": { ar: "بيانات التثبيت (XML):", en: "Installer Data (XML):" },
  "diag.copy": { ar: "نسخ تقرير الفحص", en: "Copy Report" },
  'home.locate.scanning': { ar: 'جاري فحص الأقراص بحثاً عن مجلد اللعبة...', en: 'Scanning local drives for FC 27...' },
  'home.locate.cancelling': { ar: 'جاري إلغاء عملية الفحص...', en: 'Cancelling drive scan...' },
  'home.locate.cancelled': { ar: 'تم إلغاء عملية الفحص.', en: 'Drive scan cancelled.' },
  'home.locate.found': { ar: 'تم العثور على مجلد اللعبة بنجاح!', en: 'Game directory detected successfully!' },
  'home.locate.not_found': { ar: 'لم يتم العثور على اللعبة تلقائياً. يرجى تحديد المجلد يدوياً.', en: 'Game folder not found automatically. Please browse manually.' },

  // Activation & Patching Progress Templates
  'progress.scanning': { ar: 'جاري فحص ملفات اللعبة...', en: 'Scanning game files...' },
  'progress.downloading': { ar: 'جاري تحميل {file}... {percent}% {speed}', en: 'Downloading {file}... {percent}% {speed}' },
  'progress.verifying': { ar: 'جاري التحقق من سلامة {file}...', en: 'Verifying integrity of {file}...' },
  'progress.extracting': { ar: 'جاري فك ضغط {file}...', en: 'Extracting {file}...' },
  'progress.patching': { ar: 'جاري تطبيق تعديلات التفعيل وحقن الملفات...', en: 'Applying activation patches and injecting files...' },
  'progress.denuvo_check': { ar: 'جاري فحص ترخيص اللعبة مع السيرفر...', en: 'Checking Denuvo ticket status...' },
  'progress.completed': { ar: 'اكتمل التفعيل بنجاح! اللعبة جاهزة للتشغيل.', en: 'Activation completed successfully! Ready to play.' },
  'progress.failed': { ar: 'حدث خطأ أثناء التفعيل: {reason}', en: 'Activation failed: {reason}' },
  'progress.paused': { ar: 'العملية متوقفة مؤقتاً.', en: 'Operation paused.' },

  // Onboarding Tour
  'tour.next': { ar: 'التالي', en: 'Next' },
  'tour.prev': { ar: 'السابق', en: 'Previous' },
  'tour.finish': { ar: 'إنهاء', en: 'Finish' },
  'tour.skip': { ar: 'تخطي الجولة', en: 'Skip Tour' },

  // Errors & Diagnostics
  'error.path.missing_exe': { ar: 'لم يتم العثور على ملف FC27.exe في المجلد المحدد.', en: 'FC27.exe was not found in the selected folder.' },
  'error.path.missing_dbdata': { ar: 'ملف dbdata.dll غير موجود في هذا المجلد.', en: 'Required file dbdata.dll is missing from this folder.' },
  'error.path.missing_installer': { ar: 'مجلد التثبيت __Installer غير مكتمل.', en: 'Installer metadata directory (__Installer) is incomplete.' },
  'error.general': { ar: 'حدث خطأ غير متوقع. يرجى مراجعة سجلات النظام.', en: 'An unexpected error occurred. Please check application logs.' }
};

let currentLang = DEFAULT_LANGUAGE;

/**
 * Initializes language settings from storage and updates document attributes.
 */
export function initI18n() {
  try {
    const saved = localStorage.getItem('ta_ui_language') || sessionStorage.getItem('ta_ui_language');
    if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
      currentLang = saved;
    } else {
      currentLang = DEFAULT_LANGUAGE;
    }
  } catch {
    currentLang = DEFAULT_LANGUAGE;
  }

  applyLanguage(currentLang);
  exposeGlobals();
}

/**
 * Returns the currently active language code ('ar' or 'en').
 * @returns {string}
 */
export function currentLanguage() {
  return currentLang;
}

/**
 * Resolves a translated string by key with dynamic token interpolation.
 * @param {string} key 
 * @param {Record<string, any>} [params={}] 
 * @returns {string}
 */
export function t(key, params = {}) {
  const entry = dictionary[key];
  if (!entry) {
    return key;
  }

  // Tiered fallback: active language -> English -> Arabic -> key
  let text = entry[currentLang] || entry['en'] || entry['ar'] || key;

  // Dynamic token replacement: {param}
  if (params && typeof params === 'object') {
    for (const [pKey, pVal] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal !== undefined && pVal !== null ? pVal : ''));
    }
  }

  return text;
}

/**
 * Structured progress event formatter.
 * @param {string|object} payload 
 * @returns {string}
 */
export function formatProgressEvent(payload) {
  if (!payload) return '';

  if (typeof payload === 'object') {
    const stage = payload.stage || payload.type;
    const file = payload.file || payload.filename || '';
    const percent = payload.percent !== undefined ? payload.percent : '';
    const speed = payload.speed || '';

    if (stage === 'downloading') {
      return t('progress.downloading', { file, percent, speed });
    }
    if (stage === 'verifying') {
      return t('progress.verifying', { file });
    }
    if (stage === 'extracting') {
      return t('progress.extracting', { file });
    }
    if (stage === 'patching') {
      return t('progress.patching');
    }
    if (stage === 'completed') {
      return t('progress.completed');
    }
    if (payload.label) {
      return localizeProgressLabel(payload.label);
    }
  }

  return localizeProgressLabel(String(payload));
}

/**
 * Robust progress label localizer for dynamic backend status strings.
 * Uses structured pattern matching and token extraction.
 * @param {string} rawLabel 
 * @returns {string}
 */
export function localizeProgressLabel(rawLabel) {
  if (!rawLabel || typeof rawLabel !== 'string') return '';
  if (currentLang === 'en') return rawLabel;

  const trimmed = rawLabel.trim();

  // Pattern: Downloading <file> ... <percent>% ... <speed>
  const dlMatch = trimmed.match(/^downloading\s+([^\s(]+)(?:\s*\(([0-9]+)%\))?(?:\s*\[([^\]]+)\])?/i);
  if (dlMatch) {
    const file = dlMatch[1];
    const percent = dlMatch[2] || '';
    const speed = dlMatch[3] ? `[${dlMatch[3]}]` : '';
    return t('progress.downloading', { file, percent, speed });
  }

  // Pattern: Verifying <file>
  const verMatch = trimmed.match(/^verifying\s+(.+)$/i);
  if (verMatch) {
    return t('progress.verifying', { file: verMatch[1] });
  }

  // Pattern: Extracting <file>
  const extMatch = trimmed.match(/^extracting\s+(.+)$/i);
  if (extMatch) {
    return t('progress.extracting', { file: extMatch[1] });
  }

  // Pattern: Patching / Modifying
  if (/^patching|applying\s+patches/i.test(trimmed)) {
    return t('progress.patching');
  }

  // Pattern: Scanning
  if (/^scanning/i.test(trimmed)) {
    return t('progress.scanning');
  }

  // Pattern: Denuvo
  if (/denuvo|ticket/i.test(trimmed)) {
    return t('progress.denuvo_check');
  }

  // Pattern: Finished / Completed
  if (/^complete|^done|^finished/i.test(trimmed)) {
    return t('progress.completed');
  }

  return rawLabel;
}

/**
 * Updates application language and synchronizes DOM direction and font properties.
 * @param {'ar'|'en'} lang 
 */
export function applyLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) return;
  currentLang = lang;

  try {
    localStorage.setItem('ta_ui_language', lang);
    sessionStorage.setItem('ta_ui_language', lang);
  } catch {}

  if (typeof document !== 'undefined') {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';

    // Update data-i18n elements safely using textContent
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (key) {
        el.textContent = t(key);
      }
    });

    // Update ARIA labels
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.dataset.i18nAria;
      if (key) {
        el.setAttribute('aria-label', t(key));
      }
    });

    // Update input placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (key) {
        el.setAttribute('placeholder', t(key));
      }
    });

    // Dispatch global event for interested components
    window.dispatchEvent(new CustomEvent('ta-language-changed', { detail: { language: lang } }));
  }
}

/**
 * Toggles between Arabic and English.
 * @returns {string} New language code
 */
export function toggleLanguage() {
  const nextLang = currentLang === 'ar' ? 'en' : 'ar';
  applyLanguage(nextLang);
  return nextLang;
}

function exposeGlobals() {
  if (typeof window !== 'undefined') {
    window.t = t;
    window.currentLanguage = currentLanguage;
    window.setLanguage = applyLanguage;
    window.toggleLanguage = toggleLanguage;
    window.localizeProgressLabel = localizeProgressLabel;
    window.formatProgressEvent = formatProgressEvent;
  }
}

// Auto-run if loaded in browser
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
  } else {
    initI18n();
  }
}
