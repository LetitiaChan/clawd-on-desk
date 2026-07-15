#!/usr/bin/env node
// scripts/release.js
// 发版自动化脚本 — 实现 project-continuity 规则三的完整发版流程，并把
// 「版本号 / CHANGELOG / release notes / 打 tag / 触发 CI」统一编排，
// 减少手动跨文件操作与漏项风险。
//
// 用法:
//   node scripts/release.js [--version <x.y.z>|patch|minor|major] [--yes] [--no-ci] [--dry-run]
//   npm run release -- --version patch
//   npm run release -- --version 0.7.17 --yes
//
// 参数:
//   --version <v>   目标版本；可为完整 semver (0.7.17) 或关键字 patch/minor/major。
//                   省略时进入交互提问（同样接受关键字）。
//   --yes           跳过 commit+tag+push 的交互确认（非交互 / CI 自定义命令场景）。
//   --no-ci         push 后不自动触发 build.yml（只打印手动命令）。
//   --dry-run       只走文件准备与校验，不 commit / 不 tag / 不 push / 不触发 CI。
//
// 编排的 9 个步骤:
//   1. npm run check:syntax        — 静态校验，失败中止
//   2. npm test                    — 全量回归，失败中止
//   3. 确认版本号                   — --version 或交互，semver 校验 + 必须递增
//   4. bump package.json version
//   5. 关闭 CHANGELOG [Unreleased] 段 + 更新 footer compare 链接
//   6. 从模板生成 docs/releases/release-v<x.y.z>.md（已存在则保留）
//   7. 三件套就绪自检（package.json / CHANGELOG / release notes）
//   8. commit + tag + push（tag push 被 auto-tag 抢跑而拒绝时视为预期，不中止）
//   9. 触发并核对 build.yml —— 这是关键：auto-tag.yml 用 GITHUB_TOKEN 建 tag
//      不会级联触发 build.yml（GitHub Actions 防递归），所以必须显式
//      `gh workflow run build.yml --ref v<x.y.z>`（详见规则三 step 6 / §六-22）。
//
// 退出码: 0 成功 / 1 校验失败或用户取消。
// 依赖: 仅 Node 内置模块 + git CLI（+ 可选 gh CLI 用于第 9 步）。

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');
const CHANGELOG_PATH = path.join(REPO_ROOT, 'CHANGELOG.md');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'docs', 'releases', 'release-template.md');
const BUILD_WORKFLOW = 'build.yml';

// ─── Logging ─────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`[release] \u2717 ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[release] ${msg}`);
}

function warn(msg) {
  console.warn(`[release] \u26a0 ${msg}`);
}

// ─── Shell helpers ─────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: REPO_ROOT, ...opts });
  return result.status === 0;
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function runCaptureSafe(cmd) {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
}

function commandExists(cmd) {
  const result = spawnSync(cmd, { shell: true, stdio: 'ignore', cwd: REPO_ROOT });
  return result.status === 0;
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

// ─── Pure helpers (exported for tests) ─────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { version: null, dryRun: false, yes: false, noCi: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      opts.version = args[++i];
    } else if (args[i] === '--dry-run') {
      opts.dryRun = true;
    } else if (args[i] === '--yes' || args[i] === '-y') {
      opts.yes = true;
    } else if (args[i] === '--no-ci') {
      opts.noCi = true;
    }
  }
  return opts;
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
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

