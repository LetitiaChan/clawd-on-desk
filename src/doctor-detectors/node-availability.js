"use strict";

const { execFileSync } = require("child_process");

/**
 * Doctor check: is Node.js available for hook execution?
 *
 * On macOS/Linux, resolveNodeBin() returns an absolute path or null.
 * On Windows, it always returns bare "node" — so we additionally verify
 * via `where node` that it's actually in PATH.
 *
 * @param {object} [options]
 * @param {Function} [options.resolveNodeBin] - override for testing
 * @param {string} [options.platform] - override for testing
 * @param {Function} [options.execFileSync] - override for testing
 * @returns {object} doctor check result
 */
function checkNodeAvailability(options = {}) {
  const platform = options.platform || process.platform;
  const resolve = options.resolveNodeBin || require("../../hooks/server-config").resolveNodeBin;
  const execSync = options.execFileSync || execFileSync;

  let nodeBin;
  try {
    nodeBin = resolve({ platform });
  } catch {
    nodeBin = null;
  }

  // macOS/Linux: null means detection failed
  if (platform !== "win32" && !nodeBin) {
    return {
      id: "node-availability",
      status: "fail",
      level: "warning",
      detail: "Node.js not found in well-known paths or login shell",
      textHint: "doctorNodeMissingHint",
      nodeBin: null,
    };
  }

  // Windows: resolveNodeBin always returns "node" — verify it's actually in PATH
  if (platform === "win32") {
    const found = verifyNodeInPath(execSync);
    if (!found) {
      return {
        id: "node-availability",
        status: "fail",
        level: "warning",
        detail: "Node.js not found in PATH (where node failed)",
        textHint: "doctorNodeMissingHint",
        nodeBin: null,
      };
    }
    // `where node` succeeded — use the path it returned
    nodeBin = found;
  }

  return {
    id: "node-availability",
    status: "pass",
    level: null,
    detail: `Node.js detected: ${nodeBin}`,
    nodeBin,
  };
}

/**
 * On Windows, run `where node` to verify node is actually in PATH.
 * Returns the first found path, or null if not found.
 */
function verifyNodeInPath(execSync) {
  try {
    const output = execSync("where", ["node"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    const firstLine = String(output || "").split(/\r?\n/).find((l) => l.trim());
    return firstLine ? firstLine.trim() : null;
  } catch {
    return null;
  }
}

module.exports = { checkNodeAvailability };
