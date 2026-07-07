#!/usr/bin/env node
// secret-scan.js — dependency-free secret scanner (BACKLOG P1-6).
//
// High-precision patterns (private keys, cloud/provider tokens) plus a conservative
// high-entropy assignment check. No external tools (portable, matches the harness ethos).
// Used by the git-native pre-commit (blocks committing secrets) and by CI/VERIFY.
//
// Usage:
//   node hooks/secret-scan.js [--staged | --all | --files a,b] [--root <dir>] [--json]
//     --staged  scan git-staged files (default; used by pre-commit)
//     --all     walk the working tree
//     --files   explicit comma-separated file list
//
// Skip a false positive with an inline marker on the line:  secret-scan:allow
// Exit 0 = clean (or nothing to scan / internal error), exit 1 = secret(s) found.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PATTERNS = [
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[opsru]_[A-Za-z0-9]{36,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "Stripe secret key", re: /\bsk_live_[0-9A-Za-z]{24,}\b/ },
];

// Conservative generic: key-looking name assigned a long high-entropy literal.
const ASSIGN_RE = /(?:secret|token|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']([A-Za-z0-9+/=_\-]{20,})["']/i;
function shannon(s) {
  const f = {};
  for (const c of s) f[c] = (f[c] || 0) + 1;
  let h = 0;
  for (const k in f) { const p = f[k] / s.length; h -= p * Math.log2(p); }
  return h;
}

const SKIP_DIRS = new Set([".git", "node_modules", "target", "bin", "obj", "dist", "build", ".venv", "venv", "__pycache__"]);
const ALLOW_MARK = /secret-scan:allow|pragma: ?allowlist ?secret/i;

function parseArgs(argv) {
  const a = { mode: "staged", root: process.cwd(), files: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") a.mode = "all";
    else if (argv[i] === "--staged") a.mode = "staged";
    else if (argv[i] === "--files") { a.mode = "files"; a.files = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean); }
    else if (argv[i] === "--root") a.root = argv[++i];
    else if (argv[i] === "--json") a.json = true;
  }
  return a;
}

function stagedFiles(root) {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}
function stagedContent(root, file) {
  try { return execFileSync("git", ["show", ":" + file], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
}
function walk(root) {
  const out = [];
  (function rec(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(path.join(dir, e.name)); }
      else out.push(path.relative(root, path.join(dir, e.name)));
    }
  })(root);
  return out;
}

function scanText(text, file, findings) {
  if (text.includes("\0")) return; // binary
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW_MARK.test(line)) continue;
    for (const p of PATTERNS) if (p.re.test(line)) findings.push({ file, line: i + 1, rule: p.name });
    const m = ASSIGN_RE.exec(line);
    if (m && m[1].length >= 20 && shannon(m[1]) >= 4.0) findings.push({ file, line: i + 1, rule: "High-entropy secret assignment" });
  }
}

(function main() {
  const a = parseArgs(process.argv.slice(2));
  const findings = [];
  try {
    if (a.mode === "staged") {
      for (const f of stagedFiles(a.root)) { const c = stagedContent(a.root, f); if (c != null) scanText(c, f, findings); }
    } else {
      const files = a.mode === "files" ? a.files : walk(a.root);
      for (const f of files) {
        let c; try { c = fs.readFileSync(path.join(a.root, f), "utf8"); } catch { continue; }
        scanText(c, f, findings);
      }
    }
  } catch { process.exit(0); } // fail-open on infra errors

  if (!findings.length) {
    if (a.json) console.log(JSON.stringify({ ok: true, findings: [] }));
    else console.log("✅ secret-scan: секретов не найдено.");
    process.exit(0);
  }
  if (a.json) { console.log(JSON.stringify({ ok: false, findings })); process.exit(1); }
  console.error("🛑 secret-scan: похоже на утечку секретов — заблокировано.");
  for (const f of findings) console.error(`   ${f.file}:${f.line}  [${f.rule}]`);
  console.error("   Убери секрет (используй env/secret-store). Ложное срабатывание — пометь строку `secret-scan:allow`.");
  process.exit(1);
})();
