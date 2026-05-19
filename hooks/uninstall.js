#!/usr/bin/env node
// Clawd uninstall entry point.
//
// Usage:
//   node hooks/uninstall.js                     # uninstall Claude hooks (default)
//   node hooks/uninstall.js gongfeng-copilot    # generate gongfeng-copilot uninstall wizard (HTML)
//   node hooks/uninstall.js all-agents          # unregister hooks from ALL supported agents
//   node hooks/uninstall.js all                 # all-agents + gongfeng-copilot wizard
//   node hooks/uninstall.js -h | --help

const argv = process.argv.slice(2);

function printHelp() {
  console.log([
    "Clawd uninstall",
    "",
    "Usage:",
    "  node hooks/uninstall.js                  Uninstall Claude hooks (default)",
    "  node hooks/uninstall.js gongfeng-copilot Generate gongfeng-copilot uninstall wizard",
    "  node hooks/uninstall.js all-agents       Unregister hooks from ALL supported agents",
    "  node hooks/uninstall.js all              Run all-agents + gongfeng-copilot wizard",
    "  -h, --help                                Show this help",
    "",
    "Supported agents for all-agents:",
    "  Claude Code, CodeBuddy, Gemini CLI, Cursor Agent, Kiro CLI,",
    "  Kimi CLI, Copilot CLI, Codex CLI, Codex Debug, OpenClaw,",
    "  OpenCode, Hermes, Pi Extension",
    "",
    "Notes:",
    "  Gongfeng-Copilot hooks are managed through the plugin's Hooks UI.",
    "  The wizard scans hooks-cache.json and renders an HTML page that walks you",
    "  through removing each Clawd:* hook via the plugin UI.",
  ].join("\n"));
}

function uninstallClaude() {
  const { unregisterHooks } = require("./install.js");
  const { removed, changed } = unregisterHooks();
  console.log("Clawd Claude hooks uninstall complete");
  console.log(`  Removed: ${removed}`);
  console.log(`  Changed: ${changed}`);
}

function uninstallGongfeng() {
  const { prepareGongfengCopilotUninstall } = require("./gongfeng-copilot-uninstall.js");
  // Pass through --output <path> if user provided it after the subcommand.
  const opts = { silent: false };
  const idx = argv.indexOf("--output");
  if (idx >= 0 && argv[idx + 1]) opts.output = argv[idx + 1];
  prepareGongfengCopilotUninstall(opts);
}

/**
 * Unregister hooks from ALL supported agents.
 * Each agent is wrapped in try/catch so one failure doesn't block others.
 * @returns {{ results: object[] }}
 */
function uninstallAllAgents() {
  const agents = [
    { name: "Claude Code", fn: () => { const { unregisterHooks } = require("./install.js"); return unregisterHooks(); } },
    { name: "CodeBuddy", fn: () => { const { unregisterCodeBuddyHooks } = require("./codebuddy-install.js"); return unregisterCodeBuddyHooks(); } },
    { name: "Gemini CLI", fn: () => { const { unregisterGeminiHooks } = require("./gemini-install.js"); return unregisterGeminiHooks(); } },
    { name: "Cursor Agent", fn: () => { const { unregisterCursorHooks } = require("./cursor-install.js"); return unregisterCursorHooks(); } },
    { name: "Kiro CLI", fn: () => { const { unregisterKiroHooks } = require("./kiro-install.js"); return unregisterKiroHooks(); } },
    { name: "Kimi CLI", fn: () => { const { unregisterKimiHooks } = require("./kimi-install.js"); return unregisterKimiHooks(); } },
    { name: "Copilot CLI", fn: () => { const { unregisterCopilotHooks } = require("./copilot-install.js"); return unregisterCopilotHooks(); } },
    { name: "Codex CLI", fn: () => { const { unregisterCodexHooks } = require("./codex-install.js"); return unregisterCodexHooks(); } },
    { name: "Codex Debug", fn: () => { const { unregisterCodexDebugHooks } = require("./codex-debug-install.js"); return unregisterCodexDebugHooks(); } },
    { name: "OpenClaw", fn: () => { const { unregisterOpenClawPlugin } = require("./openclaw-install.js"); return unregisterOpenClawPlugin(); } },
    { name: "OpenCode", fn: () => { const { unregisterOpencodePlugin } = require("./opencode-install.js"); return unregisterOpencodePlugin(); } },
    { name: "Hermes", fn: () => { const { unregisterHermesPlugin } = require("./hermes-install.js"); return unregisterHermesPlugin(); } },
    { name: "Pi Extension", fn: () => { const { unregisterPiExtension } = require("./pi-install.js"); return unregisterPiExtension(); } },
  ];

  const results = [];
  let totalRemoved = 0;
  let totalChanged = 0;

  console.log("Clawd: unregistering hooks from all agents...\n");

  for (const agent of agents) {
    try {
      const result = agent.fn();
      const removed = result.removed || 0;
      const changed = result.changed ? 1 : 0;
      totalRemoved += removed;
      totalChanged += changed;
      const status = changed ? `✓ removed ${removed} hook(s)` : "— no hooks found";
      console.log(`  ${agent.name}: ${status}`);
      results.push({ name: agent.name, ...result, error: null });
    } catch (err) {
      console.log(`  ${agent.name}: ✗ error — ${err.message}`);
      results.push({ name: agent.name, removed: 0, changed: false, error: err.message });
    }
  }

  console.log(`\nSummary: ${totalRemoved} hook(s) removed across ${totalChanged} agent(s)`);
  return { results };
}

if (argv.includes("-h") || argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

const target = argv[0] || "claude";

try {
  switch (target) {
    case "claude":
      uninstallClaude();
      break;
    case "gongfeng-copilot":
    case "gongfeng":
      uninstallGongfeng();
      break;
    case "all-agents":
      uninstallAllAgents();
      break;
    case "all":
      uninstallAllAgents();
      console.log("");
      uninstallGongfeng();
      break;
    default:
      console.error(`Unknown target: ${target}`);
      printHelp();
      process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
