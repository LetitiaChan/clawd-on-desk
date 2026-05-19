#!/usr/bin/env node
// Clawd — Gongfeng Copilot Configuration Wizard
// Interactive tool to help users manually configure gongfeng-copilot hooks
//
// Usage:
//   node tools/gongfeng-wizard.js [options]
//
// Options:
//   --hook   <path>   Override absolute path to gongfeng-copilot-hook.js
//                     (default: ../hooks/gongfeng-copilot-hook.js)
//   --node   <path>   Override Node executable path baked into snippets
//                     (default: auto-detected via server-config)
//   --output <path>   Override generated HTML output path
//                     (default: ./gongfeng-wizard.html, alongside this script)
//   -h, --help        Show this help

const fs = require('fs');
const path = require('path');
const {
  prepareGongfengCopilotSnippets,
  generateHtmlWizard,
  _detectNodeAvailability,
} = require('../hooks/gongfeng-copilot-install.js');

function parseArgs(argv) {
  const args = { hook: null, node: null, output: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--hook':
        args.hook = argv[++i];
        break;
      case '--node':
        args.node = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      default:
        if (a && a.startsWith('--')) {
          // Support --key=value form too
          const eq = a.indexOf('=');
          if (eq > 0) {
            const k = a.slice(2, eq);
            const v = a.slice(eq + 1);
            if (k === 'hook') args.hook = v;
            else if (k === 'node') args.node = v;
            else if (k === 'output') args.output = v;
          }
        }
    }
  }
  return args;
}

function printHelp() {
  console.log([
    'Clawd — Gongfeng Copilot Configuration Wizard',
    '',
    'Usage: node tools/gongfeng-wizard.js [options]',
    '',
    'Options:',
    '  --hook   <path>   Override absolute path to gongfeng-copilot-hook.js',
    '  --node   <path>   Override Node executable path baked into snippets',
    '  --output <path>   Override generated HTML output path',
    '  -h, --help        Show this help',
    ''
  ].join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  try {
    const prepOptions = { silent: true };
    if (args.hook) prepOptions.hookScript = path.resolve(args.hook);
    if (args.node) prepOptions.nodeBin = args.node;

    const result = prepareGongfengCopilotSnippets(prepOptions);

    if (result.status === 'plugin_not_installed') {
      console.log('❌ Gongfeng Copilot 插件未安装');
    console.log('请先安装 Gongfeng Copilot (CodeBuddy VSCode plugin)');
      return;
    }

    // 生成 HTML 文件
    const htmlContent = generateHtmlWizard(result);
    const outputPath = args.output
      ? path.resolve(args.output)
      : path.join(__dirname, 'gongfeng-wizard.html');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, htmlContent, 'utf-8');

    console.log('✅ 配置向导已生成:');
    console.log(`   文件位置: ${outputPath}`);
    console.log('');
    console.log('📋 配置摘要:');
    console.log(`   - 插件状态: ${result.status === 'ready' ? '已安装' : '未安装'}`);
    console.log(`   - 已配置钩子: ${result.existing.found}/11`);
    // Resolve the *real* node path via the same detector the HTML wizard uses,
    // so the CLI summary doesn't print a misleading bare "node" on Windows
    // (resolveNodeBin returns the literal string "node" on win32 by design).
    let nodeSummary;
    try {
      const ns = _detectNodeAvailability();
      nodeSummary = ns.available
        ? `${ns.nodePath} ✅`
        : '⚠️ 未检测到 — 详见生成的 HTML 中的「⓪ 安装 Node.js」步骤';
    } catch (_e) {
      nodeSummary = `${result.node_bin} (detector unavailable)`;
    }
    console.log(`   - Node: ${nodeSummary}`);
    console.log(`   - Hook 脚本: ${result.hook_script}`);
    console.log('');
    console.log('🚀 下一步:');
    console.log('   1. 用浏览器打开生成的 HTML 文件');
    console.log('   2. 按照页面指引逐个配置 11 个钩子');
    console.log('   3. Windows 用户记得设置命令执行器路径');

  } catch (error) {
    console.error('❌ 生成配置向导失败:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };