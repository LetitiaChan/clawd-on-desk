#!/usr/bin/env node
// Generate shell script snippets for manual hook setup in gongfeng-copilot plugin.
//
// The Gongfeng Copilot (CodeBuddy VSCode plugin) (publisher: gongfeng, name: gongfeng-copilot)
// uses a cloud-synced hooks.json that cannot be modified locally (cloud overrides).
// Instead, we generate shell script snippets that users can manually paste into
// the plugin's UI to create persistent hooks.
//
// IMPORTANT: Windows users must configure command_executor_path to bash.exe:
//   C:\\Program Files\\Git\\bin\\bash.exe
//
// Manual setup process:
//   1. User copies script snippet for each event
//   2. Pastes into plugin UI → plugin renders .sh file
//   3. Cloud sync preserves the hook with assigned hook_id
//   4. Plugin executes .sh via configured bash executor

const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveNodeBin } = require("./server-config");
const { asarUnpackedPath } = require("./json-utils");

const MARKER = "gongfeng-copilot-hook.js";
const DISPLAY_NAME_PREFIX = "Clawd: ";
const DEFAULT_PARENT_DIR = path.join(os.homedir(), ".gongfeng-copilot");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_PARENT_DIR, "hooks", "hooks.json");
const DEFAULT_STUB_DIR = path.join(DEFAULT_PARENT_DIR, "hooks", "clawd");

// Event name → human-readable display label (matches plugin's UI labels)
const GONGFENG_HOOK_EVENTS = [
  { name: "beforeSubmitPrompt",         display: "提交提示词前" },
  { name: "afterAgentThought",          display: "Agent思考后" },
  { name: "afterAgentResponse",         display: "Agent响应后" },
  { name: "beforeShellExecution",       display: "Shell执行前" },
  { name: "afterShellExecution",        display: "Shell执行后" },
  { name: "beforeMCPExecution",         display: "MCP执行前" },
  { name: "afterMCPExecution",          display: "MCP执行后" },
  { name: "afterFileEdit",              display: "文件编辑后" },
  { name: "afterSearchReplaceFileEdit", display: "搜索替换文件编辑后" },
  { name: "afterFileRead",              display: "文件读取后" },
  { name: "stop",                       display: "停止" },
];

function quoteForShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Build shell script snippet for manual paste into plugin UI.
 * Each snippet pipes stdin to our Node hook handler with the event name.
 */
function buildShellSnippet(nodeBin, hookScript, eventName) {
  return [
    "#!/usr/bin/env bash",
    `# Clawd gongfeng-copilot hook for event: ${eventName}`,
    `exec ${quoteForShell(nodeBin)} ${quoteForShell(hookScript)} ${quoteForShell(eventName)}`,
    ""
  ].join("\n");
}



/**
 * Check if user has already configured Clawd hooks via plugin UI.
 * Scans hooks-cache.json for entries with display_name starting with "Clawd: ".
 */
function checkExistingClawdHooks() {
  const cachePath = path.join(DEFAULT_PARENT_DIR, "hooks", "hooks-cache.json");
  if (!fs.existsSync(cachePath)) return { found: 0, events: [] };
  
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    const clawdEvents = [];
    let found = 0;
    
    const hooksObj = cache.hooks || {};
    for (const [eventName, hooks] of Object.entries(hooksObj)) {
      if (Array.isArray(hooks)) {
        for (const hook of hooks) {
          if (hook && typeof hook === 'object' && hook.display_name && hook.display_name.startsWith(DISPLAY_NAME_PREFIX)) {
            found++;
            clawdEvents.push({
              event: eventName,
              display_name: hook.display_name,
              hook_id: hook.hook_id
            });
          }
        }
      }
    }
    
    return { found, events: clawdEvents };
  } catch (err) {
    return { found: 0, events: [], error: err.message };
  }
}

/**
 * Generate shell script snippets for manual setup in gongfeng-copilot plugin.
 * Returns snippets for all 11 events and detection results.
 */
function prepareGongfengCopilotSnippets(options = {}) {
  const parentDir = DEFAULT_PARENT_DIR;
  
  // Check if plugin is installed
  if (!fs.existsSync(parentDir)) {
    if (!options.silent) {
      console.log("Clawd: ~/.gongfeng-copilot/ not found — skipping snippet generation");
    }
    return { status: "plugin_not_installed", snippets: [], existing: { found: 0, events: [] } };
  }
  
  const hookScript = options.hookScript
    ? String(options.hookScript).replace(/\\/g, "/")
    : asarUnpackedPath(
        path.resolve(__dirname, "gongfeng-copilot-hook.js").replace(/\\/g, "/")
      );

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved || "node";
  
  // Check existing hooks
  const existing = checkExistingClawdHooks();
  
  // Generate snippets for all events
  const snippets = GONGFENG_HOOK_EVENTS.map(ev => ({
    event: ev.name,
    display_name: `${DISPLAY_NAME_PREFIX}${ev.name}`,
    trigger_event_display: ev.display,
    shell_snippet: buildShellSnippet(nodeBin, hookScript, ev.name),
    instructions: `在插件UI中创建hook：名称="${DISPLAY_NAME_PREFIX}${ev.name}"，触发事件="${ev.display}"`
  }));
  
  return {
    status: "ready",
    snippets,
    existing,
    node_bin: nodeBin,
    hook_script: hookScript
  };
}

// Backward compatibility: old register function now generates snippets
function registerGongfengCopilotHooks(options = {}) {
  const result = prepareGongfengCopilotSnippets(options);
  
  if (!options.silent) {
    if (result.status === "plugin_not_installed") {
      console.log("Clawd: ~/.gongfeng-copilot/ not found — skipping hook setup");
    } else {
      console.log(`Clawd gongfeng-copilot snippets ready (${result.existing.found}/11 hooks already configured)`);
      console.log("Please use the UI to manually paste the generated shell script snippets");
    }
  }
  
  // Return compatible format for integration-sync.js
  return { 
    added: Math.max(0, 11 - result.existing.found),
    updated: 0,
    removed: 0,
    skipped: result.existing.found
  };
}

module.exports = {
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_STUB_DIR,
  GONGFENG_HOOK_EVENTS,
  registerGongfengCopilotHooks,
  prepareGongfengCopilotSnippets,
  checkExistingClawdHooks
};

if (require.main === module) {
  try {
    const result = prepareGongfengCopilotSnippets({ silent: false });
    
    if (result.status === "ready") {
      console.log("\n=== Clawd Gongfeng-Copilot Hook Snippets ===");
      console.log(`检测到已配置的hook: ${result.existing.found}/11`);
      console.log("\n请按以下步骤手动配置:");
      console.log("1. 在CodeBuddy插件 → Hooks管理 → 高级设置");
      console.log("2. 设置命令执行器路径: C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe");
      console.log("3. 为每个事件创建hook，粘贴对应的shell脚本");
      
      result.snippets.forEach((snippet, index) => {
        console.log(`\n--- ${index + 1}. ${snippet.event} ---`);
        console.log(snippet.instructions);
        console.log("Shell脚本:");
        console.log(snippet.shell_snippet);
      });
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
