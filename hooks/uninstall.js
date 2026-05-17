#!/usr/bin/env node
// Clawd uninstall entry point.
//
// Usage:
//   node hooks/uninstall.js                     # uninstall Claude hooks (default)
//   node hooks/uninstall.js gongfeng-copilot    # generate gongfeng-copilot uninstall wizard (HTML)
//   node hooks/uninstall.js all                 # both
//   node hooks/uninstall.js -h | --help

const argv = process.argv.slice(2);

function printHelp() {
  console.log([
    "Clawd uninstall",
    "",
    "Usage:",
    "  node hooks/uninstall.js                  Uninstall Claude hooks (default)",
    "  node hooks/uninstall.js gongfeng-copilot Generate gongfeng-copilot uninstall wizard",
    "  node hooks/uninstall.js all              Run both of the above",
    "  -h, --help                                Show this help",
    "",
    "Notes:",
    "  Gongfeng-Copilot's hooks.json is cloud-synced and not locally writable.",
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
    case "all":
      uninstallClaude();
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
