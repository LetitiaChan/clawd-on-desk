#!/usr/bin/env node
// scripts/check-rule-consistency.js
// 验证 project-continuity.mdc 中引用的 `npm run <script>` 命令
// 在 package.json scripts 中实际存在。
//
// 用法:
//   node scripts/check-rule-consistency.js
//
// 退出码:
//   0 — 全部一致
//   1 — 存在引用了但不存在的脚本命令

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RULE_PATH = path.join(REPO_ROOT, '.codebuddy', 'rules', 'project-continuity.mdc');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');

function main() {
  // Read package.json scripts
  if (!fs.existsSync(PKG_PATH)) {
    console.error('[check:rules] ✗ package.json not found');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const scripts = Object.keys(pkg.scripts || {});

  // Read rule file
  if (!fs.existsSync(RULE_PATH)) {
    console.log('[check:rules] Rule file not found, skipping (file may be .gitignored).');
    process.exit(0);
  }
  const ruleContent = fs.readFileSync(RULE_PATH, 'utf8');

  // Extract all `npm run <script>` references
  // Matches: npm run check:syntax, npm run verify:sidecars, etc.
  // Skips glob patterns like `npm run build:win:*`
  const npmRunPattern = /npm run ([\w:.-]+)/g;
  const referenced = new Set();
  let match;
  while ((match = npmRunPattern.exec(ruleContent)) !== null) {
    const name = match[1];
    // Skip incomplete glob references (trailing colon means a wildcard follows)
    if (name.endsWith(':')) continue;
    referenced.add(name);
  }

  // Known exceptions: scripts referenced in the rule as "not available" or aspirational
  const KNOWN_EXCEPTIONS = [
    'lint', // explicitly documented as "本地暂不可用" in the rule
  ];

  if (referenced.size === 0) {
    console.log('[check:rules] No `npm run` references found in rule file.');
    process.exit(0);
  }

  // Check each reference exists in package.json
  const missing = [];
  for (const scriptName of referenced) {
    if (KNOWN_EXCEPTIONS.includes(scriptName)) continue;
    if (!scripts.includes(scriptName)) {
      missing.push(scriptName);
    }
  }

  if (missing.length === 0) {
    console.log(`[check:rules] OK — ${referenced.size} npm run references all exist in package.json.`);
    process.exit(0);
  }

  console.error(`[check:rules] ✗ ${missing.length} script(s) referenced in project-continuity.mdc but missing from package.json:`);
  for (const s of missing.sort()) {
    console.error(`  - npm run ${s}`);
  }
  console.error('');
  console.error('Either add the script to package.json or update the rule file.');
  process.exit(1);
}

main();
