#!/usr/bin/env node
// install.js - one-command installer for llm-dev-harness in a target repository.
//
// What it does:
//   1. copies harness hooks and configs into the target project without overwriting
//      existing files by default;
//   2. creates a target harness.config.json when missing, without pinning the
//      source repo self-test so the target can auto-detect its own stacks;
//   3. merges the agent guard into .claude/settings.json while preserving foreign
//      keys and hooks, and without duplicating our entries on repeated runs;
//   4. installs the CI/ruleset mirror needed for server-side enforcement;
//   5. installs lefthook hooks and runs doctor.
//
// Idempotent, cross-platform (Windows/macOS/Linux), and dependency-light.
// Double-click wrappers: install.cmd (Windows) / install.sh (POSIX).
//
// Usage:
//   node install.js [--target <dir>] [--force] [--dry-run] [--with-ci]
//                   [--with-ruleset] [--json]
//     --target        install destination (default: current directory)
//     --force         overwrite existing harness files
//     --dry-run       show the plan without writing
//     --with-ci       also copy optional GitHub maintenance files (dependabot)
//     --with-ruleset  apply the server ruleset (requires gh admin; see apply-ruleset.js)
//     --code-owner    CODEOWNERS owner such as @org/team or @user
//     --json          machine-readable report
//
// Exit 0 = installation succeeded (or dry-run), 1 = invalid target directory or
//          a critical step failed.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = __dirname;
const { DEFAULT_UI_GLOBS, DEFAULT_MOCKUPS } = require(path.join(SRC, "hooks", "_lib.js"));

// Harness files copied into the target repository. harness.config.json is not here
// because it is generated separately. test.js is not here because it is the source
// repo's dev self-test, tied to this repo's docs/CI. .github/rulesets/main.json is
// needed by apply-ruleset.js, so it is always copied.
const FILES = [
  "hooks/_lib.js", "hooks/verify-core.js", "hooks/verify.js", "hooks/design-gate.js", "hooks/doctor.js", "hooks/release-preflight.js",
  "hooks/new-mockups.js", "hooks/apply-ruleset.js", "hooks/branch-guard.js", "hooks/no-coauthor.js",
  "hooks/agent/_input.js", "hooks/agent/guard.js", "hooks/agent/stop-reminder.js",
  "lefthook.yml", "cog.toml", "CHANGELOG.md", ".gitleaks.toml", "settings.example.json",
  ".gitattributes", "AGENTS.md", ".github/rulesets/main.json", ".github/workflows/ci.yml", ".github/CODEOWNERS",
];
const CI_FILES = [".github/dependabot.yml"];

// ---------- args ----------
function parseArgs(argv) {
  const a = { target: process.cwd(), force: false, dryRun: false, withCi: false, withRuleset: false, codeOwner: "", json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") a.target = argv[++i];
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else if (argv[i] === "--with-ci") a.withCi = true;
    else if (argv[i] === "--with-ruleset") a.withRuleset = true;
    else if (argv[i] === "--code-owner") a.codeOwner = argv[++i] || "";
    else if (argv[i] === "--json") a.json = true;
  }
  a.target = path.resolve(a.target);
  return a;
}

// ---------- target harness.config.json ----------
// Reuse UI glob/mockup defaults from _lib. Do not pin verify: target projects need
// stack auto-detection, not this source repo's self-test.
function defaultConfig() {
  return JSON.stringify({
    ui: { globs: DEFAULT_UI_GLOBS, mockups: DEFAULT_MOCKUPS },
    debugAudit: { enabled: true, base: "main", soft: false, exclude: [], strict: true },
  }, null, 2) + "\n";
}

// ---------- copy one file ----------
function copyOne(rel, force, dryRun) {
  const src = path.join(SRC, rel), dst = path.join(a.target, rel);
  let exists = false;
  try { fs.accessSync(dst); exists = true; } catch {}
  if (exists && !force) return { rel, action: "skip" };
  if (!dryRun) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
  return { rel, action: exists ? "overwrite" : "write" };
}

function githubRepoFromUrl(url) {
  const value = String(url || "").trim();
  const m = value.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/:]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repository: m[2] } : null;
}

function gitRemoteUrl(target) {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: target, encoding: "utf8" });
  return r.status === 0 ? String(r.stdout || "").trim() : "";
}

