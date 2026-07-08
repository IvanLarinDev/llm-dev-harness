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
function git(args) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" }).trim(); }
function gitSafe(args) { try { return git(args); } catch { return null; } }
function inPath(bin) { try { execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" }); return true; } catch { return false; } }
function tracked(rel) { return gitSafe(["ls-files", "--error-unmatch", rel]) !== null; }
function readText(rel) { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return ""; } }
function checkTextFile(rel) {
  const p = path.join(ROOT, rel);
  let buf;
  try { buf = fs.readFileSync(p); } catch { fail(rel + " отсутствует"); return; }
  const text = buf.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buf)) fail(rel + ": невалидный UTF-8 или обрезанный многобайтный символ");
  else if (buf.includes(0)) fail(rel + " содержит NUL-байты");
  else if (buf.includes(13)) fail(rel + ": CRLF/CR line endings (нужен LF)");
  else ok(rel + ": LF, UTF-8, без NUL");
}
function yamlKeyLine(line) {
  const m = String(line).match(/^(\s*)(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:.*$/);
  if (!m) return null;
  return { indent: m[1].length, key: m[2] || m[3] || m[4] };
}
function workflowJobs(rel) {
  const text = readText(rel);
  const lines = text.split(/\r?\n/);
  const jobs = [];
  let jobsIndent = null, jobIndent = null;
  let current = null;
  for (const line of lines) {
    if (/^\s*(?:#.*)?$/.test(line)) {
      if (current) current.body.push(line);
      continue;
    }
    const key = yamlKeyLine(line);
    if (jobsIndent === null) {
      if (key && key.key === "jobs") jobsIndent = key.indent;
      continue;
    }
    if (key && key.indent <= jobsIndent) break;
    if (key && (jobIndent === null || key.indent === jobIndent)) {
      if (jobIndent === null) jobIndent = key.indent;
      current = { id: key.key, body: [line] };
      jobs.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return jobs;
}
function workflowJobIds(rel) {
  return workflowJobs(rel).map((j) => j.id);
}
function workflowJobBody(rel, id) {
  const job = workflowJobs(rel).find((j) => j.id === id);
  return job ? job.body.join("\n") : "";
}
function rulesetRequiredChecks(rel) {
  let ruleset = {};
  try { ruleset = JSON.parse(readText(rel)); } catch { return []; }
  const rsc = (ruleset.rules || []).find((r) => r.type === "required_status_checks");
  return (((rsc || {}).parameters || {}).required_status_checks || []).map((c) => c.context).filter(Boolean);
}
function checkRulesetPrReview(rel) {
  let ruleset = {};
  try { ruleset = JSON.parse(readText(rel)); } catch { return; }
  const pr = (ruleset.rules || []).find((r) => r.type === "pull_request");
  const p = (pr && pr.parameters) || {};
  if (Number(p.required_approving_review_count || 0) < 1)
    fail("ruleset: pull_request must require at least 1 approving review");
  else ok("ruleset: pull_request requires approving review");
  p.require_code_owner_review === true
    ? ok("ruleset: code-owner review required")
    : fail("ruleset: code-owner review is not required");
}
function checkVerifyJobContract(workflowPath, required) {
  if (!required.includes("verify")) return;
  const body = workflowJobBody(workflowPath, "verify");
  if (!body) { fail("CI job verify is required by ruleset but its workflow body was not found"); return; }
  const checks = [
    { name: "doctor", re: /node\s+hooks\/doctor\.js\b/ },
    { name: "verify", re: /node\s+hooks\/verify\.js\b/ },
    { name: "design-gate strict", re: /node\s+hooks\/design-gate\.js\b[^\n]*--strict\b/ },
    { name: "secret scan", re: /gitleaks/i },
  ];
  const missing = checks.filter((c) => !c.re.test(body)).map((c) => c.name);
  if (missing.length) fail(`CI job verify does not run required harness step(s): ${missing.join(", ")}`);
  else ok("CI job verify runs doctor, verify.js, design-gate --strict and secret scan");
}
function checkWorkflowSupplyChain(workflowPath) {
  const text = readText(workflowPath);
  const unpinned = [];
  for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    const spec = m[1];
    if (!/@[0-9a-f]{40}$/i.test(spec)) unpinned.push(spec);
  }
  if (unpinned.length) fail(`CI action(s) not pinned to full SHA: ${unpinned.join(", ")}`);
  else ok("CI actions are pinned to full commit SHAs");

  if (/ecc-agentshield@/.test(text)) {
    /AGENTSHIELD_INTEGRITY:\s*["']sha512-/.test(text) && /NPM_CONFIG_IGNORE_SCRIPTS:\s*["']true["']/.test(text)
      ? ok("CI AgentShield npm package has integrity pin and install scripts disabled")
      : fail("CI AgentShield npm package must pin dist.integrity and set NPM_CONFIG_IGNORE_SCRIPTS=true");
  }
}

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

  // .git должна допускать полный жизненный цикл lock-файла (write + unlink): git
  // обновляет index и refs через <name>.lock -> rename/unlink. На FS без удаления
  // (некоторые сетевые/контейнерные/FUSE mount'ы) commit/checkout/rebase падают на
  // "index.lock: File exists". Проверяем реальной пробой, а не предположением —
  // именно этот отказ среды раньше не ловился.
  const gitDir = gitSafe(["rev-parse", "--git-dir"]) || ".git";
  const gitDirAbs = path.isAbsolute(gitDir) ? gitDir : path.join(ROOT, gitDir);
  const probe = path.join(gitDirAbs, ".doctor-lock-probe-" + process.pid);
  try {
    fs.writeFileSync(probe, "x");
    try {
      fs.unlinkSync(probe);
      ok(".git допускает атомарные lock-операции (write + unlink)");
    } catch {
      fail(".git запрещает удаление файлов — git не уберёт *.lock (index.lock/ref.lock); commit/checkout/rebase упадут. Проверь mount (read-delete/FUSE) или права.");
    }
  } catch {
    fail(".git недоступна для записи — git add/commit/checkout работать не будут. Проверь права/mount.");
  }
  try {
    if (fs.existsSync(path.join(gitDirAbs, "index.lock")))
      warn("залипший .git/index.lock — удали, если ни один git-процесс не запущен (иначе add/commit блокируются)");
  } catch {}
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

const requiredHarnessFiles = [
  "hooks/verify.js",
  "hooks/design-gate.js",
  "hooks/new-mockups.js",
  "hooks/doctor.js",
  "hooks/apply-ruleset.js",
  "hooks/_lib.js",
  "hooks/branch-guard.js",
  "hooks/no-coauthor.js",
  "hooks/agent/guard.js",
  "hooks/agent/_input.js",
  "hooks/agent/stop-reminder.js",
  "harness.config.json",
  "lefthook.yml",
  "cog.toml",
  ".gitleaks.toml",
  "AGENTS.md",
  "settings.example.json",
  ".github/rulesets/main.json",
];
const missingHarness = [];
const untrackedHarness = [];
for (const f of requiredHarnessFiles) {
  if (!fs.existsSync(path.join(ROOT, f))) missingHarness.push(f);
  else if (inRepo && !tracked(f)) untrackedHarness.push(f);
}
if (missingHarness.length || untrackedHarness.length) {
  const parts = [];
  if (missingHarness.length) parts.push("missing: " + missingHarness.join(", "));
  if (untrackedHarness.length) parts.push("untracked: " + untrackedHarness.join(", "));
  fail("harness not bootstrapped into repository main — " + parts.join("; ") +
    ". Создай bootstrap PR и закоммить эти файлы перед dev/release loop.");
} else {
  ok("harness bootstrap files present and tracked");
}

// Critical harness files must be portable across Windows/macOS/Linux checkouts.
const textCritical = requiredHarnessFiles.concat([
  ".gitattributes",
  ".gitignore",
  "README.md",
  "CLAUDE.md",
  "BACKLOG.md",
  ".github/workflows/ci.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  "install.cmd",
  "install.sh",
]).filter((f, i, a) => a.indexOf(f) === i && fs.existsSync(path.join(ROOT, f)));
for (const f of textCritical) checkTextFile(f);

// harness.config.json valid JSON
const cfgPath = path.join(ROOT, "harness.config.json");
if (fs.existsSync(cfgPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    ok("harness.config.json — валидный JSON");
    const hasSelfTest = fs.existsSync(path.join(ROOT, "hooks", "test.js"));
    const stacks = cfg.verify && Array.isArray(cfg.verify.stacks) ? cfg.verify.stacks : null;
    if (hasSelfTest && stacks) {
      const harness = stacks.find((s) => s && s.id === "harness");
      const steps = (harness && Array.isArray(harness.steps)) ? harness.steps : [];
      const runsSelfTest = steps.some((s) => /node\s+test\.js\b/.test(String(s && s.run || "")));
      runsSelfTest ? ok("harness.config.json: VERIFY включает harness self-test") :
        fail("harness.config.json: verify.stacks задан, но обязательный harness self-test (node test.js) отсутствует");
    }
  }
  catch (e) { fail("harness.config.json невалиден: " + e.message); }
}

const cogPath = path.join(ROOT, "cog.toml");
if (fs.existsSync(cogPath)) {
  const cog = fs.readFileSync(cogPath, "utf8");
  /from_latest_tag\s*=\s*true/.test(cog) ? ok("cog.toml: from_latest_tag=true") : fail("cog.toml: нужен from_latest_tag=true для release bump от последнего v* tag");
  /ignore_merge_commits\s*=\s*true/.test(cog) ? ok("cog.toml: ignore_merge_commits=true") : fail("cog.toml: нужен ignore_merge_commits=true");
  /tag_prefix\s*=\s*"v"/.test(cog) ? ok("cog.toml: tag_prefix=\"v\"") : fail("cog.toml: нужен tag_prefix=\"v\"");
  /branch_whitelist\s*=\s*\[[^\]]*"release\/\*\*"/s.test(cog)
    ? ok("cog.toml: branch_whitelist includes release/**")
    : fail("cog.toml: branch_whitelist must include release/** for release worktrees");
  /template\s*=\s*"remote"/.test(cog)
    ? ok("cog.toml: changelog.template=\"remote\"")
    : fail("cog.toml: changelog.template=\"remote\" is required for github.com remote changelog generation");
  /owner\s*=\s*"[^"]+"/.test(cog)
    ? ok("cog.toml: changelog.owner set")
    : fail("cog.toml: changelog.owner is required for remote changelog generation");
  /repository\s*=\s*"[^"]+"/.test(cog)
    ? ok("cog.toml: changelog.repository set")
    : fail("cog.toml: changelog.repository is required for remote changelog generation");
  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  let changelog = "";
  try { changelog = fs.readFileSync(changelogPath, "utf8"); } catch {}
  changelog
    ? ok("CHANGELOG.md: present")
    : fail("CHANGELOG.md is required for cog bump changelog generation");
  /^---\s*$/m.test(changelog)
    ? ok("CHANGELOG.md: contains Cocogitto separator ---")
    : fail("CHANGELOG.md must contain Cocogitto separator line ---");
}

const workflowPath = ".github/workflows/ci.yml";
const rulesetPath = ".github/rulesets/main.json";
if (fs.existsSync(path.join(ROOT, workflowPath)) && fs.existsSync(path.join(ROOT, rulesetPath))) {
  const jobs = workflowJobIds(workflowPath);
  const required = rulesetRequiredChecks(rulesetPath);
  const missing = required.filter((ctx) => !jobs.includes(ctx));
  if (missing.length) fail(`ruleset required check(s) not published by CI workflow: ${missing.join(", ")} (jobs: ${jobs.join(", ") || "none"})`);
  else if (required.length) {
    ok("ruleset required checks match CI workflow job ids");
    checkVerifyJobContract(workflowPath, required);
  }
  checkRulesetPrReview(rulesetPath);
  checkWorkflowSupplyChain(workflowPath);
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
