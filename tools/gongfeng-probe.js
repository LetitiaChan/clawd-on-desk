#!/usr/bin/env node
// gongfeng-copilot hook 协议探针 (Phase 1)
// -----------------------------------------------------------------------------
// 目的：在不修改 Clawd 主代码的前提下，向 ~/.gongfeng-copilot/hooks/hooks.json
// 注入 11 个临时 hook，使其把 stdin / argv / env / shell 等信息原样 dump 到
// 日志文件，从而验证：
//   1. 11 个事件中，哪些会真的触发？
//   2. 每个事件实际收到的 stdin payload 字段长什么样？
//   3. Windows 上 "command_executor_path" 为空时，stub 是被什么 shell 执行的？
//   4. 没有 hook_id 的本地条目会不会被云端同步删除（运行后看 hooks.json 的变化）。
//   5. hooks_md5 字段不更新会不会导致插件认为本地 hook 失效？
//
// 用法：
//   node tools/gongfeng-probe.js install     # 安装探针
//   node tools/gongfeng-probe.js uninstall   # 移除探针、恢复原 hooks.json
//   node tools/gongfeng-probe.js report      # 汇总日志、输出每事件的字段集合
//   node tools/gongfeng-probe.js status      # 查看当前 hooks.json 状态
//
// 设计原则：
//   - 完全不依赖项目内任何模块（不引 server-config / json-utils），便于单独运行。
//   - 写 hooks.json 时**完整保留**所有非探针条目（用户自定义 hook 不动）。
//   - 探针条目用固定 display_name 前缀 "ClawdProbe: " 识别，便于 uninstall 精确清理。
//   - 备份原 hooks.json 到 hooks.json.clawd-probe-backup，uninstall 时可以一键还原。
// -----------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();
const PARENT_DIR = path.join(HOME, ".gongfeng-copilot");
const HOOKS_DIR = path.join(PARENT_DIR, "hooks");
const HOOKS_JSON = path.join(HOOKS_DIR, "hooks.json");
const BACKUP_JSON = path.join(HOOKS_DIR, "hooks.json.clawd-probe-backup");
const PROBE_DIR = path.join(HOOKS_DIR, "probe");
const LOG_DIR = path.join(PROBE_DIR, "logs");

const PROBE_DISPLAY_PREFIX = "ClawdProbe: ";
const PROBE_MARKER = "clawd-gongfeng-probe"; // 出现在 stub 内容里，便于识别

