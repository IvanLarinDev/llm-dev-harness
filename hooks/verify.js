#!/usr/bin/env node
// verify.js - executable, multi-stack VERIFY runner (BACKLOG P1-8).
//
// Makes AGENTS.md step 4 (VERIFY) an actual command instead of prose. Auto-detects
// which stacks live in the repo by marker files and runs lint -> build -> test for
// each, fail-fast, with warnings-as-errors defaults. Covers the user's stacks:
//   Python/Qt (ruff + pytest), C#/WPF (dotnet format/build -warnaserror/test),
//   Rust/Tauri (cargo fmt + clippy -D warnings + test; Tauri = node front + rust back),
//   Node (npm lint/build/test).
//
// Usage:
//   node hooks/verify.js [--root <dir>] [--stack <id>] [--changed [--base <ref>]] [--list] [--json] [--strict-audit]
//     --list     detect + print the plan, do not run
//     --stack    run only the named stack
//     --root     repo root (default: cwd)
//     --changed  verify only stacks whose dir is touched in the branch diff (faster inner loop)
//     --base     git ref to diff against for --changed (default: main; fallback master/origin/HEAD)
//     --files    explicit comma-separated changed files (tests/CI; bypasses git)
//     --check-harness-syntax  internal lightweight JS syntax check for harness files
//     --strict-audit  fail VERIFY if the debug-audit cannot compute its changed-file scope
//   --changed fail-safe: if the diff can't be computed, verify ALL stacks (loud warn),
//   never silently skip verification; empty diff = nothing to verify.
//
// Config: harness.config.json -> "verify". If "verify.stacks" is present it REPLACES
// the auto-detected defaults (explicit control); otherwise DEFAULT_STACKS are used.
// Per-step: optional (missing tool -> skip), okCodes { "<exit>": "note" } - non-zero
// exits that are warnings, not failures (e.g. pytest 5 = no tests collected).
//
// Debug audit: runs alongside stack checks and scans only changed files for
// leftover debug statements. Hard markers fail VERIFY; soft markers are notes
// only when harness.config.json -> debugAudit.soft is true.
//
// Exit 0 = all steps passed (or nothing to verify), exit 1 = a required step failed
//          or the debug audit found a hard marker.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { workingTreeChangedFiles, globToRe } = require(path.join(__dirname, "_lib.js"));

// Does changed `file` belong to stack directory `rel`?
function fileUnder(rel, file) {
  const r = String(rel).replace(/\\/g, "/");
  const f = String(file).replace(/\\/g, "/");
  if (r === "." || r === "") return true;
  return f === r || f.startsWith(r + "/");
}

// ---------- debug-leftover audit (changed files only) ----------
// These markers should never be committed. Patterns are syntax-specific to avoid
// matching their own regex literals or string fixtures.
const DEBUG_HARD = [
  { ext: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"], re: /(?:^|[^.\w])debugger\s*;/, what: "debugger statement" },
  { ext: [".py"], re: /(?:^|[^.\w])breakpoint\s*\(\s*\)/, what: "breakpoint call" },
  { ext: [".py"], re: /(?:^|[^.\w])i?pdb\.set_trace\s*\(/, what: "pdb set_trace" },
  { ext: [".rs"], re: /(?:^|[^.\w])dbg!\s*\(/, what: "dbg macro" },
  { ext: [".cs"], re: /Debugger\.Break\s*\(/, what: "Debugger Break" },
];
const DEBUG_SOFT = [
  { ext: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"], re: /(?:^|[^.\w])console\.(?:log|debug)\s*\(/, what: "console.log/debug" },
  { ext: [".py"], re: /(?:^|[^.\w])print\s*\(/, what: "print()" },
];

// harness.config.json -> debugAudit defaults.
function loadDebugAudit(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "harness.config.json"), "utf8"));
    const d = cfg.debugAudit || {};
    return {
      enabled: d.enabled !== false,
      base: d.base || "main",
      soft: d.soft === true,
      exclude: Array.isArray(d.exclude) ? d.exclude : [],
      strict: d.strict === true,
    };
  } catch {
    return { enabled: true, base: "main", soft: false, exclude: [], strict: false };
  }
}

function maskQuotedSegments(line) {
  let out = "", quote = null, esc = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (esc) { esc = false; out += " "; continue; }
      if (ch === "\\") { esc = true; out += " "; continue; }
      if (ch === quote) { quote = null; out += ch; continue; }
      out += " ";
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; out += ch; continue; }
    out += ch;
  }
  return out;
}
function stripCommentTail(line, ext) {
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".rs", ".cs"].includes(ext)) return line.replace(/\/\/.*$/, "");
  if (ext === ".py") return line.replace(/#.*$/, "");
  return line;
}

