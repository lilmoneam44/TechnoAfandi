# Techno Afandi FC27 Tool — Improvements & Quality Gate Manifest

## Package Information
- **Application:** Techno Afandi FC27 Tool (EA SPORTS FC 27 Launcher & Utility)
- **Target Repository:** https://github.com/lilmoneam44/TechnoAfandi
- **Stack:** Tauri v2, Rust (2021), ES Modules, HTML5, CSS3, Vite 7
- **Version:** 1.2.19 (Patched)

## Changed & Delivered Files

| File Path | Status | Primary Improvements |
| :--- | :--- | :--- |
| `src/scripts/store.js` | **Replaced** | Added mutex-locked singleton initialization, Tauri v2 `@tauri-apps/plugin-store` compatibility, resilient `localStorage` adapter, explicit error propagation, input validation, and `lastSelectedMode` persistence. |
| `src/scripts/ui.js` | **Replaced** | Implemented strict `ACTION_REGISTRY`, completely eliminated `window[action]` reflection fallback, added focus trapping (`Tab` / `Shift+Tab`), focus restoration on dialog close, and `Escape` key dialog teardown. |
| `src/scripts/modal_fit.js` | **Replaced** | Enforced `MIN_SCALE_FLOOR = 0.85`, replaced destructive micro-scaling with internal scrolling (`overflow-y: auto`), added sticky modal footers, and scoped `MutationObserver` directly to overlay elements. |
| `src/scripts/tour.js` | **Replaced** | Rebuilt onboarding sequence with language-independent navigation (no Arabic/English string checks for logic), safe DOM node construction, viewport boundary clamping, missing target skipping, and complete event teardown. |
| `src/scripts/i18n.js` | **Replaced** | Replaced fragile regex chaining with structured progress event parsing, dynamic token replacement (`{file}`, `{percent}`, `{speed}`), multi-tier language fallbacks, and automatic document direction (`dir="rtl"` vs `dir="ltr"`). |
| `src/scripts/home.js` | **Replaced** | Added unique scan session IDs (`currentScanSessionId`) and terminal state checking to discard stale callbacks, debounced rapid progress updates via `requestAnimationFrame`, added keyboard-accessible mode radios, and integrated Quick Launch. |
| `src/scripts/version.js` | **Replaced** | Replaced global `window` exports with `registerActions`, debounced circular progress rendering, connected structured progress localization, and managed pause/resume/cancel state machines. |
| `src/styles/main_patch.css` | **Added** | Restored missing `--cyan-1` and `--cyan-2` color variables to `:root`, added accessible `:focus-visible` focus rings, replaced global `overflow: hidden` with safe scrolling, and added sticky modal action footers. |
| `src-tauri/src/main.rs` | **Updated** | Replaced `to_string_lossy()` with lossless UTF-8 path conversion, stripped Windows extended UNC prefix (`\\?\`), added case-insensitive discovery for `__Installer` and `installerdata.xml`, and bounded directory diagnostics against arbitrary traversal. |

## Verification Summary
- **Unit & Integration Tests:** 9/9 Automated tests passed (`tests/comprehensive_test_suite.js`).
- **Syntax & Bundling:** All JavaScript ES modules and Rust command signatures validated.
