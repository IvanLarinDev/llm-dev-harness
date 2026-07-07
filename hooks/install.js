#!/usr/bin/env node
// install.js — one-shot installer for the git-native enforcement layer.
// Points git at hooks/git via core.hooksPath and marks the hooks executable.
// This is what makes the harness LLM-agnostic: once installed, commit-msg /
// pre-commit / pre-push fire for ANY agent or human that runs git in this repo.
//
// Usage:  node hooks/install.js
// Undo:   git config --unset core.hooksPath
//
// The agent-adapter layer (hooks/agent/*) is optional and wired separately per
// runtime — see settings.example.json for a Claude Code example.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoHooks = path.join(__dirname, "git");
const GIT_HOOKS = ["commit-msg", "pre-commit", "pre-push"];

function run(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

try {
  // Resolve repo root and compute a repo-relative hooksPath (git wants it relative
  // to the repo root, forward slashes on every platform).
  const root = run("git rev-parse --show-toplevel");
  let rel = path.relative(root, repoHooks).split(path.sep).join("/");
  if (!rel) rel = "hooks/git";

  run(`git config core.hooksPath "${rel}"`);

  // chmod +x (no-op semantics on Windows, required on POSIX).
  for (const h of GIT_HOOKS) {
    const p = path.join(repoHooks, h);
    if (fs.existsSync(p)) {
      try { fs.chmodSync(p, 0o755); } catch {}
    }
  }

  console.log("✅ git-native hooks installed.");
  console.log(`   core.hooksPath = ${rel}`);
  console.log(`   active: ${GIT_HOOKS.join(", ")}`);
  console.log("");
  console.log("Notes:");
  console.log("  • Windows: hooks run via Git-for-Windows bash; Node must be on PATH.");
  console.log("  • Release/hotfix commit on main:  HARNESS_ALLOW_MAIN=1 git commit ...");
  console.log("  • Emergency bypass (audited):      git commit --no-verify / git push --no-verify");
  console.log("  • Agent-loop guards (optional):    wire hooks/agent/* per settings.example.json");
} catch (e) {
  console.error("❌ install failed:", e.message);
  console.error("   Run this inside the git repository you want to protect.");
  process.exit(1);
}
