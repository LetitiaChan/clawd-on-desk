"use strict";

const {
  AGENT_FLAGS,
  CODEX_PERMISSION_MODES,
} = require("./prefs");
const { getCodexPermissionMode, isAgentEnabled } = require("./agent-gate");
const {
  requireBoolean,
  requireString,
} = require("./settings-validators");

const AUTO_REPAIRABLE_AGENT_IDS = new Set([
  "claude-code",
  "codex",
  "cursor-agent",
  "gemini-cli",
  "codebuddy",
  "kiro-cli",
  "kimi-cli",
  "opencode",
  "hermes",
]);

// setAgentFlag is atomic single-agent, single-flag toggle.
// Payload `{ agentId, flag, value }` where flag is in AGENT_FLAGS.
const _validateAgentFlagId = requireString("setAgentFlag.agentId");
const _validateAgentFlagValue = requireBoolean("setAgentFlag.value");
const _validateRepairAgentId = requireString("repairAgentIntegration.agentId");

function setAgentFlag(payload, deps) {
  if (!payload || typeof payload !== "object") {
    return { status: "error", message: "setAgentFlag: payload must be an object" };
  }
  const { agentId, flag, value } = payload;
  const idCheck = _validateAgentFlagId(agentId);
  if (idCheck.status !== "ok") return idCheck;
  if (typeof flag !== "string" || !AGENT_FLAGS.includes(flag)) {
    return {
      status: "error",
      message: `setAgentFlag.flag must be one of: ${AGENT_FLAGS.join(", ")}`,
    };
  }
  const valueCheck = _validateAgentFlagValue(value);
  if (valueCheck.status !== "ok") return valueCheck;
  const snapshot = deps && deps.snapshot;
  const currentAgents = (snapshot && snapshot.agents) || {};
  const currentEntry = currentAgents[agentId];
  const currentValue =
    currentEntry && typeof currentEntry[flag] === "boolean" ? currentEntry[flag] : true;
  if (currentValue === value) {
    return { status: "ok", noop: true };
  }

  try {
    if (flag === "enabled") {
      if (!value) {
        if (agentId === "claude-code" && typeof deps.stopIntegrationForAgent === "function") {
          deps.stopIntegrationForAgent(agentId);
        }
        if (typeof deps.stopMonitorForAgent === "function") deps.stopMonitorForAgent(agentId);
        if (typeof deps.clearSessionsByAgent === "function") deps.clearSessionsByAgent(agentId);
        if (typeof deps.dismissPermissionsByAgent === "function") deps.dismissPermissionsByAgent(agentId);
      } else {
        if (typeof deps.syncIntegrationForAgent === "function") deps.syncIntegrationForAgent(agentId);
        if (typeof deps.startMonitorForAgent === "function") deps.startMonitorForAgent(agentId);
      }
    } else if (flag === "permissionsEnabled") {
      if (!value && typeof deps.dismissPermissionsByAgent === "function") {
        deps.dismissPermissionsByAgent(agentId);
      }
    }
  } catch (err) {
    return {
      status: "error",
      message: `setAgentFlag side effect threw: ${err && err.message}`,
    };
  }

  const nextEntry = { ...(currentEntry || {}), [flag]: value };
  const nextAgents = { ...currentAgents, [agentId]: nextEntry };
  return { status: "ok", commit: { agents: nextAgents } };
}

const _validateAgentPermissionModeId = requireString("setAgentPermissionMode.agentId");

function setAgentPermissionMode(payload, deps) {
  if (!payload || typeof payload !== "object") {
    return { status: "error", message: "setAgentPermissionMode: payload must be an object" };
  }
  const idCheck = _validateAgentPermissionModeId(payload.agentId);
  if (idCheck.status !== "ok") return idCheck;
  if (payload.agentId !== "codex") {
    return { status: "error", message: "setAgentPermissionMode only supports codex" };
  }
  if (!CODEX_PERMISSION_MODES.includes(payload.mode)) {
    return {
      status: "error",
      message: `setAgentPermissionMode.mode must be one of: ${CODEX_PERMISSION_MODES.join(", ")}`,
    };
  }

  const snapshot = deps && deps.snapshot;
  const currentAgents = (snapshot && snapshot.agents) || {};
  const currentEntry = currentAgents.codex || {};
  const currentMode = getCodexPermissionMode({ agents: currentAgents });
  if (currentMode === payload.mode) return { status: "ok", noop: true };

  try {
    if (payload.mode !== "intercept" && typeof deps.dismissPermissionsByAgent === "function") {
      deps.dismissPermissionsByAgent("codex");
    }
  } catch (err) {
    return {
      status: "error",
      message: `setAgentPermissionMode side effect threw: ${err && err.message}`,
    };
  }

  const nextAgents = {
    ...currentAgents,
    codex: { ...currentEntry, permissionMode: payload.mode },
  };
  return { status: "ok", commit: { agents: nextAgents } };
}

