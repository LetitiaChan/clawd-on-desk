#!/usr/bin/env node
// Merge Clawd CodeBuddy hooks into ~/.codebuddy/settings.json (append-only, idempotent)
// CodeBuddy uses Claude Code-compatible hook format: { matcher, hooks: [{ type, command }] }

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  resolveNodeBin,
  buildPermissionUrl,
  readRuntimePort,
  DEFAULT_SERVER_PORT,
  SERVER_PORTS,
  PERMISSION_PATH,
} = require("./server-config");
const { writeJsonAtomic, asarUnpackedPath, extractExistingNodeBin } = require("./json-utils");
const MARKER = "codebuddy-hook.js";
const HTTP_MARKER = PERMISSION_PATH; // "/permission"
const DEFAULT_PARENT_DIR = path.join(os.homedir(), ".codebuddy");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_PARENT_DIR, "settings.json");

// `codebuddy` ships two distinct runtimes that BOTH read ~/.codebuddy/settings.json,
// with two different permission-approval mechanisms:
//
//   1. CodeBuddy IDE (腾讯云代码助手扩展) — has NO dedicated `PermissionRequest`
//      event. Approval is carried by `PreToolUse`'s `permissionDecision`
//      (allow/deny/ask): the IDE sets `tool_input.requires_approval === true` on
//      payloads it wants confirmed, and codebuddy-hook.js intercepts exactly those
//      and forwards them to Clawd's /permission endpoint. (In practice
//      `requires_approval` exists ONLY on the `execute_command` tool schema —
//      the delete tool (`delete_file`) and other file-change tools are gated by
//      the IDE's own diff/approve UI and never carry it — and even for
//      `execute_command` the built-in TerminalExecutor usually confirms BEFORE
//      the hook fires, so this path is best-effort only.)
//
//   2. `codebuddy` CLI (= a Claude Code fork, @tencent-ai/codebuddy-code) — is
//      standard Claude Code and DOES fire a real `PermissionRequest` hook before a
//      tool that needs approval runs (primarily Bash). We register it as a blocking
//      HTTP hook pointing at Clawd's /permission endpoint, exactly like the Claude
//      Code integration (hooks/install.js HTTP_HOOKS).
//
// The `PermissionRequest` HTTP hook is harmless dead config in the IDE (which never
// fires it) and the enabling mechanism for the CLI. Both paths converge on the same
// /permission endpoint. Older installs that wired a *command* hook to
// `PermissionRequest` (which neither runtime uses) are scrubbed by
// cleanupStalePermissionRequestCommandHooks() below.
const CODEBUDDY_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "Notification",
  "PreCompact",
];

// HTTP hooks: PermissionRequest uses a bidirectional (blocking) HTTP hook for
// permission decisions. Fired by the `codebuddy` CLI (Claude Code fork) for tools
// needing approval (primarily Bash); dead config in the IDE. Mirrors the Claude
// Code integration's HTTP_HOOKS.
const HTTP_HOOKS = {
  PermissionRequest: {
    matcher: "",
    hook: {
      type: "http",
      url: `http://127.0.0.1:${DEFAULT_SERVER_PORT}${HTTP_MARKER}`,
      timeout: 600,
    },
  },
};

function getHookServerPort(explicitPort) {
  return Number.isInteger(explicitPort) ? explicitPort : (readRuntimePort() || DEFAULT_SERVER_PORT);
}

// Is `url` a Clawd /permission endpoint on one of our loopback ports?
function isClawdPermissionUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return parsed.protocol === "http:"
      && parsed.hostname === "127.0.0.1"
      && parsed.pathname === HTTP_MARKER
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.username === ""
      && parsed.password === ""
      && Number.isInteger(port)
      && SERVER_PORTS.includes(port);
  } catch {
    return false;
  }
}

function isClawdPermissionHook(entry) {
  return !!entry
    && typeof entry === "object"
    && entry.type === "http"
    && typeof entry.url === "string"
    && isClawdPermissionUrl(entry.url);
}

