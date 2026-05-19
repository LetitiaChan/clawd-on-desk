#!/usr/bin/env node
// Clawd — Gongfeng Copilot 一站式配置向导（CLI 入口 + 公共 API）
//
// ⚠️ DEPRECATED CLI ENTRY
//
//   通过 `node hooks/gongfeng-bash-detector.js` 直接调用本脚本生成的 HTML 向导
//   （见下方 `generateDetectorHtml`）是早期实现，与 Clawd 设置面板「生成向导」按钮
//   触发的 `hooks/gongfeng-copilot-install.js#generateHtmlWizard` **样式/内容已不同步**。
//
//   推荐使用：Clawd → 设置 → Agents → Gongfeng Copilot → 「生成配置向导」按钮。
//   两个入口产出的 HTML 不一致曾导致用户困惑，未来计划统一到 install 模块的实现，
//   届时本 CLI 入口的 HTML 模板会被替换为薄壳调用。
//
//   ✅ 仍然受支持的导出 API（被 install 模块和测试调用）：
//     - `detectBashPaths()` — 扫描候选 bash 路径
//     - `buildSnippetsWithFallback()` — 生成 11 段 shell snippet
//     - `prepareGongfengBashDetector()` — 组合上面两个并写 HTML
//
// Gongfeng Copilot (CodeBuddy VSCode plugin) 的 hook 是 .sh 脚本，需要：
//   (A) 一个本机 bash 可执行文件（Windows 默认没有，要手动指定路径）
//   (B) 在插件 UI 里逐个创建 11 个 hook，每个 hook 粘贴一段 shell snippet
// 因为每个人机器上 bash 路径不一致，且 11 段 snippet 手敲容易错，所以本脚本：
//   1. 扫描常见的 bash 安装路径，标记哪些真实存在；通过 PATH/git 兜底查找
//   2. 调用 prepareGongfengCopilotSnippets 生成 11 段 shell snippet
//   3. 把两者整合到 tools/gongfeng-bash-detector.html，包含一键复制按钮、
//      下载指引、操作步骤、进度跟踪
//   4. 用户在浏览器里打开向导，从上到下跟着点就行

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'

// 软依赖：插件未安装时，prepareGongfengCopilotSnippets 会返回 plugin_not_installed，
// 此时我们用一组合理默认值（node + 仓库内 hook 脚本路径）来生成 snippet。
let prepareGongfengCopilotSnippets = null;
let GONGFENG_HOOK_EVENTS = null;
try {
  const installMod = require("./gongfeng-copilot-install");
  prepareGongfengCopilotSnippets = installMod.prepareGongfengCopilotSnippets;
  GONGFENG_HOOK_EVENTS = installMod.GONGFENG_HOOK_EVENTS;
} catch (e) {
  // 模块不可用时，下面 buildSnippetsWithFallback 会兜底
}

/**
 * 各平台候选 bash 路径列表。
 *
 * Windows 注意事项（packaged Electron 排查后沉淀，2026-05-19）：
 *   1. `process.env["ProgramFiles"]` 在 packaged Electron 主进程下偶发为空 /
 *      指向非预期值，因此除了走 env 之外，还**额外**附上字面量
 *      `C:\Program Files\...` / `C:\Program Files (x86)\...` 两条候选，
 *      用 `dedupePaths` 去重，确保即便 env 异常也能命中默认安装位置。
 *   2. 32-bit on 64-bit Windows 时 WoW64 文件系统重定向器会把
 *      `C:\Program Files` / `C:\Windows\System32` 透明改写到 (x86) /
 *      SysWOW64，`fs.existsSync` 因此可能产生假阴性。`existsBypassWow64`
 *      在 fs.existsSync 返回 false 时再用 `cmd /c if exist` 二次确认
 *      （cmd.exe 使用 Win32 真实路径，不受当前进程 bitness 影响）。
 *   3. 任何因为 env 缺失 / fs 异常 / which 失败导致的漏检，都会写进
 *      `result.diagnostics`，由 wizard footer 渲染给用户/排查者参考。
 */
