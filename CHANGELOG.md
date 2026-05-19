# Changelog

All notable changes to **Clawd on Desk** (this fork: `LetitiaChan/clawd-on-desk`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Fork note** — This is the `LetitiaChan/clawd-on-desk` fork. The version axis here continues the upstream `0.7.x` line (last upstream tag on this track was `v0.7.1`). The upstream `v0.8.0` tag is unrelated to this fork's `0.7.10+` releases. Per-version release notes shipped with each draft GitHub Release are kept under `docs/releases/release-<tag>.md`.

---

## [Unreleased]

### Added
- **Gongfeng Copilot wizard — auto-detect Bash & per-platform install guidance.** `generateHtmlWizard` (in `hooks/gongfeng-copilot-install.js`) now lazily calls `detectBashPaths()` from `hooks/gongfeng-bash-detector.js` (or accepts an explicit `detection` parameter for tests) and renders the Bash-path block dynamically: when one or more bash candidates are found it lists all of them with the most likely one tagged "✨ 推荐" and copy-paste buttons; when none are found it switches to platform-specific install guidance — Windows offers a one-click `winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements` command (plus Scoop/Choco/官网手动下载 fallbacks), macOS suggests `brew install bash`, Linux lists `apt`/`dnf`/`pacman` commands. Closes the bug where the wizard hard-coded `C:\Program Files\Git\bin\bash.exe` and misled users whose Git is installed elsewhere or not installed at all.
- **Three new wizard template invariant tests** (`test/gongfeng-copilot-wizard-template.test.js`): renders the winget command on Windows when no bash detected, renders `brew install bash` on macOS when no bash detected, renders Linux package-manager commands on Linux when no bash detected. The previous "must include `C:\Program Files\Git\bin\bash.exe`" assertion has been **inverted** into a regression guard that the legacy hard-coded path no longer leaks into the rendered HTML when a real path was detected.
- **Release automation script: `scripts/release.js`.** Interactive CLI that implements the 8-step release flow from project-continuity rule §3 end-to-end: pre-flight checks (`check:syntax` + `npm test`), version bump, CHANGELOG section close, release notes generation from template, commit, tag, and push. Supports `--version <x.y.z>` for non-interactive use and `--dry-run` to preview without committing. Surfaced as `npm run release`.
- **CHANGELOG enforcement in CI: `scripts/check-changelog.js`.** Fails `ci.yml` when a push changes non-documentation files but does not update `CHANGELOG.md`. Doc-only commits (matching the same `paths-ignore` list as `ci.yml`) are automatically exempted. Surfaced as `npm run check:changelog`.
- **Rule consistency check: `scripts/check-rule-consistency.js`.** Verifies that every `npm run <script>` reference in `project-continuity.mdc` actually exists in `package.json`. Catches drift between the rule file and available scripts. Surfaced as `npm run check:rules`.
- **Release notes template: `docs/releases/release-template.md`.** Standardized template with `{VERSION}` placeholder used by `scripts/release.js` to scaffold new release notes files.

### Fixed
- **Uninstalling Clawd left orphaned hooks in all non-Claude agent configs, causing runtime errors.** When Clawd was uninstalled via Windows Control Panel (NSIS), only `~/.claude/settings.json` was cleaned. Hooks registered in CodeBuddy, Gemini, Cursor, Kiro, Kimi, Copilot, Codex, OpenCode, OpenClaw, Hermes, and Pi configs were left behind — causing `Cannot find module 'codebuddy-hook.js'` errors on next AI session. The NSIS uninstaller (`build/uninstall-claude-hooks.ps1`) now iterates all 13 agent config locations. A new `build/linux-after-remove.sh` script provides equivalent cleanup for Linux deb packages via `afterRemove`. Each agent install script now exports a symmetric `unregister*Hooks()` function and supports `--uninstall` CLI flag. `hooks/uninstall.js` gains an `all-agents` target that calls all 13 unregister functions in sequence.
- **Wizard `命令执行器路径` was hard-coded to `C:\Program Files\Git\bin\bash.exe`** regardless of where Git was actually installed on the user's machine — and gave no guidance at all when Git Bash was not installed. The wizard now scans the real machine via `detectBashPaths()` (already used by `tools/gongfeng-wizard.js`'s detector page) and renders whatever paths are actually present, with the recommended one shown in the green banner; when nothing is detected it surfaces the install guide in step ① instead of pretending the default path will work. The CLI entry point of `hooks/gongfeng-copilot-install.js` (`require.main === module`) was likewise updated so the printed setup instructions match reality on the host machine.
- **`build.yml` matrix refactor broke `test/package-build-config.test.js` "fetches and verifies pinned sidecars before release builds".** When `build.yml` was collapsed into a single matrix-driven `build` job (commit `96c6cd2`), the pinned sidecar pipeline was rewritten to use `${{ matrix.sidecar-targets }}` / `${{ matrix.verify-arg }}` / `${{ matrix.builder-flag }}` interpolation, but the test still asserted the literal pre-matrix command strings (`"npm run fetch:sidecars -- --target windows-x64,windows-arm64"` etc.) and so failed on every push to `main` since that commit (visible as 3 consecutive red CI runs on `main`). The assertion has been rewritten to verify two semantic invariants: (A) `matrix.include` declares the three platforms with the canonical `(sidecar-targets, verify-arg, builder-flag)` triplets; (B) the run-steps invoke the three-stage pipeline (fetch → verify → electron-builder) using matrix interpolation, in the right order. This restores the regression guard that the pre-matrix assertion was meant to provide.

