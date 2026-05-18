#!/usr/bin/env node
// Clawd — Gongfeng Copilot Uninstall Helper
//
// Mirror of gongfeng-copilot-install.js: since the plugin's hooks.json is
// cloud-synced and not locally writable, we cannot delete hooks programmatically.
// This module scans hooks-cache.json for entries whose display_name starts with
// "Clawd: " and renders an HTML page that walks the user through removing each
// one via the plugin UI.

const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_PARENT_DIR = path.join(os.homedir(), ".gongfeng-copilot");
const CACHE_PATH = path.join(DEFAULT_PARENT_DIR, "hooks", "hooks-cache.json");
const DISPLAY_NAME_PREFIX = "Clawd: ";

/**
 * Scan hooks-cache.json for Clawd hooks (display_name starts with "Clawd: ").
 * Returns { found, events: [{ event, display_name, hook_id }] } or
 * { status: "plugin_not_installed" | "no_cache", ... }.
 */
function collectClawdHooks() {
  if (!fs.existsSync(DEFAULT_PARENT_DIR)) {
    return { status: "plugin_not_installed", found: 0, events: [] };
  }
  if (!fs.existsSync(CACHE_PATH)) {
    return { status: "no_cache", found: 0, events: [] };
  }
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    const events = [];
    const hooksObj = cache.hooks || {};
    for (const [eventName, hooks] of Object.entries(hooksObj)) {
      if (!Array.isArray(hooks)) continue;
      for (const hook of hooks) {
        if (
          hook &&
          typeof hook === "object" &&
          typeof hook.display_name === "string" &&
          hook.display_name.startsWith(DISPLAY_NAME_PREFIX)
        ) {
          events.push({
            event: eventName,
            display_name: hook.display_name,
            hook_id: hook.hook_id || "",
            command: hook.command || "",
          });
        }
      }
    }
    return { status: "ready", found: events.length, events };
  } catch (err) {
    return { status: "error", found: 0, events: [], error: err.message };
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateUninstallHtml(result) {
  const cards = result.events.length
    ? result.events
        .map(
          (h, i) => `
    <div class="hook-card">
      <h3>${i + 1}. ${escapeHtml(h.display_name)}</h3>
      <p><strong>触发事件:</strong> <code>${escapeHtml(h.event)}</code></p>
      ${h.hook_id ? `<p><strong>Hook ID:</strong> <code>${escapeHtml(h.hook_id)}</code></p>` : ""}
      ${h.command ? `<p class="cmd"><strong>命令:</strong> <code>${escapeHtml(h.command)}</code></p>` : ""}
      <button class="del-btn" onclick="markDone(${i}, this)">✓ 已在 UI 中删除</button>
    </div>`
        )
        .join("")
    : `<p class="empty">未在 <code>hooks-cache.json</code> 中检测到任何 <code>Clawd: *</code> 钩子。<br>如果你确认插件 UI 里仍有 Clawd 配置，请重启 VSCode 让插件刷新缓存后再运行本脚本。</p>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Clawd — Gongfeng Copilot 卸载向导</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333; }
    .header { background: #fff; padding: 30px; border-radius: 10px; margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .step { background: #fff; padding: 25px; border-radius: 10px; margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .hook-card { background: #fff8f8; padding: 18px; border-radius: 8px; margin: 12px 0;
      border-left: 4px solid #d9534f; }
    .hook-card.done { background: #e8f5e8; border-left-color: #28a745; opacity: 0.6; }
    .hook-card h3 { margin: 0 0 8px 0; font-size: 16px; }
    .hook-card code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px;
      font-family: 'Courier New', monospace; }
    .hook-card .cmd code { word-break: break-all; }
    .del-btn { background: #d9534f; color: #fff; border: 0; padding: 8px 16px;
      border-radius: 6px; cursor: pointer; font-size: 13px; margin-top: 8px; }
    .del-btn:hover { background: #b02a37; }
    .del-btn.done { background: #28a745; cursor: default; }
    .progress { background: #28a745; height: 4px; border-radius: 2px;
      transition: width 0.3s; margin: 10px 0; }
    .empty { color: #666; }
    .meta { font-family: 'Courier New', monospace; font-size: 12px; color: #666;
      background: #f0f0f0; padding: 8px 12px; border-radius: 4px; margin-top: 10px;
      word-break: break-all; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🗑️ Clawd — Gongfeng Copilot 卸载向导</h1>
    <p>插件的 <code>hooks.json</code> 由云端同步，本地无法直接删除。请在插件 UI 中按下面列表逐条删除。</p>
    <div class="progress" id="progress" style="width: 0%"></div>
    <p><span id="doneCount">0</span> / ${result.events.length} 已删除</p>
    <div class="meta">
      hooks-cache.json: ${escapeHtml(CACHE_PATH)}<br>
      检测状态: ${escapeHtml(result.status)}
    </div>
  </div>

  <div class="step">
    <h2>📋 操作步骤</h2>
    <ol>
<li>打开 VSCode → Gongfeng Copilot (CodeBuddy VSCode plugin) → <strong>Hooks 管理</strong></li>
      <li>对照下方列表，找到每条 <code>Clawd: *</code> 钩子，点击 <strong>删除</strong></li>
      <li>每删完一条，回到本页点对应卡片的「已在 UI 中删除」按钮记录进度</li>
      <li>全部删除后，可再次运行 <code>node hooks/uninstall.js gongfeng-copilot</code> 复检</li>
    </ol>
  </div>

  <div class="step">
    <h2>🪝 待删除的钩子（共 ${result.events.length} 个）</h2>
    ${cards}
  </div>

  <script>
    const total = ${result.events.length};
    let done = 0;
    function markDone(idx, btn) {
      const card = btn.closest('.hook-card');
      if (card.classList.contains('done')) return;
      card.classList.add('done');
      btn.classList.add('done');
      btn.textContent = '✓ 已删除';
      btn.disabled = true;
      done++;
      document.getElementById('doneCount').textContent = done;
      document.getElementById('progress').style.width = ((done / total) * 100) + '%';
      if (done === total && total > 0) {
        setTimeout(() => alert('🎉 所有 Clawd 钩子已删除！可以关闭此页面。'), 200);
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Public API: prepare an uninstall plan and (optionally) write HTML.
 * @param {{ output?: string, silent?: boolean, writeHtml?: boolean }} options
 */
function prepareGongfengCopilotUninstall(options = {}) {
  const result = collectClawdHooks();
  const writeHtml = options.writeHtml !== false;
  let outputPath = null;

  if (writeHtml) {
    outputPath = options.output
      ? path.resolve(options.output)
      : path.resolve(__dirname, "..", "tools", "gongfeng-uninstall.html");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, generateUninstallHtml(result), "utf-8");
  }

  if (!options.silent) {
    if (result.status === "plugin_not_installed") {
      console.log("Clawd: ~/.gongfeng-copilot/ 未找到 — 跳过卸载");
    } else if (result.status === "no_cache") {
      console.log(`Clawd: ${CACHE_PATH} 不存在 — 插件可能从未运行过钩子`);
    } else if (result.status === "error") {
      console.log(`Clawd: 解析 hooks-cache.json 失败: ${result.error}`);
    } else {
      console.log(`Clawd: 检测到 ${result.found} 个 Clawd:* 钩子待手动删除`);
      result.events.forEach((h, i) => {
        console.log(`  ${i + 1}. [${h.event}] ${h.display_name}${h.hook_id ? ` (hook_id=${h.hook_id})` : ""}`);
      });
      if (outputPath) {
        console.log("");
        console.log(`📄 卸载向导已生成: ${outputPath}`);
        console.log("   请用浏览器打开，按指引在插件 UI 中逐条删除。");
      }
    }
  }

  return { ...result, outputPath };
}

module.exports = {
  collectClawdHooks,
  generateUninstallHtml,
  prepareGongfengCopilotUninstall,
  DEFAULT_PARENT_DIR,
  CACHE_PATH,
};

if (require.main === module) {
  // Parse very small CLI: --output <path> | -h
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log("Usage: node hooks/gongfeng-copilot-uninstall.js [--output <html>]");
      process.exit(0);
    }
    if (a === "--output") opts.output = argv[++i];
  }
  try {
    prepareGongfengCopilotUninstall(opts);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
