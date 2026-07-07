#!/usr/bin/env node
// doctor.js — environment self-check (BACKLOG P2-12). Catches the exact classes of
// problem we hit during development: hooks not wired, CRLF shebangs, NUL bytes, bad
// config, missing git identity. Run: `node hooks/doctor.js`.
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

// node / git
ok(`node ${process.version}`);
const gv = gitSafe(["--version"]);
gv ? ok(gv) : fail("git не найден в PATH");

// repo + hooksPath
const inRepo = gitSafe(["rev-parse", "--is-inside-work-tree"]) === "true";
if (!inRepo) { fail("не git-репозиторий (запусти внутри репо)"); }
else {
  const hp = gitSafe(["config", "--get", "core.hooksPath"]);
  if (hp === "hooks/git") ok("core.hooksPath = hooks/git");
  else fail(`core.hooksPath = ${hp || "(не задан)"} — запусти: node hooks/install.js`);

  const name = gitSafe(["config", "--get", "user.name"]);
  const email = gitSafe(["config", "--get", "user.email"]);
  (name && email) ? ok(`git identity: ${name} <${email}>`) : warn("git user.name/email не заданы");
}

// hook files: present, LF shebang, no NUL, exec bit (posix)
for (const h of ["hooks/git/commit-msg", "hooks/git/pre-commit", "hooks/git/pre-push"]) {
  const p = path.join(ROOT, h);
  let buf; try { buf = fs.readFileSync(p); } catch { fail(`${h} отсутствует`); continue; }
  if (buf.includes(0)) fail(`${h} содержит NUL-байты (git сочтёт бинарным)`);
  const firstLine = buf.slice(0, buf.indexOf(10) >= 0 ? buf.indexOf(10) : buf.length);
  if (firstLine.includes(13)) fail(`${h}: CRLF в shebang — сломается на macOS/Linux (нужен LF)`);
  else ok(`${h}: LF, без NUL`);
  if (process.platform !== "win32") {
    try { if (!(fs.statSync(p).mode & 0o111)) warn(`${h}: нет exec-бита (chmod +x)`); } catch {}
  }
}

// config JSON valid
const cfgPath = path.join(ROOT, "harness.config.json");
if (fs.existsSync(cfgPath)) {
  try { JSON.parse(fs.readFileSync(cfgPath, "utf8")); ok("harness.config.json — валидный JSON"); }
  catch (e) { fail(`harness.config.json невалиден: ${e.message}`); }
}

// report
const fails = results.filter((r) => r.level === "FAIL").length;
if (arg("--json", null) !== null || process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: fails === 0, results }));
} else {
  console.log("harness doctor:");
  const icon = { PASS: "✓", WARN: "⚠", FAIL: "✗" };
  for (const r of results) console.log(`  ${icon[r.level]} ${r.msg}`);
  console.log(fails ? `\n❌ doctor: ${fails} FAIL — почини перед работой.` : "\n✅ doctor: окружение в порядке.");
}
process.exit(fails ? 1 : 0);