### Internal / Refactor
- **Remote-side bug-fix safety net via `ci.yml`.** Added `.github/workflows/ci.yml` (Linux + Windows matrix) which runs `npm ci` + `npm run check:syntax` + `npm test` on every push to any branch and every PR targeting `main` (with `paths-ignore` for documentation-only paths matching `project-continuity` rule §4.1). Closes the gap where a bug-fix push could previously rely only on local `npm test`. The workflow uses path-scoped `concurrency` to cancel superseded runs on the same ref.
- **One-shot static check script: `scripts/check-syntax.js`.** Replaces the manual `node --check <file>` checklist that used to live in `project-continuity` rule §2 step 1. Recursively scans `src/`, `hooks/`, `agents/`, `tools/`, `scripts/`, `test/`, `launch.js` (388 `*.js` files at landing time), then exercises `require()` on 13 pinned entrypoints (each `hooks/*-install.js`, sidecar scripts) to catch top-level `require` failures that `node --check` alone cannot detect. Surfaced as `npm run check:syntax`.
- **`build.yml` matrix refactor.** Collapsed three near-identical platform build jobs (`build-windows`, `build-mac`, `build-linux`) into a single `build` job using `strategy.matrix.include`. Reduces YAML from ~75 lines to ~60 lines while preserving identical behavior; the `release` job now depends on the single matrix job name.
- **`build.yml` hardening.** All three platform jobs (Windows / macOS / Linux) now: (a) use `actions/setup-node@v4` with `cache: "npm"` for npm cache reuse, (b) switched from `npm install` to `npm ci` for reproducible installs (lockfile drift is now fail-fast), and (c) the workflow gained a top-level `concurrency: release-${{ github.ref }}, cancel-in-progress: false` block so that re-pushing the same tag never has two release jobs racing while still letting an in-flight artifact upload finish cleanly.
- **`ci.yml` now enforces CHANGELOG updates.** Added `npm run check:changelog` as the final step in the CI matrix, aligning with project-continuity rule §2 step 4.
- **Dependabot enabled (`.github/dependabot.yml`).** Weekly scans for both `npm` and `github-actions` ecosystems (Asia/Shanghai Monday 03:00). Major upgrades for `electron`, `electron-builder`, and `electron-updater` are explicitly ignored — those have to be raised manually because they touch BrowserWindow security model / NSIS / auto-update manifest format.
- **`.gitignore` whitelist fix.** The repo-wide `scripts/*` ignore rule (line 86) silently swallows any new `scripts/*.js`. Added `!scripts/check-syntax.js`, `!scripts/check-changelog.js`, `!scripts/check-rule-consistency.js`, `!scripts/release.js` to the whitelist so new scripts ship with the repo.
- **`package.json` scripts.** Added `"check:syntax"`, `"check:changelog"`, `"check:rules"`, `"release"`. Dependencies and lockfile unchanged.
- **Platform-skip guards on 9 windows-only unit tests.** The first ubuntu-latest run of `ci.yml` (commit `43f78d7`) failed on 9 pre-existing tests in `test/install.test.js` and `test/kiro-install.test.js` that hardcode backslash path literals (e.g. `"C:\\Users\\Tester\\..."` / `"D:\\shim-store\\..."`) and then call `path.dirname` / `path.join` — those Node helpers honor backslashes only when `process.platform === 'win32'`, so on Linux the candidate-paths-deep-equal assertion drifts and the suite reports `not ok`. Added `{ skip: process.platform !== "win32" ? "<reason>" : false }` to each of the 9 tests using the same B-style pattern already established in `test/kiro-install.test.js` (`:261/:422`), `test/shared-process.test.js` (`:32/:172`), and `test/windows-uninstall-cleanup.test.js`. Affected: 7 in `Claude version detection helpers`, 1 in `Hook installer version compatibility` (subtest name literally says "on Windows"), 1 in `Kiro hook installer` (asserts `LOCALAPPDATA` install path).