function rewriteCogRemoteMetadata(dryRun) {
  const dst = path.join(a.target, "cog.toml");
  const repo = githubRepoFromUrl(gitRemoteUrl(a.target));
  if (!repo) return { action: "skip", reason: "no GitHub origin" };
  let text = "";
  try { text = fs.readFileSync(dst, "utf8"); }
  catch {
    if (!dryRun) return { action: "skip", reason: "missing cog.toml" };
    try { text = fs.readFileSync(path.join(SRC, "cog.toml"), "utf8"); }
    catch { return { action: "skip", reason: "missing cog.toml" }; }
  }
  const next = text
    .replace(/^owner\s*=\s*"[^"]*"\s*$/m, `owner = "${repo.owner}"`)
    .replace(/^repository\s*=\s*"[^"]*"\s*$/m, `repository = "${repo.repository}"`);
  if (next === text) return { action: "already", owner: repo.owner, repository: repo.repository };
  if (!dryRun) fs.writeFileSync(dst, next);
  return { action: "rewrite", owner: repo.owner, repository: repo.repository };
}

function codeOwnerFile(owner) {
  if (!owner) {
    return [
      "# Code owners for this target repository.",
      "# No owner is configured yet, so the installed ruleset keeps code-owner",
      "# review disabled and relies on the regular approving-review requirement.",
      "# Re-run install.js with --code-owner @org/team or edit this file and",
      "# enable require_code_owner_review in .github/rulesets/main.json.",
      "",
    ].join("\n");
  }
  return [
    "# Code owners for this target repository.",
    `*                    ${owner}`,
    `/hooks/              ${owner}`,
    `/.github/            ${owner}`,
    `/harness.config.json ${owner}`,
    "",
  ].join("\n");
}

function configureCodeOwnersAndRuleset(dryRun) {
  const owner = String(a.codeOwner || "").trim();
  const codeownersPath = path.join(a.target, ".github", "CODEOWNERS");
  const rulesetPath = path.join(a.target, ".github", "rulesets", "main.json");
  const out = { owner, codeowners: "skip", ruleset: "skip", requireCodeOwnerReview: !!owner };
  if (!dryRun) {
    fs.mkdirSync(path.dirname(codeownersPath), { recursive: true });
    fs.writeFileSync(codeownersPath, codeOwnerFile(owner));
  }
  out.codeowners = owner ? "write-owner" : "write-template";
  let ruleset = null;
  try { ruleset = JSON.parse(fs.readFileSync(rulesetPath, "utf8")); } catch {}
  if (ruleset) {
    const pr = (ruleset.rules || []).find((r) => r.type === "pull_request");
    if (pr && pr.parameters) {
      pr.parameters.require_code_owner_review = !!owner;
      if (!dryRun) fs.writeFileSync(rulesetPath, JSON.stringify(ruleset, null, 2) + "\n");
      out.ruleset = owner ? "code-owner-required" : "code-owner-disabled";
    }
  }
  return out;
}

// ---------- harness.config.json (generate if missing) ----------
function writeConfig(force, dryRun) {
  const dst = path.join(a.target, "harness.config.json");
  let exists = false;
  try { fs.accessSync(dst); exists = true; } catch {}
  if (exists && !force) return { action: "skip" };
  if (!dryRun) fs.writeFileSync(dst, defaultConfig());
  return { action: exists ? "overwrite" : "write" };
}

// ---------- .gitignore: only the personal runner file ----------
// Do not ignore harness files (hooks/, lefthook.yml, configs, .github/): they must
// be committed so lefthook, CI, and the server ruleset have check code on a fresh
// clone. Only ignore .claude/settings.local.json, which holds per-user runner
// permissions. Guard state lives in the system temp directory, not the repository.
const GITIGNORE_LINES = [".claude/settings.local.json"];
function ensureGitignore(dryRun) {
  const dst = path.join(a.target, ".gitignore");
  let cur = "";
  try { cur = fs.readFileSync(dst, "utf8"); } catch {}
  const have = new Set(cur.split(/\r?\n/).map((s) => s.trim()));
  const covered = have.has(".claude/") || have.has(".claude") || have.has("/.claude/");
  const missing = covered ? [] : GITIGNORE_LINES.filter((l) => !have.has(l));
  if (!missing.length) return { action: "already" };
  if (!dryRun) {
    const pad = cur && !cur.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(dst, cur + pad + (cur ? "\n" : "") +
      "# agent runtime (local runner settings; do not commit)\n" + missing.join("\n") + "\n");
  }
  return { action: cur ? "appended" : "created", added: missing };
}

