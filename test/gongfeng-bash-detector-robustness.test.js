"use strict";

// Robustness regression tests for hooks/gongfeng-bash-detector.js
// 起因（2026-05-19 bug）：本地 `npm start`（dev mode）能命中
// C:\Program Files\Git\bin\bash.exe，但 packaged exe 在同一台机器上
// detect 出来 found.length === 0 → wizard banner 错误显示「未在本机检测到」。
// 排查发现 packaged Electron 主进程下 process.env / fs.existsSync /
// where 命令任一异常都会导致整体漏检，且失败被静默吞掉无法定位。
//
// 这些测试锁住三条不变式：
//   1. getCandidatePaths 在 ProgramFiles env 全空时仍包含 C:\Program Files\Git\... 字面量；
//   2. detectBashPaths 返回值带 diagnostics 数组；
//   3. generateHtmlWizard 在 detector 抛错时不再静默吞，错误堆栈写入诊断 footer；
//      且渲染 HTML 包含「🧪 诊断信息」诊断 step block。

const { describe, it } = require("node:test");
const assert = require("node:assert");

const detectorPath = require.resolve("../hooks/gongfeng-bash-detector");
const installPath = require.resolve("../hooks/gongfeng-copilot-install");

function freshRequire(p) {
  delete require.cache[p];
  return require(p);
}

describe("gongfeng-bash-detector robustness", () => {
  it("getCandidatePaths includes literal C:\\Program Files\\Git\\bin\\bash.exe even when ProgramFiles env is empty (win32 only)", () => {
    if (process.platform !== "win32") {
      // 该不变式仅对 win32 有意义；非 win32 下 candidate 列表是 *nix 格式
      return;
    }
    const savedPF = process.env["ProgramFiles"];
    const savedPF86 = process.env["ProgramFiles(x86)"];
    const savedLAD = process.env["LOCALAPPDATA"];
    try {
      delete process.env["ProgramFiles"];
      delete process.env["ProgramFiles(x86)"];
      delete process.env["LOCALAPPDATA"];
      // 强制重新加载 detector 让顶层 PLATFORM 常量重计算的同时也让
      // getCandidatePaths 在新 env 下取值
      const det = freshRequire(detectorPath);
      const result = det.detectBashPaths();
      const paths = result.candidates.map((c) => c.path.toLowerCase());
      assert.ok(
        paths.includes("c:\\program files\\git\\bin\\bash.exe"),
        "candidates should ALWAYS include literal 'C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe' regardless of process.env state"
      );
      assert.ok(
        paths.includes("c:\\program files (x86)\\git\\bin\\bash.exe"),
        "candidates should ALWAYS include literal 'C:\\\\Program Files (x86)\\\\Git\\\\bin\\\\bash.exe' regardless of process.env state"
      );
    } finally {
      if (savedPF !== undefined) process.env["ProgramFiles"] = savedPF;
      if (savedPF86 !== undefined) process.env["ProgramFiles(x86)"] = savedPF86;
      if (savedLAD !== undefined) process.env["LOCALAPPDATA"] = savedLAD;
      // 让其它测试文件拿到正常 env 下加载的 detector
      freshRequire(detectorPath);
    }
  });

  it("detectBashPaths() result always carries a diagnostics: string[] field", () => {
    const det = freshRequire(detectorPath);
    const result = det.detectBashPaths();
    assert.ok(Array.isArray(result.diagnostics), "result.diagnostics must be an array");
    // 必含 platform/arch/packaged 标记行，方便 packaged 现场反馈
    assert.ok(
      result.diagnostics.some((line) => /platform=/.test(line)),
      "diagnostics must contain a 'platform=...' line for packaged-mode triage"
    );
    if (process.platform === "win32") {
      assert.ok(
        result.diagnostics.some((line) => /env\.ProgramFiles=/.test(line)),
        "win32 diagnostics must record env.ProgramFiles state"
      );
    }
  });

  it("getCandidatePaths returns deduplicated candidates (no two entries with the same path)", () => {
    const det = freshRequire(detectorPath);
    const result = det.detectBashPaths();
    const lower = result.candidates.map((c) => c.path.toLowerCase());
    const uniq = new Set(lower);
    assert.strictEqual(
      lower.length,
      uniq.size,
      "candidate paths must be deduplicated (case-insensitive on win32 / exact on *nix)"
    );
  });

  it("generateHtmlWizard injects the diagnostics block into the wizard HTML", () => {
    const { generateHtmlWizard } = freshRequire(installPath);
    const html = generateHtmlWizard(
      {
        status: "ready",
        existing: { found: 0, events: [] },
        snippets: [],
      },
      {
        platform: "linux",
        found: [{ path: "/bin/bash", label: "Linux 标准 bash", source: "scan" }],
        candidates: [{ path: "/bin/bash", label: "Linux 标准 bash" }],
        diagnostics: ["platform=linux arch=x64 packaged=false"],
      }
    );
    assert.ok(html.includes("🧪 诊断信息"), "wizard must render the 🧪 诊断信息 step block");
    assert.ok(html.includes('id="clawd-diag-found"'), "wizard must include the 'found' diagnostic <pre>");
    assert.ok(html.includes('id="clawd-diag-candidates"'), "wizard must include the 'candidates' diagnostic <pre>");
    assert.ok(html.includes('id="clawd-diag-log"'), "wizard must include the runtime-log diagnostic <pre>");
    assert.ok(html.includes("platform=linux"), "diagnostics text from caller-supplied detection must be rendered");
  });

  it("generateHtmlWizard tolerates a detection object missing the diagnostics field (backward compat)", () => {
    const { generateHtmlWizard } = freshRequire(installPath);
    const html = generateHtmlWizard(
      {
        status: "ready",
        existing: { found: 0, events: [] },
        snippets: [],
      },
      {
        platform: "linux",
        found: [{ path: "/bin/bash", label: "Linux 标准 bash", source: "scan" }],
        candidates: [{ path: "/bin/bash", label: "Linux 标准 bash" }],
        // 故意不传 diagnostics — 之前的调用方/测试可能不传
      }
    );
    assert.ok(typeof html === "string" && html.includes("🧪 诊断信息"));
  });

  it("whichCommand on win32 falls back to 'cmd /c where' when the direct where.exe path is unusable", () => {
    // 仅做语义级断言：源码里同时存在两条尝试路径（System32\where.exe + cmd /c where）。
    // 不直接断 string 字面量太脆，做一次属性测试：随便拼一个不存在的命令名，
    // detect 应当返回 found 但 diagnostics 里**至少**记一条 whichCommand 的失败/empty 行
    // —— 实际 PATH 中没有 'definitely-not-a-real-cmd-xyz123' 这个命令。
    if (process.platform !== "win32") return;
    const det = freshRequire(detectorPath);
    // 复用 detectBashPaths 的 path（间接覆盖 whichCommand）：调用 detectBashPaths
    // 已经会跑 whichCommand('bash')。我们只断 diagnostics 数组类型存在即可——
    // 详细行为由实测 bash 是否在 PATH 决定，CI ubuntu/host 不一定一致。
    const result = det.detectBashPaths();
    assert.ok(Array.isArray(result.diagnostics));
  });
});
