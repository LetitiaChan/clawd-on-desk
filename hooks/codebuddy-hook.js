#!/usr/bin/env node
// Clawd — CodeBuddy hook (stdin JSON with hook_event_name; stdout JSON for gating hooks)
// Registered in ~/.codebuddy/settings.json by hooks/codebuddy-install.js
//
// `codebuddy` settings.json is shared by two runtimes with two permission paths:
//
//   • CodeBuddy IDE — has NO dedicated `PermissionRequest` event. Approval is
//     carried by `PreToolUse`'s `permissionDecision` (allow/deny/ask). When the IDE
//     wants confirmation it sets `tool_input.requires_approval === true`; THIS script
//     intercepts exactly those PreToolUse payloads, forwards them to Clawd's blocking
//     /permission endpoint (shared Claude Code branch), and translates the returned
//     `decision.behavior` back into `hookSpecificOutput.permissionDecision`.
//     (Best-effort AND narrowly scoped: IDE-bundle inspection confirmed
//     `requires_approval` exists ONLY on the `execute_command` tool schema. The
//     delete tool (`delete_file`) and other file-change tools (write/append/
//     replace) are `changeFileTools` gated by the IDE's own diff/approve UI and
//     NEVER carry `requires_approval` — so wantsApproval() is always false for
//     them and this path can only ever fire for `execute_command`, which the
//     IDE's built-in TerminalExecutor usually confirms before the hook runs.)
//
//   • `codebuddy` CLI (Claude Code fork) — fires a real `PermissionRequest` hook,
//     registered by codebuddy-install.js as a blocking HTTP hook that talks to
//     /permission directly. That path does NOT flow through this script; here the
//     CLI's PreToolUse only reports the "working" state (requires_approval is absent,
//     so wantsApproval() is false and we defer with {}).
//
// Any failure on the IDE path (server unreachable, no-decision, DND/disabled
// connection drop, disabled bubble) falls back to `permissionDecision:"ask"` so the
// IDE shows its own prompt — we never decide on the user's behalf.

const {
  postStateToRunningServer,
  postPermissionToRunningServer,
  readHostPrefix,
} = require("./server-config");
const { createPidResolver, readStdinJson, getPlatformConfig } = require("./shared-process");

const CODEBUDDY_PERMISSION_TIMEOUT_MS = 590000;

// CodeBuddy hook event → { state, event } for the Clawd state machine
const HOOK_MAP = {
  SessionStart:     { state: "idle",         event: "SessionStart" },
  SessionEnd:       { state: "sleeping",     event: "SessionEnd" },
  UserPromptSubmit: { state: "thinking",     event: "UserPromptSubmit" },
  PreToolUse:       { state: "working",      event: "PreToolUse" },
  PostToolUse:      { state: "working",      event: "PostToolUse" },
  Stop:             { state: "attention",    event: "Stop" },
  Notification:     { state: "notification", event: "Notification" },
  PreCompact:       { state: "sweeping",     event: "PreCompact" },
};

// CodeBuddy ships two Windows builds with DIFFERENT executable names:
//   - International: "CodeBuddy.exe"      → snapshot name "codebuddy.exe"
//   - CN (国内版):    "CodeBuddy CN.exe"   → snapshot name "codebuddy cn.exe"
// Windows process names in the snapshot are lower-cased (shared-process.js), so
// list the lower-cased variants (including the space) here. macOS/Linux comm
// names are likewise lower-cased before matching.
const CODEBUDDY_PROCESS_NAMES = {
  win: ["codebuddy.exe", "codebuddy cn.exe"],
  mac: ["codebuddy", "codebuddy cn"],
  linux: ["codebuddy", "codebuddy cn"],
};

const config = getPlatformConfig({
  extraTerminals: { win: CODEBUDDY_PROCESS_NAMES.win },
  extraEditors: {
    win: { "codebuddy.exe": "codebuddy", "codebuddy cn.exe": "codebuddy" },
    mac: { "codebuddy": "codebuddy", "codebuddy cn": "codebuddy" },
    linux: { "codebuddy": "codebuddy", "codebuddy cn": "codebuddy" },
  },
  extraEditorPathChecks: [["codebuddy", "codebuddy"]],
});
const resolve = createPidResolver({
  agentNames: {
    win: new Set(CODEBUDDY_PROCESS_NAMES.win),
    mac: new Set(CODEBUDDY_PROCESS_NAMES.mac),
    linux: new Set(CODEBUDDY_PROCESS_NAMES.linux),
  },
  platformConfig: config,
});

// Does this PreToolUse payload want the IDE's built-in command confirmation?
function wantsApproval(payload) {
  const toolInput = payload && typeof payload.tool_input === "object" && payload.tool_input
    ? payload.tool_input
    : null;
  return !!(toolInput && toolInput.requires_approval === true);
}

// Build the PreToolUse stdout output CodeBuddy expects for a permission decision.
// permissionDecision ∈ { "allow", "deny", "ask" }.
function buildPreToolUseOutput(permissionDecision, reason) {
  const decision = permissionDecision === "allow" || permissionDecision === "deny"
    ? permissionDecision
    : "ask";
  const hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision: decision };
  if (typeof reason === "string" && reason.trim()) {
    hookSpecificOutput.permissionDecisionReason = reason.trim().slice(0, 500);
  }
  return JSON.stringify({
    continue: decision !== "deny",
    hookSpecificOutput,
  });
}

