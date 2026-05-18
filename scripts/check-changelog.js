#!/usr/bin/env node
// scripts/check-changelog.js
// CI 校验：非文档 commit 必须更新 CHANGELOG.md。
//
// 用法:
//   node scripts/check-changelog.js
//
// 行为:
//   1. 获取当前 commit 变更的文件列表
//   2. 若全部为文档路径 → exit 0 (豁免)
//   3. 若有非文档文件但 CHANGELOG.md 未变更 → exit 1
//   4. 否则 exit 0
//
// 退出码:
//   0 — 通过（含豁免）
//   1 — CHANGELOG.md 未更新
//
// 依赖: Node 内置模块 + git CLI。

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// 文档豁免路径模式（与 ci.yml paths-ignore 和 project-continuity §4.1 对齐）
const DOC_PATTERNS = [
  /^AGENT-PROGRESS\.md$/,
  /^docs\//,
  /^\.codebuddy\//,
  /^\.review\//,
  /^[^/]+\.md$/,             // 根目录 *.md (README, AGENTS, CLAUDE 等)
];

function isDocOnly(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return DOC_PATTERNS.some((p) => p.test(normalized));
}

function getChangedFiles() {
  // 检测是否有 parent commit
  try {
    execSync('git rev-parse HEAD~1', { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch (_) {
    // 初始 commit，无 parent → 跳过检查
    console.log('[check:changelog] Initial commit detected, skipping check.');
    return null;
  }

  // 检测 merge commit (多个 parent)
  const parents = execSync('git rev-list --parents -n1 HEAD', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim().split(/\s+/);

  let diffCmd;
  if (parents.length > 2) {
    // Merge commit — diff against first parent
    diffCmd = 'git diff --name-only HEAD^1..HEAD';
  } else {
    diffCmd = 'git diff --name-only HEAD~1..HEAD';
  }

  const output = execSync(diffCmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (!output) return [];
  return output.split('\n').filter(Boolean);
}

function main() {
  const files = getChangedFiles();

  // null = initial commit, skip
  if (files === null) {
    process.exit(0);
  }

  // Empty diff (e.g. empty commit)
  if (files.length === 0) {
    console.log('[check:changelog] No files changed, skipping.');
    process.exit(0);
  }

  // Check if all files are doc-only
  const nonDocFiles = files.filter((f) => !isDocOnly(f));
  if (nonDocFiles.length === 0) {
    console.log('[check:changelog] Doc-only commit, CHANGELOG update not required.');
    process.exit(0);
  }

  // Non-doc files exist — CHANGELOG.md must be in the diff
  const changelogUpdated = files.some((f) => f === 'CHANGELOG.md');
  if (!changelogUpdated) {
    console.error('[check:changelog] ✗ Non-documentation files were changed but CHANGELOG.md was not updated.');
    console.error('');
    console.error('Changed non-doc files:');
    for (const f of nonDocFiles) {
      console.error(`  - ${f}`);
    }
    console.error('');
    console.error('Per project-continuity rule §2 step 4, please add an entry to CHANGELOG.md.');
    console.error('If this is a CI/infra-only change, add it under "Internal / Refactor".');
    process.exit(1);
  }

  console.log('[check:changelog] OK — CHANGELOG.md updated.');
  process.exit(0);
}

main();
