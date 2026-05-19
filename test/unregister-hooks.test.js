// test/unregister-hooks.test.js — Tests for all agent unregister functions
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// Helper: create a temp directory for test isolation
function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

module.exports = [
  // ─── CodeBuddy unregister ───────────────────────────────────────────
  {
    name: "unregisterCodeBuddyHooks removes command hooks from settings.json",
    fn() {
      const { unregisterCodeBuddyHooks } = require("../hooks/codebuddy-install.js");
      const tmpDir = makeTempDir("clawd-test-codebuddy-");
      const settingsPath = path.join(tmpDir, "settings.json");
      try {
        const settings = {
          hooks: {
            UserPromptSubmit: [
              { matcher: "", hooks: [{ type: "command", command: '"node" "codebuddy-hook.js"' }] },
              { matcher: "", hooks: [{ type: "command", command: "some-other-hook.js" }] },
            ],
            PermissionRequest: [
              { matcher: "", hooks: [{ type: "http", url: "http://127.0.0.1:23333/permission", timeout: 600 }] },
            ],
          },
        };
        fs.writeFileSync(settingsPath, JSON.stringify(settings));

        const result = unregisterCodeBuddyHooks({ settingsPath });
        assert.ok(result.changed, "should report changed=true");
        assert.ok(result.removed >= 2, `should remove at least 2 hooks, got ${result.removed}`);

        const after = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        // The other hook should remain
        assert.ok(after.hooks.UserPromptSubmit, "non-clawd event should remain");
        assert.strictEqual(after.hooks.UserPromptSubmit.length, 1);
        assert.ok(after.hooks.UserPromptSubmit[0].hooks[0].command.includes("some-other-hook.js"));
        // PermissionRequest should be gone (only had clawd hook)
        assert.strictEqual(after.hooks.PermissionRequest, undefined);
      } finally {
        cleanupDir(tmpDir);
      }
    },
  },
  {
    name: "unregisterCodeBuddyHooks returns no-op when file missing",
    fn() {
      const { unregisterCodeBuddyHooks } = require("../hooks/codebuddy-install.js");
      const result = unregisterCodeBuddyHooks({ settingsPath: "/nonexistent/path/settings.json" });
      assert.strictEqual(result.removed, 0);
      assert.strictEqual(result.changed, false);
    },
  },

  // ─── Gemini unregister ──────────────────────────────────────────────
  {
    name: "unregisterGeminiHooks removes named clawd hooks",
    fn() {
      const { unregisterGeminiHooks } = require("../hooks/gemini-install.js");
      const tmpDir = makeTempDir("clawd-test-gemini-");
      const settingsPath = path.join(tmpDir, "settings.json");
      try {
        const settings = {
          hooks: {
            SessionStart: [
              { matcher: "*", hooks: [{ name: "clawd", type: "command", command: '"node" "gemini-hook.js" SessionStart' }] },
              { matcher: "*", hooks: [{ name: "other", type: "command", command: "other-hook.js" }] },
            ],
          },
          hooksConfig: { disabled: ["clawd", "other-thing"] },
        };
        fs.writeFileSync(settingsPath, JSON.stringify(settings));

        const result = unregisterGeminiHooks({ settingsPath });
        assert.ok(result.changed, "should report changed=true");
        assert.ok(result.removed >= 1, `should remove at least 1 hook, got ${result.removed}`);

        const after = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        assert.strictEqual(after.hooks.SessionStart.length, 1);
        assert.ok(after.hooks.SessionStart[0].hooks[0].command.includes("other-hook.js"));
        // "clawd" should be removed from disabled list
        assert.ok(!after.hooksConfig.disabled.includes("clawd"));
        assert.ok(after.hooksConfig.disabled.includes("other-thing"));
      } finally {
        cleanupDir(tmpDir);
      }
    },
  },
  {
    name: "unregisterGeminiHooks returns no-op when file missing",
    fn() {
      const { unregisterGeminiHooks } = require("../hooks/gemini-install.js");
      const result = unregisterGeminiHooks({ settingsPath: "/nonexistent/settings.json" });
      assert.strictEqual(result.removed, 0);
      assert.strictEqual(result.changed, false);
    },
  },

  // ─── Cursor unregister ──────────────────────────────────────────────
  {
    name: "unregisterCursorHooks removes flat command entries",
    fn() {
      const { unregisterCursorHooks } = require("../hooks/cursor-install.js");
      const tmpDir = makeTempDir("clawd-test-cursor-");
      const hooksPath = path.join(tmpDir, "hooks.json");
      try {
        const settings = {
          version: 1,
          hooks: {
            sessionStart: [
              { command: 'cmd /c ""node" "cursor-hook.js""' },
              { command: "other-hook.js" },
            ],
            sessionEnd: [
              { command: '"node" "cursor-hook.js"' },
            ],
          },
        };
        fs.writeFileSync(hooksPath, JSON.stringify(settings));

        const result = unregisterCursorHooks({ hooksPath });
        assert.ok(result.changed, "should report changed=true");
        assert.strictEqual(result.removed, 2);

        const after = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
        assert.strictEqual(after.hooks.sessionStart.length, 1);
        assert.ok(after.hooks.sessionStart[0].command.includes("other-hook.js"));
        assert.strictEqual(after.hooks.sessionEnd, undefined);
      } finally {
        cleanupDir(tmpDir);
      }
    },
  },

  // ─── Kiro unregister ────────────────────────────────────────────────
  {
    name: "unregisterKiroHooks removes hooks from agent JSON files",
    fn() {
      const { unregisterKiroHooks } = require("../hooks/kiro-install.js");
      const tmpDir = makeTempDir("clawd-test-kiro-");
      const agentsDir = path.join(tmpDir, "agents");
      fs.mkdirSync(agentsDir, { recursive: true });
      try {
        const agentConfig = {
          name: "myagent",
          hooks: {
            agentSpawn: [
              { command: '"node" "kiro-hook.js"' },
              { command: "other-hook.js" },
            ],
            userPromptSubmit: [
              { command: '"node" "kiro-hook.js"' },
            ],
          },
        };
        fs.writeFileSync(path.join(agentsDir, "myagent.json"), JSON.stringify(agentConfig));

        const result = unregisterKiroHooks({ agentsDir, silent: true });
        assert.ok(result.changed, "should report changed=true");
        assert.strictEqual(result.removed, 2);
        assert.ok(result.files.includes("myagent.json"));

        const after = JSON.parse(fs.readFileSync(path.join(agentsDir, "myagent.json"), "utf-8"));
        assert.strictEqual(after.hooks.agentSpawn.length, 1);
        assert.ok(after.hooks.agentSpawn[0].command.includes("other-hook.js"));
        assert.strictEqual(after.hooks.userPromptSubmit, undefined);
      } finally {
        cleanupDir(tmpDir);
      }
    },
  },

  // ─── Kimi unregister ────────────────────────────────────────────────
  {
    name: "unregisterKimiHooks removes [[hooks]] blocks from config.toml",
    fn() {
      const { unregisterKimiHooks } = require("../hooks/kimi-install.js");
      const tmpDir = makeTempDir("clawd-test-kimi-");
      const settingsPath = path.join(tmpDir, "config.toml");
      try {
        const content = [
          'default_model = "kimi-for-coding"',
          "",
          "[[hooks]]",
          'event = "SessionStart"',
          "command = '\"node\" \"kimi-hook.js\"'",
          'matcher = ""',
          "timeout = 30",
          "",
          "[[hooks]]",
          'event = "UserPromptSubmit"',
          "command = 'other-hook.js'",
          'matcher = ""',
          "timeout = 30",
          "",
        ].join("\n");
        fs.writeFileSync(settingsPath, content);

        const result = unregisterKimiHooks({ settingsPath });
        assert.ok(result.changed, "should report changed=true");
        assert.strictEqual(result.removed, 1);

        const after = fs.readFileSync(settingsPath, "utf-8");
        assert.ok(!after.includes("kimi-hook.js"), "clawd hook should be removed");
        assert.ok(after.includes("other-hook.js"), "other hook should remain");
        assert.ok(after.includes('default_model = "kimi-for-coding"'), "non-hook config should remain");
      } finally {
        cleanupDir(tmpDir);
      }
    },
  },
  {
    name: "unregisterKimiHooks returns no-op when file missing",
    fn() {
      const { unregisterKimiHooks } = require("../hooks/kimi-install.js");
      const result = unregisterKimiHooks({ settingsPath: "/nonexistent/config.toml" });
      assert.strictEqual(result.removed, 0);
      assert.strictEqual(result.changed, false);
    },
  },

  // ─── Copilot unregister ─────────────────────────────────────────────
  {
    name: "unregisterCopilotHooks removes bash/powershell entries",
    fn() {
      const { unregisterCopilotHooks } = require("../hooks/copilot-install.js");
      const tmpDir = makeTempDir("clawd-test-copilot-");
      const hooksPath = path.join(tmpDir, "hooks.json");
      try {
        const settings = {
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: '"node" "copilot-hook.js" "sessionStart"', powershell: '& "node" "copilot-hook.js" "sessionStart"', timeoutSec: 5 },
              { type: "command", bash: "other-hook.sh", powershell: "other-hook.ps1", timeoutSec: 5 },
            ],
          },
        };
        fs.writeFileSync(hooksPath, JSON.stringify(settings));

        const result = unregisterCopilotHooks({ hooksPath });
        assert.ok(result.changed, "should report changed=true");
        assert.strictEqual(result.removed, 1);

        const after = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
        assert.strictEqual(after.hooks.sessionStart.length, 1);
        assert.ok(after.hooks.sessionStart[0].bash.includes("other-hook.sh"));
      } finally {
        cleanupDir(tmpDir);
      }
    },
  },

  // ─── OpenCode unregister ────────────────────────────────────────────
  {
    name: "unregisterOpencodePlugin removes plugin path from opencode.json",
    fn() {
      const { unregisterOpencodePlugin } = require("../hooks/opencode-install.js");
      const tmpDir = makeTempDir("clawd-test-opencode-");
      const configPath = path.join(tmpDir, "opencode.json");
      try {
        const settings = {
          "$schema": "https://opencode.ai/config.json",
          plugin: [
            "/home/user/.local/share/clawd/hooks/opencode-plugin",
            "opencode-wakatime",
          ],
        };
        fs.writeFileSync(configPath, JSON.stringify(settings));

        const result = unregisterOpencodePlugin({ configPath });
        assert.ok(result.changed, "should report changed=true");
        assert.ok(result.removed, "should report removed=true");

        const after = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        assert.strictEqual(after.plugin.length, 1);
        assert.strictEqual(after.plugin[0], "opencode-wakatime");
      } finally {
        cleanupDir(tmpDir);
      }
    },
  },
  {
    name: "unregisterOpencodePlugin returns no-op when file missing",
    fn() {
      const { unregisterOpencodePlugin } = require("../hooks/opencode-install.js");
      const result = unregisterOpencodePlugin({ configPath: "/nonexistent/opencode.json" });
      assert.strictEqual(result.removed, false);
      assert.strictEqual(result.changed, false);
    },
  },

  // ─── uninstall.js all-agents integration (require check) ───────────
  {
    name: "hooks/uninstall.js can be required without error",
    fn() {
      // Just verify the module loads without throwing
      delete require.cache[require.resolve("../hooks/uninstall.js")];
      // uninstall.js runs immediately when required as main, so we just check syntax
      const result = require("child_process").spawnSync(
        process.execPath,
        ["--check", path.resolve(__dirname, "..", "hooks", "uninstall.js")],
        { encoding: "utf-8" }
      );
      assert.strictEqual(result.status, 0, `uninstall.js syntax check failed: ${result.stderr}`);
    },
  },
];