### Changed
- **`project-continuity` rule.** Synchronized rule text with the above infra changes: the "locally allowed commands" header now lists `npm run check:syntax`; rule §2 step 1 collapses the manual `node --check` checklist into the new script; rule §2 step 6 is rewritten to describe the four-workflow split (`ci.yml` / `build.yml` / `auto-tag.yml` / `sync-upstream.yml`) and clarifies that pushing a `package.json` version bump to `main` implicitly triggers `auto-tag.yml` → `build.yml`; rule §4.2 now mandates `npm ci` parity in dependency upgrades.
- **Gongfeng Copilot wizard — clearer step-by-step instructions in the install template.** The HTML wizard rendered by `generateHtmlWizard` (in `hooks/gongfeng-copilot-install.js`) now spells out the exact CodeBuddy click path for step 2 ("CodeBuddy 插件 → Hooks → 管理 Hooks → 新建 Hooks → 刷新") instead of the previous one-liner "为下面每个事件创建钩子", and replaces the abstract step 3 "重启 VSCode 测试钩子是否生效" with a concrete desktop-pet three-state self-check (idle ↔ thinking ↔ responding) that matches the `afterAgentResponse` mapping fixed in `[0.7.10]`. Failure-mode hints (check `已配置 X/11`, confirm `bash.exe` path on Windows, inspect Clawd settings → logs) are listed inline so users can self-diagnose without filing an issue.
- **New invariant tests for the wizard template.** Added `test/gongfeng-copilot-wizard-template.test.js` with 6 substring-level checks (Windows `bash.exe` advice present, CodeBuddy click path landmarks present, three-state pet verification text present, `已配置 X/11` progress hint present, snippet cards render in order with copy buttons, defensive rendering for `status:"not_ready"`). These are deliberately substring-level rather than full snapshots so wording can still evolve, but the *meaning* cannot silently regress.

---

## [0.7.12] - 2026-05-18

> Tag: `v0.7.12` · Commit: `7d748c0` · Release notes: [`docs/releases/release-v0.7.12.md`](docs/releases/release-v0.7.12.md)

### Added
- **Gongfeng Copilot — in-Settings wizard buttons.** The Gongfeng Copilot agent card in `Settings → Agents` now exposes two inline actions: **Generate install wizard** and **Generate uninstall wizard**. Each button calls the new `generateGongfengCopilotWizard` / `generateGongfengCopilotUninstallWizard` IPC commands, renders the wizard HTML next to the user's writable runtime directory, and opens it with the system default browser — no terminal trip through `tools/gongfeng-wizard.js` required.
- **Settings i18n coverage for the Gongfeng wizard rows.** Added `rowGongfengGenerateWizard` / `rowGongfengGenerateUninstall` row labels, descriptions, button captions, and result toasts (`toastGongfengWizardOk`, `toastGongfengWizardOpenFailed`, `toastGongfengPluginMissing`) in `src/settings-i18n.js` for both English and Simplified Chinese.

