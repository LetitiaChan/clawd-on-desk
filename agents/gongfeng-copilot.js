// gongfeng-copilot — Gongfeng Copilot (CodeBuddy VSCode plugin) (publisher: gongfeng, name: gongfeng-copilot)
// Hook-based integration via ~/.gongfeng-copilot/hooks/hooks.json
// Hook payload schema differs from CodeBuddy CLI/IDE — flat camelCase events, .sh stub file required.
// Plugin lives inside Code.exe — process identification piggybacks on the shared editor map.

module.exports = {
  id: "gongfeng-copilot",
  name: "Gongfeng Copilot (CodeBuddy VSCode plugin)",
  // The plugin runs inside VSCode (Code.exe). We do not register a separate
  // process name here — Code.exe is already in the shared terminal list,
  // and the hook payload carries agent_id="gongfeng-copilot" for routing.
  processNames: {
    win: ["Code.exe"],
    mac: ["Code", "Code Helper"],
    linux: ["code"],
  },
  eventSource: "hook",
  // gongfeng-copilot uses flat camelCase event names (no PascalCase, no hook_event_name field).
  // Event names taken from the plugin's "管理 Hooks" UI dropdown.
  eventMap: {
    beforeSubmitPrompt:        "thinking",
    afterAgentThought:         "thinking",
    // afterAgentResponse 触发于"模型一次回答输出之后"，此时整轮对话尚未结束（stop 还没到）。
    // 之前映射为 idle 会让桌宠在"纯文本输出"阶段被打回空闲，看起来像没反应；改为 thinking
    // 与 hooks/gongfeng-copilot-hook.js 的 HOOK_TO_STATE 保持一致。
    afterAgentResponse:        "thinking",
    beforeShellExecution:      "working",
    afterShellExecution:       "working",
    beforeMCPExecution:        "working",
    afterMCPExecution:         "working",
    afterFileEdit:             "working",
    afterSearchReplaceFileEdit:"working",
    afterFileRead:             "working",
    stop:                      "attention",
  },
  capabilities: {
    httpHook: false,
    permissionApproval: false, // permission UI is handled by the VSCode plugin itself
    notificationHook: false,
    sessionEnd: false,         // no SessionEnd event — `stop` is closest analogue
    subagent: false,
  },
  hookConfig: {
    configFormat: "gongfeng-copilot-flat", // { hooks: { <event>: [{ command: "<.sh path>", display_name, trigger_event, ... }] } }
  },
  stdinFormat: "gongfengHookJson", // { command, cwd, ... } — schema varies by event
  pidField: "gongfeng_copilot_pid",
};
