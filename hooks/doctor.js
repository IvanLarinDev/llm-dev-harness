#!/usr/bin/env node
// doctor.js — environment self-check (BACKLOG P2-12). Catches the classes of problem we
// hit in development: hooks not wired, CRLF, NUL bytes, bad config, missing git identity.
// Checks the migrated stack (lefthook + gitleaks + cocogitto). Run: node hooks/doctor.js
//
// [--root <dir>] [--json].  Exit 0 = no FAIL (WARN allowed), 1 = at least one FAIL.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const ROOT = arg("--root", process.cwd());
const results = [];
function ok(msg) { results.push({ level: "PASS", msg }); }
function warn(msg) { results.push({ level: "WARN", msg }); }
function fail(msg) { results.push({ level: "FAIL", msg }); }
function git(args) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
function gitSafe(args) { try { return git(args); } catch { return null; } }
function inPath(bin) { try { execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: ["ignore", "pipe", "ignore"] }); return true; } catch { return false; } }

// node / git
ok("node " + process.version);
const gv = gitSafe(["--version"]);
gv ? ok(gv) : fail("git не найден в PATH");

// repo
const inRepo = gitSafe(["rev-parse", "--is-inside-work-tree"]) === "true";
if (!inRepo) {
  fail("не git-репозиторий (запусти внутри репо)");
} else {
  const name = gitSafe(["config", "--get", "user.name"]);
  const email = gitSafe(["config", "--get", "user.email"]);
  (name && email) ? ok("git identity: " + name + " <" + email + ">") : warn("git user.name/email не заданы");

  // lefthook wired into .git/hooks? (lefthook install writes a stub referencing lefthook)
  const hooksDir = gitSafe(["rev-parse", "--git-path", "hooks"]) || ".git/hooks";
  let wired = false;
  for (const h of ["pre-commit", "commit-msg", "pre-push"]) {
    try {
      if (/lefthook/i.test(fs.readFileSync(path.join(ROOT, hooksDir, h), "utf8"))) { wired = true; break; }
    } catch {}
  }
  wired ? ok("lefthook wired into .git/hooks") : warn("хуки не установлены — запусти: lefthook install");
}

// runner + delegated tools in PATH (WARN, not FAIL — CI provides them)
const tools = [
  ["lefthook", "git-hook раннер (lefthook install)"],
  ["gitleaks", "secret scanning (pre-commit + CI)"],
  ["cog", "cocogitto: conventional commits + release"],
];
for (const t of tools) {
  inPath(t[0]) ? ok(t[0] + " найден") : warn(t[0] + " не в PATH — " + t[1]);
}

// config files present, LF, no NUL
for (const f of ["lefthook.yml", "cog.toml", ".gitleaks.toml"]) {
  const p = path.join(ROOT, f);
  let buf;
  try { buf = fs.readFileSync(p); } catch { fail(f + " отсутствует"); continue; }
  const nl = buf.indexOf(10);
  if (buf.includes(0)) fail(f + " содержит NUL-байты");
  else if (buf.slice(0, nl >= 0 ? nl : buf.length).includes(13)) fail(f + ": CRLF (нужен LF)");
  else ok(f + ": LF, без NUL");
}

// harness.config.json valid JSON
const cfgPath = path.join(ROOT, "harness.config.json");
if (fs.existsSync(cfgPath)) {
  try { JSON.parse(fs.readFileSync(cfgPath, "utf8")); ok("harness.config.json — валидный JSON"); }
  catch (e) { fail("harness.config.json невалиден: " + e.message); }
}

// report
const fails = results.filter((r) => r.level === "FAIL").length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: fails === 0, results }));
} else {
  console.log("harness doctor:");
  const icon = { PASS: "✓", WARN: "⚠", FAIL: "✗" };
  for (const r of results) console.log("  " + icon[r.level] + " " + r.msg);
  console.log(fails ? "\n❌ doctor: " + fails + " FAIL — почини перед работой." : "\n✅ doctor: окружение в порядке.");
}
process.exit(fails ? 1 : 0);
