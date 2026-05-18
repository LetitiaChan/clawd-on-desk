# Changelog

All notable changes to **Clawd on Desk** (this fork: `LetitiaChan/clawd-on-desk`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Fork note** — This is the `LetitiaChan/clawd-on-desk` fork. The version axis here continues the upstream `0.7.x` line (last upstream tag on this track was `v0.7.1`). The upstream `v0.8.0` tag is unrelated to this fork's `0.7.10+` releases. Per-version release notes shipped with each draft GitHub Release are kept under `docs/releases/release-<tag>.md`.

---

## [Unreleased]

### Internal / Refactor
- **Remote-side bug-fix safety net via `ci.yml`.** Added `.github/workflows/ci.yml` (Linux + Windows matrix) which runs `npm ci` + `npm run check:syntax` + `npm test` on every push to any branch and every PR targeting `main` (with `paths-ignore` for documentation-only paths matching `project-continuity` rule §4.1). Closes the gap where a bug-fix push could previously rely only on local `npm test`. The workflow uses path-scoped `concurrency` to cancel superseded runs on the same ref.
- **One-shot static check script: `scripts/check-syntax.js`.** Replaces the manual `node --check <file>` checklist that used to live in `project-continuity` rule §2 step 1. Recursively scans `src/`, `hooks/`, `agents/`, `tools/`, `scripts/`, `test/`, `launch.js` (388 `*.js` files at landing time), then exercises `require()` on 13 pinned entrypoints (each `hooks/*-install.js`, sidecar scripts) to catch top-level `require` failures that `node --check` alone cannot detect. Surfaced as `npm run check:syntax`.
- **`build.yml` hardening.** All three platform jobs (Windows / macOS / Linux) now: (a) use `actions/setup-node@v4` with `cache: "npm"` for npm cache reuse, (b) switched from `npm install` to `npm ci` for reproducible installs (lockfile drift is now fail-fast), and (c) the workflow gained a top-level `concurrency: release-${{ github.ref }}, cancel-in-progress: false` block so that re-pushing the same tag never has two release jobs racing while still letting an in-flight artifact upload finish cleanly.
- **Dependabot enabled (`.github/dependabot.yml`).** Weekly scans for both `npm` and `github-actions` ecosystems (Asia/Shanghai Monday 03:00). Major upgrades for `electron`, `electron-builder`, and `electron-updater` are explicitly ignored — those have to be raised manually because they touch BrowserWindow security model / NSIS / auto-update manifest format.
- **`.gitignore` whitelist fix.** The repo-wide `scripts/*` ignore rule (line 86) silently swallows any new `scripts/*.js`. Added `!scripts/check-syntax.js` to the existing whitelist so the new script ships with the repo. **Convention going forward**: any new `scripts/*.js` must add a matching `!scripts/<file>` line, otherwise CI will hard-fail with `ENOENT` once it's referenced from a workflow.
- **`package.json` scripts.** Added `"check:syntax": "node scripts/check-syntax.js"`. Dependencies and lockfile unchanged.

### Changed
- **`project-continuity` rule.** Synchronized rule text with the above infra changes: the "locally allowed commands" header now lists `npm run check:syntax`; rule §2 step 1 collapses the manual `node --check` checklist into the new script; rule §2 step 6 is rewritten to describe the four-workflow split (`ci.yml` / `build.yml` / `auto-tag.yml` / `sync-upstream.yml`) and clarifies that pushing a `package.json` version bump to `main` implicitly triggers `auto-tag.yml` → `build.yml`; rule §4.2 now mandates `npm ci` parity in dependency upgrades.

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
