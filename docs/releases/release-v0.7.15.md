## v0.7.15

> Fork release. Continuation of the v0.7.x line on `LetitiaChan/clawd-on-desk`.

---

### New Features

- None in this release.

---

### Bug Fixes

- **"Jump to terminal" and state detection failed entirely for the CodeBuddy CN build.** On Windows the CN (国内版) IDE registers its process as `CodeBuddy CN.exe`, but every process-name match point only listed `codebuddy.exe`. Fix: added the CN variants to all match points, factored into a shared `CODEBUDDY_PROCESS_NAMES` constant with regression tests.
- **CodeBuddy hook process could hang on stdin read failure.** Added graceful `.catch()` that emits `{}` and exits cleanly so the IDE never stalls.
- **Windows agent-process detection was case-sensitive for CodeBuddy.** Changed to `-icontains` (case-insensitive) and added the `CodeBuddy.exe` variant to the names array.
- **Dead `PermissionRequest` entry in `agents/codebuddy.js` eventMap.** Removed the dead entry to prevent developer confusion; added explanatory comment.
- **Unix agent-process detection missed `CodeBuddy` (uppercase).** Added `pgrep -x 'CodeBuddy'` fallback to the chain.
- **CodeBuddy Dashboard "Jump to terminal" silently failed — `editor` field dropped by server.** Added `"codebuddy"` to the server-side editor whitelist in `src/server-route-state.js`.
- **CodeBuddy permission bubble — dual IDE + CLI path.** `codebuddy` has two approval mechanisms sharing `~/.codebuddy/settings.json`: the **IDE** has no `PermissionRequest` event and carries approval via `PreToolUse.permissionDecision` (only setting `requires_approval === true` on payloads it wants confirmed — and IDE-bundle inspection confirmed `requires_approval` exists **only** on the `execute_command` tool, while `delete_file` / `write_to_file` / `append_to_file` / `replace_in_file` are `changeFileTools` gated by the IDE's own file-change UI and never carry it), while the **`codebuddy` CLI** (a Claude Code fork) fires a real blocking `PermissionRequest` hook. Fix: `codebuddy-hook.js` intercepts IDE `PreToolUse` payloads with `requires_approval === true`, and `codebuddy-install.js` now also registers a `PermissionRequest` HTTP hook (→ `/permission`) that drives the CLI path and is harmless dead config in the IDE. The installer reconciles that hook's URL to the active port instead of deleting it, and only scrubs dead *command* hooks from older installs. Unreachable / no-decision / DND all fall back so Clawd never decides for the user. `src/integration-sync.js` threads the runtime port into the CodeBuddy sync.
- **CodeBuddy IDE terminal focus not working.** Changed extension `activationEvents` to `"onStartupFinished"` and added `"CodeBuddy"` as a window title candidate.
- **"Jump to terminal" still failed for CodeBuddy IDE — precise terminal-tab focus never fired.** Expanded `normalizeFocusRequest` editor allow-list, added `.codebuddycn/extensions` install target, bumped `EXT_VERSION` to `0.1.1`.
- **Update check falsely reports "up to date" when a new release exists.** Changed `draft: true` → `draft: false` in `build.yml` so releases are published immediately upon CI completion.

---

### Internal / Refactor

- Documented `res.destroy()` vs explicit `"deny"` semantics in `src/permission.js` cleanup path.
- Reworked `codebuddy-install.js` to register the CLI `PermissionRequest` HTTP hook (with URL reconciliation) beside the state command hooks; narrowed cleanup to dead command hooks only. Added dual-path docs to `codebuddy-install.js` / `codebuddy-hook.js`.

---

### Release & Packaging

- **CI build pipeline** — `build.yml` now creates published (non-draft) releases so the updater can detect new versions via GitHub API `/releases/latest`.

---

### Test Results

- `npm test` — **2680 passed / 0 failed / 5 skipped** (346 suites, 30.4 s)
- `npm run check:syntax` — ✅ 400 files, 13 require entries

---

### Known Limitations

- **CodeBuddy IDE permission bubble is best-effort and structurally limited to `execute_command`.** Inspection of the IDE bundle (`resources\app\out\codebuddy\main.js` + `extensions\genie\...`) shows `requires_approval` is a parameter of the `execute_command` tool **only**; the delete tool (`delete_file`) and the other file-change tools (`write_to_file` / `append_to_file` / `replace_in_file`) never carry it and are approved through the IDE's own file-change (diff/approve) UI. So the Clawd IDE bubble can only ever fire for `execute_command`, and even then the IDE's built-in TerminalExecutor usually confirms *before* the `PreToolUse` hook fires — meaning for deletions and file edits the IDE bubble cannot appear at all. Reliable Clawd permission bubbles are available on the **`codebuddy` CLI** path (Claude Code fork) via the `PermissionRequest` HTTP hook. End-to-end bubble behavior on the CLI still warrants a real `codebuddy` CLI run against a dangerous command.
- CodeBuddy CN build detection relies on process-name matching; if the CN IDE significantly changes its executable name in future versions, the detection may need updating.
