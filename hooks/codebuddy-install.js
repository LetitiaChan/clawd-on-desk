#!/usr/bin/env node
// Merge Clawd CodeBuddy hooks into ~/.codebuddy/settings.json (append-only, idempotent)
// CodeBuddy uses Claude Code-compatible hook format: { matcher, hooks: [{ type, command }] }

const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveNodeBin } = require("./server-config");
const { writeJsonAtomic, asarUnpackedPath, extractExistingNodeBin } = require("./json-utils");
const MARKER = "codebuddy-hook.js";
const HTTP_MARKER = "/permission";
const DEFAULT_PARENT_DIR = path.join(os.homedir(), ".codebuddy");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_PARENT_DIR, "settings.json");

// CodeBuddy supported hook events (as of v1.16+).
// NOTE: CodeBuddy IDE has NO dedicated `PermissionRequest` event. Permission
// approval is carried by `PreToolUse`'s `permissionDecision` (allow/deny/ask):
// codebuddy-hook.js intercepts PreToolUse payloads whose
// `tool_input.requires_approval === true` and forwards them to Clawd's
// /permission endpoint. Registering a `PermissionRequest` hook here (command or
// HTTP) is dead config — the IDE never fires it. Any such entry left over from
// older installs is scrubbed by cleanupStalePermissionRequestHooks() below.
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

// Remove Clawd-owned entries under the non-existent `PermissionRequest` event
// (both our command hook and the legacy HTTP /permission hook). Older installs
// wired permission approval to this event, which CodeBuddy never triggers.
// Returns the number of removed entries.
function cleanupStalePermissionRequestHooks(settings) {
  const entries = settings.hooks && settings.hooks.PermissionRequest;
  if (!Array.isArray(entries)) return 0;

  let removed = 0;
  const kept = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") { kept.push(entry); continue; }

    if (typeof entry.command === "string" && entry.command.includes(MARKER)) { removed++; continue; }
    if (entry.type === "http" && typeof entry.url === "string" && entry.url.includes(HTTP_MARKER)) { removed++; continue; }

    if (Array.isArray(entry.hooks)) {
      const keptInner = entry.hooks.filter((h) => {
        if (h && typeof h.command === "string" && h.command.includes(MARKER)) { removed++; return false; }
        if (h && h.type === "http" && typeof h.url === "string" && h.url.includes(HTTP_MARKER)) { removed++; return false; }
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
 * @param {object} [options]
 * @param {boolean} [options.silent]
 * @param {string} [options.settingsPath]
 * @returns {{ added: number, skipped: number, updated: number }}
 */
function registerCodeBuddyHooks(options = {}) {
  const settingsPath = options.settingsPath || path.join(os.homedir(), ".codebuddy", "settings.json");

  // Skip if ~/.codebuddy/ doesn't exist (CodeBuddy not installed)
  const codebuddyDir = path.dirname(settingsPath);
  if (!options.settingsPath && !fs.existsSync(codebuddyDir)) {
    if (!options.silent) console.log("Clawd: ~/.codebuddy/ not found — skipping CodeBuddy hook registration");
    return { added: 0, skipped: 0, updated: 0 };
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

  // Heal older installs that wired permission approval to the non-existent
  // `PermissionRequest` event. Those command / HTTP hooks never fire, so drop them.
  const removedStale = cleanupStalePermissionRequestHooks(settings);
  if (removedStale > 0) changed = true;

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
