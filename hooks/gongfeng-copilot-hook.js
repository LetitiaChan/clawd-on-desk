#!/usr/bin/env node
// Clawd — Gongfeng Copilot (CodeBuddy VSCode plugin) hook handler.
// Invoked indirectly via per-event .sh stubs in ~/.gongfeng-copilot/hooks/clawd/.
// Each stub passes the event name as argv[2] and pipes stdin JSON through.
//
// stdin payload schema (flat, camelCase event-specific shape):
//   beforeShellExecution / afterShellExecution: { command, cwd }
//   beforeMCPExecution / afterMCPExecution:     { tool, params, cwd, ... }
//   afterFileEdit / afterSearchReplaceFileEdit: { path, ... }
//   afterFileRead:                              { path, ... }
//   beforeSubmitPrompt:                         { prompt?, cwd? }
//   afterAgentResponse / afterAgentThought:     { ... }
//   stop:                                       { ... }
//
// stdout: empty JSON for non-gating events; gating events ({}) keep plugin's default policy.

const { postStateToRunningServer, readHostPrefix } = require("./server-config");
const { createPidResolver, readStdinJson, getPlatformConfig } = require("./shared-process");

// gongfeng-copilot hook event → { state, event } for the Clawd state machine.
// Event names are exact strings from the plugin's "管理 Hooks" UI dropdown.
const HOOK_TO_STATE = {
  beforeSubmitPrompt:         { state: "thinking",     event: "UserPromptSubmit" },
  afterAgentThought:          { state: "thinking",     event: "AfterAgentThought" },
  afterAgentResponse:         { state: "idle",         event: "AfterAgentResponse" },
  beforeShellExecution:       { state: "working",      event: "PreToolUse" },
  afterShellExecution:        { state: "working",      event: "PostToolUse" },
  beforeMCPExecution:         { state: "working",      event: "PreToolUse" },
  afterMCPExecution:          { state: "working",      event: "PostToolUse" },
  afterFileEdit:              { state: "working",      event: "PostToolUse" },
  afterSearchReplaceFileEdit: { state: "working",      event: "PostToolUse" },
  afterFileRead:              { state: "working",      event: "PostToolUse" },
  stop:                       { state: "attention",    event: "Stop" },
};

// Gating events — plugin expects a JSON decision response. Empty object means
// "use default policy" (do not override). Clawd does not interfere with the
// plugin's built-in permission UI.
const GATING_EVENTS = new Set([
  "beforeShellExecution",
  "beforeMCPExecution",
  "beforeSubmitPrompt",
]);

const config = getPlatformConfig();
const resolve = createPidResolver({
  // The plugin lives inside Code.exe — the editor map already covers it,
  // so we don't need a custom agentNames set here.
  agentNames: { win: new Set(["code.exe"]), mac: new Set(["code"]), linux: new Set(["code"]) },
  platformConfig: config,
});

function stdoutForEvent(hookName) {
  // Gating events ({}) keep plugin's default policy; non-gating events also
  // return {} to satisfy the plugin's stdout contract without interfering.
  void hookName;
  return "{}";
}

function pickCwd(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.cwd === "string" && payload.cwd) return payload.cwd;
  if (typeof payload.workspaceRoot === "string" && payload.workspaceRoot) return payload.workspaceRoot;
  if (typeof payload.workspace_root === "string" && payload.workspace_root) return payload.workspace_root;
  return "";
}

function pickSessionId(payload) {
  if (!payload || typeof payload !== "object") return "default";
  return (
    payload.session_id
    || payload.sessionId
    || payload.conversation_id
    || payload.conversationId
    || "default"
  );
}

readStdinJson().then((payload) => {
  // Event name comes from argv[2] (set by the .sh stub installer); fall back to
  // payload-side hint if some future plugin version supplies one.
  const argvEvent = process.argv[2];
  const hookName = argvEvent || (payload && (payload.hook_event_name || payload.event)) || "";
  const mapped = HOOK_TO_STATE[hookName];

  if (!mapped) {
    process.stdout.write(stdoutForEvent(hookName) + "\n");
    process.exit(0);
    return;
  }

  const { state, event } = mapped;

  const sessionId = pickSessionId(payload);
  const cwd = pickCwd(payload);

  const { stablePid, agentPid, detectedEditor, pidChain } = resolve();

  const body = { state, session_id: sessionId, event };
  body.agent_id = "gongfeng-copilot";
  if (cwd) body.cwd = cwd;
  if (process.env.CLAWD_REMOTE) {
    body.host = readHostPrefix();
  } else {
    body.source_pid = stablePid;
    body.editor = detectedEditor || "code";
    if (agentPid) body.agent_pid = agentPid;
    if (pidChain.length) body.pid_chain = pidChain;
  }

  const outLine = stdoutForEvent(hookName);
  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, () => {
    process.stdout.write(outLine + "\n");
    process.exit(0);
  });
});
