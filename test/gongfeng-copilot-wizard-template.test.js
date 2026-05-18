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

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { generateHtmlWizard } = require("../hooks/gongfeng-copilot-install");

function renderMinimalWizard({ status = "ready", found = 5, snippets = [] } = {}) {
  return generateHtmlWizard({
    status,
    existing: { found },
    snippets,
  });
}

describe("Gongfeng Copilot wizard HTML template", () => {
  it("renders without throwing for a minimal ready result", () => {
    const html = renderMinimalWizard();
    assert.ok(typeof html === "string" && html.length > 0, "wizard HTML must be a non-empty string");
    assert.ok(html.startsWith("<!DOCTYPE html>"), "wizard HTML must declare an HTML5 doctype");
    assert.ok(html.includes("<title>Clawd - Gongfeng Copilot 配置向导</title>"));
  });

  it("includes the Windows bash.exe path advice (regression guard against accidental removal)", () => {
    const html = renderMinimalWizard();
    assert.ok(
      html.includes("C:\\Program Files\\Git\\bin\\bash.exe"),
      "wizard must keep the Windows bash.exe path advice"
    );
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

    // copy-button hooks present once per snippet
    const copyButtonMatches = html.match(/copyToClipboard\(\d+\)/g) || [];
    assert.strictEqual(copyButtonMatches.length, 2, "one copy button per snippet card");
  });

  it("survives empty / missing snippet & existing fields without throwing", () => {
    // Defensive: status:"not_ready", found undefined, snippets undefined.
    const html = generateHtmlWizard({ status: "not_ready" });
    assert.ok(typeof html === "string" && html.length > 0);
    // Still emits the click-path and three-state guidance even when not ready.
    assert.ok(html.includes("管理 Hooks"));
    assert.ok(html.includes("思考中"));
  });
});
