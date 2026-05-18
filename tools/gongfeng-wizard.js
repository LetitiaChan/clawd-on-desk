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
const { prepareGongfengCopilotSnippets } = require('../hooks/gongfeng-copilot-install.js');

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

function generateHtmlWizard(result) {
  const snippetsHtml = result.snippets.map((snippet, index) => `
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

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Clawd - Gongfeng Copilot 配置向导</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
            color: #333;
        }
        .header {
            background: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .windows-banner {
            background: #ffe4e1;
            border: 2px solid #d9534f;
            color: #842029;
            padding: 16px 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            font-size: 14px;
            line-height: 1.6;
        }
        .windows-banner h3 {
            margin: 0 0 8px 0;
            color: #b02a37;
            font-size: 16px;
        }
        .windows-banner code {
            background: #fff;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            color: #b02a37;
            border: 1px solid #f5c2c7;
        }
        .status {
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .status.ready { background: #e8f5e8; color: #2d5016; }
        .status.not-installed { background: #fff3cd; color: #856404; }
        .step {
            background: white;
            padding: 25px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .snippet-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 15px 0;
            border-left: 4px solid #007acc;
        }
        .code-block {
            position: relative;
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 15px;
            border-radius: 6px;
            margin: 10px 0;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            white-space: pre-wrap;
        }
        .copy-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #007acc;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .copy-btn:hover { background: #005a9e; }
        .progress {
            background: #28a745;
            height: 4px;
            border-radius: 2px;
            margin: 10px 0;
            transition: width 0.3s;
        }
        .action-buttons {
            display: flex;
            gap: 10px;
            margin: 20px 0;
        }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
        .btn-primary { background: #007acc; color: white; }
        .btn-secondary { background: #6c757d; color: white; }
        .btn-success { background: #28a745; color: white; }
        .meta-info {
            font-size: 12px;
            color: #666;
            margin-top: 10px;
            font-family: 'Courier New', monospace;
            background: #f0f0f0;
            padding: 8px 12px;
            border-radius: 4px;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="windows-banner">
        <h3>⚠️ Windows 用户必读：先配置 Bash 解释器</h3>
        <p>插件默认用 <strong>PowerShell</strong> 跑钩子脚本，但 Clawd 钩子是 <code>#!/usr/bin/env bash</code>，PowerShell 会因 <code>.sh</code> 扩展名报错。</p>
        <p>请先在插件 <strong>Hooks 管理 → 高级设置</strong> 把 <strong>命令执行器路径</strong> 设为：</p>
        <p><code>C:\\Program Files\\Git\\bin\\bash.exe</code>（如果你用的是 Git for Windows 默认安装路径）</p>
        <p>没有 Git Bash？装 <a href="https://git-scm.com/download/win" target="_blank">Git for Windows</a>，或改用 WSL 的 <code>bash.exe</code> / MSYS2 的 <code>bash.exe</code>。macOS / Linux 用户忽略此横幅即可。</p>
    </div>

    <div class="header">
        <h1>🦊 Clawd - Gongfeng Copilot 配置向导</h1>
<p>帮助您手动配置 Gongfeng Copilot (CodeBuddy VSCode plugin) 的 11 个事件钩子</p>

        <div class="status ${result.status === 'ready' ? 'ready' : 'not-installed'}">
            <strong>检测状态:</strong>
            ${result.status === 'ready' ?
                `✅ 插件已安装 - 已配置 ${result.existing.found}/11 个钩子` :
                '❌ 插件未安装或路径不存在'}
        </div>

        ${result.status === 'ready' ? `
            <div class="progress" style="width: ${(result.existing.found / 11) * 100}%"></div>
        ` : ''}

        <div class="meta-info">
            Node: ${result.node_bin || '(default)'}<br>
            Hook: ${result.hook_script || '(default)'}
        </div>
    </div>

    <div class="step">
        <h2>📋 配置步骤</h2>
        <ol>
            <li><strong>Windows 用户必做:</strong> 在 CodeBuddy 插件 → Hooks 管理 → 高级设置中，设置命令执行器路径为: <code>C:\\Program Files\\Git\\bin\\bash.exe</code></li>
            <li><strong>逐个创建钩子:</strong> 为下面每个事件创建钩子，复制对应的 shell 脚本</li>
            <li><strong>验证配置:</strong> 完成后重启 VSCode 测试钩子是否生效</li>
        </ol>

        <div class="action-buttons">
            <button class="btn btn-primary" onclick="openHooksSettings()">打开 Hooks 设置</button>
            <button class="btn btn-secondary" onclick="copyAllSnippets()">复制全部脚本</button>
            <button class="btn btn-success" onclick="markAsDone()">我已配置完成</button>
        </div>
    </div>

    <div class="step">
        <h2>🔧 11 个事件钩子配置</h2>
        ${snippetsHtml}
    </div>

    <script>
        const snippets = ${JSON.stringify(result.snippets.map(s => s.shell_snippet))};

        function copyToClipboard(index) {
            navigator.clipboard.writeText(snippets[index]).then(() => {
                alert('脚本已复制到剪贴板！');
            });
        }

        function copyAllSnippets() {
            const allScripts = snippets.join('\\n\\n---\\n\\n');
            navigator.clipboard.writeText(allScripts).then(() => {
                alert('全部脚本已复制到剪贴板！');
            });
        }

        function openHooksSettings() {
            // 这里可以添加打开插件设置的逻辑
            alert('请在 VSCode 中打开 CodeBuddy 插件的 Hooks 管理界面');
        }

        function markAsDone() {
            localStorage.setItem('gongfengConfigured', 'true');
            alert('配置完成！请重启 VSCode 测试钩子是否生效。');
        }

        // 检查是否已经配置过
        if (localStorage.getItem('gongfengConfigured')) {
            document.querySelector('.header').innerHTML +=
                '<div style="background: #d4edda; padding: 10px; border-radius: 5px; margin-top: 10px;">✅ 您已经配置过 Gongfeng Copilot 钩子</div>';
        }
    </script>
</body>
</html>`;
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
    console.log(`   - Node 路径: ${result.node_bin}`);
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

module.exports = { generateHtmlWizard, main, parseArgs };