// ---------- merge agent hooks into .claude/settings.json ----------
// Keep foreign keys and hooks intact, but dedupe only exact harness commands.
// A random command ending in guard.js must not mask a missing harness guard.
function mergeSettings(dryRun) {
  let wanted;
  try { wanted = JSON.parse(fs.readFileSync(path.join(SRC, "settings.example.json"), "utf8")).hooks; }
  catch { return { status: "error", reason: "source settings.example.json is unreadable" }; }
  const dst = path.join(a.target, ".claude", "settings.json");
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(dst, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") return { status: "error", reason: "existing .claude/settings.json is invalid; leaving it untouched" }; }
  cur.hooks = cur.hooks || {};
  const commands = (entry) => (entry.hooks || []).map((h) => String(h.command || "").replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase());
  let added = 0;
  for (const ev of Object.keys(wanted)) {
    cur.hooks[ev] = cur.hooks[ev] || [];
    for (const entry of wanted[ev]) {
      const want = commands(entry);
      const dup = cur.hooks[ev].some((e) => commands(e).some((s) => want.includes(s)));
      if (!dup) { cur.hooks[ev].push(entry); added++; }
    }
  }
  if (!dryRun && added) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, JSON.stringify(cur, null, 2) + "\n");
  }
  return { status: added ? "merged" : "already", added };
}

// ---------- external activation steps ----------
function runLefthook() {
  const r = spawnSync("lefthook", ["install"], { cwd: a.target, encoding: "utf8", shell: true });
  if (r.error) return { ok: false, reason: r.error.code === "ENOENT" ? "lefthook not found in PATH" : String(r.error.message) };
  return { ok: r.status === 0, code: r.status };
}
function runDoctor() {
  const r = spawnSync("node", [path.join(a.target, "hooks", "doctor.js"), "--root", a.target, "--json"],
    { encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, results: [] }; }
}
function runRuleset() {
  const r = spawnSync("node", [path.join(a.target, "hooks", "apply-ruleset.js")], { cwd: a.target, encoding: "utf8" });
  return { ok: r.status === 0, out: String(r.stdout || "") + String(r.stderr || "") };
}

// ---------- main ----------
const a = parseArgs(process.argv.slice(2));

(function main() {
  const out = { ok: true, target: a.target, mode: null, dryRun: a.dryRun, files: [], config: null, cog: null, codeowners: null, settings: null, gitignore: null, lefthook: null, doctor: null, ruleset: null, notes: [] };

  // The target directory must exist.
  try { if (!fs.statSync(a.target).isDirectory()) throw 0; }
  catch { return finish(out, false, `target directory does not exist: ${a.target}`); }

  const isGit = fs.existsSync(path.join(a.target, ".git"));
  if (!isGit) out.notes.push("target directory is not a git repository: lefthook install and branch gates require `git init`.");

  const selfInstall = path.resolve(a.target) === path.resolve(SRC);
  out.mode = selfInstall ? "bootstrap" : "install";

  // 1. Files.
  if (!selfInstall) {
    const list = a.withCi ? FILES.concat(CI_FILES) : FILES.slice();
    for (const rel of list) out.files.push(copyOne(rel, a.force, a.dryRun));
    const cogFile = out.files.find((f) => f.rel === "cog.toml");
    if (cogFile && cogFile.action !== "skip") {
      out.cog = rewriteCogRemoteMetadata(a.dryRun);
      if (out.cog.action === "skip") {
        out.notes.push("cog.toml: " + out.cog.reason + " - set [changelog] owner/repository before release.");
      }
    }
    out.config = writeConfig(a.force, a.dryRun);
    out.codeowners = configureCodeOwnersAndRuleset(a.dryRun);
    if (!a.codeOwner) {
      out.notes.push("CODEOWNERS: no --code-owner was provided, so target ruleset keeps required approving review but disables required code-owner review to avoid maintainer deadlocks.");
    }
    if (out.files.some((f) => f.rel === ".github/workflows/ci.yml" && f.action !== "skip")) {
      // The CI mirror is copied, but it only activates after push and may require the workflow scope.
      out.notes.push("CI mirror .github/workflows/ci.yml was written; it activates after push and may require the gh workflow scope.");
    }
  } else {
    out.notes.push("bootstrap mode: target is the source repository; files are already present, so only wiring and activation run.");
  }

  // 2. Agent hooks in settings.json.
  out.settings = mergeSettings(a.dryRun);
  if (out.settings.status === "error") out.notes.push("settings: " + out.settings.reason);

  // 2b. .gitignore: only personal settings.local.json; harness files are committed.
  out.gitignore = ensureGitignore(a.dryRun);

  // 3. Activation, except in dry-run mode.
  if (!a.dryRun) {
    out.lefthook = runLefthook();
    if (!out.lefthook.ok) out.notes.push("lefthook: " + (out.lefthook.reason || `exit ${out.lefthook.code}`) + " - install lefthook and run `lefthook install`.");
    out.doctor = runDoctor();
    if (a.withRuleset) out.ruleset = runRuleset();
  }

  const hardFailures = [];
  if (out.settings.status === "error") hardFailures.push("settings");
  if (!a.dryRun && out.lefthook && !out.lefthook.ok) hardFailures.push("lefthook");
  if (!a.dryRun && out.doctor && out.doctor.ok === false) hardFailures.push("doctor");
  return finish(out, hardFailures.length === 0,
    hardFailures.length ? "installation is not fully enforceable: " + hardFailures.join(", ") + " (see notes/doctor)" : null);
})();

