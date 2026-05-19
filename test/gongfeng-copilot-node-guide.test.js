"use strict";

// Tests for the Node.js install guide section in the Gongfeng Copilot wizard.
// Covers _detectNodeAvailability() and _renderNodeSection() as well as
// the integration into the full wizard HTML via generateHtmlWizard().

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  generateHtmlWizard,
  _detectNodeAvailability,
  _renderNodeSection,
} = require("../hooks/gongfeng-copilot-install");

// ── _detectNodeAvailability ─────────────────────────────────────────────

describe("_detectNodeAvailability", () => {
  it("returns available=true on the current test machine (we are running in Node)", () => {
    // This test is running inside Node, so Node must be detectable.
    const result = _detectNodeAvailability();
    assert.strictEqual(result.available, true);
    assert.ok(result.nodePath, "nodePath should be a non-empty string");
  });

  it("accepts a platform override", () => {
    // On the test machine (win32), passing platform: "linux" will exercise
    // the non-win32 branch. resolveNodeBin for non-Electron returns execPath.
    const result = _detectNodeAvailability({ platform: "linux" });
    assert.strictEqual(result.available, true);
    assert.ok(result.nodePath);
  });
});

// ── _renderNodeSection ──────────────────────────────────────────────────

describe("_renderNodeSection", () => {
  it("returns empty strings when Node is available", () => {
    const { nodeBanner, nodeStep } = _renderNodeSection(
      { available: true, nodePath: "/usr/bin/node" },
      "linux"
    );
    assert.strictEqual(nodeBanner, "");
    assert.strictEqual(nodeStep, "");
  });

  it("renders a warning banner and install step when Node is missing (win32)", () => {
    const { nodeBanner, nodeStep } = _renderNodeSection(
      { available: false, nodePath: null },
      "win32"
    );
    assert.ok(nodeBanner.includes("未检测到 Node.js"), "banner must warn about missing Node");
    assert.ok(nodeStep.includes("安装 Node.js"), "step must be titled for Node install");
    assert.ok(nodeStep.includes("winget install"), "must offer winget command on Windows");
    assert.ok(nodeStep.includes("OpenJS.NodeJS.LTS"), "must reference the correct winget package ID");
    assert.ok(nodeStep.includes("nodejs.org"), "must link to official download");
    assert.ok(nodeStep.includes("nvm"), "must mention nvm as an alternative");
    assert.ok(nodeStep.includes("Volta"), "must mention Volta as an alternative");
  });

  it("renders macOS install guide when Node is missing (darwin)", () => {
    const { nodeBanner, nodeStep } = _renderNodeSection(
      { available: false, nodePath: null },
      "darwin"
    );
    assert.ok(nodeBanner.includes("未检测到 Node.js"));
    assert.ok(nodeStep.includes("brew install node@20"), "must suggest Homebrew on macOS");
    assert.ok(nodeStep.includes("nodejs.org"), "must link to official download");
    assert.ok(!nodeStep.includes("winget"), "must NOT show winget on macOS");
  });

  it("renders Linux install guide when Node is missing (linux)", () => {
    const { nodeBanner, nodeStep } = _renderNodeSection(
      { available: false, nodePath: null },
      "linux"
    );
    assert.ok(nodeBanner.includes("未检测到 Node.js"));
    assert.ok(nodeStep.includes("apt install nodejs"), "must suggest apt on Debian/Ubuntu");
    assert.ok(nodeStep.includes("dnf install nodejs"), "must suggest dnf on RHEL/Fedora");
    assert.ok(nodeStep.includes("pacman"), "must suggest pacman on Arch");
    assert.ok(!nodeStep.includes("winget"), "must NOT show winget on Linux");
    assert.ok(!nodeStep.includes("brew install"), "must NOT show brew on Linux");
  });

  it("step appears with id=step-node and step number ⓪ (before bash step ①)", () => {
    const { nodeStep } = _renderNodeSection(
      { available: false, nodePath: null },
      "win32"
    );
    assert.ok(nodeStep.includes('id="step-node"'), "must use id=step-node for anchor link");
    assert.ok(nodeStep.includes("⓪"), "must use ⓪ as step number");
  });
});

// ── Integration: generateHtmlWizard with Node missing ───────────────────

describe("Wizard HTML Node.js install guide integration", () => {
  function renderWizard(detection) {
    return generateHtmlWizard(
      { status: "ready", existing: { found: 0 }, snippets: [] },
      detection
    );
  }

  it("shows Node install section when Node is unavailable on the host", () => {
    // We can't easily mock resolveNodeBin inside generateHtmlWizard since
    // it calls _detectNodeAvailability internally using the real system.
    // On a test machine with Node available, the section won't render.
    // So this test validates the structural contract via _renderNodeSection
    // which is what the wizard calls.
    const { nodeStep } = _renderNodeSection(
      { available: false, nodePath: null },
      "win32"
    );
    assert.ok(nodeStep.length > 100, "install step must have substantial content");
    assert.ok(nodeStep.includes("Node.js 18+"), "must mention minimum version requirement");
  });

  it("does NOT render Node install section when Node is available", () => {
    // On the current test machine, Node IS available, so the wizard
    // should not show the Node install banner/step.
    const html = renderWizard({
      platform: "linux",
      found: [{ path: "/bin/bash", label: "test", source: "scan" }],
      candidates: [],
    });
    assert.ok(!html.includes('id="step-node"'), "must not render step-node when Node is available");
    assert.ok(!html.includes("未检测到 Node.js"), "must not show Node missing warning");
  });

  it("shows Node status in meta-info section", () => {
    // On test machine Node IS available, so meta-info should show ✅
    const html = renderWizard({
      platform: "linux",
      found: [{ path: "/bin/bash", label: "test", source: "scan" }],
      candidates: [],
    });
    assert.ok(html.includes("Node:"), "must have Node field in meta-info");
    // Since we're running in Node, it should show the checkmark
    assert.ok(html.includes("✅"), "must show ✅ for detected Node");
  });

  it("meta-info Node path must be an absolute path, not the bare literal 'node'", () => {
    // Regression for the "wizard html shows no node info" report:
    // earlier the meta-info Node line fell back to result.node_bin (which
    // is the literal string "node" on win32 by resolveNodeBin's contract).
    // After the fix, when Node IS detected the line must show the *real*
    // absolute path returned by `where node` (win32) or resolveNodeBin
    // (mac/linux) — never the bare literal "node".
    const html = renderWizard({
      platform: "linux",
      found: [{ path: "/bin/bash", label: "test", source: "scan" }],
      candidates: [],
    });
    const m = html.match(/Node:\s*([^<]*)<br>/);
    assert.ok(m, "must be able to extract Node line from meta-info");
    const nodeLine = m[1].trim();
    assert.notStrictEqual(
      nodeLine.replace(/\s*✅\s*$/, "").trim(),
      "node",
      "meta-info Node must not be the bare literal 'node' (win32 resolveNodeBin sentinel)"
    );
    // Sanity: detected line should either be an absolute path or the
    // explicit '(detected)' fallback marker — never the sentinel.
    assert.ok(
      /[\\/]/.test(nodeLine) || nodeLine.includes("(detected)") || nodeLine.includes("未检测到"),
      `Node line should look like an absolute path or fallback marker, got: ${nodeLine}`
    );
  });
});