async function repairAgentIntegration(payload, deps) {
  const agentId = typeof payload === "string" ? payload : payload && payload.agentId;
  const idCheck = _validateRepairAgentId(agentId);
  if (idCheck.status !== "ok") return idCheck;
  if (
    payload
    && typeof payload === "object"
    && Object.prototype.hasOwnProperty.call(payload, "forceCodexHooksFeature")
    && typeof payload.forceCodexHooksFeature !== "boolean"
  ) {
    return { status: "error", message: "repairAgentIntegration.forceCodexHooksFeature must be a boolean" };
  }
  const forceCodexHooksFeature =
    !!(payload && typeof payload === "object" && payload.forceCodexHooksFeature === true);

  if (!AUTO_REPAIRABLE_AGENT_IDS.has(agentId)) {
    return {
      status: "error",
      message: agentId === "copilot-cli"
        ? "Copilot CLI uses manual project-level hooks and cannot be auto-repaired"
        : `No automatic integration repair is available for ${agentId}`,
    };
  }

  const snapshot = deps && deps.snapshot;
  if (!isAgentEnabled(snapshot, agentId)) {
    return {
      status: "error",
      message: `${agentId} is disabled in Settings; enable it before repairing the integration`,
    };
  }

  if (agentId === "claude-code" && snapshot && snapshot.manageClaudeHooksAutomatically === false) {
    return {
      status: "error",
      message: "Claude hook management is disabled in Settings",
    };
  }

  const repairFn =
    deps && typeof deps.repairIntegrationForAgent === "function"
      ? deps.repairIntegrationForAgent
      : deps && typeof deps.syncIntegrationForAgent === "function"
        ? deps.syncIntegrationForAgent
        : null;
  if (!repairFn) {
    return {
      status: "error",
      message: "repairAgentIntegration requires repairIntegrationForAgent or syncIntegrationForAgent dep",
    };
  }

  try {
    const result = await repairFn(agentId, {
      forceCodexHooksFeature: agentId === "codex" && forceCodexHooksFeature,
    });
    if (result === false) {
      return { status: "error", message: `No automatic integration repair is available for ${agentId}` };
    }
    if (result && typeof result === "object" && result.status && result.status !== "ok") {
      return {
        status: "error",
        message: result.message || `Failed to repair ${agentId}`,
      };
    }
    return {
      status: "ok",
      message: result && typeof result === "object" && result.message
        ? result.message
        : `Repaired ${agentId}`,
    };
  } catch (err) {
    return {
      status: "error",
      message: `repairAgentIntegration: ${err && err.message}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// gongfeng-copilot wizard generators
//
// Unlike other agents, gongfeng-copilot's hooks.json is cloud-synced —
// Clawd cannot write it directly and must walk the user through pasting
// 11 hook snippets via the plugin UI. The wizard HTML is the bridge.
// These two actions just regenerate the HTML files (snippets / uninstall
// list) and return the on-disk path. The renderer then opens it via
// settingsAPI.openLocalFile().
//
// Both actions are read-only with respect to settings store — they do
// not produce a `commit`, so the IPC layer simply forwards the metadata
// (status / outputPath / found / total) back to the renderer.
// ─────────────────────────────────────────────────────────────────────────

function generateGongfengCopilotWizard() {
  let prepareGongfengCopilotSnippets;
  let generateHtmlWizard;
  try {
    ({ prepareGongfengCopilotSnippets, generateHtmlWizard } = require("../hooks/gongfeng-copilot-install.js"));
  } catch (err) {
    return {
      status: "error",
      message: `generateGongfengCopilotWizard: failed to load helpers: ${err && err.message}`,
    };
  }

  let result;
  try {
    result = prepareGongfengCopilotSnippets({ silent: true });
  } catch (err) {
    return {
      status: "error",
      message: `generateGongfengCopilotWizard: ${err && err.message}`,
    };
  }

  if (!result || result.status === "plugin_not_installed") {
    return {
      status: "error",
      reason: "plugin_not_installed",
      message: "Gongfeng Copilot plugin is not installed (~/.gongfeng-copilot/ missing)",
    };
  }

  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const html = generateHtmlWizard(result);
    const outputDir = path.join(os.tmpdir(), "clawd-gongfeng");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "gongfeng-wizard.html");
    fs.writeFileSync(outputPath, html, "utf-8");
    return {
      status: "ok",
      outputPath,
      configured: (result.existing && result.existing.found) || 0,
      total: 11,
    };
  } catch (err) {
    return {
      status: "error",
      message: `generateGongfengCopilotWizard: write failed: ${err && err.message}`,
    };
  }
}

function generateGongfengCopilotUninstallWizard() {
  let prepareGongfengCopilotUninstall;
  try {
    ({ prepareGongfengCopilotUninstall } = require("../hooks/gongfeng-copilot-uninstall.js"));
  } catch (err) {
    return {
      status: "error",
      message: `generateGongfengCopilotUninstallWizard: failed to load helpers: ${err && err.message}`,
    };
  }

  try {
    const path = require("path");
    const os = require("os");
    const outputDir = path.join(os.tmpdir(), "clawd-gongfeng");
    const outputPath = path.join(outputDir, "gongfeng-uninstall.html");
    const result = prepareGongfengCopilotUninstall({
      silent: true,
      writeHtml: true,
      output: outputPath,
    });
    if (!result || result.status === "plugin_not_installed") {
      return {
        status: "error",
        reason: "plugin_not_installed",
        message: "Gongfeng Copilot plugin is not installed (~/.gongfeng-copilot/ missing)",
      };
    }
    return {
      status: "ok",
      outputPath: result.outputPath || outputPath,
      found: result.found || 0,
    };
  } catch (err) {
    return {
      status: "error",
      message: `generateGongfengCopilotUninstallWizard: ${err && err.message}`,
    };
  }
}

module.exports = {
  setAgentFlag,
  setAgentPermissionMode,
  repairAgentIntegration,
  generateGongfengCopilotWizard,
  generateGongfengCopilotUninstallWizard,
};
