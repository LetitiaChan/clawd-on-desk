## v0.7.12

> Fork release. Continuation of the v0.7.x line on `LetitiaChan/clawd-on-desk`.
> v0.7.11 was reserved for an aborted fork-publish-config bump and is intentionally skipped on the version axis (the upstream `v0.8.0` tag is unrelated to this fork's `0.7.x` track).

### New Features

- **Gongfeng Copilot — in-Settings wizard buttons** — The Gongfeng Copilot agent card in `Settings → Agents` now ships two inline actions: **Generate install wizard** and **Generate uninstall wizard**. Clicking either button calls into the main process via the new `generateGongfengCopilotWizard` / `generateGongfengCopilotUninstallWizard` IPC commands, renders the wizard HTML, drops it next to the user's writable runtime directory, and opens it with the system default browser. No more bouncing through `tools/gongfeng-wizard.js` from a terminal — the same wizard is one click away from the desktop pet's settings panel.
- **Settings i18n coverage for Gongfeng wizard rows** — New `rowGongfengGenerateWizard` / `rowGongfengGenerateUninstall` row labels, descriptions, button captions, and result toasts (`toastGongfengWizardOk`, `toastGongfengWizardOpenFailed`, `toastGongfengPluginMissing`) covered in `src/settings-i18n.js` for both English and Simplified Chinese.

### Bug Fixes

- **Surface test for `settings-actions-agents`** — Updated the command-surface assertion in `test/settings-actions-agents.test.js` so it accepts the two new Gongfeng wizard commands. Prevents the test suite from drifting silently every time a new agent action is added.
- **`.codebuddy/` and `test_output.txt` ignored** — Local CodeBuddy rule cache and `npm test` redirection scratch output are now properly ignored, so they can't leak into a release commit again.

### Internal / Refactor

- **Wizard renderer moved into `hooks/gongfeng-copilot-install.js`** — The HTML wizard generator that used to live in `tools/gongfeng-wizard.js` is now exported from `hooks/gongfeng-copilot-install.js`. This matters because `hooks/**/*` is shipped under `asarUnpack` in `package.json` while `tools/**/*` is **not** packaged into the production app. Moving the renderer keeps the Settings-side `generateGongfengCopilotWizard` IPC handler self-contained inside the production bundle. `tools/gongfeng-wizard.js` keeps its dev-time CLI entry but delegates rendering to the hook module — the CLI and the Settings button now produce byte-identical wizard pages.
- **New IPC plumbing for wizard commands** — `src/preload-settings.js`, `src/settings-ipc.js`, `src/settings-actions.js`, and `src/settings-actions-agents.js` were extended to wire the two new commands end-to-end (renderer → preload → main → action handler → file write → `openLocalFile`).

### Release & Packaging

- **Tag scheme correction** — `package.json` jumps from `0.7.10` directly to `0.7.12`. The `v0.7.11` git tag on this fork was created at a commit that did **not** actually bump `package.json` (it carried only "publish config to fork repo" changes), so it's been left in place and skipped on the version axis to avoid republishing under a poisoned tag.
- **CI build pipeline unchanged** — `.github/workflows/build.yml` still triggers on `v*` tags, runs `npm test` + `electron-builder` on Windows / macOS / Linux, uploads platform installers as artifacts, and creates a draft GitHub Release that pulls release notes from `docs/releases/release-${tag}.md` (this file).

### Test Results

- `npm test` — **2602 passed / 0 failed / 5 skipped**, 2607 total, 328 suites, 20.65 s.
- `npm run verify:sidecars` — pinned sidecar binaries for Windows x64/arm64, macOS x64/arm64, and Linux x64 verified against checksums.

### Known Limitations

- **Wizard buttons require the Gongfeng plugin to be installed** — Both buttons surface a `plugin_not_installed` toast (localized) when the underlying plugin isn't present yet. Install the plugin first via the existing CodeBuddy install flow.
- **Generated wizard HTML opens via the OS default browser** — On hosts that have no default browser registered (rare), the toast will report the open error path; the file is still written to disk and can be opened manually.
- **Skipped tag — `v0.7.11`** — As noted under "Release & Packaging", the `v0.7.11` tag is intentionally orphaned. Anyone consuming `latest.yml` from this fork should get `v0.7.12` directly.
