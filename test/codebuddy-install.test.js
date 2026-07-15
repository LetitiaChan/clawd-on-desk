const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { registerCodeBuddyHooks, unregisterCodeBuddyHooks, CODEBUDDY_HOOK_EVENTS } = require("../hooks/codebuddy-install");

const MARKER = "codebuddy-hook.js";
const PERMISSION_URL = "http://127.0.0.1:23333/permission";
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
  it("does not register PermissionRequest as a command event (state hooks only)", () => {
    assert.ok(!CODEBUDDY_HOOK_EVENTS.includes("PermissionRequest"));
    assert.strictEqual(CODEBUDDY_HOOK_EVENTS.length, 8);
  });

  it("registers one command hook per state event + a PermissionRequest HTTP hook on fresh install", () => {
    const settingsPath = makeTempSettingsFile({});
    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      port: 23333,
      nodeBin: "/usr/local/bin/node",
    });

    // 8 command hooks + 1 PermissionRequest HTTP hook
    assert.strictEqual(result.added, 9);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(result.updated, 0);
    assert.strictEqual(result.removed, 0);

    const settings = readJson(settingsPath);

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

    // The ONLY HTTP hook lives under PermissionRequest, pointing at /permission.
    assert.ok(Array.isArray(settings.hooks.PermissionRequest));
    assert.strictEqual(settings.hooks.PermissionRequest.length, 1);
    const httpEntry = settings.hooks.PermissionRequest[0];
    assert.strictEqual(httpEntry.matcher, "");
    assert.strictEqual(httpEntry.hooks[0].type, "http");
    assert.strictEqual(httpEntry.hooks[0].url, PERMISSION_URL);
    assert.strictEqual(httpEntry.hooks[0].timeout, 600);

    // No HTTP hook leaks into the state events.
    for (const event of CODEBUDDY_HOOK_EVENTS) {
      for (const entry of settings.hooks[event]) {
        const inner = Array.isArray(entry.hooks) ? entry.hooks : [];
        assert.ok(!inner.some((h) => h.type === "http"), `no HTTP hook should be under ${event}`);
      }
    }
  });

  it("is idempotent on second run", () => {
    const settingsPath = makeTempSettingsFile({});
    registerCodeBuddyHooks({ silent: true, settingsPath, port: 23333, nodeBin: "/usr/local/bin/node" });
    const contentBefore = fs.readFileSync(settingsPath, "utf8");

    const result = registerCodeBuddyHooks({ silent: true, settingsPath, port: 23333, nodeBin: "/usr/local/bin/node" });

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

  it("preserves and syncs a Clawd PermissionRequest HTTP hook from older installs", () => {
    const settingsPath = makeTempSettingsFile({
      hooks: {
        PermissionRequest: [{
          matcher: "",
          hooks: [{ type: "http", url: "http://127.0.0.1:23335/permission", timeout: 600 }],
        }],
      },
    });

    const result = registerCodeBuddyHooks({
      silent: true,
      settingsPath,
      port: 23333,
      nodeBin: "/usr/local/bin/node",
    });

    // The existing HTTP hook is reconciled to the active port, not removed/duplicated.
    assert.strictEqual(result.removed, 0, "must not remove the CLI's PermissionRequest HTTP hook");
    assert.ok(result.updated >= 1, "should sync the stale HTTP hook URL");
    const settings = readJson(settingsPath);
    assert.ok(Array.isArray(settings.hooks.PermissionRequest));
    assert.strictEqual(settings.hooks.PermissionRequest.length, 1, "no duplicate HTTP hook");
    assert.strictEqual(settings.hooks.PermissionRequest[0].hooks[0].url, PERMISSION_URL);
  });

  it("scrubs a legacy PermissionRequest command hook, preserves foreign entries, and adds the HTTP hook", () => {
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
      port: 23333,
      nodeBin: "/usr/local/bin/node",
    });

    assert.ok(result.removed >= 1);
    const settings = readJson(settingsPath);
    assert.ok(Array.isArray(settings.hooks.PermissionRequest));
    // Foreign command entry survives + our HTTP hook was appended = 2 entries.
    assert.strictEqual(settings.hooks.PermissionRequest.length, 2);
    const foreign = settings.hooks.PermissionRequest.find(
      (e) => e.hooks && e.hooks[0] && e.hooks[0].command && e.hooks[0].command.includes("some-other-tool.js")
    );
    assert.ok(foreign, "foreign command hook must survive");
    const http = settings.hooks.PermissionRequest.find(
      (e) => e.hooks && e.hooks[0] && e.hooks[0].type === "http"
    );
    assert.ok(http, "Clawd PermissionRequest HTTP hook must be present");
    assert.strictEqual(http.hooks[0].url, PERMISSION_URL);
    // The dead Clawd command hook is gone.
    assert.ok(!settings.hooks.PermissionRequest.some(
      (e) => e.hooks && e.hooks[0] && e.hooks[0].command && e.hooks[0].command.includes(MARKER)
    ));
  });

  it("unregister removes both command hooks and the PermissionRequest HTTP hook", () => {
    const settingsPath = makeTempSettingsFile({});
    registerCodeBuddyHooks({ silent: true, settingsPath, port: 23333, nodeBin: "/usr/local/bin/node" });

    const result = unregisterCodeBuddyHooks({ settingsPath });
    assert.ok(result.removed >= 9, "should remove 8 command hooks + 1 HTTP hook");

    const settings = readJson(settingsPath);
    // No Clawd command hooks and no PermissionRequest HTTP hook remain.
    for (const entries of Object.values(settings.hooks || {})) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const inner = Array.isArray(entry.hooks) ? entry.hooks : [];
        assert.ok(!inner.some((h) => h && h.command && h.command.includes(MARKER)));
        assert.ok(!inner.some((h) => h && h.type === "http" && h.url && h.url.includes("/permission")));
      }
    }
  });
});
