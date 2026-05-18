#!/usr/bin/env node
// scripts/release.js
// 发版自动化脚本 — 实现 project-continuity 规则三的 8 步流程。
//
// 用法:
//   node scripts/release.js [--version <x.y.z>] [--dry-run]
//
// 行为:
//   1. 执行 npm run check:syntax — 失败则中止
//   2. 执行 npm test — 失败则中止
//   3. 确认版本号（交互或 --version 指定）
//   4. bump package.json version
//   5. 关闭 CHANGELOG [Unreleased] 段
//   6. 从模板生成 docs/releases/release-v<x.y.z>.md
//   7. 验证三件套就绪
//   8. commit + tag + push（--dry-run 跳过）
//
// 退出码:
//   0 — 成功
//   1 — 校验失败或用户取消
//
// 依赖: 仅 Node 内置模块。

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');
const CHANGELOG_PATH = path.join(REPO_ROOT, 'CHANGELOG.md');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'docs', 'releases', 'release-template.md');

// ─── Helpers ────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`[release] ✗ ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[release] ${msg}`);
}

function run(cmd, opts = {}) {
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: REPO_ROOT, ...opts });
  return result.status === 0;
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`[release] ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { version: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      opts.version = args[++i];
    } else if (args[i] === '--dry-run') {
      opts.dryRun = true;
    }
  }
  return opts;
}

function readPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  return pkg.version;
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function stepCheckSyntax() {
  info('Step 1/8: Running check:syntax ...');
  if (!run('npm run check:syntax')) {
    die('check:syntax failed. Fix syntax errors before releasing.');
  }
}

function stepTest() {
  info('Step 2/8: Running npm test ...');
  if (!run('npm test')) {
    die('Tests failed. Fix test failures before releasing.');
  }
}

async function stepVersion(opts) {
  const current = readPkgVersion();
  info(`Current version: ${current}`);

  let version = opts.version;
  if (!version) {
    version = await ask(`New version (current: ${current}):`);
  }

  if (!version) die('No version provided.');
  if (!isValidSemver(version)) die(`Invalid semver: ${version}`);
  if (compareSemver(version, current) <= 0) {
    die(`New version (${version}) must be greater than current (${current}).`);
  }

  return version;
}

function stepBumpPackageJson(version) {
  info(`Step 4/8: Bumping package.json to ${version} ...`);
  const content = fs.readFileSync(PKG_PATH, 'utf8');
  const updated = content.replace(
    /"version"\s*:\s*"[^"]+"/,
    `"version": "${version}"`
  );
  fs.writeFileSync(PKG_PATH, updated, 'utf8');
}

function stepCloseChangelog(version) {
  info('Step 5/8: Closing [Unreleased] in CHANGELOG.md ...');
  const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const date = todayISO();

  // Replace the [Unreleased] heading with the versioned heading,
  // and re-add a fresh [Unreleased] section above it.
  const unreleasedPattern = /^## \[Unreleased\]/m;
  if (!unreleasedPattern.test(content)) {
    die('Could not find ## [Unreleased] section in CHANGELOG.md');
  }

  const newSection = `## [Unreleased]\n\n---\n\n## [${version}] - ${date}`;
  const updated = content.replace(unreleasedPattern, newSection);
  fs.writeFileSync(CHANGELOG_PATH, updated, 'utf8');
}

function stepGenerateReleaseNotes(version) {
  info('Step 6/8: Generating release notes from template ...');
  const dest = path.join(REPO_ROOT, 'docs', 'releases', `release-v${version}.md`);

  if (fs.existsSync(dest)) {
    info(`  Release notes already exist at ${path.relative(REPO_ROOT, dest)}, skipping generation.`);
    return;
  }

  if (!fs.existsSync(TEMPLATE_PATH)) {
    die(`Template not found: ${path.relative(REPO_ROOT, TEMPLATE_PATH)}`);
  }

  let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  template = template.replace(/\{VERSION\}/g, version);
  fs.writeFileSync(dest, template, 'utf8');
  info(`  Created ${path.relative(REPO_ROOT, dest)}`);
}

function stepVerify(version) {
  info('Step 7/8: Verifying release artifacts ...');
  const releaseNotes = path.join(REPO_ROOT, 'docs', 'releases', `release-v${version}.md`);
  if (!fs.existsSync(releaseNotes)) {
    die(`Release notes missing: docs/releases/release-v${version}.md`);
  }
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  if (pkg.version !== version) {
    die(`package.json version (${pkg.version}) != expected (${version})`);
  }
  const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  if (!changelog.includes(`[${version}]`)) {
    die(`CHANGELOG.md does not contain [${version}] section`);
  }
  info('  All three artifacts verified ✓');
}

async function stepCommitTagPush(version, dryRun) {
  if (dryRun) {
    info('Step 8/8: [DRY RUN] Would commit, tag, and push:');
    info(`  git add package.json CHANGELOG.md docs/releases/release-v${version}.md`);
    info(`  git commit -m "release: v${version}"`);
    info(`  git tag v${version}`);
    info(`  git push && git push origin v${version}`);
    return;
  }

  info('Step 8/8: Committing, tagging, and pushing ...');

  const answer = await ask('Proceed with commit + tag + push? (y/N):');
  if (answer.toLowerCase() !== 'y') {
    die('Aborted by user.');
  }

  // Stage the three files
  if (!run(`git add package.json CHANGELOG.md "docs/releases/release-v${version}.md"`)) {
    die('git add failed');
  }

  // Commit — write message to a temp file to avoid shell quoting issues
  const msgFile = path.join(REPO_ROOT, '.git', 'COMMIT_EDITMSG_RELEASE');
  fs.writeFileSync(msgFile, `release: v${version}`, 'utf8');
  const commitOk = run(`git commit -F "${msgFile}"`);
  try { fs.unlinkSync(msgFile); } catch (_) { /* ignore */ }
  if (!commitOk) die('git commit failed');

  // Tag
  if (!run(`git tag v${version}`)) {
    die('git tag failed');
  }

  // Push
  if (!run('git push')) {
    die('git push failed');
  }
  if (!run(`git push origin v${version}`)) {
    die('git push tag failed');
  }

  info(`✓ Released v${version} — tag pushed, CI should start building.`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.dryRun) {
    info('=== DRY RUN MODE ===');
  }

  // Steps 1-2: pre-flight checks
  stepCheckSyntax();
  stepTest();

  // Step 3: determine version
  const version = await stepVersion(opts);
  info(`Releasing version: ${version}`);

  // Steps 4-7: prepare files
  stepBumpPackageJson(version);
  stepCloseChangelog(version);
  stepGenerateReleaseNotes(version);
  stepVerify(version);

  // Step 8: commit + tag + push
  await stepCommitTagPush(version, opts.dryRun);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