// One file -> findings. Binary/large/unreadable files are skipped.
function scanFileForDebug(abs, rel, soft) {
  let text;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 1024 * 1024) return [];
    text = fs.readFileSync(abs, "utf8");
  } catch { return []; }
  if (text.includes(String.fromCharCode(0))) return [];
  const ext = path.extname(rel).toLowerCase();
  const softSet = new Set(DEBUG_SOFT);
  const markers = (soft ? DEBUG_HARD.concat(DEBUG_SOFT) : DEBUG_HARD).filter((m) => m.ext.includes(ext));
  if (!markers.length) return [];
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripCommentTail(maskQuotedSegments(lines[i]), ext);
    for (const m of markers) if (m.re.test(line)) hits.push({ rel, line: i + 1, what: m.what, soft: softSet.has(m) });
  }
  return hits;
}

// Audit changed files only. Unlike stack checks, debug audit does not scan the
// whole repository when diff scope is unavailable because console.log/print can
// be legitimate in existing code.
function debugAudit(root, opts, base, explicitFiles) {
  if (!opts.enabled) return { hard: [], soft: [], skipped: "disabled in harness.config.json" };
  const cf = workingTreeChangedFiles(base || opts.base, root, explicitFiles);
  if (cf.error) return { hard: [], soft: [], skipped: cf.error };
  const excludeRe = (opts.exclude || []).map(globToRe);
  const hard = [], soft = [];
  for (const f of cf.files) {
    const rel = String(f).replace(/\\/g, "/");
    if (excludeRe.some((re) => re.test(rel))) continue;
    for (const h of scanFileForDebug(path.join(root, rel), rel, opts.soft)) (h.soft ? soft : hard).push(h);
  }
  return { hard, soft, skipped: null };
}

// ---------- defaults (warnings-as-errors baked in) ----------
const DEFAULT_STACKS = [
  { id: "rust", markers: ["Cargo.toml"], steps: [
    { name: "fmt", run: "cargo fmt --all --check" },
    { name: "clippy", run: "cargo clippy --all-targets --all-features -- -D warnings" },
    { name: "test", run: "cargo test --all" },
  ] },
  { id: "dotnet", markers: ["*.sln", "*.csproj"], steps: [
    // Existing C# repos often need a one-time formatting migration. Keep the
    // default bootstrap gate warning-only; target repos can make this required
    // by overriding verify.stacks after the format baseline lands.
    { name: "format", run: "dotnet format --verify-no-changes", optional: true },
    { name: "build", run: "dotnet build --nologo -warnaserror" },
    { name: "test", run: "dotnet test --nologo" },
  ] },
  { id: "python", markers: ["pyproject.toml", "requirements.txt", "setup.py"], steps: [
    { name: "lint", run: "ruff check ." },
    { name: "format", run: "ruff format --check .", optional: true },
    // pytest exit 5 means no tests collected; warn instead of making new repos permanently red.
    { name: "test", run: "pytest -q", okCodes: { 5: "pytest: no tests collected; add at least a smoke test" } },
  ] },
  { id: "node", markers: ["package.json"], steps: [
    { name: "lint", run: "npm run lint --if-present" },
    { name: "build", run: "npm run build --if-present" },
    { name: "test", run: "npm test --if-present" },
  ] },
];

