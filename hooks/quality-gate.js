#!/usr/bin/env node
// quality-gate.js — lightweight, portable AI-code hygiene gate (BACKLOG P2-13).
// "Treat AI-generated code as untrusted until reviewed": catch the cheap, high-signal
// problems — merge-conflict markers, oversized files (unreviewable dumps), minified
// blobs — on the changed files. Deliberately low-FP: only unambiguous issues FAIL.
//
// Usage: node hooks/quality-gate.js [--base <ref> | --files a,b | --all] [--root <dir>] [--json]
// Config: harness.config.json -> quality { maxFileLines, maxLineChars, sourceExt }
// Exit 0 = ok (WARN allowed), 1 = a FAIL-level issue.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const has = (n) => process.argv.includes(n);
const ROOT = arg("--root", process.cwd());

const DEFAULTS = { maxFileLines: 800, maxLineChars: 2000, sourceExt: [".js", ".ts", ".jsx", ".tsx", ".py", ".cs", ".rs", ".qml", ".go", ".java", ".cpp", ".c", ".h"] };
function loadCfg() {
  try { const q = (JSON.parse(fs.readFileSync(path.join(ROOT, "harness.config.json"), "utf8")).quality) || {}; return { ...DEFAULTS, ...q }; }
  catch { return DEFAULTS; }
}
function changed() {
  if (has("--files")) return (arg("--files", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (has("--all")) {
    const out = [];
    (function w(d) { let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const x of e) { if (x.isDirectory()) { if (![".git", "node_modules", "target", "dist", "build"].includes(x.name)) w(path.join(d, x.name)); } else out.push(path.relative(ROOT, path.join(d, x.name))); } })(ROOT);
    return out;
  }
  const base = arg("--base", "main");
  try { return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }
  catch { return []; }
}

(function main() {
  const cfg = loadCfg();
  const findings = [];
  for (const rel of changed()) {
    if (!cfg.sourceExt.includes(path.extname(rel).toLowerCase())) continue;
    let text; try { text = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    if (/^(<{7}|={7}|>{7})/m.test(text)) findings.push({ level: "FAIL", rel, why: "маркеры merge-конфликта" });
    if (lines.length > cfg.maxFileLines) findings.push({ level: "FAIL", rel, why: `${lines.length} строк > лимита ${cfg.maxFileLines} (разбей файл)` });
    if (lines.some((l) => l.length > cfg.maxLineChars)) findings.push({ level: "WARN", rel, why: `строка > ${cfg.maxLineChars} символов (минифицировано/дамп?)` });
    const todos = (text.match(/\b(TODO|FIXME|XXX)\b/g) || []).length;
    if (todos > 5) findings.push({ level: "WARN", rel, why: `${todos} TODO/FIXME` });
  }
  const fails = findings.filter((f) => f.level === "FAIL").length;
  if (has("--json")) { console.log(JSON.stringify({ ok: fails === 0, findings })); process.exit(fails ? 1 : 0); }
  if (!findings.length) { console.log("✅ quality-gate: замечаний нет."); process.exit(0); }
  console.log("quality-gate:");
  for (const f of findings) console.log(`  ${f.level === "FAIL" ? "✗" : "⚠"} ${f.rel}: ${f.why}`);
  if (fails) { console.error(`\n❌ quality-gate: ${fails} FAIL.`); process.exit(1); }
  console.log("\n✅ quality-gate: только предупреждения."); process.exit(0);
})();
