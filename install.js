#!/usr/bin/env node
// install.js - one-command installer for llm-dev-harness in a target repository.
//
// What it does:
//   1. installs harness-owned runtime files and records their hashes;
//   2. seeds project-owned policy/config templates only when they are missing;
//   3. creates a target harness.config.json when missing, without pinning the
//      source repo self-test so the target can auto-detect its own stacks;
//   4. merges the agent guard into .claude/settings.json while preserving foreign
//      keys and hooks, and without duplicating our entries on repeated runs;
//   5. installs lefthook hooks and runs doctor.
//
// Idempotent, cross-platform (Windows/macOS/Linux), and dependency-light.
// Double-click wrappers: install.cmd (Windows) / install.sh (POSIX).
//
// Usage:
//   node install.js [<dir> | --target <dir>] [--update] [--dry-run]
//                   [--with-ci] [--with-ruleset] [--json]
//     <dir>           positional install destination (optional)
//     --target        install destination (default: current directory)
//     --update        update unchanged harness-managed runtime files
//     --replace-managed  replace locally modified managed runtime files
//     --force         legacy alias for --update --replace-managed
//     --require-enforceable  fail while bootstrap/activation is pending
//     --dry-run       show the plan without writing
//     --with-ci       also copy optional GitHub maintenance files (dependabot)
//     --with-ruleset  apply the server ruleset (requires gh admin; see apply-ruleset.js)
//     --code-owner    CODEOWNERS owner such as @org/team or @user
//     --server-provider auto|github|none
//     --ruleset-profile auto|solo|team
//     --release-provider auto|cocogitto|none
//     --json          machine-readable report
//
// Exit 0 = installation succeeded (or dry-run), 1 = invalid target directory or
//          a critical step failed.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SRC = __dirname;
const { DEFAULT_UI_GLOBS, DEFAULT_UI_EXCLUDE, DEFAULT_MOCKUPS } = require(path.join(SRC, "hooks", "_lib.js"));

const INSTALL_MANIFEST = ".harness/installation.json";

// Only these files are harness-owned and eligible for in-place updates. Everything
// else is project policy: installer-created templates are seeds, never update
// payloads. test.js and release.yml remain source-repository-only.
const MANAGED_FILES = [
  "hooks/_lib.js", "hooks/verify-core.js", "hooks/verify.js", "hooks/design-gate.js", "hooks/doctor.js", "hooks/release-start.js", "hooks/release-config.js", "hooks/release-manifest-bump.js", "hooks/release-preflight.js", "hooks/release-artifacts.js", "hooks/post-merge-cleanup.js", "hooks/release-cleanup.js", "hooks/repo-state-audit.js",
  "hooks/new-mockups.js", "hooks/apply-ruleset.js", "hooks/branch-guard.js", "hooks/no-coauthor.js",
  "hooks/agent/_input.js", "hooks/agent/guard.js", "hooks/agent/stop-reminder.js",
  "lefthook.yml", "settings.example.json",
];
const PROJECT_TEMPLATES = [
  { rel: ".gitattributes" },
  { rel: "AGENTS.md", source: "templates/AGENTS.target.md" },
  { rel: ".gitleaks.toml" },
];
const GITHUB_RELEASE_TEMPLATES = [{ rel: "cog.toml" }];
const GENERIC_RELEASE_TEMPLATES = [{ rel: "cog.toml", source: "templates/cog.target.toml" }];
const GITHUB_TEMPLATES = [
  { rel: ".github/rulesets/main.json" },
  { rel: ".github/workflows/ci.yml" },
  { rel: ".github/CODEOWNERS" },
];
const CI_FILES = [{ rel: ".github/dependabot.yml" }];

