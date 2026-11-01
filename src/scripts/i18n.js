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
  'app.title': { ar: 'Techno Afandi – FC 27 Tool', en: 'Techno Afandi – FC 27 Tool' },
  'app.version': { ar: 'الإصدار', en: 'Version' },
  'app.status.connected': { ar: 'متصل', en: 'Connected' },
  'app.status.ready': { ar: 'جاهز للاستخدام', en: 'Ready to Launch' },

  // Hero Section
  'home.hero.title': { ar: 'FC 27 MOD INTEGRATOR', en: 'FC 27 MOD INTEGRATOR' },
  'home.hero.subtitle': { ar: 'التحكم الكامل في تشغيل وتفعيل مودات FC 27', en: 'Complete control for FC 27 mod management & activation' },

  // Modes
  'home.mode.section': { ar: 'اختر نمط التشغيل', en: 'Select Launch Mode' },
  'home.mode.label': { ar: 'اختر نمط التشغيل', en: 'Select launch mode' },
  'home.mode.fmm.title': { ar: 'FMM – FIFA Mod Manager', en: 'FMM – FIFA Mod Manager' },
  'home.mode.fmm.desc': { ar: 'تشغيل الأطقم، والوجوه، والمودات المخصصة عبر Mod Manager.', en: 'Launch custom kits, faces, and gameplay mods via Mod Manager.' },
  'home.mode.fmm.badge': { ar: 'مودات مخصصة', en: 'Custom Mods' },
  'home.mode.live.title': { ar: 'Live Editor Mode', en: 'Live Editor Mode' },
  'home.mode.live.desc': { ar: 'تعديل خواص اللاعبين والذاكرة في الوقت الفعلي أثناء اللعب.', en: 'Real-time player attributes and memory editing during match.' },
  'home.mode.live.badge': { ar: 'تعديل مباشر', en: 'Live Memory' },
  'home.launch.fmm': { ar: 'متابعة بنمط FMM', en: 'Continue with FMM' },
  'home.launch.live': { ar: 'متابعة بنمط Live Editor', en: 'Continue with Live Editor' },
  'mode.fmm.title': { ar: 'FMM Mode (FIFA Mod Manager)', en: 'FMM Mode (FIFA Mod Manager)' },
  'mode.fmm.desc': { ar: 'تشغيل اللعبة مع مود مانجر لإدارة وتثبيت المودات والأطقم.', en: 'Launch game with FIFA Mod Manager for custom kits and mods.' },
  'mode.live.title': { ar: 'Live Editor Mode', en: 'Live Editor Mode' },
  'mode.live.desc': { ar: 'تشغيل اللعبة مع أداة Live Editor لتعديل خصائص اللعبة مباشرة.', en: 'Launch game with Live Editor for real-time memory and player editing.' },
  'mode.warning.title': { ar: 'تنبيه اختيار النمط', en: 'Mode Selection Required' },
  'mode.warning.desc': { ar: 'يرجى اختيار نمط التشغيل أولاً (FMM أو Live Editor) للمتابعة.', en: 'Please select a launcher mode (FMM or Live Editor) to proceed.' },

  // Buttons & Controls
  'btn.launch': { ar: 'بدء تشغيل اللعبة', en: 'Launch Game' },
  'btn.quick_launch': { ar: 'تشغيل فوري', en: 'Quick Launch' },
  'btn.continue': { ar: 'متابعة إلى التفعيل والتشغيل', en: 'Continue to Activation' },
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
  'home.path.title': { ar: 'مسار اللعبة المحدد:', en: 'Selected Game Folder:' },
  'home.path.unselected': { ar: 'لم يتم تحديد المسار (انقر للتحديد أو الفحص)', en: 'No folder selected (click to browse or scan)' },
  'home.path.invalid': { ar: 'مسار غير صالح - انقر للتصحيح', en: 'Invalid folder - click to correct' },
  'btn.diagnostics': { ar: 'تشخيص ملفات اللعبة', en: 'Game Diagnostics' },
  'diag.title': { ar: 'فحص وتشخيص ملفات اللعبة', en: 'Game Installation Diagnostics' },
  'diag.path': { ar: 'المسار المحدد:', en: 'Selected Path:' },
  'diag.dbdata': { ar: 'ملف dbdata.dll:', en: 'dbdata.dll File:' },
  'diag.xml': { ar: 'بيانات التثبيت (XML):', en: 'Installer Data (XML):' },
  'diag.copy': { ar: 'نسخ تقرير الفحص', en: 'Copy Report' },
  'home.locate.scanning': { ar: 'جاري فحص الأقراص بحثاً عن مجلد اللعبة...', en: 'Scanning local drives for FC 27...' },
  'home.locate.cancelling': { ar: 'جاري إلغاء عملية الفحص...', en: 'Cancelling drive scan...' },
  'home.locate.cancelled': { ar: 'تم إلغاء عملية الفحص.', en: 'Drive scan cancelled.' },
  'home.locate.found': { ar: 'تم العثور على مجلد اللعبة بنجاح!', en: 'Game directory detected successfully!' },
  'home.locate.not_found': { ar: 'لم يتم العثور على اللعبة تلقائياً. يرجى تحديد المجلد يدوياً.', en: 'Game folder not found automatically. Please browse manually.' },

  // Welcome & Modal Dialogs
  'home.welcome.title': { ar: 'مرحباً بك في أداة تكنو أفندي FC 27', en: 'Welcome to Techno Afandi FC 27' },
  'home.welcome.desc': { ar: 'تتيح لك الأداة تشغيل المودات وتفعيل EA SPORTS FC 27 بسلاسة تامة. يمكنك بدء جولة تعريفية سريعة أو البدء فوراً.', en: 'This tool lets you launch custom mods and activate EA SPORTS FC 27 seamlessly.' },
  'modal.scan.title': { ar: 'البحث التلقائي عن مسار اللعبة', en: 'Auto-Locate Game Path' },
  'modal.cancel.confirm': { ar: 'تأكيد إلغاء العملية', en: 'Confirm Cancellation' },
  'modal.error.title': { ar: 'تنبيه خطأ', en: 'Error Alert' },
  'nav.version': { ar: 'التفعيل والتحضير للتشغيل', en: 'Activation & Launch Preparation' },

  // Engine Status & Utilities
  'home.system.title': { ar: 'حالة النظام وتكامل المحرك', en: 'Engine & System Status' },
  'home.system.frostbite': { ar: 'محرك Frostbite™', en: 'Frostbite™ Engine' },
  'home.system.memory': { ar: 'حقن الذاكرة', en: 'Memory Hook' },
  'home.system.guard': { ar: 'حماية التفعيل', en: 'Activation Guard' },
  'home.system.active': { ar: 'متصل ونشط', en: 'Active' },
  'home.system.ready': { ar: 'جاهز للحقن', en: 'Ready' },
  'home.system.protected': { ar: 'محمي وآمن', en: 'Protected' },

  // Tour Guide
  'tour.start': { ar: 'جولة تعريفية', en: 'Start Tour' },
  'tour.next': { ar: 'التالي', en: 'Next' },
  'tour.prev': { ar: 'السابق', en: 'Previous' },
  'tour.skip': { ar: 'تخطي الجولة', en: 'Skip Tour' },
  'tour.finish': { ar: 'إنهاء', en: 'Finish' },
  'tour.step1.title': { ar: 'مرحباً بك', en: 'Welcome' },
  'tour.step1.desc': { ar: 'أداة تكنو أفندي لتشغيل وتفعيل مودات FC 27 بأعلى كفاءة.', en: 'Techno Afandi FC 27 mod management and activation platform.' },
  'tour.step2.title': { ar: 'مسار اللعبة', en: 'Game Folder' },
  'tour.step2.desc': { ar: 'تأكد من تحديد مجلد تثبيت لعبة FC 27 بشكل صحيح.', en: 'Ensure the FC 27 installation folder is correctly selected.' },
  'tour.step3.title': { ar: 'أنماط التشغيل', en: 'Launch Modes' },
  'tour.step3.desc': { ar: 'اختر بين نمط Mod Manager للأطقم أو Live Editor لتعديل الخصائص.', en: 'Choose between FIFA Mod Manager or Live Editor mode.' },
  'tour.step4.title': { ar: 'التشغيل والتفعيل', en: 'Launch & Activate' },
  'tour.step4.desc': { ar: 'اضغط للمتابعة لبدء عملية التفعيل وتشغيل اللعبة فوراً.', en: 'Click to start activation and launch the game.' },

  // Progress & Events
  'progress.downloading': { ar: 'جاري التحميل: {file} ({percent}%) {speed}', en: 'Downloading: {file} ({percent}%) {speed}' },
  'progress.scanning': { ar: 'جاري فحص: {folder}', en: 'Scanning: {folder}' },
  'progress.extracting': { ar: 'جاري استخراج الملفات: {file}', en: 'Extracting: {file}' },
  'progress.injecting': { ar: 'جاري تطبيق وتفعيل المودات...', en: 'Applying and injecting mods...' },
  'progress.completed': { ar: 'تمت العملية بنجاح!', en: 'Operation completed successfully!' },
  'progress.paused': { ar: 'العملية متوقفة مؤقتاً', en: 'Operation paused' },
  'progress.cancelled': { ar: 'تم إلغاء العملية', en: 'Operation cancelled' },
  'error.general': { ar: 'حدث خطأ غير متوقع', en: 'An unexpected error occurred' }
};

