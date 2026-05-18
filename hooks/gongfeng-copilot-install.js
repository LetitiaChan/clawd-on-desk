#!/usr/bin/env node
// Generate shell script snippets for setting up gongfeng-copilot hooks via the
// plugin's official Hooks UI.
//
// Integration model:
//   The Gongfeng Copilot (CodeBuddy VSCode plugin) is configured through its
//   built-in "Hooks 管理" UI. We do not touch the plugin's own config files;
//   instead, this module produces ready-to-paste shell snippets so the user
//   can create each hook through the supported UI flow.
//
// IMPORTANT: Windows users must set the plugin's command executor path to a
// bash.exe (e.g. C:\\Program Files\\Git\\bin\\bash.exe) in the plugin's
// advanced settings before the snippets can run.
//
// Recommended setup flow:
//   1. Copy the generated snippet for each event.
//   2. Paste it into the plugin's Hooks UI (name + trigger event + script).
//   3. Save — the plugin handles persistence on its side.
//   4. The plugin invokes the snippet via the configured bash executor.

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

// ─────────────────────────────────────────────────────────────────────────
// HTML wizard renderer (also used by tools/gongfeng-wizard.js so the CLI
// and the Settings panel "Generate wizard" button render the same page).
// Kept inside hooks/ — packaged into asar.unpacked, while tools/ is not
// shipped in the production app — so settings-actions-agents.js can call
// it without depending on tools/.
// ─────────────────────────────────────────────────────────────────────────
function generateHtmlWizard(result) {
  const snippetsHtml = (result.snippets || []).map((snippet, index) => `
    <div class="snippet-card">
      <h3>${index + 1}. ${snippet.event}</h3>
      <p><strong>配置名称:</strong> ${snippet.display_name}</p>
      <p><strong>触发事件:</strong> ${snippet.trigger_event_display}</p>
      <div class="code-block">
        <pre><code>${snippet.shell_snippet}</code></pre>
        <button class="copy-btn" onclick="copyToClipboard(${index})">复制脚本</button>
      </div>
    </div>
  `).join('');

  const snippetsJson = JSON.stringify((result.snippets || []).map(s => s.shell_snippet));
  const found = (result.existing && result.existing.found) || 0;
  const ready = result.status === 'ready';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Clawd - Gongfeng Copilot 配置向导</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333; }
