const { describe, it } = require("node:test");
const assert = require("node:assert");
const { checkNodeAvailability } = require("../src/doctor-detectors/node-availability");

describe("node-availability detector", () => {
  it("returns pass when resolveNodeBin returns an absolute path (macOS/Linux)", () => {
    const result = checkNodeAvailability({
      platform: "darwin",
      resolveNodeBin: () => "/usr/local/bin/node",
    });
    assert.strictEqual(result.id, "node-availability");
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.level, null);
    assert.strictEqual(result.nodeBin, "/usr/local/bin/node");
  });

  it("returns warning when resolveNodeBin returns null (macOS/Linux)", () => {
    const result = checkNodeAvailability({
      platform: "darwin",
      resolveNodeBin: () => null,
    });
    assert.strictEqual(result.id, "node-availability");
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.level, "warning");
    assert.strictEqual(result.nodeBin, null);
  });

  it("returns warning when resolveNodeBin throws (macOS/Linux)", () => {
    const result = checkNodeAvailability({
      platform: "linux",
      resolveNodeBin: () => { throw new Error("boom"); },
    });
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.level, "warning");
    assert.strictEqual(result.nodeBin, null);
  });

  it("returns pass on Windows when where node succeeds", () => {
    const result = checkNodeAvailability({
      platform: "win32",
      resolveNodeBin: () => "node",
      execFileSync: () => "C:\\Program Files\\nodejs\\node.exe\r\n",
    });
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.level, null);
    assert.strictEqual(result.nodeBin, "C:\\Program Files\\nodejs\\node.exe");
  });

  it("returns warning on Windows when where node fails", () => {
    const result = checkNodeAvailability({
      platform: "win32",
      resolveNodeBin: () => "node",
      execFileSync: () => { throw new Error("not found"); },
    });
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.level, "warning");
    assert.strictEqual(result.nodeBin, null);
  });

  it("returns warning on Windows when where node returns empty output", () => {
    const result = checkNodeAvailability({
      platform: "win32",
      resolveNodeBin: () => "node",
      execFileSync: () => "\r\n",
    });
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.level, "warning");
    assert.strictEqual(result.nodeBin, null);
  });

  it("textHint is doctorNodeMissingHint when node is missing", () => {
    const result = checkNodeAvailability({
      platform: "darwin",
      resolveNodeBin: () => null,
    });
    assert.strictEqual(result.textHint, "doctorNodeMissingHint");
  });
});