// Find Clawd's PermissionRequest HTTP hook (flat or nested) and reconcile its URL
// to `expectedUrl` (e.g. when the runtime port changed). Returns whether one was
// found and whether it changed.
function syncPermissionHttpHook(entries, expectedUrl) {
  let found = false;
  let changed = false;
  if (!Array.isArray(entries)) return { found, changed };
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (isClawdPermissionHook(entry)) {
      found = true;
      if (entry.url !== expectedUrl) { entry.url = expectedUrl; changed = true; }
    }
    if (!Array.isArray(entry.hooks)) continue;
    for (const h of entry.hooks) {
      if (!isClawdPermissionHook(h)) continue;
      found = true;
      if (h.url !== expectedUrl) { h.url = expectedUrl; changed = true; }
    }
  }
  return { found, changed };
}

// Remove ONLY Clawd-owned *command* hooks mistakenly registered under
// `PermissionRequest` by older installs (neither the IDE nor the CLI fires a
// command hook for that event — the CLI uses the HTTP hook below). Third-party
// entries and Clawd's own PermissionRequest HTTP hook are preserved.
// Returns the number of removed entries.
function cleanupStalePermissionRequestCommandHooks(settings) {
  const entries = settings.hooks && settings.hooks.PermissionRequest;
  if (!Array.isArray(entries)) return 0;

  let removed = 0;
  const kept = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") { kept.push(entry); continue; }

    if (typeof entry.command === "string" && entry.command.includes(MARKER)) { removed++; continue; }

    if (Array.isArray(entry.hooks)) {
      const keptInner = entry.hooks.filter((h) => {
        if (h && typeof h.command === "string" && h.command.includes(MARKER)) { removed++; return false; }
        return true;
      });
      if (keptInner.length > 0) { entry.hooks = keptInner; kept.push(entry); }
      continue;
    }

    kept.push(entry);
  }

  if (kept.length > 0) settings.hooks.PermissionRequest = kept;
  else delete settings.hooks.PermissionRequest;
  return removed;
}

/**
 * Register Clawd hooks into ~/.codebuddy/settings.json
 * Uses Claude Code-compatible nested format: { matcher, hooks: [{ type, command }] }
 * Registers command hooks for state events + a blocking PermissionRequest HTTP hook
 * (used by the codebuddy CLI; dead config in the IDE).
 * @param {object} [options]
 * @param {boolean} [options.silent]
 * @param {string} [options.settingsPath]
 * @param {number} [options.port] - server port for the PermissionRequest HTTP hook URL
 * @returns {{ added: number, skipped: number, updated: number, removed: number }}
 */
function registerCodeBuddyHooks(options = {}) {
  const settingsPath = options.settingsPath || path.join(os.homedir(), ".codebuddy", "settings.json");
  const hookPort = getHookServerPort(options.port);

  // Skip if ~/.codebuddy/ doesn't exist (CodeBuddy not installed)
  const codebuddyDir = path.dirname(settingsPath);
  if (!options.settingsPath && !fs.existsSync(codebuddyDir)) {
    if (!options.silent) console.log("Clawd: ~/.codebuddy/ not found — skipping CodeBuddy hook registration");
    return { added: 0, skipped: 0, updated: 0, removed: 0 };
  }

  const hookScript = asarUnpackedPath(path.resolve(__dirname, "codebuddy-hook.js").replace(/\\/g, "/"));

  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new Error(`Failed to read settings.json: ${err.message}`);
    }
  }

  // Resolve node path; if detection fails, preserve existing absolute path
  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved
    || extractExistingNodeBin(settings, MARKER, { nested: true })
    || "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;

  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};

  let added = 0;
  let skipped = 0;
  let updated = 0;
  let changed = false;

  for (const event of CODEBUDDY_HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
      changed = true;
    }

    const arr = settings.hooks[event];
    let found = false;
    let stalePath = false;

    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      // Check nested hooks array (Claude Code format)
      const innerHooks = entry.hooks;
      if (Array.isArray(innerHooks)) {
        for (const h of innerHooks) {
          if (!h || !h.command) continue;
          if (!h.command.includes(MARKER)) continue;
          found = true;
          if (h.command !== desiredCommand) {
            h.command = desiredCommand;
            stalePath = true;
          }
          break;
        }
      }
      // Also check flat format for migration
      if (!found && entry.command && entry.command.includes(MARKER)) {
        found = true;
        if (entry.command !== desiredCommand) {
          entry.command = desiredCommand;
          stalePath = true;
        }
      }
      if (found) break;
    }

    if (found) {
      if (stalePath) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
      continue;
    }

    // Add in Claude Code-compatible nested format
    arr.push({
      matcher: "",
      hooks: [{ type: "command", command: desiredCommand }],
    });
    added++;
    changed = true;
  }

  // Heal older installs that wired permission approval to a *command* hook under
  // `PermissionRequest`. Neither the IDE nor the CLI fires such a command hook, so
  // drop it (the CLI path is served by the HTTP hook registered below).
  const removedStale = cleanupStalePermissionRequestCommandHooks(settings);
  if (removedStale > 0) changed = true;

  // Register the blocking PermissionRequest HTTP hook (CLI path; dead config in IDE).
  for (const [event, { matcher, hook }] of Object.entries(HTTP_HOOKS)) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
      changed = true;
    }

    const desiredUrl = buildPermissionUrl(hookPort);
    const httpSync = syncPermissionHttpHook(settings.hooks[event], desiredUrl);
    if (httpSync.found) {
      if (httpSync.changed) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
      continue;
    }

    settings.hooks[event].push({ matcher, hooks: [{ ...hook, url: desiredUrl }] });
    added++;
    changed = true;
  }

  if (added > 0 || changed) {
    writeJsonAtomic(settingsPath, settings);
  }

  if (!options.silent) {
    console.log(`Clawd CodeBuddy hooks → ${settingsPath}`);
    console.log(`  Added: ${added}, updated: ${updated}, skipped: ${skipped}, removed(stale): ${removedStale}`);
  }

  return { added, skipped, updated, removed: removedStale };
}

