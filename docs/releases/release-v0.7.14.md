## v0.7.14

> Fork release. Continuation of the v0.7.x line on `LetitiaChan/clawd-on-desk`.

### New Features

- **Node.js install guidance in wizard and doctor modal.** When `node` is not detected on the system, the Gongfeng Copilot wizard now renders a dedicated step ⓪ (before the Bash step ①) with per-platform install commands: Windows (`winget install OpenJS.NodeJS.LTS` + msi download + nvm-windows/Volta/Scoop/Chocolatey), macOS (`brew install node@20` + nvm/Volta), Linux (`apt`/`dnf`/`pacman` + NodeSource + nvm/Volta). The wizard meta-info also shows Node detection status (✅ / ⚠️). The Settings → Doctor modal's Node.js check now displays inline install commands for all three platforms when Node is missing, in all 5 UI locales.
- **10 new test cases** (`test/gongfeng-copilot-node-guide.test.js`): covers `_detectNodeAvailability`, `_renderNodeSection` per-platform rendering, and wizard integration.

### Bug Fixes

- **CLI `tools/gongfeng-wizard.js` summary printed misleading bare `node` instead of the real Node.js path.** Users running the CLI saw `- Node 路径: node` and reasonably concluded Clawd had not detected their Node.js install — even though the generated HTML wizard's meta-info already showed the correct absolute path. The CLI summary now calls the same detector so both surfaces agree.
- **Wizard HTML `meta-info` Node line had a dead-code fallback to `result.node_bin`** (the win32 sentinel `"node"`). Simplified to `nodeStatus.nodePath || '(detected)'` and pinned with a regression test.

### Internal / Refactor

- Removed the abandoned "bundled Node" approach (`scripts/fetch-node-portable.js`, never committed).

### Release & Packaging

- **CI build pipeline** — unchanged from v0.7.13.

### Test Results

- `npm test` — **2657 passed / 0 failed / 5 skipped** (340 suites, 21.5 s)
- `npm run check:syntax` — ✅ 398 files, 13 require entries
- `npm run verify:sidecars` — ✅

### Known Limitations

- Node.js install guidance is informational only — Clawd does not auto-install Node.js for the user.
- The wizard's Node detection relies on PATH lookup; if Node is installed but not on PATH, the wizard will show the install guidance even though Node is present on disk.
