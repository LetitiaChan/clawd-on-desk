## v0.7.13

> Fork release. Continuation of the v0.7.x line on `LetitiaChan/clawd-on-desk`.

### New Features

- **Gongfeng Copilot wizard — auto-detect Bash & per-platform install guidance.** The wizard now lazily calls `detectBashPaths()` and renders the Bash-path block dynamically: when candidates are found it lists them with the recommended one tagged "✨ 推荐"; when none are found it shows platform-specific install guidance (Windows: `winget`/Scoop/Choco; macOS: `brew install bash`; Linux: `apt`/`dnf`/`pacman`).
- **Release automation script: `scripts/release.js`.** Interactive CLI implementing the 8-step release flow end-to-end. Supports `--version <x.y.z>` for non-interactive use and `--dry-run` for preview. Surfaced as `npm run release`.
- **CHANGELOG enforcement in CI: `scripts/check-changelog.js`.** Fails `ci.yml` when a push changes non-doc files but does not update `CHANGELOG.md`. Surfaced as `npm run check:changelog`.
- **Rule consistency check: `scripts/check-rule-consistency.js`.** Verifies that every `npm run <script>` reference in `project-continuity.mdc` exists in `package.json`. Surfaced as `npm run check:rules`.
- **Release notes template: `docs/releases/release-template.md`.** Standardized template used by `scripts/release.js` to scaffold new release notes files.

### Bug Fixes

- **Linux deb build `Macro file is not defined` error.** `build/linux-after-remove.sh` used `${file}` bash syntax which electron-builder interpreted as a package macro. Changed to `$file`.
- **macOS CI test failure in updater test.** The "packaged download fails" test exercised the Windows-only path on all platforms; pinned to `platform: "win32"` and fixed `src/updater.js` to use injectable `runtimePlatform`.
- **`agents/gongfeng-copilot.js` `eventMap.afterAgentResponse` mismatch.** Aligned with the runtime hook mapping (`thinking` instead of `idle`).
- **Uninstall residue: `~/.gongfeng-copilot/hooks/clawd/` never cleaned up.** NSIS and Linux deb uninstallers now remove this directory. `hooks/uninstall.js` gained a 14th cleanup step.
- **Marker lists missed `gongfeng-copilot-hook.js` & `codex-debug-hook.js`.** Both uninstaller marker arrays now include these entries.
- **`checkExistingClawdHooks` read lagging `hooks-cache.json`.** Now prefers `hooks.json` (source-of-truth) with `hooks-cache.json` as fallback.
- **Wizard hard-coded `C:\Program Files\Git\bin\bash.exe`.** Now scans the real machine via `detectBashPaths()` and shows actual paths or per-platform install guidance.
- **Packaged exe falsely reported "Git Bash 未检测到".** Three-pronged fix: literal+env-derived candidates, `existsBypassWow64()` cmd fallback, `whichCommand` dual-attempt with diagnostics array.
- **`build.yml` matrix refactor broke sidecar test.** Assertions rewritten to verify semantic matrix invariants instead of literal command strings.
- **Uninstalling Clawd left orphaned hooks in all non-Claude agent configs.** NSIS and Linux deb uninstallers now iterate all 13 agent config locations.

### Internal / Refactor

- **Hook hardening** — `.catch()` on stdin promise, 5s hard timeout, opt-in `CLAWD_HOOK_DEBUG=1` stderr diagnostic.
- **`src/main.js` global crash guards** — `uncaughtException` + `unhandledRejection` handlers at top of main, log-only (no `process.exit`).
- **`hooks/gongfeng-bash-detector.js` deprecation banner** — Top-of-file comment marks standalone CLI HTML output as superseded.
- **Wizard diagnostics panel** — Footer `🧪 诊断信息` block with three collapsible `<details>` panes showing detection state.
- **New test files** — `gongfeng-bash-detector-robustness.test.js` (6 invariants), `code-review-hardening-2026-05-19.test.js` (18 invariants), expanded `gongfeng-copilot-wizard-template.test.js`.
- **`ci.yml` remote safety net** — Linux + Windows matrix, runs on every push and PR to `main`.
- **`scripts/check-syntax.js`** — One-shot static check: 395 files + 13 require entries.
- **`build.yml` matrix refactor** — Three platform jobs collapsed into single matrix-driven job.
- **`build.yml` hardening** — `setup-node@v4` + `cache: "npm"` + `npm ci` + concurrency guard.
- **`ci.yml` CHANGELOG enforcement** — `npm run check:changelog` as final CI step.
- **Dependabot enabled** — Weekly npm + github-actions scans; Electron trio major upgrades ignored.
- **`.gitignore` whitelist fixes** — `scripts/*` entries for new scripts.
- **Platform-skip guards on 9 windows-only tests** — Added `process.platform` skip for cross-platform CI.
- **`docs/investigations/hook-binary-feasibility.md`** — Feasibility analysis of compiling hooks to platform binaries (not recommended).

### Release & Packaging

- **CI build pipeline refactored** — `build.yml` now uses matrix strategy for Windows/macOS/Linux. `ci.yml` added as push/PR safety net. `auto-tag.yml` creates tags from `package.json` version bumps.

### Test Results

- `npm test` — **2637 passed / 0 failed / 5 skipped** (2642 total, 336 suites, 20.54 s)
- `npm run check:syntax` — 395 files, 13 require entries ✅

### Known Limitations

- The Gongfeng wizard diagnostic panel (`🧪 诊断信息`) is debug-oriented; the three `<details>` panes show raw arrays and may be confusing to end users — future versions may gate it behind a verbose flag.
- `ci.yml` CHANGELOG enforcement may need tuning for edge cases (multi-commit pushes where only the last commit touches source files).
- Platform-skip guards mean 5 tests are skipped on Linux/macOS — these test Windows-specific path handling that cannot be meaningfully exercised cross-platform.