### Fixed
- **Surface test for `settings-actions-agents`.** Updated the command-surface assertion in `test/settings-actions-agents.test.js` to accept the two new Gongfeng wizard commands, preventing silent drift whenever a new agent action is added.
- **Ignore noise files.** `.codebuddy/` (CodeBuddy rule cache) and `test_output.txt` (`npm test` redirection scratch output) are now properly gitignored so they cannot leak into release commits.

### Changed (Internal / Refactor)
- **Wizard renderer moved into `hooks/gongfeng-copilot-install.js`.** The HTML wizard generator that used to live in `tools/gongfeng-wizard.js` is now exported from `hooks/gongfeng-copilot-install.js`. This matters because `hooks/**/*` is shipped under `asarUnpack` in `package.json` while `tools/**/*` is **not** packaged into the production app. Moving the renderer keeps the Settings-side `generateGongfengCopilotWizard` IPC handler self-contained inside the production bundle. `tools/gongfeng-wizard.js` keeps its dev-time CLI entry but delegates rendering to the hook module — the CLI and the Settings button now produce byte-identical wizard pages.
- **New IPC plumbing for the wizard commands.** `src/preload-settings.js`, `src/settings-ipc.js`, `src/settings-actions.js`, and `src/settings-actions-agents.js` were extended to wire the two new commands end-to-end (renderer → preload → main → action handler → file write → `openLocalFile`).

### Release & Packaging
- **Tag scheme correction.** `package.json` jumps from `0.7.10` directly to `0.7.12`. The `v0.7.11` git tag on this fork was created at a commit that did **not** actually bump `package.json` (it carried only "publish config to fork repo" changes), so it has been left in place but is **intentionally skipped** on the version axis to avoid republishing under a poisoned tag.
- **CI build pipeline unchanged.** `.github/workflows/build.yml` still triggers on `v*` tags, runs `npm test` + `electron-builder` on Windows / macOS / Linux, uploads platform installers as artifacts, and creates a draft GitHub Release that pulls release notes from `docs/releases/release-${tag}.md`.

### Test Results
- `npm test` — **2602 passed / 0 failed / 5 skipped** (2607 total, 328 suites, 20.65 s).
- `npm run verify:sidecars` — pinned sidecar binaries for Windows x64/arm64, macOS x64/arm64, and Linux x64 verified against checksums.

### Known Limitations
- The two wizard buttons surface a localized `plugin_not_installed` toast when the Gongfeng plugin isn't present yet — install the plugin first via the existing CodeBuddy install flow.
- Generated wizard HTML opens via the OS default browser; on hosts without a default browser registered, the toast reports the open error path but the file is still written to disk and can be opened manually.
- **`v0.7.11` tag is intentionally orphaned.** Anyone consuming `latest.yml` from this fork should get `v0.7.12` directly.

---

## [0.7.11] - 2026-05-18 [SKIPPED — tag orphaned]

> Tag: `v0.7.11` · Commit: `8e1e424` · ⚠️ **Do not consume.** This tag is intentionally skipped on the version axis. It was created during a fork-publish-config bump that did not actually change `package.json`'s version; the next real release is [`v0.7.12`](#0712---2026-05-18).

### Changed
- `chore: bump version to v0.7.11 and update publish config to fork repo` (`adba635`).
- `fix: update tests for gongfeng-copilot agent and fork repo config` (`8e1e424`).

---

## [0.7.10] - 2026-05-17

> Tag: `v0.7.10` · Commit: `d018255`

### Added
- **Gongfeng Copilot (CodeBuddy 内网版) integration.** Initial end-to-end support for the Gongfeng Copilot agent: hook scripts, install/uninstall flows, agent registry entry, settings card wiring, and a one-stop wizard tool (`tools/gongfeng-wizard.js`). See commits `e37053e`, `3fbe0c3`, `8fbe3af`, `a14a27c`.
- **`gongfeng-bash-detector` hooks wizard.** New one-stop hook setup wizard for Gongfeng / CodeBuddy 内网版 (commit `a14a27c`).
- **Fork sync automation.** Added `.github/workflows/sync-upstream.yml` (and friends) so the fork can sync from upstream, auto-tag, rebase feature branches, and publish releases directly from the fork (commit `b7d4923`).

