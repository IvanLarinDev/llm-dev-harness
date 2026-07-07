#!/usr/bin/env node
// verify.js — executable, multi-stack VERIFY runner (BACKLOG P1-8).
//
// Makes AGENTS.md step 4 (VERIFY) an actual command instead of prose. Auto-detects
// which stacks live in the repo by marker files and runs lint -> build -> test for
// each, fail-fast, with warnings-as-errors defaults. Covers the user's stacks:
//   Python/Qt (ruff + pytest), C#/WPF (dotnet format/build -warnaserror/test),
//   Rust/Tauri (cargo fmt + clippy -D warnings + test; Tauri = node front + rust back),
//   Node (npm lint/build/test).
//
// Usage:
//   node hooks/verify.js [--root <dir>] [--stack <id>] [--list] [--json]
//     --list   detect + print the plan, do not run
//     --stack  run only the named stack
//     --root   repo root (default: cwd)
//
// Config: harness.config.json -> "verify". If "verify.stacks" is present it REPLACES
// the auto-detected defaults (explicit control); otherwise DEFAULT_STACKS are used.
//
// Exit 0 = all steps passed (or nothing to verify), exit 1 = a required step failed.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ---------- defaults (warnings-as-errors baked in) ----------
const DEFAULT_STACKS = [
  { id: "rust", markers: ["Cargo.toml"], steps: [
    { name: "fmt", run: "cargo fmt --all --check" },
    { name: "clippy", run: "cargo clippy --all-targets --all-features -- -D warnings" },
    { name: "test", run: "cargo test --all" },
  ] },
  { id: "dotnet", markers: ["*.sln", "*.csproj"], steps: [
    { name: "format", run: "dotnet format --verify-no-changes", optional: true },
    { name: "build", run: "dotnet build --nologo -warnaserror" },
    { name: "test", run: "dotnet test --nologo" },
  ] },
  { id: "python", markers: ["pyproject.toml", "requirements.txt", "setup.py"], steps: [
    { name: "lint", run: "ruff check ." },
    { name: "format", run: "ruff format --check .", optional: true },
    { name: "test", run: "pytest -q" },
  ] },
  { id: "node", markers: ["package.json"], steps: [
    { name: "lint", run: "npm run lint --if-present" },
    { name: "build", run: "npm run build --if-present" },
    { name: "test", run: "npm test --if-present" },
  ] },
];

const SKIP_DIRS = new Set([".git", "node_modules", "target", "bin", "obj", "dist", "build", ".venv", "venv", "__pycache__", ".next", ".idea", ".vscode"]);
const MAX_DEPTH = 6;

// ---------- args ----------
function parseArgs(argv) {
  const a = { root: process.cwd(), stack: null, list: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") a.root = argv[++i];
    else if (argv[i] === "--stack") a.stack = argv[++i];
    else if (argv[i] === "--list") a.list = true;
    else if (argv[i] === "--json") a.json = true;
  }
  return a;
}

// ---------- config ----------
function loadStacks(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "harness.config.json"), "utf8"));
    if (cfg.verify && Array.isArray(cfg.verify.stacks) && cfg.verify.stacks.length) {
      return { stacks: cfg.verify.stacks, failFast: cfg.verify.failFast !== false, explicit: true };
    }
    return { stacks: DEFAULT_STACKS, failFast: !(cfg.verify && cfg.verify.failFast === false), explicit: false };
  } catch {
    return { stacks: DEFAULT_STACKS, failFast: true, explicit: false };
  }
}

// ---------- filename glob (within a directory) ----------
function fnMatch(pattern, name) {
  if (pattern === name) return true;
  const re = "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$";
  return new RegExp(re).test(name);
}

// ---------- detect: dirs that contain a stack's marker ----------
function detect(root, stacks) {
  const found = []; // {stack, dir(abs), rel}
  function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const names = entries.filter((e) => e.isFile()).map((e) => e.name);
    for (const s of stacks) {
      const markers = s.markers || [];
      if (markers.some((m) => names.some((n) => fnMatch(m, n)))) {
        found.push({ stack: s, dir, rel: path.relative(root, dir) || "." });
      }
    }
    if (depth >= MAX_DEPTH) return;
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1);
  }
  walk(root, 0);
  return found;
}

// ---------- run ----------
function runStep(step, cwd) {
  const r = spawnSync(step.run, { cwd, shell: true, stdio: "inherit" });
  if (r.error) return { ok: false, code: -1, notFound: r.error.code === "ENOENT" };
  return { ok: r.status === 0, code: r.status };
}

// ---------- main ----------
(function main() {
  const a = parseArgs(process.argv.slice(2));
  let { stacks, failFast, explicit } = loadStacks(a.root);
  if (a.stack) stacks = stacks.filter((s) => s.id === a.stack);

  const targets = detect(a.root, stacks);

  if (a.list) {
    const plan = targets.map((t) => ({ stack: t.stack.id, dir: t.rel, steps: (t.stack.steps || []).map((s) => s.name) }));
    if (a.json) console.log(JSON.stringify({ explicit, plan }));
    else {
      console.log(`design of VERIFY (${explicit ? "config" : "auto-detect"}):`);
      if (!plan.length) console.log("  (стеки не обнаружены)");
      for (const p of plan) console.log(`  • ${p.stack} @ ${p.dir}: ${p.steps.join(" → ")}`);
    }
    process.exit(0);
  }

  if (!targets.length) {
    console.log("✅ verify: стеки не обнаружены — проверять нечего.");
    process.exit(0);
  }

  let failed = null;
  const summary = [];
  outer:
  for (const t of targets) {
    for (const step of t.stack.steps || []) {
      const label = `${t.stack.id}/${step.name} @ ${t.rel}`;
      console.log(`\n▶ ${label}: ${step.run}`);
      const res = runStep(step, t.dir);
      if (res.ok) { summary.push(`✓ ${label}`); continue; }
      if (res.notFound || res.code === 9009 || res.code === 127) {
        if (step.optional) { summary.push(`⚠ ${label} (инструмент не найден — пропущено)`); continue; }
        summary.push(`✗ ${label} (инструмент не найден)`);
        failed = `${label}: команда не найдена — установи инструмент или переопредели шаг в harness.config.json`;
        if (failFast) break outer; else continue;
      }
      if (step.optional) { summary.push(`⚠ ${label} (optional, exit ${res.code})`); continue; }
      summary.push(`✗ ${label} (exit ${res.code})`);
      failed = `${label}: exit ${res.code}`;
      if (failFast) break outer;
    }
  }

  console.log("\n— verify summary —");
  for (const s of summary) console.log("  " + s);
  if (failed) { console.error(`\n❌ VERIFY failed: ${failed}`); process.exit(1); }
  console.log("\n✅ VERIFY passed.");
  process.exit(0);
})();