const SKIP_DIRS = new Set([".git", "node_modules", "target", "bin", "obj", "dist", "build", ".venv", "venv", "__pycache__", ".next", ".idea", ".vscode"]);
const MAX_DEPTH = 6;
const DEFAULT_STEP_TIMEOUT_MS = 15 * 60 * 1000;
const HARNESS_CHANGED = [
  "hooks/", "lefthook.yml", "harness.config.json", ".gitleaks.toml", "cog.toml",
  ".github/rulesets/", ".github/workflows/", "settings.example.json", "AGENTS.md",
];

// ---------- args ----------
function parseArgs(argv) {
  const a = { root: process.cwd(), stack: null, list: false, json: false, changed: false, base: "main", files: null, checkHarnessSyntax: false, strictAudit: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") a.root = argv[++i];
    else if (argv[i] === "--stack") a.stack = argv[++i];
    else if (argv[i] === "--list") a.list = true;
    else if (argv[i] === "--json") a.json = true;
    else if (argv[i] === "--changed") a.changed = true;
    else if (argv[i] === "--base") a.base = argv[++i];
    else if (argv[i] === "--files") a.files = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--check-harness-syntax") a.checkHarnessSyntax = true;
    else if (argv[i] === "--strict-audit") a.strictAudit = true;
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

function isHarnessChangedFile(file) {
  const f = String(file || "").replace(/\\/g, "/");
  return HARNESS_CHANGED.some((p) => p.endsWith("/") ? f.startsWith(p) : f === p);
}

function harnessTarget(root) {
  const steps = [];
  if (fs.existsSync(path.join(root, "hooks", "test.js"))) steps.push({ name: "self-test", run: "node test.js", cwdRel: "hooks" });
  return { stack: { id: "harness", steps }, dir: root, rel: "." };
}

function harnessSyntaxTarget(root) {
  return { stack: { id: "harness-syntax", steps: [{ name: "syntax", run: "node hooks/verify.js --check-harness-syntax" }] }, dir: root, rel: "." };
}

function ensureHarnessSyntaxTarget(root, targets) {
  if (!fs.existsSync(path.join(root, "hooks", "verify.js"))) return targets;
  if (targets.some((t) => t.stack && t.stack.id === "harness-syntax")) return targets;
  return targets.concat([harnessSyntaxTarget(root)]);
}

function isGitRepo(root) {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000, killSignal: "SIGKILL",
  });
  return r.status === 0 && String(r.stdout || "").trim() === "true";
}

function ensureGitHygieneTarget(root, targets) {
  if (!isGitRepo(root)) return targets;
  if (targets.some((t) => t.stack && t.stack.id === "git-hygiene")) return targets;
  return targets.concat([{ stack: { id: "git-hygiene", steps: [
    { name: "diff-check", run: "git diff --check && git diff --cached --check" },
  ] }, dir: root, rel: "." }]);
}

function maybeAddHarnessTarget(root, targets, files) {
  if (!files.some(isHarnessChangedFile)) return targets;
  if (!fs.existsSync(path.join(root, "hooks", "verify.js"))) return targets;
  targets = ensureHarnessSyntaxTarget(root, targets);
  if (!fs.existsSync(path.join(root, "hooks", "test.js"))) return targets;
  if (targets.some((t) => t.stack && t.stack.id === "harness")) return targets;
  return targets.concat([harnessTarget(root)]);
}

function listHarnessJs(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".js")) out.push(p);
    }
  }
  walk(path.join(root, "hooks"));
  for (const rel of ["install.js"]) {
    const p = path.join(root, rel);
    try { if (fs.statSync(p).isFile()) out.push(p); } catch {}
  }
  return out;
}

