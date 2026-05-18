#!/usr/bin/env node
// scripts/check-syntax.js
// 静态语法 + 关键入口可加载性检查。
// 用途：替代规则二第 1 步的人肉 `node --check` 清单。
//
// 行为：
//   1. 对所有受跟踪源码目录下的 *.js 跑 `node --check`。
//   2. 对一组关键入口尝试 `require()` 加载（捕获 require 期间抛出的同步错误）。
//
// 退出码：
//   0 — 全绿
//   1 — 有任意 *.js 语法错误
//   2 — 有任意关键入口 require 失败
//   3 — 同时存在以上两类错误
//
// 与 CI/规则的关系：
//   - 规则二第 1 步 → `npm run check:syntax`
//   - .github/workflows/ci.yml 在 push/PR 时执行
//
// 注意：本脚本本身只调用 Node 内置模块，不引入任何第三方依赖。

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

// 受扫目录（相对仓库根）。新增源码目录请在此追加。
const SCAN_DIRS = [
  'src',
  'hooks',
  'agents',
  'tools',
  'scripts',
  'test',
];

// 受扫的根目录单文件
const SCAN_ROOT_FILES = [
  'launch.js',
];

// 关键入口（必须能被 require 加载）。
// 注意：electron 主进程入口 src/main.js 引用 electron 包，
// 在普通 node 环境下 require 会失败，故不放进 require 检查清单，
// 仅保留 `node --check` 语法层面校验。
const REQUIRE_ENTRIES = [
  // 安装类 hook（独立 CLI，纯 node 可加载）
  'hooks/install.js',
  'hooks/gemini-install.js',
  'hooks/cursor-install.js',
  'hooks/kiro-install.js',
  'hooks/kimi-install.js',
  'hooks/codex-install.js',
  'hooks/codex-debug-install.js',
  'hooks/openclaw-install.js',
  'hooks/hermes-install.js',
  'hooks/pi-install.js',
  'hooks/gongfeng-copilot-install.js',
  // sidecar/scripts
  'scripts/verify-sidecar-binaries.js',
  'scripts/fetch-sidecar-binaries.js',
];

// 排除路径（glob 简化版，按前缀匹配）。
const EXCLUDE_PREFIXES = [
  'node_modules',
  'dist',
  '.git',
  'bin/cc-connect-clawd', // sidecar 二进制目录可能含同名 .js？保守起见排除
];

function isExcluded(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  return EXCLUDE_PREFIXES.some((p) => norm === p || norm.startsWith(`${p}/`));
}

function walk(dirAbs, collector) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const childAbs = path.join(dirAbs, entry.name);
    const childRel = path.relative(REPO_ROOT, childAbs).replace(/\\/g, '/');
    if (isExcluded(childRel)) continue;
    if (entry.isDirectory()) {
      walk(childAbs, collector);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      collector.push(childAbs);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    walk(path.join(REPO_ROOT, d), files);
  }
  for (const f of SCAN_ROOT_FILES) {
    const abs = path.join(REPO_ROOT, f);
    if (fs.existsSync(abs)) files.push(abs);
  }
  return files;
}

function runNodeCheck(files) {
  const failures = [];
  for (const abs of files) {
    const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
    const r = spawnSync(process.execPath, ['--check', abs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
      failures.push({
        file: rel,
        stderr: (r.stderr || '').trim() || `exit code ${r.status}`,
      });
    }
  }
  return failures;
}

function runRequireChecks() {
  const failures = [];
  for (const rel of REQUIRE_ENTRIES) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      // 入口不存在不算失败，但提示一下
      // 防止文件被搬走后忘了同步本清单
      // eslint-disable-next-line no-console
      console.warn(`[check:syntax] (skip) require entry not found: ${rel}`);
      continue;
    }
    // 在子进程中 require，避免污染当前进程；只校验 require 阶段不抛出。
    const code = `require(${JSON.stringify(abs)});`;
    const r = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAWD_CHECK_SYNTAX: '1' },
    });
    if (r.status !== 0) {
      failures.push({
        file: rel,
        stderr: (r.stderr || '').trim() || `exit code ${r.status}`,
      });
    }
  }
  return failures;
}

function main() {
  const files = collectFiles();
  // eslint-disable-next-line no-console
  console.log(`[check:syntax] scanning ${files.length} *.js files ...`);

  const syntaxFailures = runNodeCheck(files);
  const requireFailures = runRequireChecks();

  if (syntaxFailures.length === 0 && requireFailures.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[check:syntax] OK — ${files.length} files, ${REQUIRE_ENTRIES.length} require entries.`);
    process.exit(0);
  }

  if (syntaxFailures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n[check:syntax] node --check failures (${syntaxFailures.length}):`);
    for (const f of syntaxFailures) {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${f.file}\n${f.stderr.split('\n').map((l) => `      ${l}`).join('\n')}`);
    }
  }
  if (requireFailures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n[check:syntax] require() failures (${requireFailures.length}):`);
    for (const f of requireFailures) {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${f.file}\n${f.stderr.split('\n').map((l) => `      ${l}`).join('\n')}`);
    }
  }

  let code = 0;
  if (syntaxFailures.length > 0) code |= 1;
  if (requireFailures.length > 0) code |= 2;
  process.exit(code);
}

if (require.main === module) {
  main();
}

module.exports = { collectFiles, runNodeCheck, runRequireChecks };