### Fixed
- **`afterAgentResponse` mapping for Gongfeng Copilot.** Re-mapped the response phase from `idle` to `thinking` so the desktop pet keeps reacting during the plain-text streaming phase (commit `521dc74`).

### Changed (Internal / Refactor)
- `restore upstream-only files (idle-bubble animation, sidecar docs) to keep diff focused on Gongfeng integration` (`f40eaef`).
- `neutralize comments — remove references to plugin internals (cloud-sync, md5 checks) and reframe as UI-based integration` (`8fbe3af`).
- `sanitize Gongfeng Copilot integration & revert unrelated changes` (`3fbe0c3`).

---

## Upstream history (pre-fork divergence)

The following versions predate this fork's divergence point and were tagged on the upstream repository (`rullerzhou-afk/clawd-on-desk`). Detailed per-version release notes are kept under [`docs/releases/`](docs/releases/) for the ones we already have on disk; the tag itself is the source of truth otherwise.

- **v0.8.0** — Telegram remote approval (sidecar manager, settings tab, pinned binaries), refreshed thinking animation, normalized 64×64 agent icons, plus the bug fixes called out in [`docs/releases/release-v0.8.0.md`](docs/releases/release-v0.8.0.md).
  > ⚠️ Unrelated to this fork's `0.7.10+` releases on the version axis — see the fork note at the top of this file.
- **v0.7.1** — Settings language picker overhaul, Codex Pet zh-TW translation, doctor panel polish, Hermes Agent integration, and several Windows hook hardenings. See [`docs/releases/release-v0.7.1.md`](docs/releases/release-v0.7.1.md).
- **v0.7.0** — Large pre-v0.7.1 refactor wave (settings ipc / theme runtime / pet window runtime / agent runtime extraction). No standalone release-notes file shipped.
- **v0.6.3** — See [`docs/releases/release-v0.6.3.md`](docs/releases/release-v0.6.3.md).
- **v0.6.2** — See [`docs/releases/release-v0.6.2.md`](docs/releases/release-v0.6.2.md).
- **v0.6.1** — See [`docs/releases/release-v0.6.1.md`](docs/releases/release-v0.6.1.md).
- **v0.6.0** — See [`docs/releases/release-v0.6.0.md`](docs/releases/release-v0.6.0.md).
- **v0.5.5** — See [`docs/releases/release-v0.5.5.md`](docs/releases/release-v0.5.5.md).
- **v0.5.0 → v0.5.10, v0.4.0, v0.3.x, v0.2.0, v0.1.0** — Tag-only history; refer to `git log <tag>` for details.

---

## Conventions

- **Language.** Per project rule H3.7, `CHANGELOG.md` is written in English. Category emojis are optional and may be used in per-version release notes under `docs/releases/`.
- **Categories.** We use the standard Keep a Changelog buckets: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Project-specific buckets (`Release & Packaging`, `Test Results`, `Known Limitations`, `Internal / Refactor`) are appended where useful.
- **Update timing.**
  - **Bug-fix flow** — append to the current version block (or open a new `[Unreleased]` block) **before** running `git commit && git push`, per `project-continuity` rule §2 step 4.
  - **Release flow** — close out the `[Unreleased]` block into a new `[x.y.z] - YYYY-MM-DD` section **before** the packaging step, per `project-continuity` rule §3 step 3.
- **Pure internal documentation changes** (rules, progress notes, etc.) may skip CHANGELOG updates.
- **No local packaging.** Per `project-continuity` rule §header, `electron-builder` and platform installer artifacts are produced **only** by `.github/workflows/build.yml` on tag push; never attach a locally-built installer to a GitHub Release. Local work stops at `npm test` + commit + push.

[Unreleased]: https://github.com/LetitiaChan/clawd-on-desk/compare/v0.7.12...HEAD
[0.7.12]: https://github.com/LetitiaChan/clawd-on-desk/releases/tag/v0.7.12
[0.7.11]: https://github.com/LetitiaChan/clawd-on-desk/releases/tag/v0.7.11
[0.7.10]: https://github.com/LetitiaChan/clawd-on-desk/releases/tag/v0.7.10
