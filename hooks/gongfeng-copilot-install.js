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
 *
 * Reading strategy:
 *   1. Prefer `hooks.json` (the plugin's source-of-truth file synced from cloud).
 *   2. Fall back to `hooks-cache.json` (local cache of cloud state) when
 *      hooks.json is missing — this happens on a fresh install before the
 *      plugin has serialized cloud config locally.
 *
 * The cache can lag behind the cloud (e.g. user removed hooks on another
 * machine), so reading the source-of-truth file first gives more accurate
 * "已配置 X/11" counters in the wizard UI.
 *
 * Returns { found, events: [{ event, display_name, hook_id }], source }.
 */
function checkExistingClawdHooks() {
  const hooksJsonPath = path.join(DEFAULT_PARENT_DIR, "hooks", "hooks.json");
  const cachePath = path.join(DEFAULT_PARENT_DIR, "hooks", "hooks-cache.json");

  const tryParse = (filePath, source) => {
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const clawdEvents = [];
      let found = 0;
      const hooksObj = (data && data.hooks) || {};
      for (const [eventName, hooks] of Object.entries(hooksObj)) {
        if (!Array.isArray(hooks)) continue;
        for (const hook of hooks) {
          if (hook && typeof hook === "object" && typeof hook.display_name === "string"
              && hook.display_name.startsWith(DISPLAY_NAME_PREFIX)) {
            found++;
            clawdEvents.push({
              event: eventName,
              display_name: hook.display_name,
              hook_id: hook.hook_id,
            });
          }
        }
      }
      return { found, events: clawdEvents, source };
    } catch (err) {
      return { found: 0, events: [], error: err.message, source };
    }
  };

  const fromHooksJson = tryParse(hooksJsonPath, "hooks.json");
  if (fromHooksJson) return fromHooksJson;

  const fromCache = tryParse(cachePath, "hooks-cache.json");
  if (fromCache) return fromCache;

  return { found: 0, events: [], source: "none" };
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

// HTML escape — kept local so the wizard module has zero hard dependency
// on the detector module (detector require'd lazily below).
function _escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the platform-specific Bash hint banner + path block.
 *
 * Behaviour:
 *   • Always returns a Banner + a Step block.
 *   • If `detection.found` is non-empty → render the recommended path
 *     (first entry) plus the rest as an expandable list, all with copy
 *     buttons. NO hard-coded "C:\\Program Files\\Git\\bin\\bash.exe".
 *   • If `detection.found` is empty → render an install-guidance block
 *     specific to the platform:
 *       win32  → winget one-click copy +官网下载链接 + scoop/choco fallback
 *       darwin → /bin/bash 应该自带；提示 brew install bash
 *       linux  → 平台对应包管理器命令
 *   • If `detection` is missing/unsupported → fall back to legacy generic
 *     advice so the page still renders (defensive, used by old tests).
 */
function _renderBashSection(detection) {
  const platform = detection && detection.platform ? detection.platform : process.platform;
  const found = (detection && Array.isArray(detection.found)) ? detection.found : [];

  // ── Banner (always rendered, content depends on platform/state) ─────
  let banner;
  if (platform === "win32") {
    if (found.length > 0) {
      const top = found[0];
      banner = `
<div class="windows-banner ok">
  <h3>✅ Windows 用户：已自动检测到本机 Bash 路径</h3>
  <p>插件默认用 <strong>PowerShell</strong> 跑钩子脚本，但 Clawd 钩子是 <code>#!/usr/bin/env bash</code>，PowerShell 会因 <code>.sh</code> 扩展名报错。</p>
  <p>请把插件 <strong>Hooks 管理 → 高级设置 → 命令执行器路径</strong> 设为下面这条<strong>本机实际路径</strong>（已为你检测好）：</p>
  <p><code id="bash-banner-path">${_escHtml(top.path)}</code> <button class="copy-btn" onclick="copyText('bash-banner-path', this)">📋 复制路径</button></p>
  <p class="muted">来源：${_escHtml(top.label)}。如果该路径不可用，请到下方 <a href="#step-bash">「① Bash 路径」</a> 选择其它候选项。</p>
</div>`;
    } else {
      banner = `
<div class="windows-banner">
  <h3>⚠️ Windows 用户必读：未在本机检测到 Git Bash</h3>
  <p>插件默认用 <strong>PowerShell</strong> 跑钩子脚本，但 Clawd 钩子是 <code>#!/usr/bin/env bash</code>，PowerShell 会因 <code>.sh</code> 扩展名报错。<strong>必须先安装 Git for Windows（自带 <code>bash.exe</code>）</strong>。</p>
  <p>请到下方 <a href="#step-bash">「① 安装 Git Bash」</a> 步骤跟着指引做（推荐：复制 winget 一键命令到 PowerShell 里跑）。</p>
</div>`;
    }
  } else {
    // macOS / Linux — bash 通常自带；只在没找到时给提示
    if (found.length === 0) {
      banner = `
<div class="windows-banner">
  <h3>⚠️ 未在本机检测到 bash 可执行文件</h3>
  <p>${platform === "darwin" ? "macOS 通常自带 <code>/bin/bash</code>，正常情况下都能找到。" : "大多数 Linux 发行版都自带 bash。"}如果确实没有，请按下方 <a href="#step-bash">「① Bash 路径」</a> 步骤的提示安装。</p>
</div>`;
    } else {
      banner = ""; // macOS/Linux 已检测到 bash → 不显示横幅，避免噪音
    }
  }

  // ── Step block: candidate list OR install guidance ──────────────────
  let stepBlock;
  if (found.length > 0) {
    const cards = found
      .map((h, i) => `
    <div class="bash-card${i === 0 ? " recommended" : ""}">
      ${i === 0 ? '<span class="bash-badge">✨ 推荐</span>' : ""}
      <p class="bash-label">${_escHtml(h.label || "")}</p>
      <div class="bash-row">
        <code id="bash-path-${i}">${_escHtml(h.path)}</code>
        <button class="copy-btn" onclick="copyText('bash-path-${i}', this)">📋 复制</button>
      </div>
    </div>`)
      .join("");
    stepBlock = `
<div class="step" id="step-bash">
  <h2>① ✅ 设置 Bash 执行器路径${platform !== "win32" ? "（macOS / Linux 通常可跳过）" : ""}</h2>
  <p>已在本机检测到 <strong>${found.length}</strong> 个可用 bash。把<strong>推荐项</strong>的路径填入插件 <strong>Hooks 管理 → 高级设置 → 命令执行器路径</strong>（点右侧「复制」直接粘贴）。</p>
  ${cards}
  <details>
    <summary>都不可用？手动定位</summary>
    <p>${platform === "win32" ? "在 PowerShell 里执行 <code>where bash</code> / <code>where git</code>。" : "在终端执行 <code>which bash</code> 或 <code>type -a bash</code>。"}</p>
  </details>
</div>`;
  } else {
    // 未找到 bash → 平台对应安装指引
    let install;
    if (platform === "win32") {
      install = `
  <p><strong>方案 A · 推荐：用 winget 一键安装 Git for Windows</strong>（Win10/11 自带 winget；安装包约 70MB，会弹 UAC 让你确认）。复制下面这条命令到 <strong>PowerShell</strong> 里运行：</p>
  <div class="cmd-block">
    <code id="winget-cmd">winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements</code>
    <button class="copy-btn block" onclick="copyText('winget-cmd', this)">📋 复制命令</button>
  </div>
  <p>装完后<strong>重启 VSCode</strong>，再回 Clawd 重新生成本向导，bash 路径就会被自动识别。</p>
  <details>
    <summary>方案 B · 手动下载安装包</summary>
    <ol>
      <li>访问 <a href="https://git-scm.com/download/win" target="_blank" rel="noopener">https://git-scm.com/download/win</a></li>
      <li>下载并运行 64-bit 安装包（一路下一步即可）</li>
      <li>默认安装路径：<code>C:\\Program Files\\Git\\bin\\bash.exe</code></li>
    </ol>
  </details>
  <details>
    <summary>方案 C · 用其它包管理器</summary>
    <ul>
      <li>Scoop：<code>scoop install git</code></li>
      <li>Chocolatey：<code>choco install git</code></li>
    </ul>
  </details>`;
    } else if (platform === "darwin") {
      install = `
  <p>macOS 通常自带 <code>/bin/bash</code>。如果确实没找到：</p>
  <div class="cmd-block">
    <code id="brew-cmd">brew install bash</code>
    <button class="copy-btn block" onclick="copyText('brew-cmd', this)">📋 复制命令</button>
  </div>
  <p>没装 Homebrew？先按 <a href="https://brew.sh/" target="_blank" rel="noopener">brew.sh</a> 装好再跑上面那条。</p>`;
    } else {
      install = `
  <p>大多数 Linux 发行版都自带 bash，请用包管理器安装：</p>
  <ul>
    <li>Debian/Ubuntu：<code>sudo apt install bash</code></li>
    <li>RHEL/CentOS/Fedora：<code>sudo dnf install bash</code></li>
    <li>Arch：<code>sudo pacman -S bash</code></li>
  </ul>`;
    }
    stepBlock = `
<div class="step download" id="step-bash">
  <h2>① 📥 ${platform === "win32" ? "安装 Git Bash" : "安装 bash"}</h2>
  <p>本机当前未检测到可用的 bash 可执行文件，请先按下面的指引装上，再继续后面的步骤。</p>
  ${install}
</div>`;
  }

  return { banner, stepBlock };
}

function generateHtmlWizard(result, detection) {
  // Lazy-resolve detection so callers (CLI / Settings / tests) don't have
  // to know about the detector module. Tests can pass an explicit
  // `detection` object to lock down rendering for a specific platform/state.
  const detectorErrors = [];
  if (!detection) {
    try {
      // eslint-disable-next-line global-require
      const { detectBashPaths } = require("./gongfeng-bash-detector");
      detection = detectBashPaths();
    } catch (err) {
      // detector module unavailable (shouldn't happen in shipped builds);
      // _renderBashSection has its own defensive fallback. 不再静默吞：
      // 记下错误堆栈渲染到 wizard footer，方便现场排查。
      detectorErrors.push(
        `require('./gongfeng-bash-detector') / detectBashPaths() failed: ${
          (err && err.stack) || (err && err.message) || String(err)
        }`
      );
      try {
        // eslint-disable-next-line no-console
        console.error("[gongfeng-wizard] detector load/exec failed:", err);
      } catch (_e) {}
      detection = {
        platform: process.platform,
        found: [],
        candidates: [],
        diagnostics: ["detector module failed to load (see footer)"],
      };
    }
  }
  if (detection && !Array.isArray(detection.diagnostics)) {
    detection.diagnostics = [];
  }
  if (detectorErrors.length) {
    detection.diagnostics.unshift(...detectorErrors);
  }

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

  // 诊断信息（footer 中的 <details>）：在 packaged exe 上未检测到 bash
  // 但实际是装了的场景（bug 2026-05-19）可用这里的输出快速定位问题到底是 env
  // 缺失、fs.existsSync 假阴还是 which 失败。主动隐藏部分环境变量避免泄露
  // 不必要信息。
  const diagnosticsLines = (detection && Array.isArray(detection.diagnostics))
    ? detection.diagnostics.map(s => String(s))
    : [];
  const candidateLines = (detection && Array.isArray(detection.candidates))
    ? detection.candidates.map((c, i) => `${i + 1}. ${c.path}  — ${c.label || ""}`)
    : [];
  const foundLines = (detection && Array.isArray(detection.found))
    ? detection.found.map((c, i) => `✅ ${i + 1}. ${c.path}  — ${c.label || ""} (source=${c.source || "?"})`)
    : [];

  const { banner: bashBanner, stepBlock: bashStep } = _renderBashSection(detection);
  const recommendedPath = (detection.found && detection.found[0] && detection.found[0].path) || null;
  const stepOneInstruction = recommendedPath
    ? `<strong>设置命令执行器路径:</strong> 在 CodeBuddy 插件 → Hooks 管理 → 高级设置中，把命令执行器路径设为下面这条<strong>本机实际路径</strong>: <code>${_escHtml(recommendedPath)}</code>（已自动检测；其它候选见下方「① Bash 路径」步骤）`
    : `<strong>先装 Git Bash:</strong> 本机未检测到 bash —— 请到下方「① ${detection.platform === "win32" ? "安装 Git Bash" : "安装 bash"}」步骤按指引安装；装完后再回来配置命令执行器路径`;

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
.windows-banner.ok { background: #e8f5e8; border-color: #28a745; color: #1e6b2e; }
.windows-banner h3 { margin: 0 0 8px 0; color: #b02a37; font-size: 16px; }
.windows-banner.ok h3 { color: #1e6b2e; }
.windows-banner code { background: #fff; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; color: #b02a37; border: 1px solid #f5c2c7; word-break: break-all; }
.windows-banner.ok code { color: #1e6b2e; border-color: #b9dfbb; }
.windows-banner .muted { color: #666; font-size: 12px; margin-top: 6px; }
.status { padding: 15px; border-radius: 8px; margin: 20px 0; }
.status.ready { background: #e8f5e8; color: #2d5016; }
.status.not-installed { background: #fff3cd; color: #856404; }
.step { background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.step.download { border-left: 4px solid #f0ad4e; }
.bash-card { background: #f8fbff; padding: 14px 16px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #5b8def; position: relative; }
.bash-card.recommended { background: #f0fff4; border-left-color: #28a745; }
.bash-badge { position: absolute; top: 10px; right: 12px; background: #28a745; color: #fff; font-size: 12px; padding: 2px 10px; border-radius: 10px; }
.bash-label { margin: 0 0 8px 0; color: #555; font-size: 13px; }
.bash-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.bash-row code { flex: 1; background: #fff; padding: 8px 12px; border-radius: 4px; font-family: 'Courier New', monospace; word-break: break-all; border: 1px solid #ddd; font-size: 13px; min-width: 200px; }
.cmd-block { background: #1e1e1e; color: #d4d4d4; padding: 14px; border-radius: 6px; margin: 10px 0; font-family: 'Courier New', monospace; font-size: 13px; }
.cmd-block code { color: #d4d4d4; word-break: break-all; display: block; }
.snippet-card { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #007acc; }
.code-block { position: relative; background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 6px; margin: 10px 0; font-family: 'Courier New', monospace; font-size: 14px; white-space: pre-wrap; }
.copy-btn { background: #007acc; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.copy-btn:hover { background: #005a9e; }
.copy-btn.done { background: #28a745; }
.copy-btn.block { display: block; margin-top: 10px; }
.code-block .copy-btn { position: absolute; top: 10px; right: 10px; }
.progress { background: #28a745; height: 4px; border-radius: 2px; margin: 10px 0; transition: width 0.3s; }
.action-buttons { display: flex; gap: 10px; margin: 20px 0; }
.btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.btn-primary { background: #007acc; color: white; }
.btn-secondary { background: #6c757d; color: white; }
.btn-success { background: #28a745; color: white; }
.meta-info { font-size: 12px; color: #666; margin-top: 10px; font-family: 'Courier New', monospace; background: #f0f0f0; padding: 8px 12px; border-radius: 4px; word-break: break-all; }
details { margin-top: 10px; }
details summary { cursor: pointer; color: #5b8def; }
</style>
</head>
<body>
${bashBanner}

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
    Hook: ${result.hook_script || '(default)'}<br>
    Bash: ${recommendedPath ? _escHtml(recommendedPath) + ' ✨' : '(未检测到 — 请先按下方步骤安装)'}
  </div>
</div>

${bashStep}

<div class="step">
  <h2>📋 配置步骤</h2>
  <ol>
    <li>${stepOneInstruction}</li>
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

<div class="step">
  <h2>🧪 诊断信息（快速排查用）</h2>
  <p style="color:#666;font-size:13px;">如果顶部提示未检测到 Bash 但你本机实际装了 Git for Windows，展开下面三块获取 Clawd 看到的现场：</p>
  <details>
    <summary>仅检查到的 bash（${foundLines.length} 条）</summary>
    <pre id="clawd-diag-found">${_escHtml(foundLines.join('\n') || '(空)')}</pre>
  </details>
  <details>
    <summary>扫描过的候选路径（${candidateLines.length} 条）</summary>
    <pre id="clawd-diag-candidates">${_escHtml(candidateLines.join('\n') || '(空)')}</pre>
  </details>
  <details>
    <summary>运行时诊断记录（${diagnosticsLines.length} 条）</summary>
    <pre id="clawd-diag-log">${_escHtml(diagnosticsLines.join('\n') || '(空)')}</pre>
  </details>
  <p style="color:#666;font-size:12px;margin-top:8px;">若你打开该向导是从 <strong>Clawd 设置 → Agents → 生成配置向导</strong>，且三块都为空/缺失 → 请复制本页 URL 反馈给开发者。</p>
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
function copyText(elemId, btn) {
  const el = document.getElementById(elemId);
  if (!el) return;
  const text = el.textContent;
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  };
  const original = btn.textContent;
  const onSuccess = () => {
    btn.classList.add('done');
    btn.textContent = '✓ 已复制';
    setTimeout(() => {
      btn.classList.remove('done');
      btn.textContent = original;
    }, 1800);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess, () => { fallback(); onSuccess(); });
  } else {
    fallback();
    onSuccess();
  }
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

      // Detect bash dynamically so the CLI hint matches the actual machine.
      let detection = null;
      try {
        // eslint-disable-next-line global-require
        detection = require("./gongfeng-bash-detector").detectBashPaths();
      } catch (_e) {
        detection = { platform: process.platform, found: [] };
      }
      const recommended = detection.found && detection.found[0];

      console.log("\n请按以下步骤手动配置:");
      console.log("1. 在CodeBuddy插件 → Hooks管理 → 高级设置");
      if (recommended) {
        console.log(`2. 设置命令执行器路径: ${recommended.path}  (来源: ${recommended.label})`);
      } else if (detection.platform === "win32") {
        console.log("2. 未检测到 Git Bash —— 请先安装 Git for Windows: https://git-scm.com/download/win");
        console.log("   或在 PowerShell 里执行: winget install --id Git.Git -e --source winget");
      } else {
        console.log("2. 未检测到 bash —— 请通过包管理器安装后再回来配置命令执行器路径");
      }
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
