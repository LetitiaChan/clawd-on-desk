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
  it("does not register a PermissionRequest event (IDE has none)", () => {
    assert.ok(!CODEBUDDY_HOOK_EVENTS.includes("PermissionRequest"));
    assert.strictEqual(CODEBUDDY_HOOK_EVENTS.length, 8);
  });

  it("registers one command hook per supported event on fresh install", () => {
    const settingsPath = makeTempSettingsFile({});
    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      nodeBin: "/usr/local/bin/node",
    });

    // 8 command hooks, no HTTP hook, no PermissionRequest event
    assert.strictEqual(result.added, 8);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(result.updated, 0);
    assert.strictEqual(result.removed, 0);

    const settings = readJson(settingsPath);
    assert.ok(!settings.hooks.PermissionRequest, "must not create PermissionRequest event");

    for (const event of CODEBUDDY_HOOK_EVENTS) {
      assert.ok(Array.isArray(settings.hooks[event]), `missing hooks for ${event}`);
      assert.strictEqual(settings.hooks[event].length, 1, `expected 1 entry for ${event}`);
      const entry = settings.hooks[event][0];
      assert.strictEqual(entry.matcher, "");
      assert.ok(Array.isArray(entry.hooks));
      assert.strictEqual(entry.hooks[0].type, "command");
      assert.ok(entry.hooks[0].command.includes(MARKER));
      assert.ok(entry.hooks[0].command.includes("/usr/local/bin/node"));
    }

    // No HTTP hooks anywhere
    for (const entries of Object.values(settings.hooks)) {
      for (const entry of entries) {
        const inner = Array.isArray(entry.hooks) ? entry.hooks : [];
        assert.ok(!inner.some((h) => h.type === "http"), "no HTTP hook should be registered");
      }
    }
  });

  it("is idempotent on second run", () => {
    const settingsPath = makeTempSettingsFile({});
    registerCodeBuddyHooks({ silent: true, settingsPath, nodeBin: "/usr/local/bin/node" });
    const contentBefore = fs.readFileSync(settingsPath, "utf8");

    const result = registerCodeBuddyHooks({ silent: true, settingsPath, nodeBin: "/usr/local/bin/node" });

    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.updated, 0);
    assert.strictEqual(result.removed, 0);
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

  it("scrubs a legacy PermissionRequest HTTP hook left by older installs", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        PermissionRequest: [{
          matcher: "",
          hooks: [{ type: "http", url: "http://127.0.0.1:23333/permission", timeout: 600 }],
        }],
      },
    });

    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      nodeBin: "/usr/local/bin/node",
    });

    assert.ok(result.removed >= 1, "should report removed stale entries");
    const settings = readJson(settingsPath);
    assert.ok(!settings.hooks.PermissionRequest, "PermissionRequest event should be deleted");
  });

  it("scrubs a legacy PermissionRequest command hook and preserves foreign entries", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        PermissionRequest: [
          { matcher: "", hooks: [{ type: "command", command: '"/x/node" "/y/codebuddy-hook.js"' }] },
          { matcher: "", hooks: [{ type: "command", command: '"/x/node" "/y/some-other-tool.js"' }] },
        ],
      },
    });

    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      nodeBin: "/usr/local/bin/node",
    });

    assert.ok(result.removed >= 1);
    const settings = readJson(settingsPath);
    // Foreign (non-Clawd) entry survives
    assert.ok(Array.isArray(settings.hooks.PermissionRequest));
    assert.strictEqual(settings.hooks.PermissionRequest.length, 1);
    assert.ok(settings.hooks.PermissionRequest[0].hooks[0].command.includes("some-other-tool.js"));
  });
});