let currentLang = DEFAULT_LANGUAGE;

/**
 * Retrieves the currently active language.
 * @returns {string} 'ar' or 'en'
 */
export function currentLanguage() {
  return currentLang;
}

/**
 * Resolves localized string by translation key.
 * Never returns raw key to the DOM if missing.
 * @param {string} key 
 * @param {Record<string, any>} params 
 * @returns {string|null}
 */
export function t(key, params = {}) {
  const entry = dictionary[key];
  if (!entry) {
    return null;
  }

  // Tiered fallback: active language -> Arabic -> English
  let text = entry[currentLang] || entry['ar'] || entry['en'] || null;
  if (!text) return null;

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
 * @param {object} eventPayload 
 * @returns {string} Localized display string
 */
export function formatProgressEvent(eventPayload) {
  if (!eventPayload) return '';

  const { status, file, percent, speed, folder } = eventPayload;
  switch (status) {
    case 'downloading':
      return t('progress.downloading', {
        file: file || '',
        percent: percent !== undefined ? Math.round(percent) : '0',
        speed: speed ? `[${speed}]` : ''
      }) || '';
    case 'scanning':
      return t('progress.scanning', { folder: folder || '' }) || '';
    case 'extracting':
      return t('progress.extracting', { file: file || '' }) || '';
    case 'injecting':
      return t('progress.injecting') || '';
    case 'completed':
      return t('progress.completed') || '';
    case 'paused':
      return t('progress.paused') || '';
    case 'cancelled':
      return t('progress.cancelled') || '';
    default:
      return eventPayload.message || '';
  }
}

/**
 * Helper to localize progress label
 */
export function localizeProgressLabel(key, fallback = '') {
  const val = t(key);
  return val !== null ? val : fallback;
}

/**
 * Applies active language across the DOM.
 * Only overwrites elements if a valid translation string exists.
 * @param {string} lang 
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

    // Update data-i18n elements safely without ever placing raw keys
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (key) {
        const val = t(key);
        if (val && val !== key) {
          el.textContent = val;
        }
      }
    });

    // Update aria-label attributes safely
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.dataset.i18nAria;
      if (key) {
        const val = t(key);
        if (val && val !== key) {
          el.setAttribute('aria-label', val);
        }
      }
    });
  }
}

/**
 * Initializes i18n from persistent storage or default.
 */
export function initI18n() {
  let saved = null;
  try {
    saved = localStorage.getItem('ta_ui_language') || sessionStorage.getItem('ta_ui_language');
  } catch {}

  const initialLang = saved && SUPPORTED_LANGUAGES.includes(saved) ? saved : DEFAULT_LANGUAGE;
  applyLanguage(initialLang);

  if (typeof window !== 'undefined') {
    window.toggleLanguage = () => {
      const nextLang = currentLang === 'ar' ? 'en' : 'ar';
      applyLanguage(nextLang);
    };
  }
}