/**
 * Unregister all Clawd hooks from ~/.codebuddy/settings.json
 * @param {object} [options]
 * @param {string} [options.settingsPath]
 * @returns {{ removed: number, changed: boolean }}
 */
function unregisterCodeBuddyHooks(options = {}) {
  const settingsPath = options.settingsPath || DEFAULT_CONFIG_PATH;
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return { removed: 0, changed: false };
    throw new Error(`Failed to read settings.json: ${err.message}`);
  }

  if (!settings.hooks || typeof settings.hooks !== "object") {
    return { removed: 0, changed: false };
  }

  let removed = 0;
  let changed = false;

  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) continue;

    const nextEntries = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") { nextEntries.push(entry); continue; }

      // Check flat command format
      if (typeof entry.command === "string" && entry.command.includes(MARKER)) {
        removed++;
        changed = true;
        continue;
      }

      // Check nested hooks array
      if (Array.isArray(entry.hooks)) {
        const nextHooks = [];
        for (const h of entry.hooks) {
          if (h && typeof h.command === "string" && h.command.includes(MARKER)) {
            removed++;
            changed = true;
          } else if (h && h.type === "http" && typeof h.url === "string" && h.url.includes(HTTP_MARKER)) {
            removed++;
            changed = true;
          } else {
            nextHooks.push(h);
          }
        }
        if (nextHooks.length > 0) {
          entry.hooks = nextHooks;
          nextEntries.push(entry);
        } else {
          // Entire entry is now empty — drop it
          changed = true;
        }
        continue;
      }

      // Check HTTP hook at entry level
      if (entry.type === "http" && typeof entry.url === "string" && entry.url.includes(HTTP_MARKER)) {
        removed++;
        changed = true;
        continue;
      }

      nextEntries.push(entry);
    }

    if (nextEntries.length > 0) {
      settings.hooks[event] = nextEntries;
    } else {
      delete settings.hooks[event];
    }
  }

  if (changed) {
    writeJsonAtomic(settingsPath, settings);
  }

  return { removed, changed };
}

module.exports = {
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  registerCodeBuddyHooks,
  unregisterCodeBuddyHooks,
  CODEBUDDY_HOOK_EVENTS,
  HTTP_HOOKS,
  isClawdPermissionHook,
  isClawdPermissionUrl,
};

if (require.main === module) {
  try {
    if (process.argv.includes("--uninstall")) {
      const { removed, changed } = unregisterCodeBuddyHooks({});
      console.log(`Clawd CodeBuddy hooks uninstall: removed=${removed}, changed=${changed}`);
    } else {
      registerCodeBuddyHooks({});
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