// ---------- args ----------
function parseArgs(argv) {
  const a = {
    target: process.cwd(), force: false, update: false, replaceManaged: false,
    requireEnforceable: false, dryRun: false, withCi: false,
    withRuleset: false, codeOwner: "", serverProvider: "auto",
    rulesetProfile: "auto", releaseProvider: "auto", json: false, errors: [],
  };
  let positionalTarget = "";
  let explicitTarget = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) a.errors.push("--target requires a directory");
      else if (explicitTarget) { a.errors.push("--target may only be provided once"); i++; }
      else explicitTarget = argv[++i];
    }
    else if (arg === "--force") { a.force = true; a.update = true; a.replaceManaged = true; }
    else if (arg === "--update") a.update = true;
    else if (arg === "--replace-managed") { a.update = true; a.replaceManaged = true; }
    else if (arg === "--require-enforceable") a.requireEnforceable = true;
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--with-ci") a.withCi = true;
    else if (arg === "--with-ruleset") a.withRuleset = true;
    else if (arg === "--server-provider") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) a.errors.push("--server-provider requires auto, github, or none");
      else a.serverProvider = argv[++i];
    }
    else if (arg === "--release-provider") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) a.errors.push("--release-provider requires auto, cocogitto, or none");
      else a.releaseProvider = argv[++i];
    }
    else if (arg === "--ruleset-profile") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) a.errors.push("--ruleset-profile requires auto, solo, or team");
      else a.rulesetProfile = argv[++i];
    }
    else if (arg === "--code-owner") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) a.errors.push("--code-owner requires an owner");
      else a.codeOwner = argv[++i];
    }
    else if (arg === "--json") a.json = true;
    else if (arg.startsWith("-")) a.errors.push(`unknown option: ${arg}`);
    else if (positionalTarget) a.errors.push(`unexpected positional argument: ${arg}`);
    else positionalTarget = arg;
  }
  if (positionalTarget && explicitTarget) {
    a.errors.push("target must be provided either positionally or with --target, not both");
  }
  if (!["auto", "github", "none"].includes(a.serverProvider)) a.errors.push(`unsupported --server-provider: ${a.serverProvider}`);
  if (!["auto", "solo", "team"].includes(a.rulesetProfile)) a.errors.push(`unsupported --ruleset-profile: ${a.rulesetProfile}`);
  if (!["auto", "cocogitto", "none"].includes(a.releaseProvider)) a.errors.push(`unsupported --release-provider: ${a.releaseProvider}`);
  if (a.rulesetProfile === "solo" && a.codeOwner) a.errors.push("--ruleset-profile solo cannot require --code-owner review");
  a.target = path.resolve(explicitTarget || positionalTarget || a.target);
  return a;
}

// ---------- target harness.config.json ----------
// Reuse UI glob/mockup defaults from _lib. Do not pin verify: target projects need
// stack auto-detection, not this source repo's self-test.
function defaultConfig(adapters) {
  return JSON.stringify({
    schemaVersion: 2,
    capabilities: { ui: "auto", release: adapters.release, serverPolicy: adapters.server },
    ui: { globs: DEFAULT_UI_GLOBS, exclude: DEFAULT_UI_EXCLUDE, mockups: DEFAULT_MOCKUPS },
    debugAudit: { enabled: true, base: "main", soft: false, exclude: [], strict: true },
    release: {
      provider: adapters.release, remote: adapters.detectedGitHub ? "github" : "none",
      changelog: adapters.release === "cocogitto", versioning: { exclude: [], allowMissing: false }, artifacts: [],
    },
    serverPolicy: { provider: adapters.server, profile: adapters.profile },
  }, null, 2) + "\n";
}

function sha256File(file) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
  catch { return ""; }
}

function readInstallManifest() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(a.target, INSTALL_MANIFEST), "utf8"));
    return value && value.schemaVersion === 1 && value.managed && typeof value.managed === "object" ? value : null;
  } catch { return null; }
}

function sourceIdentity() {
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: SRC, encoding: "utf8" });
    return r.status === 0 ? String(r.stdout || "").trim() : "";
  };
  return { version: git(["describe", "--tags", "--abbrev=0"]), commit: git(["rev-parse", "HEAD"]) };
}

function writeInstallManifest(managed, dryRun) {
  const source = sourceIdentity();
  const body = {
    schemaVersion: 1,
    source,
    managed,
    ownership: {
      managed: MANAGED_FILES,
      projectOwned: ["harness.config.json", "AGENTS.md", "cog.toml", ".gitleaks.toml", ".gitattributes", ".github/**", "CHANGELOG.md"],
    },
  };
  if (!dryRun) {
    const dst = path.join(a.target, INSTALL_MANIFEST);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, JSON.stringify(body, null, 2) + "\n");
  }
  return { rel: INSTALL_MANIFEST, action: dryRun ? "plan" : "write", source };
}