function getCandidatePaths() {
  if (PLATFORM === "win32") {
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData =
      process.env["LOCALAPPDATA"] ||
      path.join(os.homedir(), "AppData", "Local");
    const userProfile = os.homedir();

    const list = [
      {
        path: path.join(programFiles, "Git", "bin", "bash.exe"),
        label: "Git for Windows（标准安装）",
      },
      // 字面量兜底：即使 process.env["ProgramFiles"] 异常也能命中默认安装位置
      {
        path: "C:\\Program Files\\Git\\bin\\bash.exe",
        label: "Git for Windows（标准安装 / 字面量兜底）",
      },
      {
        path: path.join(programFilesX86, "Git", "bin", "bash.exe"),
        label: "Git for Windows (x86)",
      },
      {
        path: "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        label: "Git for Windows (x86) / 字面量兜底",
      },
      {
        path: path.join(localAppData, "Programs", "Git", "bin", "bash.exe"),
        label: "Git for Windows（用户级安装）",
      },
      {
        path: path.join(userProfile, "scoop", "apps", "git", "current", "bin", "bash.exe"),
        label: "Git via Scoop",
      },
      {
        path: "C:\\msys64\\usr\\bin\\bash.exe",
        label: "MSYS2",
      },
      {
        path: "C:\\cygwin64\\bin\\bash.exe",
        label: "Cygwin64",
      },
      {
        path: "C:\\Windows\\System32\\bash.exe",
        label: "WSL（不推荐：路径在 Linux 命名空间下，跨域访问 Windows 文件较慢）",
      },
      {
        path: path.join(programFiles, "Git", "usr", "bin", "bash.exe"),
        label: "Git for Windows（usr/bin 下的 bash）",
      },
      {
        path: "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
        label: "Git for Windows（usr/bin / 字面量兜底）",
      },
    ];

    // 用 (lowercase path) 去重；保留首次出现的 label
    const seen = new Set();
    return list.filter((c) => {
      const key = c.path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (PLATFORM === "darwin") {
    return [
      { path: "/bin/bash", label: "macOS 内置 bash" },
      { path: "/opt/homebrew/bin/bash", label: "Homebrew (Apple Silicon)" },
      { path: "/usr/local/bin/bash", label: "Homebrew (Intel)" },
    ];
  }
  // linux
  return [
    { path: "/bin/bash", label: "Linux 标准 bash" },
    { path: "/usr/bin/bash", label: "Linux /usr/bin/bash" },
  ];
}

/**
 * fs.existsSync 兜底：在 win32 下 fs.existsSync 返回 false 时，
 * 用 cmd.exe 内置 `if exist` 再确认一次。理由：
 *   - 32-bit Node 在 64-bit Windows 上访问 `C:\Program Files\...` 会被
 *     WoW64 文件系统重定向器悄悄改写到 `(x86)`，`fs.existsSync` 因此假阴性。
 *   - 某些 packaged Electron 进程下 fs.existsSync 偶发对真实存在的路径返回
 *     false（暂未复现稳定根因，但 cmd 兜底实测可绕过）。
 * 走 cmd 内置命令（`if exist`）而不是 spawn `where.exe`，因为 cmd.exe 永远是
 * native 64-bit、且不依赖 PATH 中的 bash/where 是否被劫持。
 */
function existsBypassWow64(p) {
  if (!p) return false;
  if (fs.existsSync(p)) return true;
  if (PLATFORM !== "win32") return false;
  try {
    // 用 cmd 内置 if exist —— 0 = exists, 1 = not exists（execSync 抛异常）
    execSync(`cmd /d /c "if exist "${p}" (exit 0) else (exit 1)"`, {
      stdio: "ignore",
      timeout: 2000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 在系统 PATH 中查找命令的绝对路径。Windows 用 where，类 Unix 用 which。
 * win32 下显式走 `%SystemRoot%\System32\where.exe` + 「`cmd /c where`」双重兜底，
 * 避免 packaged Electron 主进程 PATH 异常 / where 被同名脚本劫持时整体漏检。
 */
function whichCommand(cmd, diagnostics) {
  const note = (msg) => {
    if (Array.isArray(diagnostics)) diagnostics.push(`whichCommand(${cmd}): ${msg}`);
  };
  if (PLATFORM === "win32") {
    const systemRoot = process.env["SystemRoot"] || "C:\\Windows";
    const whereExe = path.join(systemRoot, "System32", "where.exe");
    // 候选执行方式：(1) 直接调用 where.exe 绝对路径；(2) cmd /c where（让 cmd 解析）
    const attempts = [
      { argv: `"${whereExe}" ${cmd}`, label: `where.exe ${cmd}` },
      { argv: `cmd /d /c "where ${cmd}"`, label: `cmd /c where ${cmd}` },
    ];
    for (const att of attempts) {
      try {
        const out = execSync(att.argv, {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf-8",
          timeout: 3000,
          windowsHide: true,
        }).trim();
        if (out) return out.split(/\r?\n/)[0].trim();
        note(`${att.label} → empty stdout`);
      } catch (err) {
        note(`${att.label} → ${(err && err.message) || "error"}`);
      }
    }
    return null;
  }
  try {
    const out = execSync(`which ${cmd}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (!out) return null;
    return out.split(/\r?\n/)[0].trim();
  } catch (err) {
    note(`which ${cmd} → ${(err && err.message) || "error"}`);
    return null;
  }
}

/**
 * 扫描所有候选路径，过滤出真实存在的。
 *
 * 返回对象包含：
 *   - platform: 'win32' | 'darwin' | 'linux'
 *   - found:    Array<{ path, label, source: 'scan'|'scan-cmd'|'which'|'git' }>
 *   - candidates: Array<{ path, label }>（getCandidatePaths 原始列表）
 *   - diagnostics: string[]（哪一步漏检 / 失败、env / cwd 信息，给排查用）
 */
function detectBashPaths() {
  const candidates = getCandidatePaths();
  const found = [];
  const diagnostics = [];

  diagnostics.push(
    `platform=${PLATFORM} arch=${process.arch} packaged=${!!process.versions.electron}`
  );
  if (PLATFORM === "win32") {
    diagnostics.push(
      `env.ProgramFiles=${process.env["ProgramFiles"] || "(empty)"} env.ProgramFiles(x86)=${
        process.env["ProgramFiles(x86)"] || "(empty)"
      } env.LOCALAPPDATA=${process.env["LOCALAPPDATA"] || "(empty)"}`
    );
  }

  for (const c of candidates) {
    const direct = fs.existsSync(c.path);
    if (direct) {
      found.push({ ...c, source: "scan" });
      continue;
    }
    // fs.existsSync 假阴性兜底（仅 win32）
    if (PLATFORM === "win32" && existsBypassWow64(c.path)) {
      found.push({ ...c, source: "scan-cmd" });
      diagnostics.push(
        `existsBypassWow64 hit: ${c.path} (fs.existsSync returned false but cmd if-exist confirmed)`
      );
    }
  }

  // 通过 PATH 查找
  const fromPath = whichCommand("bash", diagnostics);
  if (
    fromPath &&
    existsBypassWow64(fromPath) &&
    !found.some((f) => f.path.toLowerCase() === fromPath.toLowerCase())
  ) {
    found.push({
      path: fromPath,
      label: "通过 PATH 找到（系统默认 bash）",
      source: "which",
    });
  }

  // 也通过 git 推导：git --exec-path 附近通常有 bash
  if (PLATFORM === "win32") {
    const gitExe = whichCommand("git", diagnostics);
    if (gitExe) {
      const guessed = path.join(path.dirname(gitExe), "bash.exe");
      if (
        existsBypassWow64(guessed) &&
        !found.some((f) => f.path.toLowerCase() === guessed.toLowerCase())
      ) {
        found.push({
          path: guessed,
          label: "通过 git 推导（git.exe 同目录的 bash.exe）",
          source: "git",
        });
      }
    }
  }

  if (found.length === 0) {
    diagnostics.push(
      `all ${candidates.length} candidates missed; PATH=${(process.env.PATH || "").slice(0, 400)}...`
    );
  }

  return { platform: PLATFORM, found, candidates, diagnostics };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateDownloadSection(platform) {
  if (platform === "win32") {
    return `
  <div class="step download">
    <h2>📥 一个都没找到？安装 Git for Windows</h2>
    <p>Git for Windows 自带 Git Bash（即 <code>bash.exe</code>），是 Windows 上最推荐的方案。</p>
    <ol>
      <li>访问 <a href="https://git-scm.com/download/win" target="_blank" rel="noopener">https://git-scm.com/download/win</a></li>
      <li>下载并运行安装包（一路下一步即可，使用默认选项）</li>
      <li>安装完成后默认路径为 <code>C:\\Program Files\\Git\\bin\\bash.exe</code></li>
      <li>重新运行 <code>node hooks/gongfeng-bash-detector.js</code> 验证</li>
    </ol>
    <details>
      <summary>用包管理器安装（可选）</summary>
      <ul>
        <li>Scoop：<code>scoop install git</code></li>
        <li>Chocolatey：<code>choco install git</code></li>
        <li>Winget：<code>winget install --id Git.Git -e</code></li>
      </ul>
    </details>
  </div>`;
  }
  if (platform === "darwin") {
    return `
  <div class="step download">
    <h2>📥 没找到 bash？</h2>
    <p>macOS 自带 <code>/bin/bash</code>，正常情况下都能找到。如果确实没有：</p>
    <ul>
      <li>用 Homebrew 安装更新版本：<code>brew install bash</code></li>
      <li>或检查 <code>/bin/bash</code> 是否被误删</li>
    </ul>
  </div>`;
  }
  return `
  <div class="step download">
    <h2>📥 没找到 bash？</h2>
    <p>大多数 Linux 发行版都自带 bash，请用包管理器安装：</p>
    <ul>
      <li>Debian/Ubuntu：<code>sudo apt install bash</code></li>
      <li>RHEL/CentOS/Fedora：<code>sudo dnf install bash</code></li>
      <li>Arch：<code>sudo pacman -S bash</code></li>
    </ul>
  </div>`;
}

/**
 * 生成 11 段 shell snippet。优先调用 install 模块；插件未安装时用兜底逻辑
 * （仍能产出可用的 snippet，只是 nodeBin / hookScript 是默认值）。
 */
function buildSnippetsWithFallback() {
  if (prepareGongfengCopilotSnippets) {
    const r = prepareGongfengCopilotSnippets({ silent: true });
    if (r && r.snippets && r.snippets.length) {
      return { snippets: r.snippets, existing: r.existing || { found: 0, events: [] }, status: r.status };
    }
  }
  // 兜底：自己拼 snippet
  const events = GONGFENG_HOOK_EVENTS || [
    { name: "beforeSubmitPrompt", display: "提交提示词前" },
    { name: "afterAgentThought", display: "Agent思考后" },
    { name: "afterAgentResponse", display: "Agent响应后" },
    { name: "beforeShellExecution", display: "Shell执行前" },
    { name: "afterShellExecution", display: "Shell执行后" },
    { name: "beforeMCPExecution", display: "MCP执行前" },
    { name: "afterMCPExecution", display: "MCP执行后" },
    { name: "afterFileEdit", display: "文件编辑后" },
    { name: "afterSearchReplaceFileEdit", display: "搜索替换文件编辑后" },
    { name: "afterFileRead", display: "文件读取后" },
    { name: "stop", display: "停止" },
  ];
  const hookScript = path
    .resolve(__dirname, "gongfeng-copilot-hook.js")
    .replace(/\\/g, "/");
  const nodeBin = "node";
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  const snippets = events.map((ev) => ({
    event: ev.name,
    display_name: `Clawd: ${ev.name}`,
    trigger_event_display: ev.display,
    shell_snippet: [
      "#!/usr/bin/env bash",
      `# Clawd gongfeng-copilot hook for event: ${ev.name}`,
      `exec ${q(nodeBin)} ${q(hookScript)} ${q(ev.name)}`,
      "",
    ].join("\n"),
    instructions: `在插件UI中创建hook：名称="Clawd: ${ev.name}"，触发事件="${ev.display}"`,
  }));
  return { snippets, existing: { found: 0, events: [] }, status: "fallback" };
}

function generateSnippetCards(snippets, existing) {
  const existingEvents = new Set(
    (existing && existing.events ? existing.events : []).map((e) => e.event)
  );
  return snippets
    .map((s, i) => {
      const already = existingEvents.has(s.event);
      return `
    <div class="snippet-card${already ? " already" : ""}" id="snippet-card-${i}">
      <div class="snippet-head">
        <span class="snippet-idx">${i + 1}</span>
        <div class="snippet-meta">
          <h3>${escapeHtml(s.display_name)}</h3>
          <p>触发事件：<strong>${escapeHtml(s.trigger_event_display)}</strong> <code>${escapeHtml(s.event)}</code></p>
        </div>
        ${already ? '<span class="snippet-badge">已配置</span>' : ""}
      </div>
      <div class="snippet-row">
        <label>① 名称：</label>
        <code id="snippet-name-${i}">${escapeHtml(s.display_name)}</code>
        <button class="copy-btn" onclick="copyText('snippet-name-${i}', this)">📋 复制名称</button>
      </div>
      <div class="snippet-row">
        <label>② 触发事件：</label>
        <code>${escapeHtml(s.trigger_event_display)}</code>
        <span class="hint">在下拉框中选这一项</span>
      </div>
      <div class="snippet-row column">
        <label>③ Shell 脚本：</label>
        <pre id="snippet-shell-${i}">${escapeHtml(s.shell_snippet)}</pre>
        <button class="copy-btn block" onclick="copyText('snippet-shell-${i}', this)">📋 复制 Shell 脚本</button>
      </div>
      <div class="snippet-foot">
        <button class="check-btn${already ? " done" : ""}" onclick="markSnippetDone(${i}, this)" ${already ? "disabled" : ""}>${already ? "✓ 已配置" : "○ 已在 UI 中创建"}</button>
      </div>
    </div>`;
    })
    .join("");
}

function generateDetectorHtml(result, snippetData) {
  const platformLabel = {
    win32: "Windows",
    darwin: "macOS",
    linux: "Linux",
  }[result.platform] || result.platform;

  const cards = result.found.length
    ? result.found
        .map(
          (h, i) => `
    <div class="hook-card${i === 0 ? " recommended" : ""}">
      ${i === 0 ? '<span class="badge">✨ 推荐</span>' : ""}
      <h3>${escapeHtml(h.label)}</h3>
      <div class="path-row">
        <code id="path-${i}">${escapeHtml(h.path)}</code>
        <button class="copy-btn" onclick="copyText('path-${i}', this)">📋 复制</button>
      </div>
    </div>`
        )
        .join("")
    : `<p class="empty">⚠️ 未在常见路径中检测到 bash 可执行文件。请参考下方「下载指引」。</p>`;

  const downloadSection = generateDownloadSection(result.platform);
  const snippetCards = generateSnippetCards(snippetData.snippets, snippetData.existing);
  const totalSnippets = snippetData.snippets.length;
  const alreadyDone = (snippetData.existing && snippetData.existing.found) || 0;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Clawd — gongfeng-copilot 一站式配置向导</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333; }
    .header { background: #fff; padding: 30px; border-radius: 10px; margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .step { background: #fff; padding: 25px; border-radius: 10px; margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .step.download { border-left: 4px solid #f0ad4e; }
    .hook-card { background: #f8fbff; padding: 18px; border-radius: 8px; margin: 12px 0;
      border-left: 4px solid #5b8def; position: relative; }
    .hook-card.recommended { background: #f0fff4; border-left-color: #28a745; }
    .hook-card h3 { margin: 0 0 10px 0; font-size: 15px; color: #333; }
    .badge { position: absolute; top: 12px; right: 12px; background: #28a745;
      color: #fff; font-size: 12px; padding: 2px 10px; border-radius: 10px; }
    .path-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .path-row code { flex: 1; background: #fff; padding: 8px 12px; border-radius: 4px;
      font-family: 'Courier New', monospace; word-break: break-all; border: 1px solid #ddd;
      font-size: 13px; min-width: 200px; }
    .copy-btn { background: #5b8def; color: #fff; border: 0; padding: 8px 16px;
      border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; }
    .copy-btn:hover { background: #4070d8; }
    .copy-btn.done { background: #28a745; }
    .copy-btn.block { display: block; margin-top: 8px; }
    .empty { color: #856404; background: #fff3cd; padding: 12px; border-radius: 6px; }
    .meta { font-family: 'Courier New', monospace; font-size: 12px; color: #666;
      background: #f0f0f0; padding: 8px 12px; border-radius: 4px; margin-top: 10px; }
    h2 { margin-top: 0; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px;
      font-family: 'Courier New', monospace; font-size: 13px; }
    a { color: #5b8def; }
    details { margin-top: 12px; }
    details summary { cursor: pointer; color: #5b8def; }
    ol li, ul li { margin: 6px 0; }
    .toc { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
    .toc a { background: #5b8def; color: #fff; padding: 6px 14px; border-radius: 16px;
      text-decoration: none; font-size: 13px; }
    .toc a:hover { background: #4070d8; }
    .progress-wrap { background: #e9ecef; height: 8px; border-radius: 4px; margin: 12px 0; overflow: hidden; }
    .progress-bar { background: #28a745; height: 100%; width: 0%; transition: width 0.3s; }
    .snippet-card { background: #f8fbff; padding: 16px 18px; border-radius: 8px; margin: 12px 0;
      border-left: 4px solid #5b8def; position: relative; }
    .snippet-card.already { background: #f0fff4; border-left-color: #28a745; opacity: 0.7; }
    .snippet-card.done { background: #e8f5e8; border-left-color: #28a745; }
    .snippet-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
    .snippet-idx { background: #5b8def; color: #fff; width: 26px; height: 26px;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-weight: bold; font-size: 13px; flex-shrink: 0; }
    .snippet-card.already .snippet-idx, .snippet-card.done .snippet-idx { background: #28a745; }
    .snippet-meta { flex: 1; }
    .snippet-meta h3 { margin: 0 0 4px 0; font-size: 15px; }
    .snippet-meta p { margin: 0; font-size: 13px; color: #666; }
    .snippet-badge { background: #28a745; color: #fff; font-size: 12px;
      padding: 3px 10px; border-radius: 10px; align-self: flex-start; }
    .snippet-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
    .snippet-row.column { flex-direction: column; align-items: stretch; }
    .snippet-row label { color: #555; font-size: 13px; min-width: 90px; }
    .snippet-row code { background: #fff; padding: 6px 10px; border: 1px solid #ddd;
      border-radius: 4px; flex: 1; min-width: 200px; word-break: break-all; }
    .snippet-row .hint { color: #999; font-size: 12px; }
    .snippet-row pre { background: #1e1e1e; color: #d4d4d4; padding: 12px;
      border-radius: 6px; font-family: 'Courier New', monospace; font-size: 12px;
      overflow-x: auto; margin: 0; white-space: pre-wrap; word-break: break-all; }
    .snippet-foot { margin-top: 10px; }
    .check-btn { background: #fff; color: #5b8def; border: 1px solid #5b8def;
      padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .check-btn:hover { background: #f0f7ff; }
    .check-btn.done { background: #28a745; color: #fff; border-color: #28a745; cursor: default; }
    .stat-line { color: #555; font-size: 14px; margin: 8px 0; }
    .summary { background: #fff3cd; padding: 12px 16px; border-radius: 6px;
      border-left: 4px solid #f0ad4e; margin-bottom: 16px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🚀 Clawd — gongfeng-copilot 一站式配置向导</h1>
    <p>本向导帮你完成两件事：<strong>① 设置 Bash 执行器路径</strong>（仅 Windows）<strong>② 在插件 UI 里创建 11 个 hook</strong>。每张卡片都有「📋 复制」按钮，点完粘贴即可。</p>
    <div class="toc">
      <a href="#step-bash">① Bash 路径</a>
      <a href="#step-snippets">② 11 个 Hook Snippet</a>
      <a href="#step-verify">③ 验证</a>
    </div>
    <div class="meta">
      检测平台: ${escapeHtml(platformLabel)}（${escapeHtml(result.platform)}）　Bash 候选: ${result.found.length}　已配置 Hook: ${alreadyDone}/${totalSnippets}
    </div>
  </div>

  <div class="step" id="step-bash">
    <h2>① ✅ 设置 Bash 执行器路径${result.platform !== "win32" ? "（macOS / Linux 可跳过）" : ""}</h2>
    <p>将下面检测到的路径填入 <strong>VSCode → Gongfeng Copilot (CodeBuddy VSCode plugin) → Hooks 管理 → 高级设置 → <code>command_executor_path</code></strong>。${result.found.length ? "排在最上面的是<strong>推荐选项</strong>。" : ""}</p>
    ${cards}
  </div>

  ${result.found.length === 0 ? downloadSection : `
  <div class="step">
    <h2>💡 选择建议</h2>
    <ul>
      <li><strong>Windows 用户</strong>：优先选 <code>Git for Windows</code>，最稳定，几乎所有开发者都装了。</li>
      <li><strong>不要选 WSL 的 <code>C:\\Windows\\System32\\bash.exe</code></strong>：路径在 Linux 命名空间，跨域访问 Windows 文件较慢，且依赖 WSL 发行版已安装。</li>
      <li>选好后，到插件「高级设置」粘贴 → 保存 → 继续后续步骤。</li>
    </ul>
  </div>
  ${downloadSection}`}

  <div class="step">
    <h2>🔧 Bash 还是找不到？手动定位</h2>
    <details${result.found.length === 0 ? " open" : ""}>
      <summary>Windows（在 PowerShell 或 cmd 里执行）</summary>
      <pre><code>where bash
where git</code></pre>
      <p>如果 <code>where bash</code> 有输出，那就是它；只有 <code>where git</code> 有时，<code>bash.exe</code> 通常就在 git.exe 同目录或 <code>../bin/</code> 下。</p>
    </details>
    <details>
      <summary>macOS / Linux</summary>
      <pre><code>which bash
type -a bash</code></pre>
    </details>
  </div>

  <div class="step" id="step-snippets">
    <h2>② 🪝 创建 11 个 Hook Snippet</h2>
    <div class="summary">
      <strong>操作步骤：</strong>VSCode → Gongfeng Copilot (CodeBuddy VSCode plugin) → <strong>Hooks 管理</strong> → 点「<strong>新建 Hook</strong>」<br>
      对每张卡片：<strong>① 复制名称</strong> 粘贴到「Hook 名称」 → <strong>② 选择触发事件</strong> 下拉框 → <strong>③ 复制 Shell 脚本</strong> 粘贴到脚本框 → 保存 → 回这里点「✓ 已在 UI 中创建」记录进度。
    </div>
    <div class="stat-line">进度：<span id="snippet-done-count">${alreadyDone}</span> / ${totalSnippets} 已完成</div>
    <div class="progress-wrap"><div class="progress-bar" id="snippet-progress"></div></div>
    ${snippetCards}
  </div>

  <div class="step" id="step-verify">
    <h2>③ ✔️ 验证</h2>
    <p>全部 11 个 hook 创建完成后，重新运行：</p>
    <pre><code>node hooks/gongfeng-bash-detector.js</code></pre>
    <p>再次打开本页面，已配置的 hook 会自动显示<span class="snippet-badge" style="position:relative;">已配置</span>。也可以直接启动 Clawd，触发任意一次对话，桌宠应该会随事件切换状态。</p>
  </div>

  <script>
    const TOTAL_SNIPPETS = ${totalSnippets};
    let snippetDone = ${alreadyDone};
    function refreshProgress() {
      const el = document.getElementById('snippet-done-count');
      if (el) el.textContent = snippetDone;
      const bar = document.getElementById('snippet-progress');
      if (bar) bar.style.width = ((snippetDone / TOTAL_SNIPPETS) * 100) + '%';
    }
    refreshProgress();

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

    function markSnippetDone(idx, btn) {
      const card = document.getElementById('snippet-card-' + idx);
      if (!card || card.classList.contains('done')) return;
      card.classList.add('done');
      btn.classList.add('done');
      btn.textContent = '✓ 已完成';
      btn.disabled = true;
      snippetDone++;
      refreshProgress();
      if (snippetDone === TOTAL_SNIPPETS) {
        setTimeout(() => alert('🎉 全部 11 个 hook 都已创建！可以启动 Clawd 验证桌宠是否随事件切换状态。'), 200);
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Public API：执行检测 + 拼 snippet + 写入 HTML。
 */
function prepareGongfengBashDetector(options = {}) {
  const result = detectBashPaths();
  const snippetData = buildSnippetsWithFallback();
  const writeHtml = options.writeHtml !== false;
  let outputPath = null;

  if (writeHtml) {
    outputPath = options.output
      ? path.resolve(options.output)
      : path.resolve(__dirname, "..", "tools", "gongfeng-bash-detector.html");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, generateDetectorHtml(result, snippetData), "utf-8");
  }

  if (!options.silent) {
    const platformLabel = { win32: "Windows", darwin: "macOS", linux: "Linux" }[
      result.platform
    ] || result.platform;
    console.log(`Clawd: 检测平台 = ${platformLabel}`);
    if (result.found.length === 0) {
      console.log("Clawd: ⚠️  未检测到可用 bash，请按生成的 HTML 中的下载指引安装。");
    } else {
      console.log(`Clawd: 检测到 ${result.found.length} 个可用 bash：`);
      result.found.forEach((h, i) => {
        const tag = i === 0 ? " ✨" : "";
        console.log(`  ${i + 1}. ${h.path}${tag}  — ${h.label}`);
      });
    }
    const done = (snippetData.existing && snippetData.existing.found) || 0;
    console.log(
      `Clawd: 已生成 ${snippetData.snippets.length} 个 hook snippet（已配置 ${done}/${snippetData.snippets.length}）`
    );
    if (outputPath) {
      console.log("");
      console.log(`📄 一站式配置向导已生成: ${outputPath}`);
      console.log("   请用浏览器打开，从上到下跟着点：先填 bash 路径，再创建 11 个 hook。");
    }
  }

  return { ...result, snippetData, outputPath };
}

module.exports = {
  detectBashPaths,
  buildSnippetsWithFallback,
  generateDetectorHtml,
  prepareGongfengBashDetector,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log("Usage: node hooks/gongfeng-bash-detector.js [--output <html>]");
      process.exit(0);
    }
    if (a === "--output") opts.output = argv[++i];
  }
  try {
    prepareGongfengBashDetector(opts);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
