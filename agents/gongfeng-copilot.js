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
    afterAgentResponse:        "idle",
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
