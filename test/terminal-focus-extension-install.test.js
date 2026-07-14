"use strict";

// main.js cannot be require()d in the test runner (it pulls in electron), so we
// assert on its source text — the same pattern used by other main.js tests
// (agent-runtime-main.test.js, pet-window-runtime.test.js, ...).
//
// Regression guard for: "跳转终端 (CodeBuddy IDE) 无效". CodeBuddy CN is a
// VS Code fork whose user extension dir is ~/.codebuddycn/extensions. The Clawd
// terminal-focus extension must be auto-installed there, and focus.js must keep
// the "codebuddy" editor value so scheduleTerminalTabFocus dispatches /focus-tab.

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.resolve(__dirname, "..", "src");

describe("terminal-focus extension install targets", () => {
  it("auto-installs the extension into the CodeBuddy CN IDE extension dir", () => {
    const mainSource = fs.readFileSync(path.join(SRC_DIR, "main.js"), "utf8");

    // The three supported VS Code forks must all be install targets.
    assert.match(mainSource, /path\.join\(home,\s*"\.vscode",\s*"extensions"\)/);
    assert.match(mainSource, /path\.join\(home,\s*"\.cursor",\s*"extensions"\)/);
    assert.match(mainSource, /path\.join\(home,\s*"\.codebuddycn",\s*"extensions"\)/);
  });

  it("keeps focus.js editor allow-list in sync with the install targets", () => {
    const focusSource = fs.readFileSync(path.join(SRC_DIR, "focus.js"), "utf8");

    // The editor allow-list drives whether scheduleTerminalTabFocus fires; if
    // "codebuddy" is dropped here, CodeBuddy sessions silently fall back to
    // window-level focus and never switch to the right terminal tab.
    const match = focusSource.match(/TERMINAL_TAB_FOCUS_EDITORS\s*=\s*new Set\(\[([^\]]*)\]\)/);
    assert.ok(match, "TERMINAL_TAB_FOCUS_EDITORS set must exist in focus.js");
    const members = match[1];
    assert.match(members, /"code"/);
    assert.match(members, /"cursor"/);
    assert.match(members, /"codebuddy"/);
  });

  it("keeps main.js EXT_VERSION in lockstep with the extension package.json", () => {
    // The install routine names the target dir after EXT_VERSION and skips
    // reinstall when it already exists. If EXT_VERSION lags the actual extension
    // version, extension updates (e.g. onUri→onStartupFinished) never reach
    // already-installed users.
    const mainSource = fs.readFileSync(path.join(SRC_DIR, "main.js"), "utf8");
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "extensions", "vscode", "package.json"), "utf8")
    );
    const versionMatch = mainSource.match(/EXT_VERSION\s*=\s*"([^"]+)"/);
    assert.ok(versionMatch, "EXT_VERSION must be defined in main.js");
    assert.strictEqual(
      versionMatch[1],
      pkg.version,
      "main.js EXT_VERSION must equal extensions/vscode/package.json version"
    );
  });
});