// 11 个事件 —— 来自插件 "管理 Hooks" UI 的下拉列表
const EVENTS = [
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

// ----------------------------------------------------------------------------
// 通用 IO 工具
// ----------------------------------------------------------------------------

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function writeJsonAtomic(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

// ----------------------------------------------------------------------------
// stub 脚本生成
// ----------------------------------------------------------------------------
//
// 关键点：插件运行 `command` 字段时使用的解释器目前未知（Windows 上 hooks.json
// 里 command_executor_path 为空字符串，可能是 git-bash、wsl-bash 或 cmd）。
// 我们让 stub 兼容 bash 执行：
//   - shebang 写 #!/usr/bin/env bash
//   - 整个脚本只用 POSIX 兼容语法
//   - 如果 bash 不可用导致 stub 跑不起来，hooks.json 里一定会有错误日志（插件
//     一般会显示），这本身也是探针要采集的信息。
//
// stub 做的事：
//   1. 把 stdin 全文捕获为变量 STDIN
//   2. 把 argv、所有 ${HOOK_*} 类环境变量、$SHELL、$0、PATH 写到日志
//   3. 输出 "{}" 到 stdout（不 gating，让插件继续走默认策略）
//   4. exit 0

function stubBody(eventName) {
  // 注意：以下是 .sh 文件内容，shell 自己的变量用 \$ 转义避免 JS 模板冲突
  const logFile = path.join(LOG_DIR, `${eventName}.log`).replace(/\\/g, "/");
  const cwdMarker = path.join(LOG_DIR).replace(/\\/g, "/");
  return [
    "#!/usr/bin/env bash",
    `# ${PROBE_MARKER} | event=${eventName}`,
    "# 自动生成，勿手改。用 node tools/gongfeng-probe.js uninstall 清理。",
    "set +e",
    `LOG_DIR='${cwdMarker}'`,
    `LOG_FILE='${logFile}'`,
    `EVENT='${eventName}'`,
    'mkdir -p "$LOG_DIR" 2>/dev/null',
    // 1) 读 stdin 到一个临时文件（POSIX 安全，避免 \x00 / 大 payload）
    'TMP_STDIN=$(mktemp 2>/dev/null || echo "$LOG_DIR/.stdin.$$.tmp")',
    'cat > "$TMP_STDIN"',
    // 2) 写一行 JSON-ish 日志
    'TS=$(date +%Y-%m-%dT%H:%M:%S%z 2>/dev/null || date)',
    '{',
    '  echo "===== $TS event=$EVENT ====="',
    '  echo "argv: $0 $@"',
    '  echo "shell: $0"',
    '  echo "BASH_VERSION: ${BASH_VERSION:-<none>}"',
    '  echo "SHELL: ${SHELL:-<unset>}"',
    '  echo "PWD: $(pwd)"',
    '  echo "PATH: $PATH"',
    '  echo "--- env (HOOK_*/CLAWD_*/GONGFENG_*) ---"',
    '  env | grep -E "^(HOOK_|CLAWD_|GONGFENG_|COPILOT_|CODEBUDDY_)" || true',
    '  echo "--- stdin (raw) ---"',
    '  cat "$TMP_STDIN"',
    '  echo ""',
    '  echo "--- stdin (sha256 / size) ---"',
    '  wc -c < "$TMP_STDIN" 2>/dev/null || true',
    '} >> "$LOG_FILE" 2>&1',
    'rm -f "$TMP_STDIN" 2>/dev/null',
    // 3) 不 gating，原样让插件继续
    'echo "{}"',
    'exit 0',
    "",
  ].join("\n");
}

function writeStubs() {
  fs.mkdirSync(PROBE_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const result = {};
  for (const ev of EVENTS) {
    const stubPath = path.join(PROBE_DIR, `${ev.name}.sh`);
    fs.writeFileSync(stubPath, stubBody(ev.name), "utf-8");
    if (process.platform !== "win32") {
      try { fs.chmodSync(stubPath, 0o755); } catch {}
    }
    result[ev.name] = stubPath;
  }
  return result;
}

// ----------------------------------------------------------------------------
// hooks.json 操作
// ----------------------------------------------------------------------------

function isProbeEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.display_name === "string"
      && entry.display_name.startsWith(PROBE_DISPLAY_PREFIX)) return true;
  if (typeof entry.command === "string"
      && entry.command.indexOf(PROBE_DIR) === 0) return true;
  return false;
}

function ensureBackup() {
  if (!fs.existsSync(HOOKS_JSON)) return false;
  if (fs.existsSync(BACKUP_JSON)) return false; // 不覆盖已存在的备份
  fs.copyFileSync(HOOKS_JSON, BACKUP_JSON);
  return true;
}

function cmdInstall() {
  if (!fs.existsSync(PARENT_DIR)) {
    console.error(`✗ ${PARENT_DIR} 不存在，插件未安装？`);
    process.exit(1);
  }

  const backedUp = ensureBackup();
  const stubs = writeStubs();

  let settings = readJsonSafe(HOOKS_JSON) || {};
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (typeof settings.version !== "number") settings.version = 1;
  if (typeof settings.enabled !== "boolean") settings.enabled = true;

  let added = 0;
  let kept = 0;

  for (const ev of EVENTS) {
    const list = Array.isArray(settings.hooks[ev.name]) ? settings.hooks[ev.name] : [];
    // 删除任何旧的探针条目
    const userEntries = list.filter((e) => !isProbeEntry(e));
    kept += userEntries.length;

    const probeEntry = {
      command: stubs[ev.name],
      display_name: `${PROBE_DISPLAY_PREFIX}${ev.name}`,
      trigger_event: ev.name,
      trigger_event_display: ev.display,
    };
    settings.hooks[ev.name] = [probeEntry, ...userEntries];
    added++;
  }

  writeJsonAtomic(HOOKS_JSON, settings);

  console.log("✓ gongfeng-copilot 探针已安装");
  console.log(`  hooks.json     : ${HOOKS_JSON}`);
  if (backedUp) console.log(`  备份           : ${BACKUP_JSON}`);
  else          console.log(`  备份           : (已存在，保留旧备份) ${BACKUP_JSON}`);
  console.log(`  stub 目录      : ${PROBE_DIR}`);
  console.log(`  日志目录       : ${LOG_DIR}`);
  console.log(`  注入事件数      : ${added}`);
  console.log(`  保留的用户 hook: ${kept}`);
  console.log("");
  console.log("下一步：");
  console.log("  1. 在 VSCode 里打开 CodeBuddy(内网版)，发起一次对话；");
  console.log("     尝试触发 shell 命令、MCP、文件读写、停止等多种动作。");
  console.log("  2. 跑   node tools/gongfeng-probe.js report   查看采集到的 payload。");
  console.log("  3. 完事后跑   node tools/gongfeng-probe.js uninstall   恢复。");
}

function cmdUninstall() {
  let removedFromJson = 0;

  if (fs.existsSync(HOOKS_JSON)) {
    const settings = readJsonSafe(HOOKS_JSON) || {};
    if (settings.hooks && typeof settings.hooks === "object") {
      for (const ev of Object.keys(settings.hooks)) {
        if (!Array.isArray(settings.hooks[ev])) continue;
        const before = settings.hooks[ev].length;
        settings.hooks[ev] = settings.hooks[ev].filter((e) => !isProbeEntry(e));
        removedFromJson += before - settings.hooks[ev].length;
        if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
      }
      writeJsonAtomic(HOOKS_JSON, settings);
    }
  }

  // 删 stub（保留 logs，方便事后翻阅）
  let removedStubs = 0;
  if (fs.existsSync(PROBE_DIR)) {
    for (const ev of EVENTS) {
      const stubPath = path.join(PROBE_DIR, `${ev.name}.sh`);
      try {
        fs.unlinkSync(stubPath);
        removedStubs++;
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
  }

  console.log("✓ 探针已移除");
  console.log(`  从 hooks.json 删掉的条目 : ${removedFromJson}`);
  console.log(`  删除的 stub 文件         : ${removedStubs}`);
  if (fs.existsSync(BACKUP_JSON)) {
    console.log(`  原始备份仍保留         : ${BACKUP_JSON}`);
    console.log("    若想完整还原，请手动 copy 该文件覆盖 hooks.json。");
  }
  if (fs.existsSync(LOG_DIR)) {
    console.log(`  日志保留               : ${LOG_DIR}`);
  }
}

function cmdStatus() {
  console.log(`HOME             : ${HOME}`);
  console.log(`hooks.json       : ${HOOKS_JSON} ${fs.existsSync(HOOKS_JSON) ? "(存在)" : "(不存在)"}`);
  console.log(`备份             : ${BACKUP_JSON} ${fs.existsSync(BACKUP_JSON) ? "(存在)" : "(不存在)"}`);
  console.log(`PROBE_DIR        : ${PROBE_DIR} ${fs.existsSync(PROBE_DIR) ? "(存在)" : "(不存在)"}`);
  console.log(`LOG_DIR          : ${LOG_DIR} ${fs.existsSync(LOG_DIR) ? "(存在)" : "(不存在)"}`);
  if (!fs.existsSync(HOOKS_JSON)) return;
  const s = readJsonSafe(HOOKS_JSON) || {};
  console.log("");
  console.log(`version          : ${s.version}`);
  console.log(`enabled          : ${s.enabled}`);
  console.log(`hooks_md5        : ${s.hooks_md5 || "(空)"}`);
  console.log(`command_executor : ${s.command_executor_path || "(空)"}`);
  const hooks = s.hooks || {};
  console.log(`已注册事件数      : ${Object.keys(hooks).length}`);
  for (const ev of Object.keys(hooks)) {
    const arr = hooks[ev] || [];
    const probeCount = arr.filter(isProbeEntry).length;
    console.log(`  - ${ev.padEnd(28)} 共 ${arr.length} 条 (探针 ${probeCount} / 用户 ${arr.length - probeCount})`);
  }
}

// ----------------------------------------------------------------------------
// 日志报告
// ----------------------------------------------------------------------------

function parseLog(content) {
  // 把日志按 "===== ... =====" 分块
  const blocks = [];
  const re = /^===== (\S+) event=(\S+) =====$/m;
  let rest = content;
  let m;
  while ((m = re.exec(rest)) !== null) {
    const start = m.index;
    const next = rest.slice(start + m[0].length).search(/^===== \S+ event=\S+ =====$/m);
    const blockEnd = next === -1 ? rest.length : start + m[0].length + next;
    blocks.push({
      ts: m[1],
      event: m[2],
      body: rest.slice(start, blockEnd),
    });
    if (next === -1) break;
    rest = rest.slice(blockEnd);
    re.lastIndex = 0;
  }
  return blocks;
}

function extractStdinJson(body) {
  const idx = body.indexOf("--- stdin (raw) ---");
  if (idx < 0) return null;
  const tail = body.slice(idx + "--- stdin (raw) ---".length);
  const end = tail.indexOf("--- stdin (sha256");
  const raw = (end >= 0 ? tail.slice(0, end) : tail).trim();
  if (!raw) return { _empty: true };
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function collectKeys(obj, prefix, out) {
  if (obj === null || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.add(key);
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v)) collectKeys(v, key, out);
  }
}

function cmdReport() {
  if (!fs.existsSync(LOG_DIR)) {
    console.log(`(无日志目录) ${LOG_DIR}`);
    return;
  }
  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".log"));
  if (!files.length) {
    console.log(`(暂无日志，可能 hook 还未被触发) ${LOG_DIR}`);
    return;
  }

  console.log(`日志目录: ${LOG_DIR}`);
  console.log(`日志文件: ${files.length}`);
  console.log("");

  for (const f of files.sort()) {
    const content = fs.readFileSync(path.join(LOG_DIR, f), "utf-8");
    const blocks = parseLog(content);
    if (!blocks.length) continue;

    const event = blocks[0].event;
    const keySet = new Set();
    let firstSample = null;
    let exampleShell = null;

    for (const b of blocks) {
      const j = extractStdinJson(b.body);
      if (j && !j._empty && !j._raw) {
        collectKeys(j, "", keySet);
        if (!firstSample) firstSample = j;
      }
      if (!exampleShell) {
        const m = b.body.match(/^BASH_VERSION:\s*(.+)$/m);
        if (m) exampleShell = m[1].trim();
      }
    }

    console.log(`▍ event=${event}  触发次数=${blocks.length}`);
    if (exampleShell) console.log(`  bash: ${exampleShell}`);
    console.log(`  payload 字段(${keySet.size}): ${[...keySet].sort().join(", ") || "(无 / 非 JSON)"}`);
    if (firstSample) {
      const trimmed = JSON.stringify(firstSample, null, 2)
        .split("\n").slice(0, 12).join("\n");
      console.log("  样本 payload (截断):");
      console.log(trimmed.split("\n").map((l) => "    " + l).join("\n"));
    }
    console.log("");
  }
}

// ----------------------------------------------------------------------------
// 入口
// ----------------------------------------------------------------------------

const cmd = (process.argv[2] || "").toLowerCase();
switch (cmd) {
  case "install":   cmdInstall();   break;
  case "uninstall": cmdUninstall(); break;
  case "status":    cmdStatus();    break;
  case "report":    cmdReport();    break;
  default:
    console.log("用法: node tools/gongfeng-probe.js <install|uninstall|status|report>");
    process.exit(cmd ? 2 : 0);
}