function copyManaged(rel, previous, dryRun) {
  const src = path.join(SRC, rel), dst = path.join(a.target, rel);
  const sourceHash = sha256File(src);
  const targetHash = sha256File(dst);
  if (!targetHash) {
    if (!dryRun) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    return { rel, ownership: "managed", action: "write", hash: sourceHash };
  }
  if (targetHash === sourceHash) return { rel, ownership: "managed", action: "already", hash: sourceHash };
  if (!a.update) return { rel, ownership: "managed", action: "preserve", reason: "use --update", hash: "" };
  const baseline = previous && previous.managed && previous.managed[rel];
  if (!a.replaceManaged && (!baseline || baseline !== targetHash)) {
    return { rel, ownership: "managed", action: "conflict", reason: baseline ? "locally modified since install" : "no install baseline; use --replace-managed", hash: "" };
  }
  if (!dryRun) fs.copyFileSync(src, dst);
  return { rel, ownership: "managed", action: "overwrite", hash: sourceHash };
}

function copyProjectTemplate(entry, dryRun) {
  const rel = entry.rel;
  const src = path.join(SRC, entry.source || rel), dst = path.join(a.target, rel);
  if (fs.existsSync(dst)) return { rel, ownership: "project", action: "preserve" };
  if (!dryRun) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
  return { rel, ownership: "project", action: "write" };
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

function resolveAdapters() {
  const github = !!githubRepoFromUrl(gitRemoteUrl(a.target));
  const server = a.serverProvider === "auto" ? (github ? "github" : "none") : a.serverProvider;
  const release = a.releaseProvider === "auto" ? (github ? "cocogitto" : "none") : a.releaseProvider;
  const profile = a.rulesetProfile === "auto" ? "team" : a.rulesetProfile;
  return { server, release, profile, detectedGitHub: github };
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

function rulesetComment(owner, profile) {
  const base = "Installed GitHub branch ruleset for llm-dev-harness: the server-side gate that local hooks cannot replace. It requires PRs, the GitHub Actions verify check pinned by integration_id, and blocks force-push/delete on main.";
  if (profile === "solo") return base + " Solo profile: approving and code-owner reviews are advisory to avoid self-approval deadlock.";
  if (owner) {
    return base + " Code-owner review is required because install.js was run with --code-owner; keep .github/CODEOWNERS in sync with this setting.";
  }
  return base + " Code-owner review is disabled because install.js was run without --code-owner; the regular approving-review requirement remains enabled. Re-run install.js with --code-owner @org/team to require CODEOWNERS review.";
}

function configureCodeOwnersAndRuleset(dryRun, projectWrites, profile) {
  const owner = String(a.codeOwner || "").trim();
  const codeownersPath = path.join(a.target, ".github", "CODEOWNERS");
  const rulesetPath = path.join(a.target, ".github", "rulesets", "main.json");
  const explicit = !!owner;
  const codeownersCreated = projectWrites.has(".github/CODEOWNERS");
  const rulesetCreated = projectWrites.has(".github/rulesets/main.json");
  const profileExplicit = a.rulesetProfile !== "auto";
  const out = { owner, codeowners: "preserve", ruleset: "preserve", requireCodeOwnerReview: explicit };
  if ((codeownersCreated || explicit) && !dryRun) {
    fs.mkdirSync(path.dirname(codeownersPath), { recursive: true });
    fs.writeFileSync(codeownersPath, codeOwnerFile(owner));
  }
  if (codeownersCreated || explicit) out.codeowners = owner ? "write-owner" : "write-template";
  let ruleset = null;
  try { ruleset = JSON.parse(fs.readFileSync(rulesetPath, "utf8")); } catch {}
  if (!ruleset && dryRun && rulesetCreated) {
    try { ruleset = JSON.parse(fs.readFileSync(path.join(SRC, ".github", "rulesets", "main.json"), "utf8")); } catch {}
  }
  if (ruleset) {
    if (rulesetCreated || explicit || profileExplicit) {
      ruleset._comment = rulesetComment(owner, profile);
      const pr = (ruleset.rules || []).find((r) => r.type === "pull_request");
      if (pr && pr.parameters) {
        pr.parameters.required_approving_review_count = profile === "solo" ? 0 : 1;
        pr.parameters.require_code_owner_review = profile === "solo" ? false : explicit;
        if (!dryRun) fs.writeFileSync(rulesetPath, JSON.stringify(ruleset, null, 2) + "\n");
        out.ruleset = owner ? "code-owner-required" : "code-owner-disabled";
      }
    }
  }
  return out;
}

// ---------- harness.config.json (generate if missing) ----------
function writeConfig(adapters, dryRun) {
  const dst = path.join(a.target, "harness.config.json");
  let exists = false;
  try { fs.accessSync(dst); exists = true; } catch {}
  if (exists) {
    const explicit = a.serverProvider !== "auto" || a.releaseProvider !== "auto" || a.rulesetProfile !== "auto";
    let config;
    try { config = JSON.parse(fs.readFileSync(dst, "utf8")); }
    catch (e) { return { action: "error", ownership: "project", reason: `cannot apply explicit adapter selection to invalid JSON: ${e.message}` }; }
    if (!explicit) {
      const migrations = [];
      if (config.schemaVersion !== 2 || !config.capabilities)
        migrations.push("schema-v2-capabilities");
      if (!config.ui || !Array.isArray(config.ui.exclude) ||
          (Array.isArray(config.ui.globs) && !config.ui.globs.some((glob) => /xaml|tsx|jsx|vue|svelte|razor/i.test(String(glob)))))
        migrations.push("ui-routing-v2-review");
      if (!config.release || !config.release.versioning || !Array.isArray(config.release.artifacts))
        migrations.push("release-contract-v2-review");
      if (!config.serverPolicy || !config.serverPolicy.provider || !config.serverPolicy.profile)
        migrations.push("server-policy-v2-review");
      return { action: "preserve", ownership: "project", migrations };
    }
    config.schemaVersion = config.schemaVersion || 2;
    config.capabilities = config.capabilities || {};
    config.release = config.release || {};
    config.serverPolicy = config.serverPolicy || {};
    if (a.serverProvider !== "auto") {
      config.capabilities.serverPolicy = adapters.server;
      config.serverPolicy.provider = adapters.server;
    }
    if (a.releaseProvider !== "auto") {
      config.capabilities.release = adapters.release;
      config.release.provider = adapters.release;
      config.release.remote = adapters.detectedGitHub ? "github" : "none";
    }
    if (a.rulesetProfile !== "auto") {
      config.capabilities.serverPolicy = adapters.server;
      config.serverPolicy.provider = adapters.server;
      config.serverPolicy.profile = adapters.profile;
    }
    if (!dryRun) fs.writeFileSync(dst, JSON.stringify(config, null, 2) + "\n");
    return { action: "update-explicit", ownership: "project" };
  }
  if (!dryRun) fs.writeFileSync(dst, defaultConfig(adapters));
  return { action: "write", ownership: "project" };
}

// A target changelog belongs to the target project. Seed the Cocogitto
// separator when absent, but never replace product release history on --force.
function ensureChangelog(dryRun) {
  const dst = path.join(a.target, "CHANGELOG.md");
  try {
    if (fs.statSync(dst).isFile()) return { action: "already" };
  } catch {}
  if (!dryRun) fs.writeFileSync(dst, "# Changelog\n\n- - -\n");
  return { action: "write" };
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
  const out = {
    ok: true, installed: false, bootstrapRequired: false, activationRequired: false, enforceable: false,
    target: a.target, mode: null, dryRun: a.dryRun, files: [], config: null,
    adapters: null, installManifest: null, changelog: null, cog: null, codeowners: null,
    settings: null, gitignore: null, lefthook: null, doctor: null, ruleset: null,
    migrationRequired: [], notes: [], argumentErrors: a.errors,
  };

  if (a.errors.length) {
    out.mode = "invalid";
    return finish(out, false, `invalid arguments: ${a.errors.join("; ")}`);
  }

  // The target directory must exist.
  try { if (!fs.statSync(a.target).isDirectory()) throw 0; }
  catch { return finish(out, false, `target directory does not exist: ${a.target}`); }

  const isGit = fs.existsSync(path.join(a.target, ".git"));
  if (!isGit) out.notes.push("target directory is not a git repository: lefthook install and branch gates require `git init`.");

  const selfInstall = path.resolve(a.target) === path.resolve(SRC);
  out.mode = selfInstall ? "bootstrap" : "install";
  out.adapters = selfInstall ? { server: "github", release: "cocogitto", profile: "solo", detectedGitHub: true } : resolveAdapters();
  if (out.adapters.server !== "github" && (a.withRuleset || a.codeOwner || a.rulesetProfile !== "auto")) {
    return finish(out, false, "--with-ruleset/--code-owner/--ruleset-profile require --server-provider github or a GitHub origin");
  }

  // 1. Files.
  if (!selfInstall) {
    const previous = readInstallManifest();
    const managedHashes = {};
    for (const rel of MANAGED_FILES) {
      const result = copyManaged(rel, previous, a.dryRun);
      out.files.push(result);
      if (result.hash) managedHashes[rel] = result.hash;
      else if (previous && previous.managed && previous.managed[rel]) managedHashes[rel] = previous.managed[rel];
    }
    let templates = PROJECT_TEMPLATES.slice();
    if (out.adapters.release === "cocogitto") templates = templates.concat(
      out.adapters.detectedGitHub ? GITHUB_RELEASE_TEMPLATES : GENERIC_RELEASE_TEMPLATES
    );
    if (out.adapters.server === "github") templates = templates.concat(GITHUB_TEMPLATES, a.withCi ? CI_FILES : []);
    for (const entry of templates) out.files.push(copyProjectTemplate(entry, a.dryRun));
    const projectWrites = new Set(out.files.filter((f) => f.ownership === "project" && f.action === "write").map((f) => f.rel));
    const cogFile = out.files.find((f) => f.rel === "cog.toml");
    if (cogFile && cogFile.action === "write" && out.adapters.detectedGitHub) {
      out.cog = rewriteCogRemoteMetadata(a.dryRun);
      if (out.cog.action === "skip") {
        out.notes.push("cog.toml: " + out.cog.reason + " - set [changelog] owner/repository before release.");
      }
    }
    out.config = writeConfig(out.adapters, a.dryRun);
    out.migrationRequired = (out.config && out.config.migrations) || [];
    if (out.adapters.release === "cocogitto") out.changelog = ensureChangelog(a.dryRun);
    if (out.adapters.server === "github") out.codeowners = configureCodeOwnersAndRuleset(a.dryRun, projectWrites, out.adapters.profile);
    out.installManifest = writeInstallManifest(managedHashes, a.dryRun);
    if (a.force) out.notes.push("--force is a compatibility alias for --update --replace-managed; project-owned files were preserved.");
    if (out.adapters.server === "github" && !a.codeOwner && (projectWrites.has(".github/CODEOWNERS") || projectWrites.has(".github/rulesets/main.json"))) {
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
  const conflicts = out.files.filter((f) => f.action === "conflict");
  const doctorFails = out.doctor && Array.isArray(out.doctor.results)
    ? out.doctor.results.filter((r) => r.level === "FAIL") : [];
  const bootstrapFails = doctorFails.filter((r) => r.code === "bootstrap-required");
  const nonBootstrapDoctorFails = doctorFails.filter((r) => r.code !== "bootstrap-required");
  out.installed = conflicts.length === 0 && out.settings.status !== "error";
  out.bootstrapRequired = bootstrapFails.length > 0;
  out.activationRequired = !a.dryRun && !!(out.lefthook && !out.lefthook.ok);
  out.enforceable = out.installed && isGit && !!(out.lefthook && out.lefthook.ok) && !!(out.doctor && out.doctor.ok);
  if (out.settings.status === "error") hardFailures.push("settings");
  if (out.config && out.config.action === "error") hardFailures.push("harness-config");
  if (conflicts.length) hardFailures.push("managed-file-conflict");
  if (!a.dryRun && nonBootstrapDoctorFails.length) hardFailures.push("doctor");
  if (!a.dryRun && a.withRuleset && out.ruleset && !out.ruleset.ok) hardFailures.push("ruleset");
  if (!a.dryRun && a.requireEnforceable && !out.enforceable) hardFailures.push("not-enforceable");
  if (out.bootstrapRequired) out.notes.push("bootstrap pending: commit the installed harness through a PR before treating the loop as enforceable.");
  if (out.activationRequired) out.notes.push("activation pending: install Lefthook and run `lefthook install`; use --require-enforceable to gate automation.");
  if (out.migrationRequired.length) out.notes.push(`project-owned harness.config.json needs a separate reviewed migration: ${out.migrationRequired.join(", ")}`);
  return finish(out, hardFailures.length === 0,
    hardFailures.length ? "installation failed: " + hardFailures.join(", ") + " (see notes/doctor)" : null);
})();

function finish(out, ok, reason) {
  out.ok = ok;
  if (reason) out.reason = reason;
  if (a.json) { console.log(JSON.stringify(out)); process.exit(ok ? 0 : 1); }

  const icon = (x) => (x === "write" ? "+" : x === "overwrite" ? "~" : x === "conflict" ? "!" : "-");
  console.log(`\nllm-dev-harness -> ${out.target}  [${out.mode}${out.dryRun ? ", dry-run" : ""}]`);
  if (out.adapters) console.log(`  adapters: server=${out.adapters.server}${out.adapters.server === "github" ? "/" + out.adapters.profile : ""}, release=${out.adapters.release}${out.adapters.detectedGitHub ? " (GitHub origin detected)" : ""}`);
  if (out.files.length) {
    const w = out.files.filter((f) => f.action === "write").length;
    const o = out.files.filter((f) => f.action === "overwrite").length;
    const p = out.files.filter((f) => ["already", "preserve"].includes(f.action)).length;
    const c = out.files.filter((f) => f.action === "conflict").length;
    console.log(`  files: +${w} new, ${o} updated, ${p} preserved, ${c} conflict(s)`);
    for (const f of out.files) if (f.action !== "already") console.log(`    ${icon(f.action)} ${f.rel}${f.ownership ? " [" + f.ownership + "]" : ""}${f.reason ? " - " + f.reason : ""}`);
  }
  if (out.config) console.log(`  harness.config.json: ${out.config.action === "write" ? "generated" : out.config.action === "update-explicit" ? "updated by explicit adapter/profile selection" : out.config.action === "error" ? "error - " + out.config.reason : "project-owned; preserved"}`);
  if (out.installManifest) console.log(`  ${INSTALL_MANIFEST}: managed-file baseline recorded`);
  if (out.changelog) console.log(`  CHANGELOG.md: ${out.changelog.action === "write" ? "generated" : "preserved"}`);
  if (out.codeowners) console.log(`  CODEOWNERS/ruleset: ${out.codeowners.owner ? "owner " + out.codeowners.owner + " configured" : "template only, code-owner review disabled"}`);
  if (out.settings) console.log(`  .claude/settings.json: ${out.settings.status === "merged" ? `+${out.settings.added} agent hook(s) merged` : out.settings.status === "already" ? "agent hooks already present" : "error - " + out.settings.reason}`);
  if (out.gitignore) console.log(`  .gitignore: ${out.gitignore.action === "already" ? "already covers .claude/settings.local.json" : (out.gitignore.action === "created" ? "created" : "appended") + " -> .claude/settings.local.json"}`);
  if (out.lefthook) console.log(`  lefthook install: ${out.lefthook.ok ? "ok" : "skipped (" + (out.lefthook.reason || out.lefthook.code) + ")"}`);
  if (out.doctor) console.log(`  doctor: ${out.doctor.ok ? "environment ready" : out.bootstrapRequired ? "bootstrap pending" : "FAIL present - run `node hooks/doctor.js`"}`);
  if (out.ruleset) console.log(`  ruleset: ${out.ruleset.ok ? "applied" : "not applied (requires gh admin plus Pro/public repository)"}`);
  if (out.notes.length) { console.log("\n  next:"); for (const n of out.notes) console.log("   - " + n); }
  if (!out.dryRun && out.ok) {
    console.log("\n  manual follow-up when needed:");
    console.log("   - server ruleset (real enforcement): node hooks/apply-ruleset.js  (gh admin, Pro/public repository)");
    console.log("   - check: node hooks/verify.js --list and node hooks/doctor.js");
  }
  console.log(ok ? ((out.bootstrapRequired || out.activationRequired) ? "\ninstallation complete; bootstrap/activation follow-up required." : "\ninstallation complete.") : "\ninstallation failed: " + (reason || ""));
  process.exit(ok ? 0 : 1);
}