function checkHarnessSyntax(root) {
  const files = listHarnessJs(root);
  let failed = false;
  for (const file of files) {
    const r = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30 * 1000, killSignal: "SIGKILL" });
    if (r.status !== 0 || r.error) {
      failed = true;
      const rel = path.relative(root, file) || file;
      process.stderr.write(`syntax failed: ${rel}\n`);
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      if (r.error) process.stderr.write(String(r.error.message || r.error) + "\n");
    }
  }
  if (!files.length) console.log("harness syntax: no JS files found");
  else console.log(`harness syntax: checked ${files.length} JS file(s)`);
  process.exit(failed ? 1 : 0);
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
function stepTimeoutMs(step) {
  const raw = step.timeoutMs !== undefined ? step.timeoutMs : step.timeout;
  if (raw === undefined) return DEFAULT_STEP_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STEP_TIMEOUT_MS;
}
function stepCwd(step, cwd) {
  if (!step.cwdRel) return cwd;
  return path.resolve(cwd, step.cwdRel);
}
function runStep(step, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verify-step-"));
  const stdoutPath = path.join(dir, "stdout.log");
  const stderrPath = path.join(dir, "stderr.log");
  const outFd = fs.openSync(stdoutPath, "w");
  const errFd = fs.openSync(stderrPath, "w");
  let r;
  try {
    r = spawnSync(step.run, { cwd: stepCwd(step, cwd), shell: true, stdio: ["ignore", outFd, errFd], timeout: stepTimeoutMs(step), killSignal: "SIGKILL" });
  } finally {
    try { fs.closeSync(outFd); } catch {}
    try { fs.closeSync(errFd); } catch {}
  }
  if (r.error) return { ok: false, code: -1, notFound: r.error.code === "ENOENT", timedOut: r.error.code === "ETIMEDOUT", stdoutPath, stderrPath, cleanup: () => cleanupStepOutput(dir) };
  return { ok: r.status === 0, code: r.status, stdoutPath, stderrPath, cleanup: () => cleanupStepOutput(dir) };
}
function emitStepOutput(res) {
  for (const [file, stream] of [[res.stdoutPath, process.stdout], [res.stderrPath, process.stderr]]) {
    emitOutputFile(file, stream);
  }
}
function emitOutputFile(file, stream) {
  if (!file) return;
  let fd;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return;
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      stream.write(buf.subarray(0, n));
    }
  } catch {
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}
function diagnosticExcerpt(res, maxLines = 8) {
  const text = [res.stderrPath, res.stdoutPath].map((file) => readSmallOutputFile(file)).filter(Boolean).join("\n").trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.trim()).slice(0, maxLines);
  return lines.join("\n");
}
function readSmallOutputFile(file, maxBytes = 64 * 1024) {
  if (!file) return "";
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return "";
    if (st.size <= maxBytes) return fs.readFileSync(file, "utf8");
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return (start > 0 ? "[output truncated]\n" : "") + buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}
function cleanupStepOutput(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ---------- main ----------
(function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.checkHarnessSyntax) checkHarnessSyntax(a.root);
  let { stacks, failFast, explicit } = loadStacks(a.root);
  if (a.stack) stacks = stacks.filter((s) => s.id === a.stack);

  let targets = detect(a.root, stacks);

  // --changed narrows checks to stacks touched by the branch diff. If diff
  // scope cannot be computed, run all detected stacks loudly instead of skipping.
  if (a.changed) {
    const cf = workingTreeChangedFiles(a.base, a.root, a.files);
    if (cf.error) {
      console.error(`verify --changed: ${cf.error}; filter not applied, checking all detected stacks. Pass --base <ref> to choose a base.`);
      targets = maybeAddHarnessTarget(a.root, targets, ["hooks/verify.js"]);
    } else {
      const files = cf.files.map((f) => f.replace(/\\/g, "/"));
      targets = files.length ? targets.filter((t) => files.some((f) => fileUnder(t.rel, f))) : [];
      targets = maybeAddHarnessTarget(a.root, targets, files);
    }
  } else {
    targets = ensureHarnessSyntaxTarget(a.root, targets);
    targets = ensureGitHygieneTarget(a.root, targets);
  }

  if (a.list) {
    const plan = targets.map((t) => ({ stack: t.stack.id, dir: t.rel, steps: (t.stack.steps || []).map((s) => s.name) }));
    if (a.json) console.log(JSON.stringify({ explicit, plan }));
    else {
      console.log(`design of VERIFY (${explicit ? "config" : "auto-detect"}):`);
      if (!plan.length) console.log("  (no stacks detected)");
      for (const p of plan) console.log(`  - ${p.stack} @ ${p.dir}: ${p.steps.join(" -> ")}`);
    }
    process.exit(0);
  }

  // Debug audit runs before the early no-target exit, so it still works without stacks.
  const da = loadDebugAudit(a.root);
  const audit = debugAudit(a.root, da, a.base, a.files);
  let auditFailed = null;
  if (audit.skipped) {
    if (da.enabled) console.log(`\n- debug audit skipped: ${audit.skipped}`);
    if (da.enabled && (a.strictAudit || da.strict)) auditFailed = `debug audit strict: ${audit.skipped}`;
  } else {
    for (const h of audit.soft) console.log(`  debug line (soft): ${h.rel}:${h.line} - ${h.what}`);
    if (audit.hard.length) {
      console.error("\ndebug audit: leftover debug statements in changed files:");
      for (const h of audit.hard) console.error(`  - ${h.rel}:${h.line} - ${h.what}`);
      auditFailed = `debug audit: ${audit.hard.length} hard finding(s)`;
    }
  }

  if (!targets.length && !auditFailed) {
    console.log(a.changed
      ? "verify --changed: changed files do not touch any detected stack; nothing to check."
      : "verify: no stacks detected; nothing to check.");
    process.exit(0);
  }

  let failed = null;
  const summary = [];
  const warnings = [];
  outer:
  for (const t of targets) {
    for (const step of t.stack.steps || []) {
      const label = `${t.stack.id}/${step.name} @ ${t.rel}`;
      console.log(`\n> ${label}: ${step.run}`);
      const res = runStep(step, t.dir);
      try {
        if (res.ok) { emitStepOutput(res); summary.push(`OK ${label}`); continue; }
        if (res.timedOut) {
          summary.push(`FAIL ${label} (timeout after ${stepTimeoutMs(step)}ms)`);
          emitStepOutput(res);
          failed = `${label}: timeout after ${stepTimeoutMs(step)}ms`;
          if (failFast) break outer; else continue;
        }
        if (res.notFound || res.code === 9009 || res.code === 127) {
          if (step.optional) {
            warnings.push(`${label}: optional tool not found - step skipped`);
            summary.push(`${label} (optional tool not found; skipped)`);
            continue;
          }
          summary.push(`${label} (tool not found)`);
          emitStepOutput(res);
          failed = `${label}: command not found; install the tool or override the step in harness.config.json`;
          if (failFast) break outer; else continue;
        }
        if (step.okCodes && step.okCodes[res.code] !== undefined) {
          const detail = diagnosticExcerpt(res);
          warnings.push(`${label}: exit ${res.code}: ${step.okCodes[res.code] || "allowed code"}${detail ? "\n" + detail : ""}`);
          summary.push(`${label} (exit ${res.code}: ${step.okCodes[res.code] || "allowed code"})`);
          continue;
        }
        if (step.optional) {
          const detail = diagnosticExcerpt(res);
          warnings.push(`${label}: optional step exited ${res.code}${detail ? "\n" + detail : "\n(no diagnostics captured)"}`);
          summary.push(`WARN ${label} (optional, exit ${res.code})`);
          continue;
        }
        summary.push(`FAIL ${label} (exit ${res.code})`);
        emitStepOutput(res);
        failed = `${label}: exit ${res.code}`;
        if (failFast) break outer;
      } finally {
        if (res.cleanup) res.cleanup();
      }
    }
  }

  if (warnings.length) {
    console.log("\n-- optional warnings --");
    for (const w of warnings) console.log("  WARN " + w.replace(/\n/g, "\n    "));
  }
  if (summary.length) {
    console.log("\n-- verify summary --");
    for (const s of summary) console.log("  " + s);
  }
  if (failed || auditFailed) {
    console.error(`\nVERIFY failed: ${[failed, auditFailed].filter(Boolean).join(" | ")}`);
    process.exit(1);
  }
  console.log("\nVERIFY passed.");
  process.exit(0);
})();