.header { background: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.windows-banner { background: #ffe4e1; border: 2px solid #d9534f; color: #842029; padding: 16px 20px; border-radius: 10px; margin-bottom: 20px; font-size: 14px; line-height: 1.6; }
.windows-banner h3 { margin: 0 0 8px 0; color: #b02a37; font-size: 16px; }
.windows-banner code { background: #fff; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; color: #b02a37; border: 1px solid #f5c2c7; }
.status { padding: 15px; border-radius: 8px; margin: 20px 0; }
.status.ready { background: #e8f5e8; color: #2d5016; }
.status.not-installed { background: #fff3cd; color: #856404; }
.step { background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.snippet-card { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #007acc; }
.code-block { position: relative; background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 6px; margin: 10px 0; font-family: 'Courier New', monospace; font-size: 14px; white-space: pre-wrap; }
.copy-btn { position: absolute; top: 10px; right: 10px; background: #007acc; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.copy-btn:hover { background: #005a9e; }
.progress { background: #28a745; height: 4px; border-radius: 2px; margin: 10px 0; transition: width 0.3s; }
.action-buttons { display: flex; gap: 10px; margin: 20px 0; }
.btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.btn-primary { background: #007acc; color: white; }
.btn-secondary { background: #6c757d; color: white; }
.btn-success { background: #28a745; color: white; }
.meta-info { font-size: 12px; color: #666; margin-top: 10px; font-family: 'Courier New', monospace; background: #f0f0f0; padding: 8px 12px; border-radius: 4px; word-break: break-all; }
</style>
</head>
<body>
<div class="windows-banner">
  <h3>⚠️ Windows 用户必读：先配置 Bash 解释器</h3>
  <p>插件默认用 <strong>PowerShell</strong> 跑钩子脚本，但 Clawd 钩子是 <code>#!/usr/bin/env bash</code>，PowerShell 会因 <code>.sh</code> 扩展名报错。</p>
  <p>请先在插件 <strong>Hooks 管理 → 高级设置</strong> 把 <strong>命令执行器路径</strong> 设为：</p>
  <p><code>C:\\Program Files\\Git\\bin\\bash.exe</code>（如果你用的是 Git for Windows 默认安装路径）</p>
  <p>没有 Git Bash？装 <a href="https://git-scm.com/download/win" target="_blank">Git for Windows</a>，或改用 WSL 的 <code>bash.exe</code> / MSYS2 的 <code>bash.exe</code>。macOS / Linux 用户忽略此横幅即可。</p>
</div>

<div class="header">
  <h1>🦊 Clawd - Gongfeng Copilot 配置向导</h1>
  <p>帮助您手动配置 Gongfeng Copilot (CodeBuddy VSCode plugin) 的 11 个事件钩子</p>
  <div class="status ${ready ? 'ready' : 'not-installed'}">
    <strong>检测状态:</strong>
    ${ready ? `✅ 插件已安装 - 已配置 ${found}/11 个钩子` : '❌ 插件未安装或路径不存在'}
  </div>
  ${ready ? `<div class="progress" style="width: ${(found / 11) * 100}%"></div>` : ''}
  <div class="meta-info">
    Node: ${result.node_bin || '(default)'}<br>
    Hook: ${result.hook_script || '(default)'}
  </div>
</div>

<div class="step">
  <h2>📋 配置步骤</h2>
  <ol>
    <li><strong>Windows 用户必做:</strong> 在 CodeBuddy 插件 → Hooks 管理 → 高级设置中，设置命令执行器路径为: <code>C:\\Program Files\\Git\\bin\\bash.exe</code></li>
    <li><strong>逐个创建钩子:</strong> 为下面每个事件创建钩子，复制对应的 shell 脚本。具体操作：在 <strong>CodeBuddy 插件 → Hooks</strong> 页，点击按钮 <strong>「管理 Hooks」</strong>，在打开的网站中点击 <strong>「新建 Hooks」</strong> 逐个创建钩子；全部创建完成后，回到 <strong>插件 Hooks 页</strong>点击 <strong>刷新</strong> 即可看到新建的钩子。</li>
    <li><strong>对话验证宠物:</strong> 配置完成后，<strong>重启 VSCode</strong>，打开 CodeBuddy 对话窗口，随便发一句话（例如「你好」）让 AI 回复。观察桌面右下角的 Clawd 桌宠：
      <ul>
        <li>发送消息后，桌宠应进入 <strong>「思考中」</strong>（thinking）状态</li>
        <li>AI 开始输出回复时，桌宠应切换到 <strong>「响应中」</strong>（responding / 打字）状态</li>
        <li>AI 回复结束后，桌宠应回到 <strong>「空闲」</strong>（idle）状态</li>
      </ul>
      若桌宠状态完全不变，说明钩子未触发——请检查上面的"已配置 X/11"计数、Windows 用户确认 bash.exe 路径，或在 Clawd 设置 → 日志中查看是否收到 hook 事件。
    </li>
  </ol>
  <div class="action-buttons">
    <button class="btn btn-secondary" onclick="copyAllSnippets()">复制全部脚本</button>
    <button class="btn btn-success" onclick="markAsDone()">我已配置完成</button>
  </div>
</div>

<div class="step">
  <h2>🔧 11 个事件钩子配置</h2>
  ${snippetsHtml}
</div>

<script>
const snippets = ${snippetsJson};
function copyToClipboard(index) {
  navigator.clipboard.writeText(snippets[index]).then(() => alert('脚本已复制到剪贴板！'));
}
function copyAllSnippets() {
  const allScripts = snippets.join('\\n\\n---\\n\\n');
  navigator.clipboard.writeText(allScripts).then(() => alert('全部脚本已复制到剪贴板！'));
}
function markAsDone() {
  localStorage.setItem('gongfengConfigured', 'true');
  alert('配置完成！请重启 VSCode 测试钩子是否生效。');
}
if (localStorage.getItem('gongfengConfigured')) {
  document.querySelector('.header').innerHTML += '<div style="background: #d4edda; padding: 10px; border-radius: 5px; margin-top: 10px;">✅ 您已经配置过 Gongfeng Copilot 钩子</div>';
}
</script>
</body>
</html>`;
}

module.exports = {
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_STUB_DIR,
  GONGFENG_HOOK_EVENTS,
  registerGongfengCopilotHooks,
  prepareGongfengCopilotSnippets,
  checkExistingClawdHooks,
  generateHtmlWizard,
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
