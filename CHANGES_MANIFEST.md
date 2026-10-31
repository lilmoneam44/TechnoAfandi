# Techno Afandi FC27 Tool — Product Evolution Manifest (v1.2.20)

## Application Metadata
- **Product Name:** Techno Afandi FC27 Tool
- **Repository:** https://github.com/lilmoneam44/TechnoAfandi
- **Baseline Commit:** `ac6cc7c879c89c0c7b024775a46485ba06d48dbf` (HEAD of `main`)
- **Release Version:** 1.2.20
- **Technology Stack:** Tauri v2, Rust 2021, JavaScript ES Modules, HTML5, CSS3, Vite 7

## Complete File Deliverables & Improvements

### 1. `src-tauri/src/main.rs` (984 Lines — Full Architecture Preserved)
- **Root-Level Visibility Fix:** All crate root commands are declared private (`fn <name>()`), eliminating Rust compiler error `E0255` duplicate macro definitions.
- **Unicode-Safe Windows Pathing:** `get_exe_dir()` converts paths losslessly via `to_str().ok_or(...)` and strips Windows verbatim UNC prefix (`r#"\\?\"#`), preventing `\u{FFFD}` path corruption on Arabic and non-English Windows usernames.
- **Case-Insensitive Installer Discovery:** `check_game_folder` and `get_folder_diagnostics` safely locate `__Installer` or `_installer` without breaking existing function signatures.
- **Bounded Diagnostics:** `get_folder_diagnostics` guards against arbitrary root filesystem queries (`/`, `C:\`, `C:`).
- **All 16 Commands Preserved:** `get_exe_dir`, `get_app_version`, `get_current_exe_path`, `copy_and_relaunch`, `check_game_folder`, `get_folder_diagnostics`, `get_game_version`, `start_activation`, `cancel_activation`, `pause_activation`, `resume_activation`, `open_url`, `clean_temp_files`, `auto_locate_game`, `cancel_game_scan`, `exit_app`.
- **Formatting:** Strictly complies with `cargo fmt --check`.

### 2. `src/scripts/store.js` (Vite Build & Persistence)
- **Build Resolution:** Removed uninstalled `@tauri-apps/plugin-store` import that caused Rollup build failure during `npm run build`.
- **Persistent WebStorage Adapter:** Native to WebView2 on Windows, stores configuration reliably across application restarts in local disk profile.
- **Mutex-Guarded Initialization:** Promise lock prevents concurrent initialization races.
- **Explicit Error Propagation:** Returns `{ success: true }` or `{ success: false, error }` instead of swallowing errors silently.

### 3. `src/scripts/home.js` (Dashboard, Quick Launch & Diagnostics)
- **Interactive Path Status Bar:** Real-time visual feedback on whether the selected FC 27 installation path is verified or missing.
- **One-Click Quick Launch:** Instant launch path for returning players using cached, validated configurations.
- **Diagnostics Center:** Integrated `openDiagnostics` and `copyDiagnostics` for inspecting game files and sharing reports.
- **Session-Guarded Scanning:** Unique atomic scan session IDs discard stale callbacks from canceled operations.
- **Progress Saturation Guard:** Debounces rapid scan progress events via `requestAnimationFrame`.
- **Keyboard-Accessible Modes:** Radio group arrow key navigation (Left/Right/Up/Down).

### 4. `src/scripts/ui.js` (Action Registry & Accessibility)
- **Zero Reflection:** Explicit `ACTION_REGISTRY` replaces unconstrained `window[action]` execution.
- **Focus Management:** Traps keyboard focus (`Tab` / `Shift+Tab`) inside active dialogs and restores focus to triggering elements upon dismissal.
- **Escape Key Handling:** Dismisses active top-level dialogs cleanly.

### 5. `src/scripts/modal_fit.js` (Responsive Dialog Scaling)
- **Readability Floor:** Enforces `MIN_SCALE_FLOOR = 0.85`, preventing microscopic text on small viewports.
- **Internal Scrolling & Sticky Actions:** Enables `overflow-y: auto` with sticky footers so action buttons are never clipped.
- **Scoped Observer:** Scopes `MutationObserver` directly to overlay elements instead of the entire document tree.

### 6. `src/scripts/tour.js` (Bilingual Onboarding)
- **Language-Agnostic Logic:** Uses semantic step indices instead of matching Arabic/English text labels.
- **Boundary Clamping:** Prevents tooltips from clipping off-screen.
- **Clean Teardown:** Completely detaches event listeners on completion or dismissal.

### 7. `src/scripts/i18n.js` (Localization Engine)
- **Structured Progress Events:** Pattern-based token matching (`{file}`, `{percent}`, `{speed}`) replaces brittle regex chaining.
- **Bilingual Coverage:** Complete Arabic (RTL) and English (LTR) dictionaries with automatic document direction synchronization.

### 8. `src/styles/main_patch.css` (Design System Overhaul)
- **Restored Design Tokens:** Defines `--cyan-1: #38EFFF` and `--cyan-2: #00D2E0` in `:root`.
- **Accessibility:** Adds `:focus-visible` glow rings.
- **Component Styling:** Styles Path Status Bar, Quick Launch, and Diagnostics cards.

### 9. Version Manifests
- `package.json`: Version bumped to `1.2.20`.
- `src-tauri/Cargo.toml`: Version bumped to `1.2.20`.
- `src-tauri/tauri.conf.json`: Version bumped to `1.2.20`.

## Automated Quality Gate Test Results
- **Suite:** `tests/comprehensive_test_suite.js`
- **Result:** 10/10 Tests Passed (Store mutex, path validation, mode roundtrip, Action Registry, i18n RTL/LTR, progress event tokens, diagnostics tokens, modal scale floor, scan session guard, tour lifecycle).
