const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { registerCodeBuddyHooks, CODEBUDDY_HOOK_EVENTS } = require("../hooks/codebuddy-install");

const MARKER = "codebuddy-hook.js";
const tempDirs = [];

function makeTempSettingsFile(initial = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-codebuddy-"));
  const settingsPath = path.join(tmpDir, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(initial, null, 2), "utf8");
  tempDirs.push(tmpDir);
  return settingsPath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("CodeBuddy hook installer", () => {
  it("registers all command events + PermissionRequest HTTP hook on fresh install", () => {
    const settingsPath = makeTempSettingsFile({});
    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      nodeBin: "/usr/local/bin/node",
    });

    // 9 command hooks (including PermissionRequest) + 1 HTTP hook = 10
    assert.strictEqual(result.added, 10);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(result.updated, 0);

    const settings = readJson(settingsPath);

    // Verify command hooks (nested Claude Code format)
    for (const event of CODEBUDDY_HOOK_EVENTS) {
      assert.ok(Array.isArray(settings.hooks[event]), `missing hooks for ${event}`);
      // PermissionRequest has both command + HTTP hook entries
      const commandEntries = settings.hooks[event].filter(
        e => e.hooks && e.hooks.some(h => h.type === "command")
      );
      assert.strictEqual(commandEntries.length, 1, `expected 1 command hook for ${event}`);
      const entry = commandEntries[0];
      assert.strictEqual(entry.matcher, "");
      assert.ok(Array.isArray(entry.hooks));
      assert.strictEqual(entry.hooks[0].type, "command");
      assert.ok(entry.hooks[0].command.includes(MARKER));
      assert.ok(entry.hooks[0].command.includes("/usr/local/bin/node"));
    }

    // Verify PermissionRequest HTTP hook (in addition to command hook)
    const permEntries = settings.hooks.PermissionRequest;
    assert.ok(Array.isArray(permEntries));
    assert.strictEqual(permEntries.length, 2); // command + HTTP
    const httpEntry = permEntries.find(
      e => e.hooks && e.hooks.some(h => h.type === "http")
    );
    assert.ok(httpEntry, "missing HTTP hook entry for PermissionRequest");
    const permHook = httpEntry.hooks[0];
    assert.strictEqual(permHook.type, "http");
    assert.ok(permHook.url.includes("127.0.0.1"));
    assert.ok(permHook.url.includes("/permission"));
    assert.strictEqual(permHook.timeout, 600);
  });

  it("is idempotent on second run", () => {
    const settingsPath = makeTempSettingsFile({});
    registerCodeBuddyHooks({ silent: true, settingsPath, nodeBin: "/usr/local/bin/node" });
    const contentBefore = fs.readFileSync(settingsPath, "utf8");

    const result = registerCodeBuddyHooks({ silent: true, settingsPath, nodeBin: "/usr/local/bin/node" });

    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.updated, 0);
    assert.strictEqual(fs.readFileSync(settingsPath, "utf8"), contentBefore);
  });

  it("updates stale hook paths in nested format", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        Stop: [{
          matcher: "",
          hooks: [{ type: "command", command: '"/old/node" "/old/path/codebuddy-hook.js"' }],
        }],
      },
    });

    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      nodeBin: "/usr/local/bin/node",
    });

    assert.ok(result.updated >= 1);
    const settings = readJson(settingsPath);
    assert.ok(settings.hooks.Stop[0].hooks[0].command.includes("/usr/local/bin/node"));
    assert.ok(!settings.hooks.Stop[0].hooks[0].command.includes("/old/path/"));
    assert.strictEqual(settings.hooks.Stop.length, 1);
  });

  it("updates stale hook paths in flat format (migration)", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        PreToolUse: [{ command: '"/old/node" "/old/path/codebuddy-hook.js"' }],
      },
    });

    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      nodeBin: "/usr/local/bin/node",
    });

    assert.ok(result.updated >= 1);
    const settings = readJson(settingsPath);
    // Flat entry gets its command updated in place
    assert.ok(settings.hooks.PreToolUse[0].command.includes("/usr/local/bin/node"));
    assert.ok(!settings.hooks.PreToolUse[0].command.includes("/old/path/"));
  });

  it("preserves existing node path from nested format when detection fails", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        Stop: [{
          matcher: "",
          hooks: [{ type: "command", command: '"/home/user/.nvm/versions/node/v20/bin/node" "/some/path/codebuddy-hook.js"' }],
        }],
      },
    });

    registerCodeBuddyHooks({ silent: true, settingsPath, nodeBin: null });

    const settings = readJson(settingsPath);
    assert.ok(settings.hooks.Stop[0].hooks[0].command.includes("/home/user/.nvm/versions/node/v20/bin/node"));
  });

  it("preserves existing node path from flat format when detection fails", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        PostToolUse: [{ command: '"/home/user/.volta/bin/node" "/some/path/codebuddy-hook.js"' }],
      },
    });

    registerCodeBuddyHooks({ silent: true, settingsPath, nodeBin: null });

    const settings = readJson(settingsPath);
    assert.ok(settings.hooks.PostToolUse[0].command.includes("/home/user/.volta/bin/node"));
  });

  it("updates stale PermissionRequest HTTP URL", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        PermissionRequest: [{
          matcher: "",
          hooks: [{ type: "http", url: "http://127.0.0.1:99999/permission", timeout: 600 }],
        }],
      },
    });

    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      nodeBin: "/usr/local/bin/node",
    });

    assert.ok(result.updated >= 1);
    const settings = readJson(settingsPath);
    const permHook = settings.hooks.PermissionRequest[0].hooks[0];
    assert.ok(permHook.url.includes("/permission"));
    assert.ok(permHook.url.includes("127.0.0.1"));
    assert.notStrictEqual(permHook.url, "http://127.0.0.1:99999/permission");
  });
});
