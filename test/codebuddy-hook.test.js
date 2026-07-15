const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  wantsApproval,
  buildPreToolUseOutput,
  parsePermissionResponse,
  permissionResultToOutput,
  config,
  CODEBUDDY_PROCESS_NAMES,
} = require("../hooks/codebuddy-hook");

describe("codebuddy-hook: process name coverage (CN vs international builds)", () => {
  it("lists both international and CN executable names per platform", () => {
    assert.ok(CODEBUDDY_PROCESS_NAMES.win.includes("codebuddy.exe"));
    assert.ok(
      CODEBUDDY_PROCESS_NAMES.win.includes("codebuddy cn.exe"),
      "CN build ('CodeBuddy CN.exe' → 'codebuddy cn.exe') must be recognized"
    );
    assert.ok(CODEBUDDY_PROCESS_NAMES.mac.includes("codebuddy cn"));
    assert.ok(CODEBUDDY_PROCESS_NAMES.linux.includes("codebuddy cn"));
  });

  it("recognizes the CN executable as both a terminal and an editor on Windows", () => {
    if (process.platform !== "win32") return; // config is platform-specific at load time
    // Windows snapshot lower-cases process names, so match against lower case.
    assert.ok(config.terminalNames.has("codebuddy cn.exe"));
    assert.strictEqual(config.editorMap["codebuddy cn.exe"], "codebuddy");
    assert.strictEqual(config.editorMap["codebuddy.exe"], "codebuddy");
  });
});

describe("codebuddy-hook: wantsApproval", () => {
  it("returns true only when tool_input.requires_approval === true", () => {
    assert.strictEqual(wantsApproval({ tool_input: { requires_approval: true } }), true);
    assert.strictEqual(wantsApproval({ tool_input: { requires_approval: false } }), false);
    assert.strictEqual(wantsApproval({ tool_input: {} }), false);
    assert.strictEqual(wantsApproval({ tool_input: { requires_approval: "true" } }), false);
    assert.strictEqual(wantsApproval({}), false);
    assert.strictEqual(wantsApproval(null), false);
  });
});

describe("codebuddy-hook: buildPreToolUseOutput", () => {
  it("emits allow with continue:true", () => {
    const out = JSON.parse(buildPreToolUseOutput("allow"));
    assert.strictEqual(out.continue, true);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "allow");
    assert.ok(!("permissionDecisionReason" in out.hookSpecificOutput));
  });

  it("emits deny with continue:false and reason", () => {
    const out = JSON.parse(buildPreToolUseOutput("deny", "blocked by user"));
    assert.strictEqual(out.continue, false);
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "deny");
    assert.strictEqual(out.hookSpecificOutput.permissionDecisionReason, "blocked by user");
  });

  it("emits ask with continue:true", () => {
    const out = JSON.parse(buildPreToolUseOutput("ask"));
    assert.strictEqual(out.continue, true);
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "ask");
  });

  it("coerces unknown decisions to ask", () => {
    const out = JSON.parse(buildPreToolUseOutput("weird"));
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "ask");
    assert.strictEqual(out.continue, true);
  });

  it("truncates long reasons", () => {
    const long = "x".repeat(1000);
    const out = JSON.parse(buildPreToolUseOutput("deny", long));
    assert.strictEqual(out.hookSpecificOutput.permissionDecisionReason.length, 500);
  });
});

describe("codebuddy-hook: parsePermissionResponse", () => {
  it("parses allow behavior from the shared CC /permission shape", () => {
    const body = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    assert.deepStrictEqual(parsePermissionResponse(body), { behavior: "allow", message: null });
  });

  it("parses deny behavior with message", () => {
    const body = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "no" } },
    });
    assert.deepStrictEqual(parsePermissionResponse(body), { behavior: "deny", message: "no" });
  });

  it("returns null for empty / non-JSON / unknown behavior", () => {
    assert.strictEqual(parsePermissionResponse(""), null);
    assert.strictEqual(parsePermissionResponse("not json"), null);
    assert.strictEqual(parsePermissionResponse("{}"), null);
    assert.strictEqual(parsePermissionResponse(JSON.stringify({
      hookSpecificOutput: { decision: { behavior: "maybe" } },
    })), null);
  });
});

describe("codebuddy-hook: permissionResultToOutput", () => {
  it("falls back to ask when the server is unreachable (ok=false)", () => {
    const out = JSON.parse(permissionResultToOutput(false, ""));
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "ask");
  });

  it("falls back to ask when the response has no usable decision", () => {
    const out = JSON.parse(permissionResultToOutput(true, "{}"));
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "ask");
  });

  it("maps an allow decision through", () => {
    const body = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    const out = JSON.parse(permissionResultToOutput(true, body));
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "allow");
    assert.strictEqual(out.continue, true);
  });

  it("maps a deny decision through with reason", () => {
    const body = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "danger" } },
    });
    const out = JSON.parse(permissionResultToOutput(true, body));
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, "deny");
    assert.strictEqual(out.continue, false);
    assert.strictEqual(out.hookSpecificOutput.permissionDecisionReason, "danger");
  });
});
