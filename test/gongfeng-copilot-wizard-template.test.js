"use strict";

// Invariants for the Gongfeng Copilot wizard HTML template
// (rendered by `generateHtmlWizard` in hooks/gongfeng-copilot-install.js,
//  shipped in asar.unpacked because tools/ is not packaged).
//
// These tests pin down user-facing UX text that has been silently
// shortened in past edits. They are deliberately substring-level (not
// snapshot-level) so wording can still evolve, but the *meaning* —
// "tell the user how to verify the hooks via the desktop pet states"
// and "explain the exact CodeBuddy click path" — cannot regress
// without a deliberate test update.
//
// As of the bash auto-detection fix, the wizard MUST NOT hard-code
// "C:\\Program Files\\Git\\bin\\bash.exe" as the canonical path —
// instead it renders whatever detectBashPaths() returned for the
// current machine, and falls back to a per-platform install guide
// (winget for Windows, brew/apt for *nix) when nothing is found.
// Tests below pass an explicit `detection` argument so they don't
// depend on the host machine running the test suite.

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { generateHtmlWizard } = require("../hooks/gongfeng-copilot-install");

function renderMinimalWizard({ status = "ready", found = 5, snippets = [], detection } = {}) {
  // Default detection = "found one bash on Linux" so legacy tests that
  // don't care about the bash section still get a deterministic render.
  const det = detection || {
    platform: "linux",
    found: [{ path: "/bin/bash", label: "Linux 标准 bash", source: "scan" }],
    candidates: [],
  };
  return generateHtmlWizard(
    {
      status,
      existing: { found },
      snippets,
    },
    det
  );
}