// Parse Clawd's /permission response (shared Claude Code branch shape):
//   { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior, message } } }
// Returns { behavior: "allow"|"deny", message: string|null } or null when the
// response carries no usable decision.
function parsePermissionResponse(responseBody) {
  if (typeof responseBody !== "string" || !responseBody.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return null;
  }
  const decision = parsed && parsed.hookSpecificOutput && typeof parsed.hookSpecificOutput === "object"
    ? parsed.hookSpecificOutput.decision
    : null;
  if (!decision || typeof decision !== "object") return null;
  const behavior = decision.behavior === "deny" ? "deny"
    : (decision.behavior === "allow" ? "allow" : null);
  if (!behavior) return null;
  return {
    behavior,
    message: typeof decision.message === "string" && decision.message ? decision.message : null,
  };
}

// Translate a /permission outcome into the PreToolUse stdout line.
// ok=false (unreachable / connection dropped by DND / disabled agent / disabled
// bubble) or an unparseable body → "ask": the IDE falls back to its own prompt.
function permissionResultToOutput(ok, responseBody) {
  if (!ok) return buildPreToolUseOutput("ask");
  const parsed = parsePermissionResponse(responseBody);
  if (!parsed) return buildPreToolUseOutput("ask");
  return buildPreToolUseOutput(parsed.behavior, parsed.message);
}

// Build the /permission request body for a PreToolUse approval.
function buildPermissionBody(payload) {
  const sessionId = (payload && payload.session_id) || "default";
  const toolName = typeof payload.tool_name === "string" && payload.tool_name
    ? payload.tool_name
    : "Unknown";
  const toolInput = payload && typeof payload.tool_input === "object" && payload.tool_input
    ? payload.tool_input
    : {};
  const cwd = (payload && payload.cwd) || "";

  const body = {
    agent_id: "codebuddy",
    session_id: sessionId,
    tool_name: toolName,
    tool_input: toolInput,
  };
  if (cwd) body.cwd = cwd;

  if (process.env.CLAWD_REMOTE) {
    body.host = readHostPrefix();
  } else {
    const { stablePid, agentPid, detectedEditor, pidChain } = resolve();
    body.source_pid = stablePid;
    if (detectedEditor) body.editor = detectedEditor;
    if (agentPid) body.agent_pid = agentPid;
    if (pidChain.length) body.pid_chain = pidChain;
  }

  return body;
}

function requestCodeBuddyPermission(payload, callback) {
  const body = buildPermissionBody(payload);
  postPermissionToRunningServer(
    JSON.stringify(body),
    { timeoutMs: CODEBUDDY_PERMISSION_TIMEOUT_MS, probeTimeoutMs: 100 },
    (ok, _port, responseBody) => {
      callback(permissionResultToOutput(ok, responseBody));
    }
  );
}

function reportState(payload, hookName, mapped, done) {
  const { state, event } = mapped;
  const sessionId = (payload && payload.session_id) || "default";
  const cwd = (payload && payload.cwd) || "";

  const body = { state, session_id: sessionId, event, agent_id: "codebuddy" };
  if (cwd) body.cwd = cwd;

  if (process.env.CLAWD_REMOTE) {
    body.host = readHostPrefix();
  } else {
    const { stablePid, agentPid, detectedEditor, pidChain } = resolve();
    body.source_pid = stablePid;
    if (detectedEditor) body.editor = detectedEditor;
    if (agentPid) body.agent_pid = agentPid;
    if (pidChain.length) body.pid_chain = pidChain;
  }

  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, done);
}

function main() {
  readStdinJson().then((payload) => {
    const hookName = (payload && payload.hook_event_name) || "";

    // PreToolUse doubles as the permission gate. When the IDE wants its built-in
    // command confirmation (requires_approval === true), forward to Clawd's
    // blocking /permission endpoint and translate the decision. All other tool
    // calls just report the working state and defer to the IDE default ({}).
    if (hookName === "PreToolUse" && wantsApproval(payload)) {
      requestCodeBuddyPermission(payload, (output) => {
        process.stdout.write(output + "\n");
        process.exit(0);
      });
      return;
    }

    const mapped = HOOK_MAP[hookName];
    if (!mapped) {
      process.stdout.write("{}\n");
      process.exit(0);
      return;
    }

    if (hookName === "SessionStart" && !process.env.CLAWD_REMOTE) resolve();

    reportState(payload, hookName, mapped, () => {
      process.stdout.write("{}\n");
      process.exit(0);
    });
  }).catch(() => {
    // Graceful fallback: if stdin read or JSON parse fails, emit non-blocking
    // empty output so the IDE does not hang waiting for hook response.
    process.stdout.write("{}\n");
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = {
  HOOK_MAP,
  CODEBUDDY_PERMISSION_TIMEOUT_MS,
  CODEBUDDY_PROCESS_NAMES,
  config,
  wantsApproval,
  buildPreToolUseOutput,
  parsePermissionResponse,
  permissionResultToOutput,
  buildPermissionBody,
};