// 支持 patch / minor / major 关键字派生新版本号。
function bumpVersion(current, kind) {
  if (!isValidSemver(current)) {
    throw new Error(`Invalid current version: ${current}`);
  }
  const [major, minor, patch] = current.split('.').map(Number);
  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump kind: ${kind}`);
  }
}

// 把版本输入（完整 semver 或 patch/minor/major 关键字）解析为具体版本号。
function resolveVersion(input, current) {
  if (!input) return null;
  const kind = input.toLowerCase();
  if (kind === 'patch' || kind === 'minor' || kind === 'major') {
    return bumpVersion(current, kind);
  }
  return input;
}

function todayISO(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 关闭 CHANGELOG 的 [Unreleased] 段：保留一个新的空 [Unreleased]，并在其下开一个
// [version] - date 段。纯字符串变换，便于测试。
function closeChangelogContent(content, version, date) {
  const unreleasedPattern = /^## \[Unreleased\]/m;
  if (!unreleasedPattern.test(content)) {
    throw new Error('Could not find ## [Unreleased] section in CHANGELOG.md');
  }
  const newSection = `## [Unreleased]\n\n---\n\n## [${version}] - ${date}`;
  return content.replace(unreleasedPattern, newSection);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 更新 CHANGELOG 底部的 compare 链接 footer：
//   [Unreleased]: .../compare/v<current>...HEAD
// →  [Unreleased]: .../compare/v<version>...HEAD
//    [<version>]: .../compare/v<current>...v<version>
// 找不到匹配时原样返回并标记 changed=false（best-effort，不阻塞发版）。
function updateChangelogFooter(content, current, version) {
  const linkPattern = new RegExp(
    `^\\[Unreleased\\]:\\s*(\\S*compare/)v${escapeRegExp(current)}\\.\\.\\.HEAD\\s*$`,
    'm'
  );
  const match = content.match(linkPattern);
  if (!match) {
    return { content, changed: false };
  }
  const base = match[1];
  const newUnreleased = `[Unreleased]: ${base}v${version}...HEAD`;
  const newVersionLink = `[${version}]: ${base}v${current}...v${version}`;
  const replaced = content.replace(linkPattern, `${newUnreleased}\n${newVersionLink}`);
  return { content: replaced, changed: true };
}

function renderTemplate(template, version) {
  return template.replace(/\{VERSION\}/g, version);
}

function readPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  return pkg.version;
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function stepCheckSyntax() {
  info('Step 1/9: Running check:syntax ...');
  if (!run('npm run check:syntax')) {
    die('check:syntax failed. Fix syntax errors before releasing.');
  }
}

function stepTest() {
  info('Step 2/9: Running npm test ...');
  if (!run('npm test')) {
    die('Tests failed. Fix test failures before releasing.');
  }
}

async function stepVersion(opts) {
  const current = readPkgVersion();
  info(`Step 3/9: Current version: ${current}`);

  let input = opts.version;
  if (!input) {
    input = await ask(`New version or bump kind [patch|minor|major] (current: ${current}):`);
  }
  if (!input) die('No version provided.');

  let version;
  try {
    version = resolveVersion(input, current);
  } catch (err) {
    die(err.message);
  }

  if (!isValidSemver(version)) die(`Invalid semver: ${version}`);
  if (compareSemver(version, current) <= 0) {
    die(`New version (${version}) must be greater than current (${current}).`);
  }
  return version;
}

function stepBumpPackageJson(version, dryRun) {
  info(`Step 4/9: Bumping package.json to ${version} ...`);
  const content = fs.readFileSync(PKG_PATH, 'utf8');
  const updated = content.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`);
  if (dryRun) {
    info('  [DRY RUN] package.json not written.');
    return;
  }
  fs.writeFileSync(PKG_PATH, updated, 'utf8');
}

function stepCloseChangelog(current, version, dryRun) {
  info('Step 5/9: Closing [Unreleased] in CHANGELOG.md ...');
  let content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  try {
    // Runs even in dry-run so a missing [Unreleased] section is caught early.
    content = closeChangelogContent(content, version, todayISO());
  } catch (err) {
    die(err.message);
  }
  const footer = updateChangelogFooter(content, current, version);
  if (footer.changed) {
    content = footer.content;
    info(`  Updated compare-link footer (v${current}...HEAD \u2192 v${version}...HEAD + [${version}] link).`);
  } else {
    warn(`Could not find footer compare link for v${current}; skipped footer update (add [${version}] link manually if needed).`);
  }
  if (dryRun) {
    info('  [DRY RUN] CHANGELOG.md not written.');
    return;
  }
  fs.writeFileSync(CHANGELOG_PATH, content, 'utf8');
}

function stepGenerateReleaseNotes(version, dryRun) {
  info('Step 6/9: Generating release notes from template ...');
  const dest = path.join(REPO_ROOT, 'docs', 'releases', `release-v${version}.md`);

  if (fs.existsSync(dest)) {
    info(`  Release notes already exist at ${path.relative(REPO_ROOT, dest)}, keeping as-is.`);
    return;
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    die(`Template not found: ${path.relative(REPO_ROOT, TEMPLATE_PATH)}`);
  }
  if (dryRun) {
    info(`  [DRY RUN] Would create ${path.relative(REPO_ROOT, dest)} from template.`);
    return;
  }
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  fs.writeFileSync(dest, renderTemplate(template, version), 'utf8');
  info(`  Created ${path.relative(REPO_ROOT, dest)} — FILL IN before publishing the draft Release.`);
}

function stepVerify(version, dryRun) {
  info('Step 7/9: Verifying release artifacts ...');
  if (dryRun) {
    info('  [DRY RUN] Skipping on-disk verification (files were not written).');
    return;
  }
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
  info('  All three artifacts verified \u2713');
}

async function stepCommitTagPush(version, opts) {
  const tag = `v${version}`;

  if (opts.dryRun) {
    info('Step 8/9: [DRY RUN] Would commit, tag, and push:');
    info(`  git add package.json CHANGELOG.md docs/releases/release-${tag}.md`);
    info(`  git commit -m "release: ${tag}"`);
    info(`  git tag ${tag}`);
    info(`  git push && git push origin ${tag}`);
    return;
  }

  info('Step 8/9: Committing, tagging, and pushing ...');

  if (!opts.yes) {
    const answer = await ask('Proceed with commit + tag + push? (y/N):');
    if (answer.toLowerCase() !== 'y') {
      die('Aborted by user.');
    }
  }

  if (!run(`git add package.json CHANGELOG.md "docs/releases/release-${tag}.md"`)) {
    die('git add failed');
  }

  // Commit via temp file to avoid shell quoting issues.
  const msgFile = path.join(REPO_ROOT, '.git', 'COMMIT_EDITMSG_RELEASE');
  fs.writeFileSync(msgFile, `release: ${tag}`, 'utf8');
  const commitOk = run(`git commit -F "${msgFile}"`);
  try { fs.unlinkSync(msgFile); } catch (_) { /* ignore */ }
  if (!commitOk) die('git commit failed');

  if (!run(`git tag ${tag}`)) {
    warn(`git tag ${tag} failed (may already exist locally); continuing.`);
  }

  if (!run('git push')) {
    die('git push (branch) failed');
  }

  // Tag push may be rejected because auto-tag.yml (triggered by the package.json
  // change we just pushed) already created the tag with GITHUB_TOKEN. That is an
  // EXPECTED race, not an error — confirm the tag exists on origin and continue.
  const tagPushOk = run(`git push origin ${tag}`);
  if (!tagPushOk) {
    info(`git push tag was rejected — likely auto-tag.yml already created ${tag} (expected race).`);
    const remoteTag = runCaptureSafe(`git ls-remote --tags origin refs/tags/${tag}`);
    if (!remoteTag) {
      die(`Tag ${tag} is not on origin and the push failed. Investigate manually.`);
    }
    info(`  Confirmed ${tag} exists on origin.`);
  }

  info(`\u2713 release commit + ${tag} are on origin.`);
}

// Step 9: 触发并核对 build.yml。这是本脚本相对于「纯手动跑规则三」最关键的补齐。
function stepTriggerCI(version, opts) {
  const tag = `v${version}`;

  const manual = () => {
    info('Trigger the packaging pipeline manually once the tag is on origin:');
    info(`  gh workflow run ${BUILD_WORKFLOW} --ref ${tag}`);
    info(`  gh run list --workflow ${BUILD_WORKFLOW} --limit 5   # confirm headBranch=${tag}`);
  };

  if (opts.dryRun) {
    info('Step 9/9: [DRY RUN] Would trigger CI:');
    manual();
    return;
  }
  if (opts.noCi) {
    info('Step 9/9: --no-ci set, skipping automatic CI trigger.');
    manual();
    return;
  }
  if (!commandExists('gh --version')) {
    warn('GitHub CLI (gh) not found — cannot auto-trigger build.yml.');
    manual();
    return;
  }

  info(`Step 9/9: Triggering ${BUILD_WORKFLOW} on ${tag} ...`);
  // Note: a bare tag push does NOT reliably trigger build.yml (auto-tag uses
  // GITHUB_TOKEN which is blocked from cascading workflow runs). workflow_dispatch
  // with --ref v<tag> sets github.ref=refs/tags/v<tag>, so the release job's
  // `startsWith(github.ref,'refs/tags/v')` guard still holds.
  if (!run(`gh workflow run ${BUILD_WORKFLOW} --ref ${tag}`)) {
    warn('gh workflow run failed — trigger manually.');
    manual();
    return;
  }
  info('  Dispatched. Recent build.yml runs:');
  run(`gh run list --workflow ${BUILD_WORKFLOW} --limit 5`);
  info(`  Verify a run with headBranch=${tag} appears above, then watch it to green.`);
  info(`  Follow with: gh run watch --workflow ${BUILD_WORKFLOW}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.dryRun) {
    info('=== DRY RUN MODE (no commit / tag / push / CI trigger) ===');
  }

  const current = readPkgVersion();

  stepCheckSyntax();
  stepTest();

  const version = await stepVersion(opts);
  info(`Releasing version: ${version} (from ${current})`);

  stepBumpPackageJson(version, opts.dryRun);
  stepCloseChangelog(current, version, opts.dryRun);
  stepGenerateReleaseNotes(version, opts.dryRun);
  stepVerify(version, opts.dryRun);

  await stepCommitTagPush(version, opts);
  stepTriggerCI(version, opts);

  info(`Done. Remember to fill docs/releases/release-v${version}.md and confirm the draft Release once CI is green.`);
}

// 仅作为 CLI 直接运行时执行 main；被 require 时只导出纯函数供测试。
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  isValidSemver,
  compareSemver,
  bumpVersion,
  resolveVersion,
  todayISO,
  closeChangelogContent,
  updateChangelogFooter,
  renderTemplate,
  escapeRegExp,
};