function finish(out, ok, reason) {
  out.ok = ok;
  if (reason) out.reason = reason;
  if (a.json) { console.log(JSON.stringify(out)); process.exit(ok ? 0 : 1); }

  const icon = (x) => (x === "write" ? "+" : x === "overwrite" ? "~" : "-");
  console.log(`\nllm-dev-harness -> ${out.target}  [${out.mode}${out.dryRun ? ", dry-run" : ""}]`);
  if (out.files.length) {
    const w = out.files.filter((f) => f.action === "write").length;
    const o = out.files.filter((f) => f.action === "overwrite").length;
    const s = out.files.filter((f) => f.action === "skip").length;
    console.log(`  files: +${w} new, ${o} overwritten, ${s} already existed (--force to update)`);
    for (const f of out.files) if (f.action !== "skip") console.log(`    ${icon(f.action)} ${f.rel}`);
  }
  if (out.config) console.log(`  harness.config.json: ${out.config.action === "skip" ? "already present" : out.config.action === "write" ? "generated" : "overwritten"}`);
  if (out.codeowners) console.log(`  CODEOWNERS/ruleset: ${out.codeowners.owner ? "owner " + out.codeowners.owner + " configured" : "template only, code-owner review disabled"}`);
  if (out.settings) console.log(`  .claude/settings.json: ${out.settings.status === "merged" ? `+${out.settings.added} agent hook(s) merged` : out.settings.status === "already" ? "agent hooks already present" : "error - " + out.settings.reason}`);
  if (out.gitignore) console.log(`  .gitignore: ${out.gitignore.action === "already" ? "already covers .claude/settings.local.json" : (out.gitignore.action === "created" ? "created" : "appended") + " -> .claude/settings.local.json"}`);
  if (out.lefthook) console.log(`  lefthook install: ${out.lefthook.ok ? "ok" : "skipped (" + (out.lefthook.reason || out.lefthook.code) + ")"}`);
  if (out.doctor) console.log(`  doctor: ${out.doctor.ok ? "environment ready" : "FAIL present - run `node hooks/doctor.js`"}`);
  if (out.ruleset) console.log(`  ruleset: ${out.ruleset.ok ? "applied" : "not applied (requires gh admin plus Pro/public repository)"}`);
  if (out.notes.length) { console.log("\n  next:"); for (const n of out.notes) console.log("   - " + n); }
  if (!out.dryRun && out.ok) {
    console.log("\n  manual follow-up when needed:");
    console.log("   - server ruleset (real enforcement): node hooks/apply-ruleset.js  (gh admin, Pro/public repository)");
    console.log("   - check: node hooks/verify.js --list and node hooks/doctor.js");
  }
  console.log(ok ? "\ninstallation complete." : "\ninstallation failed: " + (reason || ""));
  process.exit(ok ? 0 : 1);
}
