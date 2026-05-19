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
  // afterAgentResponse 触发于"模型一次回答输出之后"，此时整轮对话尚未结束（stop 还没到）。
  // 之前映射为 idle 会让桌宠在"纯文本输出"阶段被打回空闲，看起来像没反应；改为 thinking
  // 与 cursor-hook / codebuddy-hook 的语义一致：保持"忙"状态直到 stop 触发 attention（成功动画）。
  afterAgentResponse:         { state: "thinking",     event: "AfterAgentResponse" },
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
  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, (ok) => {
    if (!ok && process.env.CLAWD_HOOK_DEBUG) {
      // 静默失败排查辅助：只在用户显式开启 CLAWD_HOOK_DEBUG=1 时才输出，
      // 避免污染插件 UI 上的 stderr 面板。常见场景：Clawd 主进程未运行 / 端口 23333-23337
      // 全部被占用 / 100ms 超时下主进程过载。
      process.stderr.write(`[clawd-gongfeng] state post failed: event=${hookName}\n`);
    }
    process.stdout.write(outLine + "\n");
    process.exit(0);
  });
}).catch((err) => {
  // stdin 读取异常（管道关闭 / 解析失败 / 上层逻辑抛错）。打印一个空 JSON 让插件继续，
  // 避免 hook 进程挂起导致僵尸。CLAWD_HOOK_DEBUG=1 时输出诊断信息便于排查。
  if (process.env.CLAWD_HOOK_DEBUG) {
    process.stderr.write(`[clawd-gongfeng] stdin read failed: ${err && err.message}\n`);
  }
  process.stdout.write("{}\n");
  process.exit(0);
});

// 兜底超时：极端情况下（stdin 管道既不 end 也不 error），上面 readStdinJson 的
// Promise 可能永远不 settle。给 hook 进程一个硬性墙钟上限——5 秒后无论如何都退出，
// 避免插件累积僵尸子进程。Hook 自身不应该跑超过几百毫秒。
const HOOK_HARD_TIMEOUT_MS = 5000;
const hardTimer = setTimeout(() => {
  if (process.env.CLAWD_HOOK_DEBUG) {
    process.stderr.write(`[clawd-gongfeng] hard timeout (${HOOK_HARD_TIMEOUT_MS}ms) — forcing exit\n`);
  }
  try { process.stdout.write("{}\n"); } catch {}
  process.exit(0);
}, HOOK_HARD_TIMEOUT_MS);
hardTimer.unref();
