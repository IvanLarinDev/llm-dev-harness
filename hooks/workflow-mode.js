#!/usr/bin/env node
// workflow-mode.js - single source of truth for the branch workflow mode.
//
// harness.config.json -> branchLifecycle.mode:
//   "pr"    (default) - feature branches + PR; commits on main are blocked.
//   "trunk"           - solo trunk-based flow; commits land on main directly,
//                       branches are reserved for large incompatible work.
// A missing, unreadable, or unknown mode falls back to "pr" (fail-closed).

const fs = require("fs");
const path = require("path");

function workflowMode(root) {
  try {
    const file = path.join(String(root || process.cwd()), "harness.config.json");
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    const mode = String(((cfg || {}).branchLifecycle || {}).mode || "pr").trim();
    return mode === "trunk" ? "trunk" : "pr";
  } catch {
    return "pr";
  }
}

function isTrunk(root) {
  return workflowMode(root) === "trunk";
}

module.exports = { workflowMode, isTrunk };
