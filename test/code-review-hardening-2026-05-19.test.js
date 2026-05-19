// 本测试文件集中验证 2026-05-19 P0/P1/P2 评审修复闭环：
//   • P0-1: agents/gongfeng-copilot.js 的 eventMap.afterAgentResponse 与
//     hooks/gongfeng-copilot-hook.js 的 HOOK_TO_STATE 必须一致（thinking）
//   • P0-3: build/uninstall-claude-hooks.ps1 与 build/linux-after-remove.sh
//     的 marker 列表必须包含 gongfeng-copilot-hook.js
//   • P0-2: build/* 卸载脚本必须包含 ~/.gongfeng-copilot/hooks/clawd 的清理
//     片段；hooks/gongfeng-copilot-uninstall.js 必须导出 removeLocalStubDir
//     并在 prepareGongfengCopilotUninstall 中默认调用
//   • P1-7: gongfeng-copilot-install.checkExistingClawdHooks 与
//     gongfeng-copilot-uninstall.collectClawdHooks 必须优先读 hooks.json
//     而非 hooks-cache.json
//
// 这些都是「结构性不变式」（按 AGENT-PROGRESS §六-16 沉淀的经验，断言只锁
// 领域语义/文件存在性/键存在性，不锁具体路径或文案字面量），后续重构时不
// 应被这些断言绑住手脚。

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("Code review hardening — P0/P1/P2 round (2026-05-19)", () => {
  // ── P0-1 ───────────────────────────────────────────────────────────
  describe("P0-1: agents/gongfeng-copilot.js eventMap aligned with hook runtime", () => {
    it("eventMap.afterAgentResponse should be 'thinking' (matches hook HOOK_TO_STATE)", () => {
      const agent = require("../agents/gongfeng-copilot");
      assert.strictEqual(
        agent.eventMap.afterAgentResponse,
        "thinking",
        "afterAgentResponse must stay 'thinking' so the desk pet keeps reacting "
        + "during plain-text streaming; do not regress to 'idle'."
      );
    });

    it("eventMap should map all 11 plugin events", () => {
      const agent = require("../agents/gongfeng-copilot");
      const expected = [
        "beforeSubmitPrompt", "afterAgentThought", "afterAgentResponse",
        "beforeShellExecution", "afterShellExecution",
        "beforeMCPExecution", "afterMCPExecution",
        "afterFileEdit", "afterSearchReplaceFileEdit", "afterFileRead",
        "stop",
      ];
      for (const ev of expected) {
        assert.ok(
          ev in agent.eventMap,
          `eventMap missing event: ${ev}`
        );
      }
    });
  });

  // ── P0-2 / P0-3 ────────────────────────────────────────────────────
  describe("P0-2/P0-3: uninstall scripts cover gongfeng-copilot", () => {
    const psPath = path.resolve(__dirname, "..", "build", "uninstall-claude-hooks.ps1");
    const shPath = path.resolve(__dirname, "..", "build", "linux-after-remove.sh");

    it("Windows ps1: marker list contains gongfeng-copilot-hook.js", () => {
      const content = fs.readFileSync(psPath, "utf-8");
      assert.ok(
        content.includes('"gongfeng-copilot-hook.js"'),
        "ClawdCommandMarkers in uninstall-claude-hooks.ps1 must include gongfeng-copilot-hook.js"
      );
    });

    it("Windows ps1: cleans up ~/.gongfeng-copilot/hooks/clawd directory", () => {
      const content = fs.readFileSync(psPath, "utf-8");
      // 语义级断言：脚本里出现了 .gongfeng-copilot 路径片段 + hooks + clawd
      // + 某种目录删除调用（[System.IO.Directory]::Delete / Remove-Item / rd 等）。
      assert.ok(
        content.includes(".gongfeng-copilot"),
        "ps1 should reference ~/.gongfeng-copilot path"
      );
      assert.ok(
        /\[System\.IO\.Directory\]::Delete|Remove-Item.*-Recurse|rd \/s/i.test(content),
        "ps1 should call a recursive directory delete API"
      );
    });

    it("Linux sh: marker list contains gongfeng-copilot-hook.js", () => {
      const content = fs.readFileSync(shPath, "utf-8");
      assert.ok(
        content.includes("gongfeng-copilot-hook.js"),
        "CLAWD_MARKERS in linux-after-remove.sh must include gongfeng-copilot-hook.js"
      );
    });

    it("Linux sh: cleans up ~/.gongfeng-copilot/hooks/clawd directory", () => {
      const content = fs.readFileSync(shPath, "utf-8");
      assert.ok(
        content.includes(".gongfeng-copilot/hooks/clawd"),
        "sh should reference the local stub dir"
      );
      assert.ok(
        /rm -rf .*\.gongfeng-copilot\/hooks\/clawd/.test(content),
        "sh should rm -rf the local stub dir"
      );
    });

    it("hooks/gongfeng-copilot-uninstall.js exports removeLocalStubDir + LOCAL_STUB_DIR", () => {
      const mod = require("../hooks/gongfeng-copilot-uninstall");
      assert.strictEqual(typeof mod.removeLocalStubDir, "function");
      assert.ok(
        typeof mod.LOCAL_STUB_DIR === "string"
        && mod.LOCAL_STUB_DIR.includes(".gongfeng-copilot")
        && mod.LOCAL_STUB_DIR.endsWith(path.join("hooks", "clawd")),
        "LOCAL_STUB_DIR should point to ~/.gongfeng-copilot/hooks/clawd"
      );
    });

    it("removeLocalStubDir is no-op (returns removed:false) when stub dir missing", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-stub-test-"));
      // Force HOME to a fresh tmp dir so the stub dir does not exist
      const origHome = os.homedir;
      try {
        Object.defineProperty(os, "homedir", { value: () => tmp, configurable: true });
        // Have to require fresh to pick up the new homedir
        const modPath = require.resolve("../hooks/gongfeng-copilot-uninstall");
        delete require.cache[modPath];
        const mod = require("../hooks/gongfeng-copilot-uninstall");
        const r = mod.removeLocalStubDir();
        assert.strictEqual(r.removed, false, "no stub dir → removed:false");
        assert.ok(typeof r.path === "string" && r.path.length > 0);
      } finally {
        Object.defineProperty(os, "homedir", { value: origHome, configurable: true });
        delete require.cache[require.resolve("../hooks/gongfeng-copilot-uninstall")];
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      }
    });

    it("removeLocalStubDir actually deletes the stub dir when present", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-stub-test-"));
      const stubDir = path.join(tmp, ".gongfeng-copilot", "hooks", "clawd");
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(path.join(stubDir, "before-submit-prompt.sh"), "#!/usr/bin/env bash\n");
      const origHome = os.homedir;
      try {
        Object.defineProperty(os, "homedir", { value: () => tmp, configurable: true });
        delete require.cache[require.resolve("../hooks/gongfeng-copilot-uninstall")];
        const mod = require("../hooks/gongfeng-copilot-uninstall");
        const r = mod.removeLocalStubDir();
        assert.strictEqual(r.removed, true);
        assert.strictEqual(fs.existsSync(stubDir), false, "stub dir should be gone");
      } finally {
        Object.defineProperty(os, "homedir", { value: origHome, configurable: true });
        delete require.cache[require.resolve("../hooks/gongfeng-copilot-uninstall")];
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      }
    });

    it("hooks/uninstall.js all-agents path includes Gongfeng Copilot stub cleanup", () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, "..", "hooks", "uninstall.js"),
        "utf-8"
      );
      assert.ok(
        /Gongfeng Copilot.*local stubs/i.test(content),
        "uninstall.js#uninstallAllAgents should list 'Gongfeng Copilot (local stubs)'"
      );
      assert.ok(
        content.includes("removeLocalStubDir"),
        "uninstall.js#uninstallAllAgents should call removeLocalStubDir"
      );
    });
  });

  // ── P1-7 ───────────────────────────────────────────────────────────
  describe("P1-7: hooks.json preferred over hooks-cache.json", () => {
    function withTempHome(fn) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-hookprio-"));
      const origHome = os.homedir;
      Object.defineProperty(os, "homedir", { value: () => tmp, configurable: true });
      // Bust any cached modules that captured homedir at require-time.
      const installPath = require.resolve("../hooks/gongfeng-copilot-install");
      const uninstallPath = require.resolve("../hooks/gongfeng-copilot-uninstall");
      delete require.cache[installPath];
      delete require.cache[uninstallPath];
      try {
        return fn(tmp);
      } finally {
        Object.defineProperty(os, "homedir", { value: origHome, configurable: true });
        delete require.cache[installPath];
        delete require.cache[uninstallPath];
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      }
    }

    function writeHooksFile(home, fileName, payload) {
      const dir = path.join(home, ".gongfeng-copilot", "hooks");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileName), JSON.stringify(payload), "utf-8");
    }

    it("checkExistingClawdHooks reads hooks.json when present", () => {
      withTempHome((home) => {
        writeHooksFile(home, "hooks.json", {
          hooks: {
            stop: [{ display_name: "Clawd: stop", hook_id: "abc" }],
            beforeSubmitPrompt: [{ display_name: "Clawd: beforeSubmitPrompt", hook_id: "def" }],
            unrelated: [{ display_name: "User Hook", hook_id: "ignore" }],
          },
        });
        // Cache says something different — must NOT win
        writeHooksFile(home, "hooks-cache.json", { hooks: {} });

        const { checkExistingClawdHooks } = require("../hooks/gongfeng-copilot-install");
        const r = checkExistingClawdHooks();
        assert.strictEqual(r.found, 2, "should pick up the 2 Clawd entries from hooks.json");
        assert.strictEqual(r.source, "hooks.json");
      });
    });

    it("checkExistingClawdHooks falls back to hooks-cache.json when hooks.json missing", () => {
      withTempHome((home) => {
        writeHooksFile(home, "hooks-cache.json", {
          hooks: {
            stop: [{ display_name: "Clawd: stop", hook_id: "from-cache" }],
          },
        });
        const { checkExistingClawdHooks } = require("../hooks/gongfeng-copilot-install");
        const r = checkExistingClawdHooks();
        assert.strictEqual(r.found, 1);
        assert.strictEqual(r.source, "hooks-cache.json");
      });
    });

    it("collectClawdHooks (uninstall) prefers hooks.json over hooks-cache.json", () => {
      withTempHome((home) => {
        writeHooksFile(home, "hooks.json", {
          hooks: {
            stop: [
              { display_name: "Clawd: stop", hook_id: "A", command: "/p/clawd.sh" },
              { display_name: "Clawd: afterFileEdit", hook_id: "B", command: "/p/edit.sh" },
            ],
          },
        });
        writeHooksFile(home, "hooks-cache.json", { hooks: {} });
        const { collectClawdHooks } = require("../hooks/gongfeng-copilot-uninstall");
        const r = collectClawdHooks();
        assert.strictEqual(r.status, "ready");
        assert.strictEqual(r.found, 2);
        assert.strictEqual(r.source, "hooks.json");
      });
    });
  });

  // ── P1-5 / P1-6 ────────────────────────────────────────────────────
  describe("P1-5/P1-6: gongfeng-copilot-hook.js debug log + hard timeout", () => {
    const hookPath = path.resolve(__dirname, "..", "hooks", "gongfeng-copilot-hook.js");

    it("hook source contains hard-timeout safeguard", () => {
      const src = fs.readFileSync(hookPath, "utf-8");
      assert.ok(
        /HOOK_HARD_TIMEOUT_MS/.test(src),
        "hook should declare a HOOK_HARD_TIMEOUT_MS to avoid zombie processes"
      );
      assert.ok(
        /setTimeout\(/.test(src) && /unref\(/.test(src),
        "hook should set an unref'd timeout for hard timeout"
      );
    });

    it("hook source guards stderr logging behind CLAWD_HOOK_DEBUG env", () => {
      const src = fs.readFileSync(hookPath, "utf-8");
      assert.ok(
        /CLAWD_HOOK_DEBUG/.test(src),
        "stderr diagnostic logs must be opt-in via CLAWD_HOOK_DEBUG to avoid polluting plugin UI"
      );
    });

    it("hook source has a .catch() on the readStdinJson promise", () => {
      const src = fs.readFileSync(hookPath, "utf-8");
      assert.ok(
        /\.catch\(/.test(src),
        "hook should attach .catch() so stdin pipe errors don't leave the hook hung"
      );
    });
  });

  // ── P2-8 ───────────────────────────────────────────────────────────
  describe("P2-8: src/main.js installs global crash guards early", () => {
    const mainPath = path.resolve(__dirname, "..", "src", "main.js");
    it("registers uncaughtException + unhandledRejection handlers", () => {
      const src = fs.readFileSync(mainPath, "utf-8");
      assert.ok(
        /process\.on\(["']uncaughtException["']/.test(src),
        "main.js must install an uncaughtException handler"
      );
      assert.ok(
        /process\.on\(["']unhandledRejection["']/.test(src),
        "main.js must install an unhandledRejection handler"
      );
    });

    it("crash guards are installed BEFORE app.commandLine.appendSwitch (so they cover early init)", () => {
      const src = fs.readFileSync(mainPath, "utf-8");
      const idxUncaught = src.indexOf('process.on("uncaughtException"');
      const idxAppendSwitch = src.indexOf("app.commandLine.appendSwitch");
      assert.ok(idxUncaught > 0, "uncaughtException handler not found");
      assert.ok(idxAppendSwitch > 0, "appendSwitch line not found");
      assert.ok(
        idxUncaught < idxAppendSwitch,
        "uncaughtException handler must be registered BEFORE app.commandLine.appendSwitch"
      );
    });
  });
});