describe("Gongfeng Copilot wizard HTML template", () => {
  it("renders without throwing for a minimal ready result", () => {
    const html = renderMinimalWizard();
    assert.ok(typeof html === "string" && html.length > 0, "wizard HTML must be a non-empty string");
    assert.ok(html.startsWith("<!DOCTYPE html>"), "wizard HTML must declare an HTML5 doctype");
    assert.ok(html.includes("<title>Clawd - Gongfeng Copilot 配置向导</title>"));
  });

  it("does NOT hard-code the Windows bash.exe path; uses the detected path instead", () => {
    // Simulate a machine where Git for Windows is installed under a
    // non-default location (e.g. user-level install). The wizard MUST
    // surface that exact path, not the legacy hard-coded
    // "C:\\Program Files\\Git\\bin\\bash.exe".
    const customPath = "D:\\Tools\\Git\\bin\\bash.exe";
    const html = renderMinimalWizard({
      detection: {
        platform: "win32",
        found: [{ path: customPath, label: "Git for Windows（自定义路径）", source: "scan" }],
        candidates: [],
      },
    });
    assert.ok(
      html.includes(customPath),
      "wizard must surface the actual detected path, not a hard-coded default"
    );
    // Critical regression guard: the legacy hard-coded path must not
    // appear in the step-1 instruction line nor in the meta-info, since
    // that's the bug being fixed (it misled users on machines where Git
    // is installed elsewhere).
    const legacyPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    // The legacy path may still appear once inside the "方案 B 手动下载"
    // <details> block ONLY when detection.found is empty (as a worked
    // example of the default install location). With found.length > 0
    // we rendered the candidate list and SHOULD NOT mention it at all.
    assert.ok(
      !html.includes(legacyPath),
      "wizard must not fall back to the legacy hard-coded path when a real bash is detected"
    );
  });

  it("renders the Windows install guide (winget command) when no bash is detected on win32", () => {
    const html = renderMinimalWizard({
      detection: { platform: "win32", found: [], candidates: [] },
    });
    // Banner warns that bash wasn't found.
    assert.ok(html.includes("未在本机检测到 Git Bash"), "must announce missing Git Bash");
    // Step ① flips into "install" mode rather than "pick a path" mode.
    assert.ok(html.includes("安装 Git Bash"), "step 1 must offer the install path");
    // Winget one-click command must be present and copyable.
    assert.ok(
      html.includes("winget install --id Git.Git"),
      "must offer a one-click winget command"
    );
    assert.ok(html.includes("git-scm.com/download/win"), "must keep the manual download fallback link");
  });

  it("renders the macOS install guide when no bash is detected on darwin", () => {
    const html = renderMinimalWizard({
      detection: { platform: "darwin", found: [], candidates: [] },
    });
    assert.ok(html.includes("未在本机检测到 bash"), "must announce missing bash on macOS");
    assert.ok(html.includes("brew install bash"), "must suggest Homebrew on macOS");
    // No winget on macOS.
    assert.ok(!html.includes("winget install"), "must NOT show winget on macOS");
  });

  it("renders the Linux install guide when no bash is detected on linux", () => {
    const html = renderMinimalWizard({
      detection: { platform: "linux", found: [], candidates: [] },
    });
    assert.ok(html.includes("apt install bash") || html.includes("dnf install bash"));
    assert.ok(!html.includes("winget install"), "must NOT show winget on Linux");
  });

  it("explains the exact CodeBuddy click path for creating hooks", () => {
    const html = renderMinimalWizard();
    // Three landmark phrases from the step-2 instructions; if any of
    // them go missing, the user is back to staring at a blank panel.
    assert.ok(html.includes("CodeBuddy 插件 → Hooks"), "must mention the CodeBuddy → Hooks navigation");
    assert.ok(html.includes("管理 Hooks"), 'must mention the "管理 Hooks" button name');
    assert.ok(html.includes("新建 Hooks"), 'must mention the "新建 Hooks" button name');
    assert.ok(html.includes("刷新"), 'must mention the post-creation 刷新 step');
  });

  it("documents the desktop-pet three-state verification path (idle ↔ thinking ↔ responding)", () => {
    const html = renderMinimalWizard();
    // Without all three states, users cannot self-diagnose whether
    // hooks fired. This matches the v0.7.12 fix that re-mapped
    // afterAgentResponse from idle to thinking.
    assert.ok(html.includes("思考中"), "must mention the thinking state");
    assert.ok(html.includes("响应中"), "must mention the responding state");
    assert.ok(html.includes("空闲"), "must mention the idle state");
    assert.ok(html.includes("thinking"), "must mention the thinking state in English (state key)");
    assert.ok(html.includes("responding"), "must mention the responding state in English (state key)");
    assert.ok(html.includes("idle"), "must mention the idle state in English (state key)");
  });

  it("includes the 已配置 X/11 progress hint and the 11 hook total", () => {
    const html = renderMinimalWizard({ found: 7 });
    assert.ok(html.includes("已配置"), "must surface the 已配置 X/11 hint as a self-diagnosis anchor");
    assert.ok(html.includes("11"), "wizard expects exactly 11 hook events");
  });

  it("renders snippet cards for each provided snippet, in order, with copy buttons", () => {
    const snippets = [
      {
        event: "PostToolUse:Edit",
        display_name: "工具调用后",
        trigger_event_display: "Edit / MultiEdit / Write",
        shell_snippet: 'echo "hook A"',
      },
      {
        event: "Stop",
        display_name: "对话结束",
        trigger_event_display: "Stop",
        shell_snippet: 'echo "hook B"',
      },
    ];
    const html = renderMinimalWizard({ snippets });

    assert.ok(html.includes("1. PostToolUse:Edit"), "first snippet must render with index 1");
    assert.ok(html.includes("2. Stop"), "second snippet must render with index 2");
    assert.ok(html.includes('echo "hook A"'));
    assert.ok(html.includes('echo "hook B"'));

    const firstIdx = html.indexOf("1. PostToolUse:Edit");
    const secondIdx = html.indexOf("2. Stop");
    assert.ok(firstIdx > -1 && secondIdx > firstIdx, "snippet cards must appear in the provided order");

    // copy-button hooks present once per snippet (snippet card buttons
    // call copyToClipboard(N); other copy buttons in the wizard call
    // copyText('elem-id', ...) so they don't collide).
    const copyButtonMatches = html.match(/copyToClipboard\(\d+\)/g) || [];
    assert.strictEqual(copyButtonMatches.length, 2, "one copy button per snippet card");
  });

  it("survives empty / missing snippet & existing fields without throwing", () => {
    // Defensive: status:"not_ready", found undefined, snippets undefined.
    // We still pass an explicit detection so the bash section renders
    // deterministically rather than poking the host machine.
    const html = generateHtmlWizard(
      { status: "not_ready" },
      { platform: "linux", found: [{ path: "/bin/bash", label: "Linux 标准 bash" }] }
    );
    assert.ok(typeof html === "string" && html.length > 0);
    // Still emits the click-path and three-state guidance even when not ready.
    assert.ok(html.includes("管理 Hooks"));
    assert.ok(html.includes("思考中"));
  });
});
