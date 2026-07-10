#!/usr/bin/env node
// test.js - cross-platform harness self-test suite without bash.
// Checks delegated tool configs (lefthook/gitleaks/cocogitto/ruleset/CI),
// guard.js behavior (bypass, loops, protected files, lint configs, fact-force,
// profiles), design-gate, and verify. Guard tests run in-process through the
// exported run() function, following the ECC dispatcher pattern; this is much
// faster than spawning node for every case. The CLI stdin/exit-code contract is
// covered separately with spawn-based tests.
// Run: node hooks/test.js, or node hooks/test.js --repeat 3 for flake hunting.
// Exit 0 = green, 1 = failures.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (process.argv.includes("--repeat")) {
  const i = process.argv.indexOf("--repeat");
  const raw = Number(process.argv[i + 1] || 3);
  const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
  for (let n = 1; n <= count; n++) {
    console.log(`\nrepeat ${n}/${count}: node hooks/test.js`);
    try {
      execFileSync(process.execPath, [__filename], { cwd: path.join(__dirname, ".."), stdio: "inherit" });
    } catch (e) {
      process.exit(e.status || 1);
    }
  }
  process.exit(0);
}

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  + " + msg); }
  else { fail++; console.log("  X " + msg); }
}
function cases(title, list, run) {
  console.log("\n" + title + ":");
  for (const c of list) ok(run(c), c.name);
}
function runHook(hookPath, payloadObj, env = {}) {
  try {
    execFileSync("node", [hookPath], {
      input: JSON.stringify(payloadObj), encoding: "utf8",
      env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (e) { return e.status || 1; }
}
function hookOutput(hookPath, payloadObj, env = {}) {
  // Capture stdout+stderr regardless of exit code.
  try {
    return execFileSync("node", [hookPath], {
      input: JSON.stringify(payloadObj), encoding: "utf8",
      env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) { return String(e.stdout || "") + String(e.stderr || ""); }
}

const GUARD = path.join(__dirname, "agent", "guard.js");
const STOP = path.join(__dirname, "agent", "stop-reminder.js");
const DESIGN_GATE = path.join(__dirname, "design-gate.js");
const NEW_MOCKUPS = path.join(__dirname, "new-mockups.js");
const VERIFY = path.join(__dirname, "verify.js");
const APPLY_RULESET = path.join(__dirname, "apply-ruleset.js");
const RELEASE_START = path.join(__dirname, "release-start.js");
const RELEASE_MANIFEST_BUMP = path.join(__dirname, "release-manifest-bump.js");
const RELEASE_PREFLIGHT = path.join(__dirname, "release-preflight.js");
const RELEASE_ARTIFACTS = path.join(__dirname, "release-artifacts.js");
const GITHUB_BRANCH_CLEANUP = path.join(__dirname, "github-branch-cleanup.js");
const POST_MERGE_CLEANUP = path.join(__dirname, "post-merge-cleanup.js");
const RELEASE_CLEANUP = path.join(__dirname, "release-cleanup.js");
const REPO_STATE_AUDIT = path.join(__dirname, "repo-state-audit.js");
const BRANCH_GUARD = path.join(__dirname, "branch-guard.js");
const NO_COAUTHOR = path.join(__dirname, "no-coauthor.js");
const REPO = path.join(__dirname, "..");
const sharedLib = require(path.join(__dirname, "_lib.js"));
const verifyCore = require(path.join(__dirname, "verify-core.js"));
const applyRuleset = require(APPLY_RULESET);
const releaseStart = require(RELEASE_START);
const repoStateAudit = require(REPO_STATE_AUDIT);
const githubBranchCleanup = require(GITHUB_BRANCH_CLEANUP);
function readRepo(f) { try { return fs.readFileSync(path.join(REPO, f), "utf8"); } catch { return ""; } }
// guard blocks harness-file edits relative to projectDir; tests run from a neutral
// directory so relative-path behavior is what gets exercised.
const NEUTRAL = fs.mkdtempSync(path.join(os.tmpdir(), "harness-neutral-"));
function sess(name) {
  return { HARNESS_SESSION_ID: name + "-" + Date.now() + "-" + Math.random().toString(36).slice(2), HARNESS_PROJECT_DIR: NEUTRAL };
}

// ---------- in-process guard runner ----------
const guardMod = require(GUARD);
function grun(payload, env = {}) {
  const ti = payload.tool_input || {};
  const ctx = {
    tool: payload.tool_name || "",
    command: typeof ti.command === "string" ? ti.command : "",
    filePath: ti.file_path || ti.path || ti.filePath || ti.filename || ti.target_file || ti.targetFile || "",
    sessionId: env.HARNESS_SESSION_ID || "",
    projectDir: env.HARNESS_PROJECT_DIR || NEUTRAL,
    stopHookActive: false, truncated: false, parseError: false, raw: payload,
  };
  return guardMod.run(ctx, { ...process.env, ...env });
}
const gexit = (payload, env = {}) => grun(payload, env).exitCode;
function gout(payload, env = {}) { const r = grun(payload, env); return String(r.stdout) + String(r.stderr); }

// ---------- delegated tool configs ----------
console.log("\nconfigs (lefthook + gitleaks + cocogitto + ruleset + ci):");
const lh = readRepo("lefthook.yml");
ok(/commit-msg:/.test(lh) && /cog verify/.test(lh), "lefthook commit-msg -> cog verify (conventional)");
ok(/no-coauthor:[\s\S]*node hooks\/no-coauthor\.js/.test(lh), "lefthook commit-msg -> Windows-safe no-coauthor Node script");
ok(fs.existsSync(NO_COAUTHOR), "configs lefthook gitleaks cocogitto ruleset ci assertion 1");
ok(/pre-commit:/.test(lh) && /gitleaks/.test(lh), "lefthook pre-commit -> gitleaks (secrets)");
ok(/HARNESS_ALLOW_MAIN/.test(lh), "configs lefthook gitleaks cocogitto ruleset ci assertion 2");
ok(/branch-guard:[\s\S]*node hooks\/branch-guard\.js/.test(lh), "lefthook branch-guard -> Windows-safe Node script");
ok(fs.existsSync(BRANCH_GUARD), "configs lefthook gitleaks cocogitto ruleset ci assertion 3");
ok(/pre-push:/.test(lh) && /verify\.js/.test(lh), "lefthook pre-push -> verify.js");
ok(/pre-push:[\s\S]*design-gate\.js/.test(lh), "lefthook pre-push -> design-gate.js");
ok(/design-gate\.js --base origin\/main/.test(lh), "lefthook design-gate uses fresh remote base origin/main");
const cog = readRepo("cog.toml");
ok(/from_latest_tag/.test(cog) && /\[changelog\]/.test(cog), "configs lefthook gitleaks cocogitto ruleset ci assertion 4");
ok(/from_latest_tag\s*=\s*true/.test(cog) && /ignore_merge_commits\s*=\s*true/.test(cog) && /tag_prefix\s*=\s*"v"/.test(cog),
  "cog.toml release-safe: latest v* tag + merge commits ignored");
ok(/branch_whitelist\s*=\s*\[[^\]]*"release\/\*\*"/s.test(cog),
  "cog.toml release-safe: release/** branch whitelist is allowed");
ok(/template\s*=\s*"remote"/.test(cog) && /owner\s*=\s*"[^"]+"/.test(cog) && /repository\s*=\s*"[^"]+"/.test(cog),
  "cog.toml release-safe: remote changelog template has owner/repository");
ok(/owner\s*=\s*"IvanLarinDev"/.test(cog) && /repository\s*=\s*"llm-dev-harness"/.test(cog),
  "cog.toml release-safe: remote changelog metadata matches source repository");
ok(/^- - -\s*$/m.test(readRepo("CHANGELOG.md")), "CHANGELOG.md contains Cocogitto separator");
const gl = readRepo(".gitleaks.toml");
ok(/useDefault\s*=\s*true/.test(gl), "configs lefthook gitleaks cocogitto ruleset ci assertion 5");
let ruleset = {};
try { ruleset = JSON.parse(readRepo(".github/rulesets/main.json")); } catch {}
ok(ruleset.enforcement === "active" && ruleset.target === "branch", "ruleset is an active branch ruleset");
const rNames = (ruleset.rules || []).map((r) => r.type);
ok(["deletion", "non_fast_forward", "pull_request", "required_status_checks"].every((t) => rNames.includes(t)),
  "ruleset: block delete/force-push, require PR + status check");
const rsc = (ruleset.rules || []).find((r) => r.type === "required_status_checks");
ok(!!rsc && rsc.parameters.required_status_checks.some((c) => c.context === "verify"),
  "configs lefthook gitleaks cocogitto ruleset ci assertion 6");
ok(!!rsc && rsc.parameters.required_status_checks.some((c) => c.context === "verify" && c.integration_id === 15368),
  "ruleset pins the verify check to GitHub Actions (integration_id), so API-forged statuses do not satisfy it");
const prr = (ruleset.rules || []).find((r) => r.type === "pull_request");
ok(!!prr && prr.parameters.required_approving_review_count === 0 && prr.parameters.require_code_owner_review === false,
  "source ruleset uses solo-maintainer PR policy while verify remains required");
const liveLikeRuleset = JSON.parse(JSON.stringify(ruleset));
const liveLikePr = liveLikeRuleset.rules.find((r) => r.type === "pull_request");
liveLikePr.parameters.allowed_merge_methods = ["merge", "squash", "rebase"];
ok(applyRuleset.compareRuleset(ruleset, liveLikeRuleset).length === 0,
  "apply-ruleset readback comparison ignores harmless GitHub-added rule fields");
const strictExpectedRuleset = JSON.parse(JSON.stringify(ruleset));
const strictExpectedPr = strictExpectedRuleset.rules.find((r) => r.type === "pull_request");
strictExpectedPr.parameters.required_approving_review_count = 1;
strictExpectedPr.parameters.require_code_owner_review = true;
ok(applyRuleset.compareRuleset(strictExpectedRuleset, liveLikeRuleset).some((m) => /pull_request/.test(m)),
  "apply-ruleset readback comparison catches PR review policy drift");
ok(applyRuleset.parseRulesetList(JSON.stringify([{ name: "a" }]) + "\n" + JSON.stringify([{ name: "b" }])).length === 2,
  "apply-ruleset parses paginated ruleset list output");
ok(applyRuleset.driftReport(ruleset, [], null, "example/repo").mismatches.some((m) => /missing/.test(m)),
  "apply-ruleset read-only drift check reports a missing live ruleset");
ok(applyRuleset.driftReport(ruleset, [{ name: ruleset.name, id: 7 }], liveLikeRuleset, "example/repo").ok === true,
  "apply-ruleset read-only drift check accepts matching live policy");
ok(applyRuleset.driftReport(strictExpectedRuleset, [{ name: ruleset.name, id: 7 }], liveLikeRuleset, "example/repo").ok === false,
  "apply-ruleset read-only drift check rejects review-policy drift");
const ci = readRepo(".github/workflows/ci.yml");
ok(/runs-on:\s*windows-latest/.test(ci), "CI: verify job runs on Windows for WPF/net*-windows targets");
ok(/uses:\s*actions\/setup-dotnet@[0-9a-f]{40}\s*# actions\/setup-dotnet@v\d/.test(ci) && /dotnet-version:\s*"10\.0\.x"/.test(ci),
  "CI: setup-dotnet is pinned and installs .NET 10");
ok(/push:\s*\n\s*branches:\s*\[main\]/.test(ci), "CI: push trigger only runs on main");
ok(/doctor\.js/.test(ci) && /design-gate\.js/.test(ci) && /verify\.js/.test(ci), "configs lefthook gitleaks cocogitto ruleset ci assertion 8");
ok(/uses:\s*actions\/checkout@[0-9a-f]{40}\s*# actions\/checkout@v\d/.test(ci) &&
   /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*# actions\/setup-node@v\d/.test(ci) &&
   /uses:\s*actions\/setup-go@[0-9a-f]{40}\s*# actions\/setup-go@v\d/.test(ci),
  "CI: GitHub Actions pinned to full SHAs with Dependabot-readable comments");
ok(/GITLEAKS_VERSION:\s*"v8\.24\.3"/.test(ci) && /go install github\.com\/zricethezav\/gitleaks\/v8@\$GITLEAKS_VERSION/.test(ci) && /gitleaks detect/.test(ci),
  "CI: gitleaks installs through Go on the Windows runner");
ok(/AGENTSHIELD_INTEGRITY:\s*"sha512-/.test(ci) && /NPM_CONFIG_IGNORE_SCRIPTS:\s*"true"/.test(ci),
  "CI: AgentShield npm package has integrity pin and install scripts disabled");
ok(/COG_VERSION:\s*"7\.0\.0"/.test(ci) &&
   /COG_SHA256:\s*"074f68f05d270da5c0d69d3e234ec362bec4c6e3189c21d1c948d038603655d7"/.test(ci) &&
   /cocogitto-\$COG_VERSION-x86_64-pc-windows-msvc\.tar\.gz/.test(ci) &&
   /sha256sum -c -/.test(ci) &&
   /x86_64-pc-windows-msvc\/cog\.exe" --version/.test(ci),
  "CI: cocogitto installs the pinned Windows binary with checksum verification");
ok(/Conventional commit range[\s\S]*shell:\s*bash[\s\S]*\.\/x86_64-pc-windows-msvc\/cog\.exe check "\$\{\{ github\.event\.pull_request\.base\.sha \}\}\.\.HEAD" --ignore-merge-commits/.test(ci),
  "CI: conventional commit check uses explicit PR range, not latest tag (works before first release tag)");
const jobIds = [...ci.matchAll(/^  ([A-Za-z0-9_-]+):\s*\n\s+runs-on:/gm)].map((m) => m[1]);
const requiredContexts = (((rsc || {}).parameters || {}).required_status_checks || []).map((c) => c.context);
ok(requiredContexts.length > 0 && requiredContexts.every((ctx) => jobIds.includes(ctx)),
  "CI/ruleset contract: required status check contexts match workflow job ids");
ok(/design-gate\.js --strict --base/.test(ci), "configs lefthook gitleaks cocogitto ruleset ci assertion 9");
ok(/AGENTSHIELD_VERSION:\s*"1\.4\.0"/.test(ci) && /continue-on-error:\s*true/.test(ci),
  "configs lefthook gitleaks cocogitto ruleset ci assertion 10");
ok(/AgentShield[\s\S]*shell:\s*bash/.test(ci), "CI: AgentShield step uses bash explicitly on the Windows runner");
const branchCleanupWorkflow = readRepo(".github/workflows/branch-cleanup.yml");
ok(/workflow_run:[\s\S]*workflows:\s*\[[^\]]*"verify"[^\]]*\][\s\S]*types:\s*\[completed\]/.test(branchCleanupWorkflow) &&
   /workflow_run\.conclusion == 'success'/.test(branchCleanupWorkflow) &&
   /workflow_run\.head_branch == github\.event\.repository\.default_branch/.test(branchCleanupWorkflow),
  "branch cleanup workflow runs only after successful default-branch verify");
ok(/contents:\s*write/.test(branchCleanupWorkflow) && /pull-requests:\s*read/.test(branchCleanupWorkflow) &&
   /checks:\s*read/.test(branchCleanupWorkflow) && /github-branch-cleanup\.js[\s\S]*--apply/.test(branchCleanupWorkflow),
  "branch cleanup workflow grants scoped evidence/delete permissions and invokes the provider adapter");
ok(/ref:\s*\$\{\{ github\.event\.workflow_run\.head_sha \}\}/.test(branchCleanupWorkflow),
  "branch cleanup workflow executes trusted code from the verified main SHA");
const evidencePr = {
  number: 7, merged_at: "2026-01-01T00:00:00Z", merge_commit_sha: "a".repeat(40),
  base: { ref: "main" }, head: { ref: "feat/example", sha: "b".repeat(40), repo: { full_name: "example/repo" } },
};
ok(githubBranchCleanup.selectMergedPr([evidencePr], "a".repeat(40), "main").length === 1 &&
   githubBranchCleanup.selectMergedPr([evidencePr], "c".repeat(40), "main").length === 0,
  "GitHub branch cleanup binds one MERGED PR to the exact workflow SHA and base");
ok(githubBranchCleanup.latestRequiredCheck([
  { id: 1, name: "verify", status: "completed", conclusion: "failure", app: { slug: "github-actions" } },
  { id: 2, name: "verify", status: "completed", conclusion: "success", app: { slug: "github-actions" } },
  { id: 3, name: "verify", status: "completed", conclusion: "success", app: { slug: "foreign-app" } },
], "verify").id === 2,
"GitHub branch cleanup uses the latest required GitHub Actions check, not a foreign status");
ok(githubBranchCleanup.mismatchedBranchHeads([
  { label: "missing", exists: false, oid: "" },
  { label: "reviewed", exists: true, oid: "b".repeat(40) },
  { label: "moved", exists: true, oid: "c".repeat(40) },
], "b".repeat(40)).map((entry) => entry.label).join(",") === "moved",
"GitHub branch cleanup rejects any existing local or remote ref that moved after review");
const releaseWorkflow = readRepo(".github/workflows/release.yml");
ok(/tags:\s*\[[^\]]*"v\*"/.test(releaseWorkflow) && /contents:\s*write/.test(releaseWorkflow),
  "release workflow triggers on version tags with contents write permission");
ok(/release-preflight\.js[^\n]*--require-tag-in-base[^\n]*--require-release-tip[^\n]*--allow-remote-tag/.test(releaseWorkflow) &&
   /node hooks\/verify\.js/.test(releaseWorkflow),
"release workflow rejects tags outside main and runs VERIFY");
ok(/git archive/.test(releaseWorkflow) && /Get-FileHash[^\n]*SHA256/.test(releaseWorkflow) &&
   /Expand-Archive/.test(releaseWorkflow) && /gh release (?:create|upload)/.test(releaseWorkflow),
"release workflow builds, checksums, smoke-tests, and publishes a source ZIP");

// ---------- no-coauthor policy ----------
console.log("\nno-coauthor policy:");
const noCoauthor = require(NO_COAUTHOR);
ok(noCoauthor.hasForbiddenTrailer("Co-Authored-By: Claude <noreply@anthropic.com>"), "detects Co-Authored-By");
ok(noCoauthor.hasForbiddenTrailer("\\u{1F916} Generated with Claude Code"), "detects Generated with Claude");
ok(noCoauthor.hasForbiddenTrailer("generated by an AI assistant"), "detects generated by an AI");
ok(!noCoauthor.hasForbiddenTrailer("fix(proto): regenerate stubs generated with protoc"), "does not flag generated with protoc");
ok(!noCoauthor.hasForbiddenTrailer("feat(ui): add robot marker to status bar"), "does not flag a plain robot marker in normal text");
function noCoauthorExit(message) {
  const file = path.join(os.tmpdir(), "harness-no-coauthor-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".txt");
  fs.writeFileSync(file, message);
  try {
    execFileSync("node", [NO_COAUTHOR, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (e) {
    return e.status || 1;
  } finally {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}
ok(noCoauthorExit("feat(ui): add setting\n") === 0, "no coauthor policy assertion 1");
ok(noCoauthorExit("feat(ui): add setting\n\nCo-Authored-By: Claude <noreply@example.test>\n") === 1,
  "no coauthor policy assertion 2");

// ---------- guard: harness bypass ----------
console.log("\nguard: bypass detection:");
const bp = (cmd, env = {}) => gexit({ tool_name: "Bash", tool_input: { command: cmd } }, { ...sess("bp"), ...env });
ok(bp('git commit -m "feat: x" --no-verify') === 2, "guard bypass detection assertion 1");
ok(bp('git commit -n -m "feat: x"') === 2, "guard bypass detection assertion 2");
ok(bp("git push origin main --no-verify") === 2, "guard bypass detection assertion 3");
ok(bp("git config core.hooksPath /dev/null") === 2, "guard bypass detection assertion 4");
ok(bp('git -c core.hooksPath=/dev/null commit -m "feat: x"') === 2, "guard bypass detection assertion 5");
ok(bp("git.exe commit --no-verify -m x") === 2, "guard bypass detection assertion 6");
ok(bp("git.cmd commit -n -m x") === 2, "guard bypass detection assertion 7");
ok(bp("lefthook uninstall") === 2, "guard bypass detection assertion 8");
ok(bp('LEFTHOOK=0 git commit -m "feat: x"') === 2, "guard bypass detection assertion 9");
ok(bp("rm -rf .git/hooks") === 2, "guard bypass detection assertion 10");
ok(bp("ls .git/hooks") === 0, "guard bypass detection assertion 11");
ok(bp('git commit -m "docs: add -n / --no-verify support notes"') === 0, "guard bypass detection assertion 12");
ok(bp('git commit -m "feat(core): real change"') === 0, "guard bypass detection assertion 13");
ok(bp("git commit --no-verify -m x", { HARNESS_ACK_BYPASS: "1" }) === 0, "guard bypass detection assertion 14");
ok(!/HARNESS_ACK_BYPASS/.test(gout({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, sess("hint"))),
  "guard bypass detection assertion 15");

// ---------- branch-guard CLI ----------
console.log("\nbranch-guard:");
function runBranchGuard(root, env = {}) {
  try {
    execFileSync("node", [BRANCH_GUARD], { cwd: root, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (e) { return e.status || 1; }
}
const btmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-branchguard-"));
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: btmp });
ok(runBranchGuard(btmp) === 1, "branch guard assertion 1");
ok(runBranchGuard(btmp, { HARNESS_ALLOW_MAIN: "1" }) === 0, "branch guard assertion 2");
execFileSync("git", ["checkout", "-q", "-b", "feat/test"], { cwd: btmp });
ok(runBranchGuard(btmp) === 0, "branch guard assertion 3");
try { fs.rmSync(btmp, { recursive: true, force: true }); } catch {}

// ---------- guard: shell writes to protected paths ----------
console.log("\nguard: protected paths via shell:");
ok(bp("sed -i 's/x/y/' hooks/agent/guard.js") === 2, "guard protected paths via shell assertion 1");
ok(bp("echo bad >> lefthook.yml") === 2, "guard protected paths via shell assertion 2");
ok(bp("rm -rf hooks") === 2, "guard protected paths via shell assertion 3");
ok(bp("mv lefthook.yml lefthook.yml.bak") === 2, "guard protected paths via shell assertion 4");
ok(bp("tee .github/workflows/ci.yml") === 2, "guard protected paths via shell assertion 5");
ok(bp("del hooks\\agent\\guard.js") === 2, "guard protected paths via shell assertion 6");
ok(bp("move lefthook.yml lefthook.bak") === 2, "guard protected paths via shell assertion 7");
ok(bp("rd /s hooks") === 2, "guard protected paths via shell assertion 8");
ok(bp("Remove-Item lefthook.yml") === 2, "guard protected paths via shell assertion 9");
ok(bp("Set-Content .github\\workflows\\ci.yml -Value x") === 2, "guard protected paths via shell assertion 10");
ok(bp("Copy-Item x lefthook.yml") === 2, "block: Copy-Item into lefthook.yml (PowerShell, destination is second arg)");
ok(bp('rm "hooks/agent/guard.js"') === 2, "block: quoted protected path in POSIX shell command");
ok(bp('Remove-Item "lefthook.yml"') === 2, "block: quoted protected path in PowerShell command");
ok(bp('git commit -m "rm hooks/"') === 0, "does not treat quoted commit message text as a protected write");
ok(bp("del notes.txt") === 0, "guard protected paths via shell assertion 11");
ok(bp("Remove-Item build\\temp.log") === 0, "guard protected paths via shell assertion 12");
ok(bp("node hooks/verify.js") === 0, "guard protected paths via shell assertion 13");
ok(bp("node hooks/test.js") === 0, "guard protected paths via shell assertion 14");
ok(bp("cat hooks/agent/guard.js") === 0, "guard protected paths via shell assertion 15");
ok(bp("git add hooks/ lefthook.yml") === 0, "guard protected paths via shell assertion 16");
ok(bp("sed -i 's/x/y/' hooks/agent/guard.js", { HARNESS_ACK_BYPASS: "1" }) === 0, "guard protected paths via shell assertion 17");

// ---------- guard: protected-write bypass through inline interpreter eval ----------
console.log("\nguard: interpreter-eval protected write:");
ok(/inline-eval/i.test(gout({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('hooks/agent/guard.js','x')\"" } }, sess("ie1"))),
  "node -e writeFileSync in hooks/ -> inline-eval interpreter message");
ok(gexit({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('hooks/agent/guard.js','x')\"" } }, sess("ie1b")) === 2,
  "guard interpreter eval protected write assertion 1");
ok(gexit({ tool_name: "Bash", tool_input: { command: "python -c \"open('lefthook.yml','w').write('x')\"" } }, sess("ie2")) === 2,
  "guard interpreter eval protected write assertion 2");
ok(gexit({ tool_name: "Bash", tool_input: { command: "python -c \"from pathlib import Path; Path('hooks/agent/guard.js').write_text('x')\"" } }, sess("ie2b")) === 2,
  "guard interpreter eval protected write assertion 3");
ok(gexit({ tool_name: "Bash", tool_input: { command: "python -c \"import shutil; shutil.rmtree('hooks')\"" } }, sess("ie2c")) === 2,
  "guard interpreter eval protected write assertion 4");
ok(gexit({ tool_name: "Bash", tool_input: { command: "python -c \"import os; os.remove('lefthook.yml')\"" } }, sess("ie2d")) === 2,
  "guard interpreter eval protected write assertion 5");
ok(gexit({ tool_name: "Bash", tool_input: { command: "bash -c 'rm -rf hooks/'" } }, sess("ie3")) === 2,
  "guard interpreter eval protected write assertion 6");
ok(gexit({ tool_name: "Bash", tool_input: { command: "pwsh -EncodedCommand SQBFAFgAIAAoACcAaABvAG8AawBzAC8AYQBnAGUAbgB0AC8AZwB1AGEAcgBkAC4AagBzACcAKQA=" } }, sess("ie9")) === 2,
  "pwsh -EncodedCommand -> opaque eval is blocked");
ok(gexit({ tool_name: "Bash", tool_input: { command: "powershell -EncodedCommand SQBFAFgAIAAoACcAbABlAGYAdABoAG8AbwBrAC4AeQBtAGwAJwApAA==" } }, sess("ie10")) === 2,
  "powershell -EncodedCommand -> opaque eval is blocked");
ok(gexit({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs')['write'+'FileSync']('hooks/agent/guard.js','x')\"" } }, sess("ie11")) === 2,
  "node -e dynamic writeFileSync in hooks/ -> hard block");
ok(gexit({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('hooks/agent/guard.js','x')\"" } }, { ...sess("ie8"), HARNESS_ACK_BYPASS: "1" }) === 0,
  "guard interpreter eval protected write assertion 7");
ok(!/inline-eval/i.test(gout({ tool_name: "Bash", tool_input: { command: "node -e \"console.log(1+1)\"" } }, sess("ie4"))),
  "node -e without a write and without a harness path -> no note");
ok(!/inline-eval/i.test(gout({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('build/out.txt','x')\"" } }, sess("ie5"))),
  "node -e write to a normal file (build/) -> no note");
ok(!/inline-eval/i.test(gout({ tool_name: "Bash", tool_input: { command: "ssh -c aes256 host" } }, sess("ie6"))),
  "ssh -c ... -> no note (not an interpreter; `sh` in `ssh` does not match the word boundary)");
ok(!/inline-eval/i.test(gout({ tool_name: "Bash", tool_input: { command: "node hooks/verify.js" } }, sess("ie7"))),
  "node hooks/verify.js (without -e) -> no note");

// ---------- guard: stream corruption ----------
console.log("\nguard: stream corruption:");
ok(bp("cd /x && echo garbage 183<tool_call>") === 2, "guard stream corruption assertion 1");
ok(bp("echo garbage </tool_use> x") === 2, "guard stream corruption assertion 2");
ok(bp("echo a echo a echo a echo a echo a") === 2, "guard stream corruption assertion 3");
ok(bp("cat > a.html <<EOF\n<toolbar>hi</toolbar>\nEOF") === 0, "guard stream corruption assertion 4");

// ---------- guard: shell loops ----------
console.log("\nguard: shell loops:");
let S = sess("triv");
let last = 0;
for (const c of ["echo a", "echo b", "ls", "pwd", "echo c"]) last = gexit({ tool_name: "Bash", tool_input: { command: c } }, S);
ok(last === 2, "guard shell loops assertion 1");
S = sess("real-reset");
gexit({ tool_name: "Bash", tool_input: { command: "echo a" } }, S);
gexit({ tool_name: "Bash", tool_input: { command: "npm run build -- --verbose" } }, S);
for (const c of ["echo b", "echo c", "ls"]) last = gexit({ tool_name: "Bash", tool_input: { command: c } }, S);
ok(last === 0, "guard shell loops assertion 2");
S = sess("ident");
for (let i = 0; i < 5; i++) last = gexit({ tool_name: "Bash", tool_input: { command: "npm run build -- --verbose" } }, S);
ok(last === 2, "guard shell loops assertion 3");
S = sess("alt");
for (let i = 0; i < 5; i++) {
  gexit({ tool_name: "Bash", tool_input: { command: "npm test -- --run-suite alpha" } }, S);
  last = gexit({ tool_name: "Bash", tool_input: { command: "git diff --stat HEAD~1" } }, S);
}
ok(last === 2, "guard shell loops assertion 4");
S = sess("alt-break");
for (let i = 0; i < 4; i++) {
  gexit({ tool_name: "Bash", tool_input: { command: "npm test -- --run-suite alpha" } }, S);
  gexit({ tool_name: "Bash", tool_input: { command: "git diff --stat HEAD~1" } }, S);
}
last = gexit({ tool_name: "Bash", tool_input: { command: "node hooks/verify.js --list" } }, S);
ok(last === 0, "guard shell loops assertion 5");

// ---------- guard: file-tool loops ----------
console.log("\nguard: file-tool loops:");
S = sess("ft");
for (let i = 0; i < 12; i++) last = gexit({ tool_name: "Read", tool_input: { file_path: "/tmp/same.txt" } }, S);
ok(last === 2, "guard file tool loops assertion 1");
S = sess("ft2");
for (let i = 0; i < 11; i++) gexit({ tool_name: "Edit", tool_input: { file_path: "/tmp/a.py" } }, S);
ok(gexit({ tool_name: "Edit", tool_input: { file_path: "/tmp/b.py" } }, S) === 0, "guard file tool loops assertion 2");
ok(gexit({ tool_name: "Read", tool_input: {} }, sess("ft3")) === 0, "guard file tool loops assertion 3");

// ---------- guard: protected harness files ----------
console.log("\nguard: protected harness files:");
const ed = (fp, env = {}) => gexit({ tool_name: "Edit", tool_input: { file_path: fp } }, { ...sess("prot"), ...env });
ok(ed("lefthook.yml") === 2, "guard protected harness files assertion 1");
ok(ed("hooks/agent/guard.js") === 2, "guard protected harness files assertion 2");
ok(gexit({ tool_name: "Write", tool_input: { filename: "hooks/agent/guard.js" } }, sess("prot-alias")) === 2,
  "block: protected file write through filename path alias");
ok(ed(".claude/settings.json") === 2, "guard protected harness files assertion 3");
ok(ed(".github/workflows/ci.yml") === 2, "guard protected harness files assertion 4");
ok(ed("src/app.py") === 0, "guard protected harness files assertion 5");
ok(ed("lefthook.yml", { HARNESS_ACK_BYPASS: "1" }) === 0, "guard protected harness files assertion 6");
ok(ed("./lefthook.yml") === 2, "guard protected harness files assertion 7");
ok(ed("design/../hooks/agent/guard.js") === 2, "guard protected harness files assertion 8");
ok(ed("Lefthook.yml") === 2, "guard protected harness files assertion 9");
ok(ed("hooks2/readme.md") === 0, "guard protected harness files assertion 10");

// ---------- guard: lint-config protection (ECC config-protection pattern) ----------
console.log("\nguard: lint-config protection:");
fs.writeFileSync(path.join(NEUTRAL, ".eslintrc.json"), "{}");
ok(ed(".eslintrc.json") === 2, "guard lint config protection assertion 1");
ok(ed("ruff.toml") === 0, "guard lint config protection assertion 2");
ok(ed(".eslintrc.json", { HARNESS_ACK_BYPASS: "1" }) === 0, "guard lint config protection assertion 3");
ok(ed("pyproject.toml") === 0, "guard lint config protection assertion 4");
ok(bp("sed -i 's/select/ignore/' ruff.toml") === 2, "guard lint config protection assertion 5");
ok(bp("Set-Content src\\.eslintrc.json -Value x") === 2, "guard lint config protection assertion 6");
ok(bp("del ruff.toml") === 2, "guard lint config protection assertion 7");
ok(bp("echo lax >> src/.eslintrc.json") === 2, "guard lint config protection assertion 8");
ok(bp("cat ruff.toml") === 0, "guard lint config protection assertion 9");
ok(bp("rm myruff.toml") === 0, "guard lint config protection assertion 10");
ok(bp("echo x > src/hooks/useAuth.ts") === 0, "guard lint config protection assertion 11");

cases("guard: red-team adversarial fixtures", [
  { name: "block shell write through src/../hooks traversal", cmd: "echo x > src/../hooks/agent/guard.js", exit: 2 },
  { name: "block shell delete through design/../hooks traversal", cmd: "rm design/../hooks/agent/guard.js", exit: 2 },
  { name: "block PowerShell write through ./ protected path", cmd: "Set-Content ./lefthook.yml -Value x", exit: 2 },
  { name: "block cmd copy into workflow config", cmd: "copy x .github\\workflows\\ci.yml", exit: 2 },
  { name: "allow ordinary project path containing hooks segment", cmd: "echo x > src/hooks/useAuth.ts", exit: 0 },
  { name: "block node -e fs.rmSync against hooks root", cmd: "node -e \"require('fs').rmSync('hooks',{recursive:true})\"", exit: 2 },
  { name: "block python -c traversal into hooks root", cmd: "python -c \"open('src/../hooks/agent/guard.js','w').write('x')\"", exit: 2 },
  { name: "block ruby -e File.write against protected file", cmd: "ruby -e \"File.write('lefthook.yml','x')\"", exit: 2 },
  { name: "block installation baseline tampering", cmd: "echo x > .harness/installation.json", exit: 2 },
  { name: "allow interpreter write to ordinary src/hooks project file", cmd: "python -c \"open('src/hooks/useAuth.ts','w').write('x')\"", exit: 0 },
], (c) => bp(c.cmd, c.env || {}) === c.exit);

cases("guard: red-team file path aliases", [
  { name: "block targetFile alias with normalized protected traversal", tool: "Create", input: { targetFile: "design/../hooks/agent/guard.js" }, exit: 2 },
  { name: "block target_file alias for ruleset", tool: "Write", input: { target_file: ".github/rulesets/main.json" }, exit: 2 },
  { name: "block filename alias for .git/hooks write", tool: "Write", input: { filename: ".git/hooks/pre-commit" }, exit: 2 },
  { name: "block file-tool installation baseline tampering", tool: "Write", input: { file_path: ".harness/installation.json" }, exit: 2 },
  { name: "allow mixed-purpose pyproject.toml", tool: "Edit", input: { file_path: "pyproject.toml" }, exit: 0 },
], (c) => gexit({ tool_name: c.tool, tool_input: c.input }, sess("rt-file")) === c.exit);

// ---------- guard: fact-force (EXPLORE before IMPLEMENT, ECC GateGuard pattern) ----------
console.log("\nguard: fact-force:");
fs.writeFileSync(path.join(NEUTRAL, "existing.py"), "x = 1");
let SF = sess("ff");
ok(/before reading/i.test(gout({ tool_name: "Edit", tool_input: { file_path: "existing.py" } }, SF)),
  "Edit existing file without Read -> note");
ok(!/before reading/i.test(gout({ tool_name: "Edit", tool_input: { file_path: "existing.py" } }, SF)),
  "second edit of the same file -> note once, no spam");
SF = sess("ff2");
grun({ tool_name: "Read", tool_input: { file_path: "existing.py" } }, SF);
ok(!/before reading/i.test(gout({ tool_name: "Edit", tool_input: { file_path: "existing.py" } }, SF)),
  "Read before Edit -> no note");
ok(!/before reading/i.test(gout({ tool_name: "Write", tool_input: { file_path: "brand-new.py" } }, sess("ff3"))),
  "Write new file -> no note (nothing to read)");

// ---------- guard: strictness profiles ----------
console.log("\nguard: strictness profiles:");
ok(gexit({ tool_name: "Edit", tool_input: { file_path: ".eslintrc.json" } }, { ...sess("pf1"), HARNESS_PROFILE: "minimal" }) === 0,
  "guard strictness profiles assertion 1");
ok(gexit({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, { ...sess("pf2"), HARNESS_PROFILE: "minimal" }) === 2,
  "guard strictness profiles assertion 2");
ok(gexit({ tool_name: "Edit", tool_input: { file_path: "lefthook.yml" } }, { ...sess("pf3"), HARNESS_PROFILE: "minimal" }) === 2,
  "guard strictness profiles assertion 3");
let SP = sess("pf4"), lastP = 0;
for (const c of ["echo a", "echo b", "ls", "pwd", "echo c"]) lastP = gexit({ tool_name: "Bash", tool_input: { command: c } }, { ...SP, HARNESS_PROFILE: "minimal" });
ok(lastP === 0, "guard strictness profiles assertion 4");
SP = sess("pf5");
for (let i = 0; i < 3; i++) lastP = gexit({ tool_name: "Bash", tool_input: { command: "npm run build" } }, { ...SP, HARNESS_PROFILE: "strict" });
ok(lastP === 2, "guard strictness profiles assertion 5");
ok(gexit({ tool_name: "Edit", tool_input: { file_path: ".eslintrc.json" } }, { ...sess("pf6"), HARNESS_DISABLED_CHECKS: "lintconfig" }) === 0,
  "guard strictness profiles assertion 6");

// ---------- guard: DESIGN note ----------
console.log("\nguard: design note:");
const dn = gout({ tool_name: "Edit", tool_input: { file_path: "src/ui/panel.qml" } }, sess("dn1"));
ok(/DESIGN|mockup/i.test(dn), "UI file edit -> DESIGN-stage note");
ok(/"hookSpecificOutput"/.test(dn) && /"hookEventName"\s*:\s*"PreToolUse"/.test(dn),
  "guard design note assertion 1");
const dn2 = gout({ tool_name: "Edit", tool_input: { file_path: "src/core/logic.py" } }, sess("dn2"));
ok(!/DESIGN|mockup/i.test(dn2), "ordinary file -> no note");
const dnXaml = gout({ tool_name: "Edit", tool_input: { file_path: "src/Desktop/App.xaml" } }, sess("dn-xaml"));
const dnReact = gout({ tool_name: "Edit", tool_input: { file_path: "src/components/Toolbar.tsx" } }, sess("dn-react"));
const dnGenerated = gout({ tool_name: "Edit", tool_input: { file_path: "src/components/Toolbar.test.tsx" } }, sess("dn-generated"));
ok(/DESIGN|mockup/i.test(dnXaml) && /DESIGN|mockup/i.test(dnReact),
  "UI auto-detection covers desktop XAML and React components");
ok(!/DESIGN|mockup/i.test(dnGenerated),
  "UI exclusions keep test/generated paths out of DESIGN routing");
fs.writeFileSync(path.join(NEUTRAL, "harness.config.json"), JSON.stringify({ capabilities: { ui: "none" } }));
const dnDisabled = gout({ tool_name: "Edit", tool_input: { file_path: "src/components/Disabled.tsx" } }, sess("dn-disabled"));
fs.rmSync(path.join(NEUTRAL, "harness.config.json"), { force: true });
ok(!/DESIGN|mockup/i.test(dnDisabled), "ui:none disables automatic DESIGN routing");

// ---------- guard: CLI wrapper (spawn-based stdin/exit-code contract) ----------
console.log("\nguard: CLI contract:");
ok(runHook(GUARD, { tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, sess("cli1")) === 2, "guard cli contract assertion 1");
ok(runHook(GUARD, { tool_name: "Bash", tool_input: { command: "echo ok" } }, sess("cli2")) === 0, "CLI: allow -> exit 0");
ok(typeof guardMod.run === "function", "guard cli contract assertion 2");
const rr = grun({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, sess("ip1"));
ok(rr.exitCode === 2 && /guard/.test(rr.stderr), "guard cli contract assertion 3");

// ---------- guard: fail-closed on malformed input ----------
console.log("\nguard: fail-closed input:");
function runRaw(hookPath, rawStr, env = {}) {
  try {
    execFileSync("node", [hookPath], { input: rawStr, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    return 0;
  } catch (e) { return e.status || 1; }
}
ok(runRaw(GUARD, "{broken json...", sess("fc1")) === 2, "guard fail closed input assertion 1");
ok(runRaw(GUARD, "", sess("fc2")) === 0, "guard fail closed input assertion 2");

// ---------- design-gate ----------
console.log("\ndesign-gate:");
function gate(root, files) {
  try {
    execFileSync("node", [DESIGN_GATE, "--root", root, "--files", files.join(",")], { encoding: "utf8", stdio: "pipe" });
    return 0;
  } catch (e) { return e.status || 1; }
}
function gateResult(root, files) {
  try {
    return JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", root, "--files", files.join(","), "--json"], { encoding: "utf8", stdio: "pipe" }));
  } catch (e) { try { return JSON.parse(String(e.stdout || "{}")); } catch { return {}; } }
}
function mockupExit(root, args) {
  try {
    execFileSync("node", [NEW_MOCKUPS, ...args], { env: { ...process.env, HARNESS_ROOT: root }, encoding: "utf8", stdio: "pipe" });
    return 0;
  } catch (e) { return e.status || 1; }
}
const dtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-design-"));
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1, "design gate assertion 1");
ok((gateResult(dtmp, ["src/Dropwheel/UI/Foo.xaml"]).uiChanged || []).includes("src/Dropwheel/UI/Foo.xaml"),
  "design gate assertion 2");
ok(gate(dtmp, ["src/core/logic.py"]) === 0, "design gate assertion 3");
const staleMain = fs.mkdtempSync(path.join(os.tmpdir(), "harness-design-stale-main-"));
function sgit(args) {
  return execFileSync("git", args, { cwd: staleMain, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function swrite(rel, text) {
  const p = path.join(staleMain, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
sgit(["init", "-q", "-b", "main"]);
sgit(["config", "user.name", "Harness Test"]);
sgit(["config", "user.email", "harness@example.test"]);
swrite("README.md", "base\n");
sgit(["add", "."]);
sgit(["commit", "-q", "-m", "chore: base"]);
const baseCommit = sgit(["rev-parse", "HEAD"]);
sgit(["branch", "feature/readme"]);
swrite("src/ui/app.js", "console.log('ui');\n");
for (let i = 1; i <= 4; i++) swrite(`design/mockups/open/${String(i).padStart(2, "0")}.html`, "<!doctype html>\n");
swrite("design/mockups/open/APPROVED", "approved\n");
sgit(["add", "."]);
sgit(["commit", "-q", "-m", "feat(ui): add upstream ui"]);
const remoteMain = sgit(["rev-parse", "HEAD"]);
sgit(["update-ref", "refs/remotes/origin/main", remoteMain]);
sgit(["update-ref", "refs/heads/main", baseCommit]);
sgit(["checkout", "-q", "-f", "feature/readme"]);
sgit(["merge", "-q", "--no-ff", "-m", "merge origin/main", "origin/main"]);
fs.appendFileSync(path.join(staleMain, "README.md"), "feature\n");
sgit(["add", "README.md"]);
sgit(["commit", "-q", "-m", "docs(readme): update"]);
let staleGate = {};
try {
  staleGate = JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", staleMain, "--json"], { encoding: "utf8", stdio: "pipe" }));
} catch (e) { try { staleGate = JSON.parse(String(e.stdout || "{}")); } catch {} }
ok(staleGate.base === "origin/main" && Array.isArray(staleGate.uiChanged) && staleGate.uiChanged.length === 0,
  "design-gate default prefers origin/main, so stale local main does not add upstream UI noise");
fs.mkdirSync(path.join(staleMain, "src", "ui"), { recursive: true });
fs.writeFileSync(path.join(staleMain, "src", "ui", "scratch.ui"), "<ui/>\n");
staleGate = {};
try {
  staleGate = JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", staleMain, "--json"], { encoding: "utf8", stdio: "pipe" }));
} catch (e) { try { staleGate = JSON.parse(String(e.stdout || "{}")); } catch {} }
ok(Array.isArray(staleGate.uiChanged) && staleGate.uiChanged.length === 0,
  "design-gate ignores untracked local UI files; it gates branch diff, not dirty workspace noise");
try { fs.rmSync(staleMain, { recursive: true, force: true }); } catch {}
ok(mockupExit(dtmp, ["missing-kind"]) === 1,
  "new-mockups requires an explicit change kind");
ok(mockupExit(dtmp, ["motion-missing-example", "--kind", "animation", "--fidelity", "text"]) === 1,
  "animation evidence requires a concrete example");
execFileSync("node", [NEW_MOCKUPS, "login", "--kind", "new-ui"], { env: { ...process.env, HARNESS_ROOT: dtmp }, stdio: "pipe" });
const fdir = path.join(dtmp, "design", "mockups", "login");
ok(fs.readdirSync(fdir).filter((f) => f.endsWith(".html")).length === 4, "design gate assertion 4");
let loginManifest = {};
try { loginManifest = JSON.parse(fs.readFileSync(path.join(fdir, "DESIGN.json"), "utf8")); } catch {}
const newUiRoots = new Set(loginManifest.variants.map((variant) => {
  const source = fs.readFileSync(path.join(fdir, variant.file), "utf8");
  return (source.match(/:root \{[^}]+/) || [""])[0];
}));
ok(loginManifest.kind === "new-ui" && loginManifest.variants.length === 4 && newUiRoots.size === 4,
  "new-ui scaffold declares four stylistic variants");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/login/01-minimal-light.html"]) === 1,
  "design gate assertion 5");
fs.writeFileSync(path.join(fdir, "APPROVED"), "approved: test\nui: src/ui/main_window.ui\n");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/login/APPROVED"]) === 0,
  "design gate assertion 6");
ok(gateResult(dtmp, ["src/ui/main_window.ui", "design/mockups/login/APPROVED"]).mockups.kind === "new-ui",
  "design gate reports the approved evidence kind");
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1,
  "design gate assertion 7");
ok(gate(dtmp, ["design/mockups/login/02-dark-pro.html"]) === 0, "design gate assertion 8");

const baselinePath = path.join(dtmp, "src", "ui", "current-panel.ui");
fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
fs.writeFileSync(baselinePath, "<ui/>\n");
ok(mockupExit(dtmp, ["existing-no-baseline", "--kind", "existing-ui"]) === 1,
  "existing-ui scaffold requires a baseline path");
ok(mockupExit(dtmp, ["existing-panel", "--kind", "existing-ui", "--baseline", "src/ui/current-panel.ui"]) === 0,
  "existing-ui scaffold accepts a current UI baseline");
const existingDir = path.join(dtmp, "design", "mockups", "existing-panel");
const existingManifest = JSON.parse(fs.readFileSync(path.join(existingDir, "DESIGN.json"), "utf8"));
const existingRoots = new Set(existingManifest.variants.map((variant) => {
  const source = fs.readFileSync(path.join(existingDir, variant.file), "utf8");
  return (source.match(/:root \{[^}]+/) || [""])[0];
}));
ok(existingManifest.kind === "existing-ui" && existingManifest.baselineReferences[0] === "src/ui/current-panel.ui" &&
   existingManifest.variants.every((variant) => /(?:inline|toolbar|side-panel|contextual)/.test(variant.file)) && existingRoots.size === 1,
"existing-ui scaffold keeps one baseline and compares layouts");
fs.writeFileSync(path.join(existingDir, "APPROVED"), "approved: test\n");
ok(gate(dtmp, ["src/ui/current-panel.ui", "design/mockups/existing-panel/APPROVED"]) === 0,
  "design gate accepts approved existing-ui layout evidence");
fs.rmSync(baselinePath);
ok(gate(dtmp, ["src/ui/current-panel.ui", "design/mockups/existing-panel/APPROVED"]) === 1,
  "design gate rejects existing-ui evidence with a missing baseline");
fs.writeFileSync(baselinePath, "<ui/>\n");

ok(mockupExit(dtmp, ["reorder-motion-text", "--kind", "animation", "--fidelity", "text", "--example", "Tile A moves before Tile B"]) === 0,
  "animation/text scaffold is generated for a concrete example");
const motionTextDir = path.join(dtmp, "design", "mockups", "reorder-motion-text");
const motionTextManifest = JSON.parse(fs.readFileSync(path.join(motionTextDir, "DESIGN.json"), "utf8"));
ok(motionTextManifest.kind === "animation" && motionTextManifest.fidelity === "text" &&
   motionTextManifest.example === "Tile A moves before Tile B" && motionTextManifest.variants.every((variant) =>
     variant.file.endsWith(".md") && fs.readFileSync(path.join(motionTextDir, variant.file), "utf8").includes("Concrete example: Tile A moves before Tile B")),
"animation/text uses four written variants instead of visual themes");
fs.writeFileSync(path.join(motionTextDir, "APPROVED"), "approved: test\nui: src/ui/main_window.ui\n");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/reorder-motion-text/APPROVED"]) === 0,
  "design gate accepts approved written motion evidence");

ok(mockupExit(dtmp, ["reorder-motion-js", "--kind", "animation", "--fidelity", "js", "--example", "Tile A moves before Tile B"]) === 0,
  "animation/js scaffold is generated for a concrete example");
const motionJsDir = path.join(dtmp, "design", "mockups", "reorder-motion-js");
const motionJsManifest = JSON.parse(fs.readFileSync(path.join(motionJsDir, "DESIGN.json"), "utf8"));
ok(motionJsManifest.variants.every((variant) => {
  const source = fs.readFileSync(path.join(motionJsDir, variant.file), "utf8");
  return /<script/.test(source) && /\.animate\s*\(/.test(source);
}), "animation/js creates executable JavaScript motion variants");
fs.writeFileSync(path.join(motionJsDir, "APPROVED"), "approved: test\nui: src/ui/main_window.ui\n");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/reorder-motion-js/APPROVED"]) === 0,
  "design gate accepts approved JavaScript motion evidence");
fs.writeFileSync(path.join(motionJsDir, motionJsManifest.variants[0].file), "<!doctype html>\n");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/reorder-motion-js/APPROVED"]) === 1,
  "design gate rejects a claimed JavaScript variant without executable motion");

let backendOutput = "";
try {
  backendOutput = execFileSync("node", [NEW_MOCKUPS, "server-cache", "--kind", "backend"],
    { env: { ...process.env, HARNESS_ROOT: dtmp }, encoding: "utf8", stdio: "pipe" });
} catch {}
ok(/SKIP mockups/.test(backendOutput) && !fs.existsSync(path.join(dtmp, "design", "mockups", "server-cache")),
  "backend-only classification creates no mockup artifacts");
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1,
  "backend classification cannot bypass a changed UI path");

const legacyDir = path.join(dtmp, "design", "mockups", "legacy-set");
fs.mkdirSync(legacyDir, { recursive: true });
for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(legacyDir, `${i}.html`), "<!doctype html>\n");
fs.writeFileSync(path.join(legacyDir, "APPROVED"), "approved: legacy\nui: src/ui/main_window.ui\n");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/legacy-set/APPROVED"]) === 0,
  "design gate preserves compatibility with scoped approved legacy sets without DESIGN.json");
ok(gate(dtmp, ["src/ui/tile-reorder.ui", "design/mockups/legacy-set/APPROVED"]) === 1,
  "design gate rejects a touched approval scoped to an unrelated UI path");

const waiverDir = path.join(dtmp, "design", "mockups", "tile-reorder");
fs.mkdirSync(waiverDir, { recursive: true });
fs.writeFileSync(path.join(waiverDir, "WAIVER.json"), JSON.stringify({
  schemaVersion: 1,
  feature: "tile-reorder",
  uiPaths: ["src/ui/tile-reorder.ui"],
  reason: "User approved skipping new mockups for a non-restyling interaction change.",
  date: "2026-07-09",
  approvedBy: "user",
}, null, 2) + "\n");
ok(gateResult(dtmp, ["src/ui/tile-reorder.ui", "design/mockups/tile-reorder/WAIVER.json"]).mockups.kind === "waiver",
  "design gate accepts a scoped explicit waiver for a UI-path change");
ok(gate(dtmp, ["src/ui/other.ui", "design/mockups/tile-reorder/WAIVER.json"]) === 1,
  "design gate rejects a waiver scoped to an unrelated UI path");
// Missing diff base is fail-open locally, but loud (skipped:true in --json).
const noGit = fs.mkdtempSync(path.join(os.tmpdir(), "harness-nogit-"));
let gateJson = {};
try {
  gateJson = JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", noGit, "--base", "no-such-ref", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch (e) { try { gateJson = JSON.parse(String(e.stdout || "{}")); } catch {} }
ok(gateJson.skipped === true && /gate skipped|diff/i.test(gateJson.warn || ""),
  "unavailable diff base -> fail-open with explicit warning, not silent skip");
let strictExit = 0, strictJson = {};
try {
  execFileSync("node", [DESIGN_GATE, "--root", noGit, "--base", "no-such-ref", "--strict", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  strictExit = e.status || 1;
  try { strictJson = JSON.parse(String(e.stdout || "{}")); } catch {}
}
ok(strictExit === 1 && strictJson.skipped === true && strictJson.ok === false,
  "design gate assertion 9");
try { fs.rmSync(noGit, { recursive: true, force: true }); } catch {}
try { fs.rmSync(dtmp, { recursive: true, force: true }); } catch {}

// ---------- verify runner ----------
console.log("\nverify runner:");
ok(typeof verifyCore.planVerifyTargets === "function" && typeof verifyCore.debugAudit === "function",
  "verify-core exports planning and audit policy");
const sourceIntegrityTmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-source-integrity-"));
fs.mkdirSync(path.join(sourceIntegrityTmp, "hooks"));
fs.writeFileSync(path.join(sourceIntegrityTmp, "install.js"), "// source marker\n");
fs.writeFileSync(path.join(sourceIntegrityTmp, "hooks", "verify.js"), "// verify marker\n");
const sourceIntegrityPlan = verifyCore.planVerifyTargets(sourceIntegrityTmp, [], {}).targets;
ok(sourceIntegrityPlan.some((target) => target.stack.id === "source-harness" &&
   (target.stack.steps || []).some((step) => step.run === "node test.js")),
  "verify source integrity: missing hooks/test.js still schedules a failing source self-test command");
fs.rmSync(sourceIntegrityTmp, { recursive: true, force: true });
function verifyExit(root) {
  try { execFileSync("node", [VERIFY, "--root", root], { encoding: "utf8", stdio: "pipe", maxBuffer: 8 * 1024 * 1024 }); return 0; }
  catch (e) { return e.status || 1; }
}
function verifyOutput(root) {
  try { return execFileSync("node", [VERIFY, "--root", root], { encoding: "utf8", stdio: "pipe", maxBuffer: 8 * 1024 * 1024 }); }
  catch (e) { return String(e.stdout || "") + String(e.stderr || ""); }
}
function verifyList(root) {
  try { return JSON.parse(execFileSync("node", [VERIFY, "--root", root, "--list", "--json"], { encoding: "utf8", stdio: "pipe" })); }
  catch { return { plan: [] }; }
}
const vtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verify-"));
fs.writeFileSync(path.join(vtmp, "Cargo.toml"), "[package]\n");
fs.mkdirSync(path.join(vtmp, "app"));
fs.writeFileSync(path.join(vtmp, "app", "App.csproj"), "<Project/>");
fs.writeFileSync(path.join(vtmp, "pyproject.toml"), "[project]\n");
const ids = verifyList(vtmp).plan.map((p) => p.stack);
ok(ids.includes("rust") && ids.includes("dotnet") && ids.includes("python"),
  "verify runner assertion 1");
const dotnetPlan = verifyList(vtmp).plan.find((p) => p.stack === "dotnet");
ok(dotnetPlan && dotnetPlan.steps.includes("format"), "verify runner assertion 2");
const universalFixtures = [
  { name: "Node backend", files: ["package.json", "src/server.js"], stacks: ["node"], ui: false },
  { name: "React UI", files: ["package.json", "src/components/App.tsx"], stacks: ["node"], ui: true, uiPath: "src/components/App.tsx" },
  { name: "Python service", files: ["pyproject.toml", "src/service.py"], stacks: ["python"], ui: false },
  { name: ".NET service", files: ["src/Service/Service.csproj", "src/Service/Program.cs"], stacks: ["dotnet"], ui: false },
  { name: "WPF desktop", files: ["src/Desktop/Desktop.csproj", "src/Desktop/App.xaml"], stacks: ["dotnet"], ui: true, uiPath: "src/Desktop/App.xaml" },
  { name: "Rust service", files: ["Cargo.toml", "src/main.rs"], stacks: ["rust"], ui: false },
  { name: "Tauri mixed", files: ["package.json", "src-tauri/Cargo.toml", "src/App.tsx"], stacks: ["node", "rust"], ui: true, uiPath: "src/App.tsx" },
  { name: "mixed monorepo", files: ["apps/web/package.json", "services/api/pyproject.toml"], stacks: ["node", "python"], ui: false },
];
for (const fixture of universalFixtures) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-stack-fixture-"));
  for (const rel of fixture.files) {
    const abs = path.join(root, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, "{}\n");
  }
  const stacks = new Set(verifyCore.detect(root, verifyCore.DEFAULT_STACKS).map((target) => target.stack.id));
  const ui = fixture.uiPath ? sharedLib.isUiPath(fixture.uiPath, sharedLib.loadConfig(root)) : false;
  ok(fixture.stacks.every((id) => stacks.has(id)) && ui === fixture.ui,
    `universal fixture: ${fixture.name} routes stacks and UI capability correctly`);
  fs.rmSync(root, { recursive: true, force: true });
}
ok(/dotnet format --verify-no-changes[^}]*optional:\s*true/.test(readRepo("hooks/verify-core.js")),
  "dotnet format --verify-no-changes is optional only when the tool is missing");
const etmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifyexec-"));
fs.writeFileSync(path.join(etmp, "m.txt"), "x");
fs.writeFileSync(path.join(etmp, "stepA.js"), "process.exit(0)");
fs.writeFileSync(path.join(etmp, "stepB.js"), "require('fs').writeFileSync('ran_b','1');console.error('error WHITESPACE: fix me');process.exit(2)");
fs.writeFileSync(path.join(etmp, "stepC.js"), "require('fs').writeFileSync('ran_c','1')");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { failFast: true, stacks: [{ id: "t", markers: ["m.txt"], steps: [
  { name: "a", run: "node stepA.js" }, { name: "b", run: "node stepB.js" }, { name: "c", run: "node stepC.js" }] }] } }));
ok(verifyExit(etmp) === 1, "verify runner assertion 3");
ok(fs.existsSync(path.join(etmp, "ran_b")) && !fs.existsSync(path.join(etmp, "ran_c")),
  "verify runner assertion 4");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "opt", run: "node stepB.js", optional: true }] }] } }));
const optOut = verifyOutput(etmp);
ok(/error WHITESPACE: fix me[\s\S]*VERIFY failed: t\/opt @ \.: optional step ran but failed with exit 2/.test(optOut),
  "optional step failure is enforced once the command runs");
fs.writeFileSync(path.join(etmp, "big.js"), "process.stdout.write('x'.repeat(2 * 1024 * 1024));");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "big", run: "node big.js" }] }] } }));
ok(verifyExit(etmp) === 0, "verify runner assertion 6");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "ok2", run: "node stepB.js", okCodes: { 2: "allowed" } }] }] } }));
ok(verifyExit(etmp) === 0, "okCodes: allowed non-zero exit (for example pytest 5 no tests) -> warning, not failure");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "missing", run: "definitely_missing_harness_cmd_zzzz" }] }] } }));
ok(verifyExit(etmp) === 1, "missing required command -> clear VERIFY failure");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "missing-opt", run: "definitely_missing_harness_cmd_zzzz", optional: true }] }] } }));
ok(/optional tool not found - step skipped[\s\S]*VERIFY passed/.test(verifyOutput(etmp)),
  "missing optional command -> warning and skip");
fs.writeFileSync(path.join(etmp, "slow.js"), "setTimeout(() => {}, 5000);\n");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "slow", run: "node slow.js", timeoutMs: 50 }] }] } }));
ok(/timeout after 50ms/.test(verifyOutput(etmp)), "verify timeout: hung step is killed and reported clearly");

// --changed: stack filtering by branch diff, made deterministic with --files.
function verifyListArgs(root, extra) {
  try { return JSON.parse(execFileSync("node", [VERIFY, "--root", root, "--list", "--json", ...extra], { encoding: "utf8", stdio: "pipe" })); }
  catch { return { plan: [] }; }
}
function verifyExitArgs(root, extra) {
  try { execFileSync("node", [VERIFY, "--root", root, ...extra], { encoding: "utf8", stdio: "pipe" }); return 0; }
  catch (e) { return e.status || 1; }
}
const ctmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifychg-"));
fs.mkdirSync(path.join(ctmp, "py")); fs.writeFileSync(path.join(ctmp, "py", "pyproject.toml"), "[project]\n");
fs.mkdirSync(path.join(ctmp, "js")); fs.writeFileSync(path.join(ctmp, "js", "package.json"), "{}\n");
fs.mkdirSync(path.join(ctmp, "hooks")); fs.writeFileSync(path.join(ctmp, "hooks", "verify.js"), "console.log('fake verify');\n");
fs.mkdirSync(path.join(ctmp, ".codex", "canary-worktrees", "run", "src"), { recursive: true });
fs.writeFileSync(path.join(ctmp, ".codex", "canary-worktrees", "run", "src", "Ignored.csproj"), "<Project/>");
const syntaxTmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifysyntax-"));
fs.mkdirSync(path.join(syntaxTmp, "hooks"));
fs.writeFileSync(path.join(syntaxTmp, "hooks", "verify.js"), "function {\n");
ok(verifyExit(syntaxTmp) === 1, "verify always fails broken harness JS syntax even when no app stack is detected");
try { fs.rmSync(syntaxTmp, { recursive: true, force: true }); } catch {}
let chg = verifyListArgs(ctmp, ["--changed", "--files", "py/app.py"]);
ok(chg.plan.length === 1 && chg.plan[0].stack === "python" && chg.plan[0].dir === "py",
  "verify runner assertion 7");
chg = verifyListArgs(ctmp, ["--changed", "--files", "js/index.js,py/app.py"]);
ok(chg.plan.map((p) => p.stack).sort().join(",") === "node,python",
  "verify runner assertion 8");
ok(verifyExitArgs(ctmp, ["--changed", "--files", ""]) === 0 && verifyListArgs(ctmp, ["--changed", "--files", ""]).plan.length === 0,
  "verify runner assertion 9");
const allIds = verifyListArgs(ctmp, []).plan.map((p) => p.stack).sort().join(",");
const fbIds = verifyListArgs(ctmp, ["--changed", "--base", "no-such-ref"]).plan.map((p) => p.stack).sort().join(",");
ok(allIds === "harness-syntax,node,python" && fbIds === "harness-syntax,node,python",
  "verify runner assertion 10");
ok(!verifyListArgs(ctmp, []).plan.some((p) => String(p.dir || "").includes(".codex")),
  "verify ignores .codex automation worktrees");
chg = verifyListArgs(ctmp, ["--changed", "--files", "hooks/verify.js"]);
ok(chg.plan.some((p) => p.stack === "harness-syntax"),
  "verify runner assertion 11");
chg = verifyListArgs(ctmp, ["--changed", "--files", "py\\..\\js\\index.js"]);
ok(chg.plan.length === 1 && chg.plan[0].stack === "node",
  "--changed: explicit --files paths are normalized before stack filtering");
{
  const scoped = sharedLib.changedFiles("main", ctmp, [
    "./py/app.py",
    "py\\app.py",
    "py/../js/index.js",
    path.join(ctmp, "js", "abs.js"),
    "../escape.js",
    "C:/outside.js",
  ]);
  ok(scoped.explicit === true && scoped.includeDirty === false &&
     scoped.files.join(",") === "py/app.py,js/index.js,js/abs.js",
    "changedFiles: explicit scope is normalized, deduped, and repo-confined");
}
try { fs.rmSync(ctmp, { recursive: true, force: true }); } catch {}

const dirtyTmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifydirty-"));
function dgit(args) { return execFileSync("git", args, { cwd: dirtyTmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function dwrite(rel, text) {
  const p = path.join(dirtyTmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
dgit(["init", "-q", "-b", "main"]);
dgit(["config", "user.name", "Harness Test"]);
dgit(["config", "user.email", "harness@example.test"]);
dwrite("hooks/verify.js", "console.log('base');\n");
dwrite("js/package.json", "{}\n");
dgit(["add", "."]);
dgit(["commit", "-q", "-m", "chore: base"]);
dwrite("hooks/verify.js", "console.log('dirty');\n");
{
  const scoped = sharedLib.workingTreeChangedFiles("main", dirtyTmp, null);
  ok(scoped.includeDirty === true && scoped.branchFiles.length === 0 &&
     scoped.dirtyFiles.includes("hooks/verify.js") && scoped.files.includes("hooks/verify.js"),
    "workingTreeChangedFiles: branch and dirty scopes are explicit");
}
chg = verifyListArgs(dirtyTmp, ["--changed"]);
ok(chg.plan.some((p) => p.stack === "harness-syntax"), "--changed: unstaged harness edit is included");
dgit(["add", "hooks/verify.js"]);
chg = verifyListArgs(dirtyTmp, ["--changed"]);
ok(chg.plan.some((p) => p.stack === "harness-syntax"), "--changed: staged harness edit is included");
dwrite("hooks/new-check.js", "console.log('new');\n");
chg = verifyListArgs(dirtyTmp, ["--changed"]);
ok(chg.plan.some((p) => p.stack === "harness-syntax"), "--changed: untracked harness file is included");
try { fs.rmSync(dirtyTmp, { recursive: true, force: true }); } catch {}

try { fs.rmSync(vtmp, { recursive: true, force: true }); fs.rmSync(etmp, { recursive: true, force: true }); } catch {}

// ---------- debug audit of changed files ----------
console.log("\ndebug-audit:");
const dbgtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dbgaudit-"));
fs.writeFileSync(path.join(dbgtmp, "clean.js"), "const x = 1;\nmodule.exports = x;\n");
fs.writeFileSync(path.join(dbgtmp, "bad.js"), "function f(){ debugger; return 1; }\n");
fs.writeFileSync(path.join(dbgtmp, "softy.js"), "console.log('hi');\n");
fs.writeFileSync(path.join(dbgtmp, "bp.js"), "breakpoint();\n");
fs.writeFileSync(path.join(dbgtmp, "bad.py"), "import pdb; pdb.set_trace()\n");
fs.mkdirSync(path.join(dbgtmp, "hooks"), { recursive: true });
fs.writeFileSync(path.join(dbgtmp, "hooks", "bad-hook.js"), "function f(){ debugger; return 1; }\n");
fs.writeFileSync(path.join(dbgtmp, "hooks", "fixture.js"), "const fixture = \"debugger;\";\n");
fs.writeFileSync(path.join(dbgtmp, "hooks", "comment.js"), "// debugger;\nconst x = 1;\n");
// verify with --files: audit scans exactly these files without git; dbgtmp has no stacks.
function dbgExit(files, cfg) {
  fs.writeFileSync(path.join(dbgtmp, "harness.config.json"), JSON.stringify(cfg || {}));
  return verifyExitArgs(dbgtmp, ["--files", files]);
}
ok(dbgExit("bad.js", {}) === 1, "debug audit assertion 1");
ok(dbgExit("clean.js", {}) === 0, "debug audit assertion 2");
ok(dbgExit("bad.py", {}) === 1, "debug audit assertion 3");
ok(dbgExit("bp.js", {}) === 0, "debug audit assertion 4");
ok(dbgExit("softy.js", {}) === 0, "debug audit assertion 5");
ok(dbgExit("softy.js", { debugAudit: { soft: true } }) === 0, "debug audit assertion 6");
ok(dbgExit("bad.js", { debugAudit: { exclude: ["bad.js"] } }) === 0, "debug audit assertion 7");
ok(dbgExit("bad.js", { debugAudit: { enabled: false } }) === 0, "debug audit assertion 8");
ok(dbgExit("hooks/bad-hook.js", {}) === 1, "debug audit assertion 9");
ok(dbgExit("hooks/fixture.js", {}) === 0, "debug audit assertion 10");
ok(dbgExit("hooks/comment.js", {}) === 0, "debug audit assertion 11");
ok(verifyExitArgs(dbgtmp, ["--strict-audit"]) === 1, "debug audit assertion 12");
try { fs.rmSync(dbgtmp, { recursive: true, force: true }); } catch {}

// ---------- doctor ----------
console.log("\ndoctor:");
const DOCTOR = path.join(__dirname, "doctor.js");
function doctor(root) {
  try { return JSON.parse(execFileSync("node", [DOCTOR, "--root", root, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch (e) { try { return JSON.parse(String(e.stdout || "{}")); } catch { return { results: [] }; } }
}
const drepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-"));
execFileSync("git", ["init", "-q"], { cwd: drepo });
let dres = doctor(drepo);
ok((dres.results || []).some((r) => /atomic lock operations/.test(r.msg) && r.level === "PASS"),
  "doctor: .git supports write+unlink lock operations -> PASS on a normal filesystem");
fs.writeFileSync(path.join(drepo, ".git", "index.lock"), "");
dres = doctor(drepo);
ok((dres.results || []).some((r) => /index\.lock/.test(r.msg) && r.level === "WARN"),
  "doctor assertion 1");
try { fs.rmSync(drepo, { recursive: true, force: true }); } catch {}

const linkedRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-linked-main-"));
const linkedWorktree = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-linked-wt-"));
fs.rmSync(linkedWorktree, { recursive: true, force: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: linkedRepo });
execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: linkedRepo });
execFileSync("git", ["config", "user.email", "harness@example.test"], { cwd: linkedRepo });
execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: linkedRepo });
fs.writeFileSync(path.join(linkedRepo, "README.md"), "base\n");
execFileSync("git", ["add", "."], { cwd: linkedRepo });
execFileSync("git", ["commit", "-q", "-m", "chore: base"], { cwd: linkedRepo });
for (const h of ["pre-commit", "commit-msg", "pre-push"])
  fs.writeFileSync(path.join(linkedRepo, ".git", "hooks", h), "# lefthook\n");
execFileSync("git", ["worktree", "add", "-q", "-b", "feature/linked", linkedWorktree], { cwd: linkedRepo });
dres = doctor(linkedWorktree);
ok((dres.results || []).some((r) => /lefthook wired into \.git\/hooks/.test(r.msg) && r.level === "PASS"),
  "doctor: linked worktree absolute hooks path -> PASS");
try { execFileSync("git", ["worktree", "remove", "--force", linkedWorktree], { cwd: linkedRepo, stdio: "ignore" }); } catch {}
try { fs.rmSync(linkedRepo, { recursive: true, force: true }); fs.rmSync(linkedWorktree, { recursive: true, force: true }); } catch {}

const bootRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-bootstrap-"));
execFileSync("git", ["init", "-q"], { cwd: bootRepo });
execFileSync("git", ["remote", "add", "origin", "https://github.com/IvanLarinDev/llm-dev-harness.git"], { cwd: bootRepo });
try { execFileSync("node", [path.join(REPO, "install.js"), "--target", bootRepo, "--json"], { encoding: "utf8", stdio: "pipe" }); } catch {}
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /harness not bootstrapped/.test(r.msg) && /untracked:/.test(r.msg) && r.level === "FAIL"),
  "doctor assertion 2");
execFileSync("git", ["add", "."], { cwd: bootRepo });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /harness bootstrap files present and tracked/.test(r.msg) && r.level === "PASS"),
  "doctor assertion 3");
ok((dres.results || []).some((r) => /GitHub branch cleanup runs only after green default-branch verify/.test(r.msg) && r.level === "PASS"),
  "doctor accepts the provider-confirmed branch cleanup workflow");
const targetBranchCleanupWorkflow = path.join(bootRepo, ".github", "workflows", "branch-cleanup.yml");
fs.writeFileSync(targetBranchCleanupWorkflow, "name: branch-cleanup\non:\n  workflow_run:\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /branch cleanup workflow is missing required contract/.test(r.msg) && r.level === "FAIL"),
  "doctor rejects a branch cleanup workflow without provider evidence gates");
fs.writeFileSync(targetBranchCleanupWorkflow, readRepo(".github/workflows/branch-cleanup.yml"));
execFileSync("git", ["add", ".github/workflows/branch-cleanup.yml"], { cwd: bootRepo });
execFileSync("git", ["rm", "--cached", "CHANGELOG.md"], { cwd: bootRepo, stdio: "ignore" });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /harness not bootstrapped/.test(r.msg) && /untracked:.*CHANGELOG\.md/.test(r.msg) && r.level === "FAIL"),
  "doctor assertion 4");
execFileSync("git", ["add", "CHANGELOG.md"], { cwd: bootRepo });
fs.rmSync(path.join(bootRepo, ".github", "workflows", "ci.yml"), { force: true });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /required check\(s\).*workflow.*missing/.test(r.msg) && /verify/.test(r.msg) && r.level === "FAIL"),
  "doctor: ruleset verify without CI workflow -> FAIL");
fs.mkdirSync(path.join(bootRepo, ".github", "workflows"), { recursive: true });
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"), "name: verify\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/verify.js\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /ruleset required check\(s\) not published/.test(r.msg) && /verify/.test(r.msg) && /build/.test(r.msg) && r.level === "FAIL"),
  "doctor: ruleset requires verify but workflow job is build -> FAIL");
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"), "name: verify\njobs:\n  verify:\n    name: build label can differ\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/verify.js\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /does not run required harness step/.test(r.msg) && /doctor/.test(r.msg) && /design-gate strict/.test(r.msg) && /secret scan/.test(r.msg) && r.level === "FAIL"),
  "doctor assertion 5");
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"),
  "name: verify\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo harmless\n      # run: node hooks/doctor.js\n      # run: node hooks/verify.js\n      # run: node hooks/design-gate.js --strict\n      # run: gitleaks detect\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /does not run required harness step/.test(r.msg) && /doctor/.test(r.msg) && /verify/.test(r.msg) && r.level === "FAIL"),
  "doctor: commented workflow gate names do not satisfy the active run-step contract");
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"),
  "name: verify\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/doctor.js\n      - run: gitleaks detect\n      - run: node hooks/verify.js\n      - run: node hooks/design-gate.js --strict --base origin/main\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /CI job verify runs doctor, verify\.js, design-gate --strict and secret scan/.test(r.msg) && r.level === "PASS"),
  "doctor assertion 6");
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"),
  "name: verify\njobs:\n  \"verify\": # quoted job id is valid YAML\n    name: build label can differ\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/doctor.js\n      - run: gitleaks detect\n      - run: node hooks/verify.js\n      - run: node hooks/design-gate.js --strict --base origin/main\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /CI job verify runs doctor, verify\.js, design-gate --strict and secret scan/.test(r.msg) && r.level === "PASS"),
  "doctor assertion 7");
const targetReleaseWorkflow = path.join(bootRepo, ".github", "workflows", "release.yml");
fs.writeFileSync(targetReleaseWorkflow,
  "name: release\non:\n  push:\n    tags: ['v*']\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0\n      - run: echo target package\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /target-specific artifact contract/.test(r.msg) && r.level === "PASS") &&
   !(dres.results || []).some((r) => /release workflow is missing required step/.test(r.msg)),
  "doctor accepts a pinned target-specific release workflow without source ZIP steps");
{
  const configPath = path.join(bootRepo, "harness.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.release = { sourceZip: true };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /release workflow is missing required step/.test(r.msg) && r.level === "FAIL"),
  "doctor enforces the source ZIP release contract only when configured");
fs.rmSync(targetReleaseWorkflow, { force: true });
fs.rmSync(path.join(bootRepo, ".github", "CODEOWNERS"), { force: true });
{
  const rulesetPath = path.join(bootRepo, ".github", "rulesets", "main.json");
  const ruleset = JSON.parse(fs.readFileSync(rulesetPath, "utf8"));
  const prRule = ruleset.rules.find((r) => r.type === "pull_request");
  prRule.parameters.require_code_owner_review = true;
  fs.writeFileSync(rulesetPath, JSON.stringify(ruleset, null, 2) + "\n");
}
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /code-owner review requires \.github\/CODEOWNERS/.test(r.msg) && r.level === "FAIL"),
  "doctor: code-owner review without CODEOWNERS -> FAIL");
fs.writeFileSync(path.join(bootRepo, ".github", "CODEOWNERS"), "# template only\n# add an owner with install.js --code-owner @org/team\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /code-owner review is enabled but \.github\/CODEOWNERS has no owner entries/.test(r.msg) && r.level === "FAIL"),
  "doctor: required code-owner review with template-only CODEOWNERS -> FAIL");
fs.writeFileSync(path.join(bootRepo, ".github", "CODEOWNERS"), readRepo(".github/CODEOWNERS"));
fs.writeFileSync(path.join(bootRepo, "hooks", "test.js"), "console.log('self-test');\n");
fs.writeFileSync(path.join(bootRepo, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "harness", markers: ["test.js"], steps: [{ name: "noop", run: "node -e \"0\"" }] }] } }, null, 2) + "\n");
execFileSync("git", ["add", "."], { cwd: bootRepo });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /verify\.stacks.*harness self-test/.test(r.msg) && r.level === "FAIL"),
  "doctor assertion 8");
const badCog = fs.readFileSync(path.join(bootRepo, "cog.toml"), "utf8")
  .replace(/,\s*"release\/\*\*"/, "")
  .replace(/\ntemplate\s*=\s*"remote"/, "")
  .replace(/\nowner\s*=\s*"[^"]+"/, "")
  .replace(/\nrepository\s*=\s*"[^"]+"/, "");
fs.writeFileSync(path.join(bootRepo, "cog.toml"), badCog);
fs.rmSync(path.join(bootRepo, "CHANGELOG.md"), { force: true });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /branch_whitelist.*release\/\*\*/.test(r.msg) && r.level === "FAIL") &&
   (dres.results || []).some((r) => /changelog\.template/.test(r.msg) && r.level === "FAIL") &&
   (dres.results || []).some((r) => /changelog\.owner/.test(r.msg) && r.level === "FAIL") &&
   (dres.results || []).some((r) => /changelog\.repository/.test(r.msg) && r.level === "FAIL") &&
   (dres.results || []).some((r) => /CHANGELOG\.md is required/.test(r.msg) && r.level === "FAIL"),
  "doctor: release-blocking cog.toml/CHANGELOG gaps -> FAIL");
fs.writeFileSync(path.join(bootRepo, "cog.toml"), readRepo("cog.toml"));
fs.writeFileSync(path.join(bootRepo, "CHANGELOG.md"), "# Changelog\n\n- - -\n");
fs.writeFileSync(path.join(bootRepo, "cog.toml"), readRepo("cog.toml").replace(/repository\s*=\s*"[^"]+"/, 'repository = "wrong-repo"'));
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /changelog\.repository must match origin repository/.test(r.msg) && /llm-dev-harness/.test(r.msg) && r.level === "FAIL"),
  "doctor: changelog.repository mismatch with origin -> FAIL");
fs.writeFileSync(path.join(bootRepo, "cog.toml"), readRepo("cog.toml"));
fs.writeFileSync(path.join(bootRepo, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "harness", markers: ["test.js"], steps: [{ name: "self-test", run: "node test.js" }] }] } }, null, 2) + "\n");
fs.writeFileSync(path.join(bootRepo, "AGENTS.md"), "line one\r\nline two\r\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /AGENTS\.md: CRLF\/CR line endings/.test(r.msg) && r.level === "FAIL"),
  "doctor assertion 9");
fs.writeFileSync(path.join(bootRepo, "AGENTS.md"), "line one\nline two\n");
fs.rmSync(path.join(bootRepo, ".github"), { recursive: true, force: true });
fs.rmSync(path.join(bootRepo, "hooks", "apply-ruleset.js"), { force: true });
execFileSync("git", ["add", "-A"], { cwd: bootRepo });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /harness not bootstrapped/.test(r.msg) && /\.github\/rulesets\/main\.json/.test(r.msg) && /hooks\/apply-ruleset\.js/.test(r.msg) && r.level === "FAIL"),
  "doctor assertion 10");
try { fs.rmSync(bootRepo, { recursive: true, force: true }); } catch {}

const sourceDoctorRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-source-integrity-"));
execFileSync("git", ["init", "-q"], { cwd: sourceDoctorRepo });
fs.mkdirSync(path.join(sourceDoctorRepo, "hooks"));
fs.writeFileSync(path.join(sourceDoctorRepo, "install.js"), "// source marker\n");
fs.writeFileSync(path.join(sourceDoctorRepo, "hooks", "verify.js"), "// verify marker\n");
fs.writeFileSync(path.join(sourceDoctorRepo, "harness.config.json"), "{}\n");
dres = doctor(sourceDoctorRepo);
ok((dres.results || []).some((result) => /missing:.*hooks\/test\.js/.test(result.msg) && result.level === "FAIL") &&
   (dres.results || []).some((result) => /source harness.*declare.*self-test/.test(result.msg) && result.level === "FAIL"),
  "doctor source integrity: missing test file and self-test config fail closed");
fs.rmSync(sourceDoctorRepo, { recursive: true, force: true });

// ---------- release start ----------
console.log("\nrelease start:");
function releaseStartRepo() {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "harness-release-start-origin-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "harness-release-start-work-"));
  execFileSync("git", ["init", "--bare", "-q"], { cwd: origin });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: work });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: work });
  execFileSync("git", ["config", "user.email", "harness@example.test"], { cwd: work });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: work });
  fs.writeFileSync(path.join(work, "README.md"), "base\n");
  execFileSync("git", ["add", "."], { cwd: work });
  execFileSync("git", ["commit", "-q", "-m", "chore: base"], { cwd: work });
  fs.writeFileSync(path.join(work, "feature.txt"), "feature\n");
  execFileSync("git", ["add", "."], { cwd: work });
  execFileSync("git", ["commit", "-q", "-m", "feat: release fixture"], { cwd: work });
  execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd: work });
  execFileSync("git", ["switch", "--detach"], { cwd: work, stdio: "ignore" });
  return { origin, work };
}
function releaseStartRun(root, runCog = () => "1.1.0") {
  return releaseStart.run({ root, base: "origin/main" }, { runCog });
}
function quietGit(root, args) {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}
function removeReleaseStartRepo(repo) {
  try { fs.rmSync(repo.work, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(repo.origin, { recursive: true, force: true }); } catch {}
}

let startCase = releaseStartRepo();
const startHead = quietGit(startCase.work, ["rev-parse", "HEAD"]);
let cogBranch = "";
let startResult = releaseStartRun(startCase.work, (root) => {
  cogBranch = quietGit(root, ["symbolic-ref", "--short", "HEAD"]);
  if (!/^release\/prepare-[0-9a-f]{12}$/.test(cogBranch)) throw new Error(`unexpected cog branch: ${cogBranch}`);
  return "1.1.0";
});
ok(startResult.ok === true && startResult.tag === "v1.1.0" && startResult.branch === "release/v1.1.0" &&
   /^release\/prepare-/.test(cogBranch) && quietGit(startCase.work, ["symbolic-ref", "--short", "HEAD"]) === "release/v1.1.0" &&
   quietGit(startCase.work, ["rev-parse", "HEAD"]) === startHead,
  "release-start: detached fresh base is attached before Cocogitto and finalized as release/vX.Y.Z");
removeReleaseStartRepo(startCase);

startCase = releaseStartRepo();
startResult = releaseStartRun(startCase.work, () => { throw new Error("no releasable commits"); });
ok(startResult.ok === false && startResult.rolledBack === true && !quietGit(startCase.work, ["symbolic-ref", "--short", "HEAD"]) &&
   !quietGit(startCase.work, ["branch", "--list", "release/prepare-*"]),
  "release-start: Cocogitto failure restores detached HEAD and removes the temporary branch");
removeReleaseStartRepo(startCase);

startCase = releaseStartRepo();
fs.writeFileSync(path.join(startCase.work, "dirty.txt"), "dirty\n");
startResult = releaseStartRun(startCase.work);
ok(startResult.ok === false && (startResult.results || []).some((result) => /worktree is dirty/.test(result.msg)) &&
   !quietGit(startCase.work, ["branch", "--list", "release/prepare-*"]),
  "release-start: dirty worktree is rejected before a branch is created");
removeReleaseStartRepo(startCase);

startCase = releaseStartRepo();
execFileSync("git", ["switch", "--detach", "HEAD^"], { cwd: startCase.work, stdio: "ignore" });
startResult = releaseStartRun(startCase.work);
ok(startResult.ok === false && (startResult.results || []).some((result) => /HEAD must exactly match origin\/main/.test(result.msg)) &&
   !quietGit(startCase.work, ["branch", "--list", "release/prepare-*"]),
  "release-start: stale detached HEAD is rejected before a branch is created");
removeReleaseStartRepo(startCase);

startCase = releaseStartRepo();
execFileSync("git", ["branch", "release/v1.1.0"], { cwd: startCase.work });
startResult = releaseStartRun(startCase.work);
ok(startResult.ok === false && startResult.rolledBack === true &&
   quietGit(startCase.work, ["show-ref", "--verify", "refs/heads/release/v1.1.0"]) &&
   !quietGit(startCase.work, ["branch", "--list", "release/prepare-*"]),
  "release-start: an existing release branch is preserved and temporary state is rolled back");
removeReleaseStartRepo(startCase);

startCase = releaseStartRepo();
fs.writeFileSync(path.join(startCase.work, "harness.config.json"), JSON.stringify({
  capabilities: { release: "none" }, release: { provider: "none" },
}, null, 2) + "\n");
startResult = releaseStartRun(startCase.work);
ok(startResult.ok === false && (startResult.results || []).some((result) => /release capability is disabled/.test(result.msg)),
  "release-start skips repositories with release:none instead of assuming Cocogitto");
removeReleaseStartRepo(startCase);

// ---------- release-preflight ----------
console.log("\nrelease-preflight:");
function relGit(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function releaseJson(root, tag, extra = [], env = {}) {
  try {
    const s = execFileSync("node", [RELEASE_PREFLIGHT, "--root", root, "--tag", tag, "--json", ...extra],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    return JSON.parse(s);
  } catch (e) {
    try { return JSON.parse(String(e.stdout || "{}")); } catch { return { ok: false, results: [] }; }
  }
}
function releaseBumpJson(root, tag, extra = []) {
  try {
    const s = execFileSync("node", [RELEASE_MANIFEST_BUMP, "--root", root, "--tag", tag, "--json", ...extra],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(s);
  } catch (e) {
    try { return JSON.parse(String(e.stdout || "{}")); } catch { return { ok: false, results: [], manifests: [] }; }
  }
}
function writeReleaseProject(root, version) {
  fs.mkdirSync(path.join(root, "src", "App"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "App", "App.csproj"), `<Project><PropertyGroup><Version>${version}</Version></PropertyGroup></Project>\n`);
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), `# Changelog\n\n## v${version}\n\n- release\n`);
}
function writeReleaseProjectWithPrefixSuffix(root, versionPrefix, versionSuffix) {
  fs.mkdirSync(path.join(root, "src", "App"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "App", "App.csproj"),
    `<Project><PropertyGroup><VersionPrefix>${versionPrefix}</VersionPrefix><VersionSuffix>${versionSuffix}</VersionSuffix></PropertyGroup></Project>\n`
  );
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), `# Changelog\n\n## v${versionPrefix}-${versionSuffix}\n\n- release\n`);
}
function releaseRepo(version, tag = "v0.10.1") {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "harness-release-origin-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "harness-release-work-"));
  execFileSync("git", ["init", "--bare", "-q"], { cwd: origin });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: work });
  relGit(work, ["config", "user.name", "Harness Test"]);
  relGit(work, ["config", "user.email", "harness@example.test"]);
  relGit(work, ["remote", "add", "origin", origin]);
  fs.writeFileSync(path.join(work, "README.md"), "base\n");
  relGit(work, ["add", "."]);
  relGit(work, ["commit", "-q", "-m", "chore: base"]);
  relGit(work, ["push", "-q", "-u", "origin", "main"]);
  const base = relGit(work, ["rev-parse", "HEAD"]);
  writeReleaseProject(work, version);
  relGit(work, ["add", "."]);
  relGit(work, ["commit", "-q", "-m", `chore(version): ${tag}`]);
  relGit(work, ["tag", "-a", tag, "-m", tag]);
  return { origin, work, base };
}

let relCase = releaseRepo("0.10.1");
let rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === true && (rpre.results || []).some((r) => /project version manifests match/.test(r.msg)),
  "release-preflight: clean release with csproj version matching tag -> PASS");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });
relCase = releaseRepo("1.2.3", "v1.2.3-rc.1");
writeReleaseProjectWithPrefixSuffix(relCase.work, "1.2.3", "rc.1");
relGit(relCase.work, ["add", "."]);
relGit(relCase.work, ["commit", "-q", "-m", "chore(version): v1.2.3-rc.1"]);
relGit(relCase.work, ["tag", "-d", "v1.2.3-rc.1"]);
relGit(relCase.work, ["tag", "-a", "v1.2.3-rc.1", "-m", "v1.2.3-rc.1"]);
rpre = releaseJson(relCase.work, "v1.2.3-rc.1");
ok(rpre.ok === true && (rpre.results || []).some((r) => /project version manifests match/.test(r.msg)),
  "release-preflight: prerelease tag matches csproj VersionPrefix + VersionSuffix -> PASS");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.2", "v0.10.2");
let rbump = releaseBumpJson(relCase.work, "v0.11.0");
let releaseCsproj = fs.readFileSync(path.join(relCase.work, "src", "App", "App.csproj"), "utf8");
ok(rbump.ok === true && rbump.manifests.some((m) => m.rel === "src/App/App.csproj" && m.from === "0.10.2" && m.to === "0.11.0" && m.changed) &&
   /<Version>0\.11\.0<\/Version>/.test(releaseCsproj),
  "release-manifest-bump: updates a stale C# project version before tagging");
relGit(relCase.work, ["add", "src/App/App.csproj"]);
relGit(relCase.work, ["commit", "-q", "-m", "chore(release): prepare v0.11.0"]);
fs.writeFileSync(path.join(relCase.work, "CHANGELOG.md"), "# Changelog\n\n## v0.11.0\n\n- release\n");
relGit(relCase.work, ["add", "CHANGELOG.md"]);
relGit(relCase.work, ["commit", "-q", "-m", "chore(release): v0.11.0"]);
relGit(relCase.work, ["tag", "-a", "v0.11.0", "-m", "v0.11.0"]);
rpre = releaseJson(relCase.work, "v0.11.0");
ok(rpre.ok === true && (rpre.results || []).some((r) => /project version manifests match/.test(r.msg)),
  "release flow fixture: manifest bump plus changelog tag passes preflight");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.2", "v0.10.2");
fs.mkdirSync(path.join(relCase.work, "packages", "Independent"), { recursive: true });
fs.writeFileSync(path.join(relCase.work, "packages", "Independent", "package.json"), JSON.stringify({ name: "independent", version: "9.9.9" }, null, 2) + "\n");
fs.writeFileSync(path.join(relCase.work, "harness.config.json"), JSON.stringify({
  release: { versioning: { manifests: ["src/App/App.csproj"] } },
}, null, 2) + "\n");
rbump = releaseBumpJson(relCase.work, "v0.11.0");
ok(rbump.ok === true && rbump.manifests.length === 1 && rbump.manifests[0].rel === "src/App/App.csproj" &&
   JSON.parse(fs.readFileSync(path.join(relCase.work, "packages", "Independent", "package.json"), "utf8")).version === "9.9.9",
  "release manifest scope updates only the configured package in an independent-version monorepo");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.1");
fs.mkdirSync(path.join(relCase.work, "packages", "Independent"), { recursive: true });
fs.writeFileSync(path.join(relCase.work, "packages", "Independent", "package.json"), JSON.stringify({ name: "independent", version: "9.9.9" }, null, 2) + "\n");
fs.writeFileSync(path.join(relCase.work, "harness.config.json"), JSON.stringify({
  release: { versioning: { manifests: ["src/App/App.csproj"] } },
}, null, 2) + "\n");
relGit(relCase.work, ["add", "."]); relGit(relCase.work, ["commit", "-q", "-m", "chore: scope release manifests"]);
relGit(relCase.work, ["tag", "-d", "v0.10.1"]); relGit(relCase.work, ["tag", "-a", "v0.10.1", "-m", "v0.10.1"]);
rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === true && (rpre.results || []).some((r) => /project version manifests match/.test(r.msg) && r.count === 1),
  "release preflight ignores independently versioned manifests outside configured scope");
fs.writeFileSync(path.join(relCase.work, "harness.config.json"), JSON.stringify({
  release: { versioning: { manifests: ["missing/project.csproj"] } },
}, null, 2) + "\n");
relGit(relCase.work, ["add", "harness.config.json"]); relGit(relCase.work, ["commit", "-q", "-m", "chore: break release scope"]);
relGit(relCase.work, ["tag", "-d", "v0.10.1"]); relGit(relCase.work, ["tag", "-a", "v0.10.1", "-m", "v0.10.1"]);
rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === false && (rpre.results || []).some((r) => /configured file is missing/.test(r.msg)),
  "release preflight fails closed when a configured version manifest is missing");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.0");
rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === false && (rpre.results || []).some((r) => /project version\(s\) do not match/.test(r.msg) && r.mismatches && /App\.csproj/.test(JSON.stringify(r.mismatches))),
  "release-preflight: tag v0.10.1 with csproj 0.10.0 -> FAIL");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });
relCase = releaseRepo("0.10.1");
fs.writeFileSync(path.join(relCase.work, "dirty.txt"), "x\n");
rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === false && (rpre.results || []).some((r) => /worktree is dirty/.test(r.msg) && r.level === "FAIL"),
  "release-preflight: dirty release worktree -> FAIL");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });
relCase = releaseRepo("0.10.1");
relGit(relCase.work, ["push", "-q", "origin", "v0.10.1"]);
rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === false && (rpre.results || []).some((r) => /remote tag already exists/.test(r.msg)),
  "release-preflight: existing remote tag -> FAIL");
rpre = releaseJson(relCase.work, "v0.10.1", ["--allow-remote-tag"]);
ok(rpre.ok === true && (rpre.results || []).some((r) => /remote tag already exists but allowed/.test(r.msg)),
  "release-preflight: tag workflow may allow the already-pushed remote tag");
const slowGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-release-slow-git-"));
const realGit = execFileSync(process.platform === "win32" ? "where.exe" : "which", ["git"],
  { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
const slowGitShim = path.join(slowGitDir, "slow-git-shim.js");
fs.writeFileSync(slowGitShim, [
  "#!/usr/bin/env node",
  "const { spawnSync } = require('child_process');",
  "if ((process.argv[2] || '').toLowerCase() === 'ls-remote') {",
  "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 11000);",
  "}",
  "const result = spawnSync(process.env.HARNESS_REAL_GIT || 'git', process.argv.slice(2), { stdio: 'inherit' });",
  "if (result.error) { console.error(result.error.message); process.exit(1); }",
  "process.exit(result.status ?? 1);",
  "",
].join("\n"));
fs.writeFileSync(path.join(slowGitDir, "git.cmd"), "@echo off\r\nnode \"%~dp0slow-git-shim.js\" %*\r\n");
fs.writeFileSync(path.join(slowGitDir, "git"), "#!/usr/bin/env sh\nexec node \"$(dirname \"$0\")/slow-git-shim.js\" \"$@\"\n");
fs.chmodSync(slowGitShim, 0o755);
fs.chmodSync(path.join(slowGitDir, "git"), 0o755);
rpre = releaseJson(relCase.work, "v0.10.1", ["--allow-remote-tag"], {
  PATH: slowGitDir + path.delimiter + process.env.PATH,
  HARNESS_REAL_GIT: realGit,
});
ok(rpre.ok === true && (rpre.results || []).some((r) => /remote tag already exists but allowed/.test(r.msg)),
  "release-preflight: slow remote tag check stays within timeout budget");
fs.rmSync(slowGitDir, { recursive: true, force: true });
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });
relCase = releaseRepo("0.10.1");
relGit(relCase.work, ["tag", "-d", "v0.10.1"]);
relGit(relCase.work, ["tag", "v0.10.1"]);
rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === false && (rpre.results || []).some((r) => /must be annotated/.test(r.msg)),
  "release-preflight: lightweight tag -> FAIL");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });
relCase = releaseRepo("0.10.1");
fs.writeFileSync(path.join(relCase.work, "CHANGELOG.md"), "# Changelog\n\n## v0.10.0\n\n- stale\n");
relGit(relCase.work, ["add", "CHANGELOG.md"]);
relGit(relCase.work, ["commit", "-q", "-m", "chore: stale changelog"]);
relGit(relCase.work, ["tag", "-d", "v0.10.1"]);
relGit(relCase.work, ["tag", "-a", "v0.10.1", "-m", "v0.10.1"]);
rpre = releaseJson(relCase.work, "v0.10.1");
ok(rpre.ok === false && (rpre.results || []).some((r) => /CHANGELOG\.md does not mention/.test(r.msg)),
  "release-preflight: stale changelog version -> FAIL");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.1");
{
  const releaseHead = relGit(relCase.work, ["rev-parse", "HEAD"]);
  const tree = relGit(relCase.work, ["rev-parse", "HEAD^{tree}"]);
  const mergedMain = relGit(relCase.work, ["commit-tree", tree, "-p", relCase.base, "-p", releaseHead, "-m", "Merge release PR"]);
  relGit(relCase.work, ["update-ref", "refs/remotes/origin/main", mergedMain]);
}
rpre = releaseJson(relCase.work, "v0.10.1", ["--require-release-tip"]);
ok(rpre.ok === true && rpre.mode === "release-tip" &&
   (rpre.results || []).some((r) => /exact release merge/.test(r.msg)),
"release-preflight: exact two-parent release merge -> PASS");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.1");
{
  const releaseHead = relGit(relCase.work, ["rev-parse", "HEAD"]);
  const releaseTree = relGit(relCase.work, ["rev-parse", "HEAD^{tree}"]);
  const baseTree = relGit(relCase.work, ["rev-parse", `${relCase.base}^{tree}`]);
  const concurrentMain = relGit(relCase.work, ["commit-tree", baseTree, "-p", relCase.base, "-m", "Concurrent main change"]);
  const mergedMain = relGit(relCase.work, ["commit-tree", releaseTree, "-p", concurrentMain, "-p", releaseHead, "-m", "Merge stale release PR"]);
  relGit(relCase.work, ["update-ref", "refs/remotes/origin/main", mergedMain]);
}
rpre = releaseJson(relCase.work, "v0.10.1", ["--require-release-tip"]);
ok(rpre.ok === false && (rpre.results || []).some((r) => /does not include the merge base parent/.test(r.msg)),
  "release-preflight: concurrent main commit omitted by tag -> FAIL");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.1");
{
  const releaseHead = relGit(relCase.work, ["rev-parse", "HEAD"]);
  const tree = relGit(relCase.work, ["rev-parse", "HEAD^{tree}"]);
  const mergedMain = relGit(relCase.work, ["commit-tree", tree, "-p", relCase.base, "-p", releaseHead, "-m", "Merge release PR"]);
  const laterMain = relGit(relCase.work, ["commit-tree", tree, "-p", mergedMain, "-m", "Commit after release merge"]);
  relGit(relCase.work, ["update-ref", "refs/remotes/origin/main", laterMain]);
}
rpre = releaseJson(relCase.work, "v0.10.1", ["--require-release-tip"]);
ok(rpre.ok === false && (rpre.results || []).some((r) => /exact two-parent release merge/.test(r.msg)),
  "release-preflight: main advanced after release merge -> FAIL");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

relCase = releaseRepo("0.10.1");
{
  const tree = relGit(relCase.work, ["rev-parse", `${relCase.base}^{tree}`]);
  const siblingMain = relGit(relCase.work, ["commit-tree", tree, "-p", relCase.base, "-m", "Unrelated main commit"]);
  relGit(relCase.work, ["update-ref", "refs/remotes/origin/main", siblingMain]);
}
rpre = releaseJson(relCase.work, "v0.10.1", ["--require-tag-in-base"]);
ok(rpre.ok === false && (rpre.results || []).some((r) => /tag v0\.10\.1 is not included in origin\/main/.test(r.msg)),
  "release-preflight: sibling release tag outside main -> FAIL");
fs.rmSync(relCase.work, { recursive: true, force: true }); fs.rmSync(relCase.origin, { recursive: true, force: true });

// ---------- release artifact contract ----------
console.log("\nrelease artifact contract:");
function releaseArtifactsJson(root, tag, extra = []) {
  try {
    return JSON.parse(execFileSync("node", [RELEASE_ARTIFACTS, "--root", root, "--tag", tag, "--json", ...extra],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (e) {
    try { return JSON.parse(String(e.stdout || "{}")); } catch { return { ok: false, results: [] }; }
  }
}
const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-release-artifact-"));
fs.writeFileSync(path.join(artifactRoot, "build.js"), [
  "const fs = require('fs');", "const path = require('path');",
  "fs.mkdirSync(path.dirname(process.env.HARNESS_ARTIFACT_PATH), { recursive: true });",
  "fs.writeFileSync(process.env.HARNESS_ARTIFACT_PATH, 'app ' + process.env.HARNESS_RELEASE_VERSION + '\\n');", "",
].join("\n"));
fs.writeFileSync(path.join(artifactRoot, "smoke.js"), [
  "const fs = require('fs');", "const text = fs.readFileSync(process.env.HARNESS_ARTIFACT_PATH, 'utf8');",
  "process.exit(text.startsWith('app ') ? 0 : 1);", "",
].join("\n"));
fs.writeFileSync(path.join(artifactRoot, "version.js"), "process.stdout.write(require('fs').readFileSync(process.env.HARNESS_ARTIFACT_PATH, 'utf8'));\n");
fs.writeFileSync(path.join(artifactRoot, "harness.config.json"), JSON.stringify({ release: { artifacts: [{
  id: "app", path: "dist/app-{version}.txt", build: "node build.js", smoke: "node smoke.js", versionCommand: "node version.js",
}] } }, null, 2) + "\n");
let artifactReport = releaseArtifactsJson(artifactRoot, "v1.2.3");
ok(artifactReport.ok === true && artifactReport.artifacts[0].path === "dist/app-1.2.3.txt" &&
   artifactReport.results.some((r) => /reports version 1\.2\.3/.test(r.message)),
  "release artifact contract builds, finds, smoke-tests, and verifies project artifact version");
fs.writeFileSync(path.join(artifactRoot, "version.js"), "process.stdout.write('0.0.0');\n");
artifactReport = releaseArtifactsJson(artifactRoot, "v1.2.3", ["--phase", "version"]);
ok(artifactReport.ok === false && artifactReport.results.some((r) => /does not match 1\.2\.3/.test(r.message)),
  "release artifact contract rejects artifact version mismatch");
fs.writeFileSync(path.join(artifactRoot, "harness.config.json"), JSON.stringify({ release: { artifacts: [{
  id: "escape", path: "../outside.zip", smoke: "node smoke.js", versionCommand: "node version.js",
}] } }, null, 2) + "\n");
artifactReport = releaseArtifactsJson(artifactRoot, "v1.2.3");
ok(artifactReport.ok === false && artifactReport.results.some((r) => /repository-external path/.test(r.message)),
  "release artifact contract rejects paths outside the repository");
fs.rmSync(artifactRoot, { recursive: true, force: true });

// ---------- release cleanup ----------
console.log("\nrelease cleanup:");
ok(/--force-with-lease=refs\/heads\/\$\{entry\.branch\}:\$\{entry\.remoteOid\}/.test(readRepo("hooks/release-cleanup.js")),
"branch cleanup leases remote deletion to the OID that passed ancestry checks");
ok(/update-ref", "-d", `refs\/heads\/\$\{entry\.branch\}`, entry\.localOid/.test(readRepo("hooks/release-cleanup.js")),
"branch cleanup atomically deletes the local OID that passed ancestry checks");
function cleanupJson(root, extra = [], script = RELEASE_CLEANUP) {
  try {
    const s = execFileSync("node", [script, "--root", root, "--base", "origin/main", "--json", ...extra],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(s);
  } catch (e) {
    try { return JSON.parse(String(e.stdout || "{}")); } catch { return { ok: false, candidates: [], blocked: [], skipped: [], errors: [] }; }
  }
}
const cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-release-cleanup-"));
const cleanupOrigin = path.join(cleanupRoot, "origin.git");
const cleanupWork = path.join(cleanupRoot, "work");
const cleanReleaseWorktree = path.join(cleanupRoot, "release-worktree");
const dirtyFixWorktree = path.join(cleanupRoot, "dirty-fix-worktree");
fs.mkdirSync(cleanupOrigin, { recursive: true });
fs.mkdirSync(cleanupWork, { recursive: true });
execFileSync("git", ["init", "--bare", "-q"], { cwd: cleanupOrigin });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: cleanupWork });
relGit(cleanupWork, ["config", "user.name", "Harness Test"]);
relGit(cleanupWork, ["config", "user.email", "harness@example.test"]);
relGit(cleanupWork, ["remote", "add", "origin", cleanupOrigin]);
fs.writeFileSync(path.join(cleanupWork, "README.md"), "base\n");
relGit(cleanupWork, ["add", "."]);
relGit(cleanupWork, ["commit", "-q", "-m", "chore: base"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "main"]);

relGit(cleanupWork, ["checkout", "-q", "-b", "feat/done"]);
fs.writeFileSync(path.join(cleanupWork, "done.txt"), "done\n");
relGit(cleanupWork, ["add", "."]);
relGit(cleanupWork, ["commit", "-q", "-m", "feat: done"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "feat/done"]);
relGit(cleanupWork, ["checkout", "-q", "main"]);
relGit(cleanupWork, ["merge", "-q", "--no-ff", "feat/done", "-m", "Merge feat/done"]);
relGit(cleanupWork, ["push", "-q", "origin", "main"]);

relGit(cleanupWork, ["branch", "release/v0.10.1", "main"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "release/v0.10.1"]);
relGit(cleanupWork, ["worktree", "add", "-q", cleanReleaseWorktree, "release/v0.10.1"]);
relGit(cleanupWork, ["branch", "fix/dirty", "main"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "fix/dirty"]);
relGit(cleanupWork, ["worktree", "add", "-q", dirtyFixWorktree, "fix/dirty"]);
fs.writeFileSync(path.join(dirtyFixWorktree, "dirty.txt"), "uncommitted\n");

relGit(cleanupWork, ["checkout", "-q", "-b", "feat/wip", "main"]);
fs.writeFileSync(path.join(cleanupWork, "wip.txt"), "wip\n");
relGit(cleanupWork, ["add", "."]);
relGit(cleanupWork, ["commit", "-q", "-m", "feat: wip"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "feat/wip"]);
relGit(cleanupWork, ["checkout", "-q", "main"]);

relGit(cleanupWork, ["checkout", "-q", "-b", "feat/squashed", "main"]);
fs.writeFileSync(path.join(cleanupWork, "squashed.txt"), "squashed\n");
relGit(cleanupWork, ["add", "."]);
relGit(cleanupWork, ["commit", "-q", "-m", "feat: branch version"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "feat/squashed"]);
relGit(cleanupWork, ["checkout", "-q", "main"]);
relGit(cleanupWork, ["cherry-pick", "-n", "feat/squashed"]);
relGit(cleanupWork, ["commit", "-q", "-m", "feat: squash equivalent"]);
relGit(cleanupWork, ["push", "-q", "origin", "main"]);

relGit(cleanupWork, ["checkout", "-q", "-b", "fix/remote-ahead", "main"]);
fs.writeFileSync(path.join(cleanupWork, "remote-ahead.txt"), "remote only\n");
relGit(cleanupWork, ["add", "."]);
relGit(cleanupWork, ["commit", "-q", "-m", "fix: remote ahead"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "fix/remote-ahead"]);
relGit(cleanupWork, ["checkout", "-q", "main"]);
relGit(cleanupWork, ["branch", "-f", "fix/remote-ahead", "main"]);
relGit(cleanupWork, ["tag", "v0.10.1"]);

let postMerge = cleanupJson(cleanupWork, ["--branch", "feat/done", "--no-fetch"], POST_MERGE_CLEANUP);
ok(postMerge.ok === true && postMerge.mode === "branch" && postMerge.branch === "feat/done" &&
   postMerge.candidates.length === 1 && postMerge.candidates[0].branch === "feat/done",
"post-merge cleanup dry-run scopes deletion to one merged development branch");
postMerge = cleanupJson(cleanupWork, ["--branch", "feat/done", "--no-fetch", "--apply"], POST_MERGE_CLEANUP);
ok(postMerge.ok === true && postMerge.deletedLocal.includes("feat/done") && postMerge.deletedRemote.includes("feat/done"),
"post-merge cleanup deletes the merged local and remote feature branch");
postMerge = cleanupJson(cleanupWork, ["--branch", "feat/done", "--no-fetch"], POST_MERGE_CLEANUP);
ok(postMerge.ok === true && postMerge.absent.includes("feat/done"),
"post-merge cleanup is idempotent after the branch is already absent");
postMerge = cleanupJson(cleanupWork, ["--branch", "feat/wip", "--no-fetch"], POST_MERGE_CLEANUP);
ok(postMerge.ok === false && postMerge.blocked.some((entry) => entry.branch === "feat/wip" && /not merged/.test(entry.reasons.join(" "))),
"post-merge cleanup blocks an unmerged feature branch");
postMerge = cleanupJson(cleanupWork, ["--branch", "feat/squashed", "--no-fetch"], POST_MERGE_CLEANUP);
ok(postMerge.ok === false && postMerge.equivalent.some((entry) => entry.branch === "feat/squashed") &&
   postMerge.blocked.some((entry) => /patch-equivalent/.test(entry.reasons.join(" "))),
"post-merge cleanup detects squash-equivalent heads but requires provider evidence");
postMerge = cleanupJson(cleanupWork, ["--branch", "feat/squashed", "--no-fetch", "--include-equivalent"], POST_MERGE_CLEANUP);
ok(postMerge.ok === true && postMerge.candidates.some((entry) => entry.branch === "feat/squashed" &&
   entry.localState === "equivalent" && entry.remoteState === "equivalent"),
"provider-confirmed cleanup admits a squash-equivalent development branch");
postMerge = cleanupJson(cleanupWork, ["--branch", "feat/squashed", "--no-fetch", "--include-equivalent", "--apply"], POST_MERGE_CLEANUP);
ok(postMerge.ok === true && postMerge.deletedLocal.includes("feat/squashed") && postMerge.deletedRemote.includes("feat/squashed"),
"provider-confirmed cleanup deletes the equivalent branch with exact leases");
postMerge = cleanupJson(cleanupWork, ["--branch", "release/v0.10.1", "--no-fetch"], POST_MERGE_CLEANUP);
ok(postMerge.ok === false && postMerge.errors.some((error) => /not eligible/.test(error)),
"post-merge cleanup reserves release branches for post-smoke cleanup");
postMerge = cleanupJson(cleanupWork, ["--no-fetch"], POST_MERGE_CLEANUP);
ok(postMerge.ok === false && postMerge.errors.some((error) => /--branch is required/.test(error)),
"post-merge cleanup requires an explicit branch");

let cleanup = cleanupJson(cleanupWork, ["--no-fetch"]);
ok(cleanup.apply === false && cleanup.candidates.some((entry) => entry.branch === "release/v0.10.1") &&
   cleanup.blocked.some((entry) => entry.branch === "fix/dirty" && /dirty/.test(entry.reasons.join(" "))) &&
   cleanup.blocked.some((entry) => entry.branch === "fix/remote-ahead" && /remote branch/.test(entry.reasons.join(" "))) &&
   cleanup.skipped.some((entry) => entry.branch === "feat/wip" && /not merged/.test(entry.reasons.join(" "))),
"release cleanup dry-run classifies merged, dirty, diverged, and unmerged branches");

cleanup = cleanupJson(cleanupWork, ["--no-fetch", "--apply"]);
const localAfterCleanup = relGit(cleanupWork, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  .split(/\r?\n/).filter(Boolean);
const remoteAfterCleanup = relGit(cleanupWork, ["ls-remote", "--heads", "origin"]);
const cleanupRemovedExpected = cleanup.ok === false && cleanup.deletedLocal.includes("release/v0.10.1") &&
  cleanup.deletedRemote.includes("release/v0.10.1") &&
  cleanup.removedWorktrees.some((item) => path.basename(item).toLowerCase() === path.basename(cleanReleaseWorktree).toLowerCase());
ok(cleanupRemovedExpected,
"release cleanup removes the remaining merged release branch and its clean linked worktree");
ok(localAfterCleanup.includes("fix/dirty") && localAfterCleanup.includes("feat/wip") && localAfterCleanup.includes("fix/remote-ahead") &&
   /refs\/heads\/fix\/dirty/.test(remoteAfterCleanup) && /refs\/heads\/feat\/wip/.test(remoteAfterCleanup) &&
   /refs\/heads\/fix\/remote-ahead/.test(remoteAfterCleanup) &&
   !localAfterCleanup.includes("feat/done") && !localAfterCleanup.includes("release/v0.10.1"),
"release cleanup preserves dirty, unmerged, and remote-diverged branches");
ok(relGit(cleanupWork, ["tag", "--list", "v0.10.1"]) === "v0.10.1",
  "release cleanup never deletes release tags");

relGit(cleanupWork, ["checkout", "-q", "-b", "feat/local-accepted", "main"]);
fs.writeFileSync(path.join(cleanupWork, "local-accepted.txt"), "accepted locally\n");
relGit(cleanupWork, ["add", "."]);
relGit(cleanupWork, ["commit", "-q", "-m", "feat: accepted locally"]);
relGit(cleanupWork, ["push", "-q", "-u", "origin", "feat/local-accepted"]);
relGit(cleanupWork, ["checkout", "-q", "main"]);
relGit(cleanupWork, ["merge", "-q", "--no-ff", "feat/local-accepted", "-m", "Merge feat/local-accepted"]);
postMerge = cleanupJson(cleanupWork, ["--base", "main", "--branch", "feat/local-accepted", "--no-fetch", "--apply"], POST_MERGE_CLEANUP);
ok(postMerge.ok === true && postMerge.deletedLocal.includes("feat/local-accepted") &&
   postMerge.deletedRemote.includes("feat/local-accepted"),
"post-merge cleanup deletes a branch merged into local main when origin/main is stale");
try { fs.rmSync(cleanupRoot, { recursive: true, force: true }); } catch {}

// ---------- repository topology audit ----------
console.log("\nrepository topology audit:");
ok(repoStateAudit.commandTimeoutMs({ remote: true }) === 60000 &&
   repoStateAudit.commandTimeoutMs() === 10000,
"topology audit gives remote fetches a separate network timeout budget");
function topologyJson(root, acceptedRoot, extra = []) {
  try {
    const args = [REPO_STATE_AUDIT, "--root", root];
    if (acceptedRoot) args.push("--accepted-root", acceptedRoot);
    args.push("--base", "main", "--strict", "--json", ...extra);
    const output = execFileSync("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  } catch (e) {
    try { return JSON.parse(String(e.stdout || "{}")); } catch { return { ok: false, issues: [] }; }
  }
}
const topologyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-topology-"));
const topologyDevelopment = path.join(topologyRoot, "development");
const topologyAccepted = path.join(topologyRoot, "accepted");
const topologyExtra = path.join(topologyRoot, "extra-worktree");
fs.mkdirSync(topologyDevelopment, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: topologyDevelopment });
relGit(topologyDevelopment, ["config", "user.name", "Harness Test"]);
relGit(topologyDevelopment, ["config", "user.email", "harness@example.test"]);
relGit(topologyDevelopment, ["config", "core.autocrlf", "false"]);
fs.writeFileSync(path.join(topologyDevelopment, "README.md"), "base\n");
relGit(topologyDevelopment, ["add", "."]);
relGit(topologyDevelopment, ["commit", "-q", "-m", "chore: base"]);
execFileSync("git", ["-c", "core.autocrlf=false", "clone", "-q", topologyDevelopment, topologyAccepted], { cwd: topologyRoot });
relGit(topologyAccepted, ["config", "user.name", "Harness Test"]);
relGit(topologyAccepted, ["config", "user.email", "harness@example.test"]);
relGit(topologyAccepted, ["config", "core.autocrlf", "false"]);
let topology = topologyJson(topologyDevelopment, topologyAccepted);
ok(topology.ok === true, "topology audit accepts two clean main checkouts at the same SHA");
relGit(topologyAccepted, ["checkout", "-q", "--detach", "main"]);
topology = topologyJson(topologyDevelopment, topologyAccepted);
ok(topology.ok === false && topology.issues.some((item) => item.code === "checkout_branch" && item.role === "accepted"),
  "topology strict audit rejects a detached checkout even when its local main ref is correct");
relGit(topologyAccepted, ["checkout", "-q", "main"]);

relGit(topologyDevelopment, ["checkout", "-q", "-b", "feat/unmerged"]);
fs.writeFileSync(path.join(topologyDevelopment, "feature.txt"), "feature\n");
relGit(topologyDevelopment, ["add", "."]);
relGit(topologyDevelopment, ["commit", "-q", "-m", "feat: topology fixture"]);
relGit(topologyDevelopment, ["checkout", "-q", "main"]);
topology = topologyJson(topologyDevelopment, topologyAccepted);
ok(topology.ok === false && topology.issues.some((item) => item.code === "unmerged_branch" && item.branch === "feat/unmerged"),
  "topology audit rejects hidden unmerged branch commits");

relGit(topologyDevelopment, ["merge", "-q", "--no-ff", "feat/unmerged", "-m", "Merge feat/unmerged"]);
topology = topologyJson(topologyDevelopment, topologyAccepted);
ok(topology.ok === false && topology.issues.some((item) => item.code === "merged_branch" && item.branch === "feat/unmerged"),
  "topology audit rejects merged branches left behind");
topology = topologyJson(topologyAccepted, "", ["--remote", "origin", "--fetch"]);
ok(topology.ok === false && topology.issues.some((item) => item.code === "remote_base_mismatch"),
  "topology audit fetches and rejects a local main that is stale against its remote");
relGit(topologyDevelopment, ["branch", "-d", "feat/unmerged"]);
relGit(topologyAccepted, ["fetch", "-q", "origin"]);
relGit(topologyAccepted, ["merge", "-q", "--ff-only", "origin/main"]);
topology = topologyJson(topologyDevelopment, topologyAccepted);
ok(topology.ok === true, "topology audit passes after branch cleanup and accepted-main synchronization");

relGit(topologyDevelopment, ["checkout", "-q", "-b", "feat/remote-only", "main"]);
fs.writeFileSync(path.join(topologyDevelopment, "remote-only.txt"), "remote only\n");
relGit(topologyDevelopment, ["add", "."]);
relGit(topologyDevelopment, ["commit", "-q", "-m", "feat: remote-only fixture"]);
relGit(topologyDevelopment, ["checkout", "-q", "main"]);
topology = topologyJson(topologyAccepted, "", ["--remote", "origin", "--fetch"]);
ok(topology.ok === false && topology.issues.some((item) => item.code === "unmerged_remote_branch" && item.branch === "feat/remote-only"),
  "topology strict audit rejects a remote-only branch with unique patches");
relGit(topologyDevelopment, ["cherry-pick", "-n", "feat/remote-only"]);
relGit(topologyDevelopment, ["commit", "-q", "-m", "feat: accept equivalent remote patch"]);
relGit(topologyAccepted, ["fetch", "-q", "origin"]);
relGit(topologyAccepted, ["merge", "-q", "--ff-only", "origin/main"]);
topology = topologyJson(topologyAccepted, "", ["--remote", "origin", "--fetch"]);
ok(topology.ok === false && topology.issues.some((item) => item.code === "equivalent_remote_branch" && item.branch === "feat/remote-only"),
  "topology strict audit rejects a patch-equivalent remote-only branch");
relGit(topologyDevelopment, ["branch", "-D", "feat/remote-only"]);
relGit(topologyAccepted, ["fetch", "-q", "--prune", "origin"]);
topology = topologyJson(topologyAccepted, "", ["--remote", "origin", "--fetch"]);
ok(topology.ok === true && topology.remoteBranches.length === 0,
  "topology strict audit passes only after the remote branch is removed");

relGit(topologyDevelopment, ["worktree", "add", "-q", "--detach", topologyExtra, "main"]);
topology = topologyJson(topologyDevelopment, topologyAccepted);
ok(topology.ok === false && topology.issues.some((item) => item.code === "extra_worktree"),
  "topology audit rejects an unexpected linked worktree");
relGit(topologyDevelopment, ["worktree", "remove", topologyExtra]);
fs.writeFileSync(path.join(topologyAccepted, "accepted-only.txt"), "ahead\n");
relGit(topologyAccepted, ["add", "."]);
relGit(topologyAccepted, ["commit", "-q", "-m", "chore: accepted ahead"]);
topology = topologyJson(topologyDevelopment, topologyAccepted);
ok(topology.ok === false && topology.issues.some((item) => item.code === "base_mismatch"),
  "topology audit rejects different development and accepted main SHAs");
try { fs.rmSync(topologyRoot, { recursive: true, force: true }); } catch {}

// ---------- stop-reminder ----------
console.log("\nstop-reminder:");
const stopRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-stop-"));
execFileSync("git", ["init", "-q"], { cwd: stopRepo });
let stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(stopOut.trim() === "", "stop reminder assertion 1");
fs.writeFileSync(path.join(stopRepo, "wip.txt"), "x");
stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(/VERIFY/.test(stopOut) && /wip\.txt/.test(stopOut), "stop reminder assertion 2");
ok(/"decision"\s*:\s*"block"/.test(stopOut), "stop reminder assertion 3");
stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(stopOut.trim() === "", "stop reminder assertion 4");
fs.writeFileSync(path.join(stopRepo, "another.txt"), "x");
stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(/another\.txt/.test(stopOut) && /"decision"\s*:\s*"block"/.test(stopOut),
  "stop reminder assertion 5");
stopOut = hookOutput(STOP, { stop_hook_active: true }, { HARNESS_PROJECT_DIR: stopRepo });
ok(stopOut.trim() === "", "stop reminder assertion 6");
try { fs.rmSync(stopRepo, { recursive: true, force: true }); } catch {}
const stopRepo2 = fs.mkdtempSync(path.join(os.tmpdir(), "harness-stop-explained-"));
execFileSync("git", ["init", "-q"], { cwd: stopRepo2 });
fs.mkdirSync(path.join(stopRepo2, "hooks"), { recursive: true });
fs.writeFileSync(path.join(stopRepo2, "hooks", "verify.js"), "x");
fs.writeFileSync(path.join(stopRepo2, ".gitignore"), "x");
const transcript = path.join(os.tmpdir(), "harness-stop-transcript-" + process.pid + ".jsonl");
fs.writeFileSync(transcript, JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: "VERIFY verified, commit created. Remaining uncommitted bootstrap/harness/local files were left intentionally and are not part of this change." },
}) + "\n");
stopOut = hookOutput(STOP, { transcript_path: transcript }, { HARNESS_PROJECT_DIR: stopRepo2 });
ok(stopOut.trim() === "", "dirty only harness/local plus report explains intentional uncommitted files -> Stop stays silent");
try { fs.rmSync(stopRepo2, { recursive: true, force: true }); fs.rmSync(transcript, { force: true }); } catch {}
const stopRepo3 = fs.mkdtempSync(path.join(os.tmpdir(), "harness-stop-review-"));
execFileSync("git", ["init", "-q"], { cwd: stopRepo3 });
fs.writeFileSync(path.join(stopRepo3, ".gitattributes"), "x");
const transcript2 = path.join(os.tmpdir(), "harness-stop-review-transcript-" + process.pid + ".jsonl");
fs.writeFileSync(transcript2, JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: "Review-only pass complete: I did not edit and did not commit. VERIFY was checked partially, commit/PR not created because the task was only a review." },
}) + "\n");
stopOut = hookOutput(STOP, { transcript_path: transcript2 }, { HARNESS_PROJECT_DIR: stopRepo3 });
ok(stopOut.trim() === "", "review-only report explains dirty tree -> Stop does not override the final answer");
try { fs.rmSync(stopRepo3, { recursive: true, force: true }); fs.rmSync(transcript2, { force: true }); } catch {}

// ---------- installer (install.js) ----------
console.log("\ninstaller:");
const INSTALL = path.join(REPO, "install.js");
function installArgs(args, cwd = REPO) {
  try {
    const s = execFileSync("node", [INSTALL, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(s);
  } catch (e) { try { return JSON.parse(String(e.stdout || "{}")); } catch { return {}; } }
}
function installJson(target, extra) {
  return installArgs(["--target", target, "--json", ...extra]);
}
const itmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-"));
execFileSync("git", ["init", "-q"], { cwd: itmp });
execFileSync("git", ["remote", "add", "origin", "https://github.com/ExampleOrg/example-target.git"], { cwd: itmp });
const positionalPlan = installArgs([itmp, "--force", "--dry-run", "--json"]);
ok(positionalPlan.ok === true && positionalPlan.mode === "install" && positionalPlan.target === path.resolve(itmp),
  "install: positional target is accepted instead of silently falling back to cwd");
const invalidArgsTarget = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-invalid-"));
const unknownArg = installArgs([invalidArgsTarget, "--unknown-option", "--json"]);
ok(unknownArg.ok === false && unknownArg.mode === "invalid" && /unknown option/.test(unknownArg.reason || "") &&
   fs.readdirSync(invalidArgsTarget).length === 0,
"install: unknown options fail before writing to the target");
const duplicateTarget = installArgs([invalidArgsTarget, "--target", invalidArgsTarget, "--json"]);
ok(duplicateTarget.ok === false && duplicateTarget.mode === "invalid" && /either positionally or with --target/.test(duplicateTarget.reason || "") &&
   fs.readdirSync(invalidArgsTarget).length === 0,
"install: positional and --target destinations cannot be combined");
const missingTargetValue = installArgs(["--target", "--json"]);
ok(missingTargetValue.ok === false && /--target requires a directory/.test(missingTargetValue.reason || ""),
"install: missing --target value fails explicitly");
// dry-run: plan exists and disk is untouched.
let plan = installJson(itmp, ["--dry-run"]);
ok(plan.ok === true && plan.mode === "install", "installer assertion 1");
ok(Array.isArray(plan.files) && plan.files.some((f) => /agent\/guard\.js/.test(f.rel)), "installer assertion 2");
ok(!fs.existsSync(path.join(itmp, "hooks", "agent", "guard.js")), "installer assertion 3");
// Real installation. Untracked harness files are a successful install with a
// separately reported bootstrap state, not an installer failure.
const firstInstall = installJson(itmp, []);
ok(firstInstall.ok === true && firstInstall.installed === true && firstInstall.bootstrapRequired === true && firstInstall.enforceable === false,
  "install: fresh repository reports bootstrapRequired without failing file installation");
ok(!firstInstall.migrationRequired.includes("branch-lifecycle-policy-review"),
  "install: fresh target receives branch lifecycle policy without a migration flag");
const enforceableGate = installJson(itmp, ["--require-enforceable"]);
ok(enforceableGate.ok === false && enforceableGate.installed === true && enforceableGate.bootstrapRequired === true &&
   /not-enforceable/.test(enforceableGate.reason || ""),
  "install: --require-enforceable turns bootstrap-pending into an automation failure");
ok(fs.existsSync(path.join(itmp, "hooks", "agent", "guard.js")) && fs.existsSync(path.join(itmp, "hooks", "verify-core.js")) && fs.existsSync(path.join(itmp, "hooks", "branch-guard.js")) && fs.existsSync(path.join(itmp, "hooks", "no-coauthor.js")) && fs.existsSync(path.join(itmp, "hooks", "release-start.js")) && fs.existsSync(path.join(itmp, "hooks", "release-config.js")) && fs.existsSync(path.join(itmp, "hooks", "release-manifest-bump.js")) && fs.existsSync(path.join(itmp, "hooks", "release-preflight.js")) && fs.existsSync(path.join(itmp, "hooks", "release-artifacts.js")) && fs.existsSync(path.join(itmp, "hooks", "branch-state.js")) && fs.existsSync(path.join(itmp, "hooks", "github-branch-cleanup.js")) && fs.existsSync(path.join(itmp, "hooks", "post-merge-cleanup.js")) && fs.existsSync(path.join(itmp, "hooks", "release-cleanup.js")) && fs.existsSync(path.join(itmp, "hooks", "repo-state-audit.js")) && fs.existsSync(path.join(itmp, "lefthook.yml")), "installer assertion 4");
const installManifest = JSON.parse(fs.readFileSync(path.join(itmp, ".harness", "installation.json"), "utf8"));
ok(installManifest.schemaVersion === 1 && installManifest.managed["hooks/agent/guard.js"] &&
   installManifest.ownership.projectOwned.includes("harness.config.json"),
  "install: manifest records managed hashes and the project-owned boundary");
ok(/^# Changelog\s+- - -\s*$/s.test(fs.readFileSync(path.join(itmp, "CHANGELOG.md"), "utf8")),
  "install: missing target changelog is initialized for Cocogitto");
const productChangelog = "# Changelog\n\n- - -\n\n## v9.9.9\n\n- Product history must survive harness updates.\n";
fs.writeFileSync(path.join(itmp, "CHANGELOG.md"), productChangelog);
installJson(itmp, ["--force"]);
ok(fs.readFileSync(path.join(itmp, "CHANGELOG.md"), "utf8") === productChangelog,
  "install: --force preserves the target project's changelog");
ok(fs.existsSync(path.join(itmp, ".github", "workflows", "ci.yml")) &&
   fs.existsSync(path.join(itmp, ".github", "workflows", "branch-cleanup.yml")) &&
   fs.existsSync(path.join(itmp, ".github", "CODEOWNERS")),
  "install: CI, branch lifecycle workflow, and CODEOWNERS are copied by default with the ruleset");
ok(!fs.existsSync(path.join(itmp, ".github", "workflows", "release.yml")),
  "install: source-only release workflow is not copied into target projects");
const defaultOwners = fs.readFileSync(path.join(itmp, ".github", "CODEOWNERS"), "utf8");
const defaultRuleset = JSON.parse(fs.readFileSync(path.join(itmp, ".github", "rulesets", "main.json"), "utf8"));
const defaultPrRule = (defaultRuleset.rules || []).find((r) => r.type === "pull_request");
ok(!/@IvanLarinDev/.test(defaultOwners) && defaultPrRule.parameters.require_code_owner_review === false,
  "install: default target CODEOWNERS does not hardcode the source maintainer and disables code-owner review");
ok(defaultPrRule.parameters.required_approving_review_count === 1,
  "install: default target ruleset keeps regular approving review even though source ruleset is solo-maintainer");
ok(/Code-owner review is disabled/.test(defaultRuleset._comment || "") && !/Code-owner review is required/.test(defaultRuleset._comment || ""),
  "install: default target ruleset comment matches disabled code-owner policy");
installJson(itmp, ["--code-owner", "@ExampleOrg/harness-maintainers"]);
const ownerRuleset = JSON.parse(fs.readFileSync(path.join(itmp, ".github", "rulesets", "main.json"), "utf8"));
const ownerPrRule = (ownerRuleset.rules || []).find((r) => r.type === "pull_request");
ok(/@ExampleOrg\/harness-maintainers/.test(fs.readFileSync(path.join(itmp, ".github", "CODEOWNERS"), "utf8")) &&
   ownerPrRule.parameters.require_code_owner_review === true,
  "install: explicit --code-owner writes CODEOWNERS and enables code-owner review");
ok(ownerPrRule.parameters.required_approving_review_count === 1,
  "install: explicit --code-owner target ruleset keeps regular approving review");
ok(/Code-owner review is required/.test(ownerRuleset._comment || ""),
  "install: explicit --code-owner ruleset comment matches required code-owner policy");
const invalidSoloOwner = installJson(itmp, ["--ruleset-profile", "solo", "--code-owner", "@ExampleOrg/team"]);
ok(invalidSoloOwner.ok === false && invalidSoloOwner.mode === "invalid",
  "install: solo ruleset profile rejects required code-owner review");
installJson(itmp, ["--ruleset-profile", "solo"]);
let profiledRuleset = JSON.parse(fs.readFileSync(path.join(itmp, ".github", "rulesets", "main.json"), "utf8"));
let profiledPr = profiledRuleset.rules.find((r) => r.type === "pull_request");
let profiledConfig = JSON.parse(fs.readFileSync(path.join(itmp, "harness.config.json"), "utf8"));
ok(profiledPr.parameters.required_approving_review_count === 0 && profiledPr.parameters.require_code_owner_review === false &&
   profiledConfig.serverPolicy.profile === "solo" && profiledConfig.serverPolicy.provider === "github",
  "install: explicit solo profile structurally updates project config and review policy");
installJson(itmp, ["--ruleset-profile", "team"]);
profiledRuleset = JSON.parse(fs.readFileSync(path.join(itmp, ".github", "rulesets", "main.json"), "utf8"));
profiledPr = profiledRuleset.rules.find((r) => r.type === "pull_request");
profiledConfig = JSON.parse(fs.readFileSync(path.join(itmp, "harness.config.json"), "utf8"));
ok(profiledPr.parameters.required_approving_review_count === 1 && profiledConfig.serverPolicy.profile === "team",
  "install: explicit team profile restores required approving review");
const tcog = fs.readFileSync(path.join(itmp, "cog.toml"), "utf8");
ok(/owner\s*=\s*"ExampleOrg"/.test(tcog) && /repository\s*=\s*"example-target"/.test(tcog),
  "install: cog.toml remote changelog metadata is rewritten from target origin");
ok(!fs.existsSync(path.join(itmp, "hooks", "test.js")), "installer assertion 5");
const tcfg = JSON.parse(fs.readFileSync(path.join(itmp, "harness.config.json"), "utf8"));
ok(tcfg.schemaVersion === 2 && !tcfg.verify && Array.isArray(tcfg.ui.globs) && Array.isArray(tcfg.ui.exclude) &&
   tcfg.capabilities.release === "cocogitto" && tcfg.capabilities.serverPolicy === "github",
  "installer assertion 6");
ok(!/Dropwheel|inbox\/dropwheel/.test(fs.readFileSync(path.join(itmp, "AGENTS.md"), "utf8")) &&
   /MERGE\+CLEANUP/.test(fs.readFileSync(path.join(itmp, "AGENTS.md"), "utf8")) &&
   /remote branches/.test(fs.readFileSync(path.join(itmp, "AGENTS.md"), "utf8")),
  "install: target AGENTS template is project-agnostic");
const tset = JSON.parse(fs.readFileSync(path.join(itmp, ".claude", "settings.json"), "utf8"));
ok(/guard\.js/.test(JSON.stringify(tset.hooks.PreToolUse)), "installer assertion 7");
ok(/stop-reminder\.js/.test(JSON.stringify(tset.hooks.Stop)), "installer assertion 8");
// .gitignore ignores only personal settings.local.json, not harness files.
const gi = fs.readFileSync(path.join(itmp, ".gitignore"), "utf8");
ok(/\.claude\/settings\.local\.json/.test(gi), "installer assertion 9");
ok(!/^hooks\//m.test(gi) && !/lefthook\.yml/.test(gi) && !/harness\.config/.test(gi),
  "installer assertion 10");
installJson(itmp, []);
const gi2 = fs.readFileSync(path.join(itmp, ".gitignore"), "utf8");
ok((gi2.match(/settings\.local\.json/g) || []).length === 1, "installer assertion 11");

// Idempotency: repeated install does not duplicate hook entries.
const preLen = tset.hooks.PreToolUse.length;
installJson(itmp, []);
const tset2 = JSON.parse(fs.readFileSync(path.join(itmp, ".claude", "settings.json"), "utf8"));
ok(tset2.hooks.PreToolUse.length === preLen, "installer assertion 12");
const dstSet = path.join(itmp, ".claude", "settings.json");
const staleSet = JSON.parse(fs.readFileSync(dstSet, "utf8"));
staleSet.hooks.PreToolUse = [
  { hooks: [{ type: "command", command: "node vendor/guard.js" }] }
];
staleSet.hooks.Stop = [
  { hooks: [{ type: "command", command: "node vendor/stop-reminder.js" }] }
];
fs.writeFileSync(dstSet, JSON.stringify(staleSet, null, 2) + "\n");
const staleMerge = installJson(itmp, []);
const staleAfter = JSON.parse(fs.readFileSync(dstSet, "utf8"));
ok(staleMerge.settings && staleMerge.settings.added === 2 &&
   staleAfter.hooks.PreToolUse.some((e) => JSON.stringify(e).includes("hooks/agent/guard.js")) &&
   staleAfter.hooks.Stop.some((e) => JSON.stringify(e).includes("hooks/agent/stop-reminder.js")),
  "install: unrelated guard.js basename does not mask missing harness hooks");
// Managed runtime updates are hash-aware. A local edit conflicts under --update
// and is replaced only by explicit --replace-managed/legacy --force.
const gp = path.join(itmp, "hooks", "agent", "guard.js");
fs.writeFileSync(gp, "// local edit\n");
installJson(itmp, []);
ok(fs.readFileSync(gp, "utf8") === "// local edit\n", "installer assertion 13");
const safeUpdate = installJson(itmp, ["--update"]);
ok(safeUpdate.ok === false && safeUpdate.files.some((f) => f.rel === "hooks/agent/guard.js" && f.action === "conflict") &&
   fs.readFileSync(gp, "utf8") === "// local edit\n",
  "install: --update refuses to overwrite locally modified managed runtime");
installJson(itmp, ["--force"]);
ok(fs.readFileSync(gp, "utf8") !== "// local edit\n", "installer assertion 14");

// Project policy survives even the compatibility force mode.
const customConfig = { schemaVersion: 2, capabilities: { ui: "none", release: "none", serverPolicy: "none" }, product: "keep-me" };
fs.writeFileSync(path.join(itmp, "harness.config.json"), JSON.stringify(customConfig, null, 2) + "\n");
fs.writeFileSync(path.join(itmp, "AGENTS.md"), "# Product-owned instructions\n");
fs.writeFileSync(path.join(itmp, ".gitleaks.toml"), "title = \"product policy\"\n");
fs.writeFileSync(path.join(itmp, "cog.toml"), "# product release adapter\n");
const customOwners = "* @ExampleOrg/product-team\n";
fs.writeFileSync(path.join(itmp, ".github", "CODEOWNERS"), customOwners);
const customRuleset = JSON.parse(fs.readFileSync(path.join(itmp, ".github", "rulesets", "main.json"), "utf8"));
customRuleset.rules.find((r) => r.type === "pull_request").parameters.required_approving_review_count = 2;
fs.writeFileSync(path.join(itmp, ".github", "rulesets", "main.json"), JSON.stringify(customRuleset, null, 2) + "\n");
const forced = installJson(itmp, ["--force"]);
ok(forced.ok === true && JSON.parse(fs.readFileSync(path.join(itmp, "harness.config.json"), "utf8")).product === "keep-me" &&
   fs.readFileSync(path.join(itmp, "AGENTS.md"), "utf8") === "# Product-owned instructions\n" &&
   fs.readFileSync(path.join(itmp, ".gitleaks.toml"), "utf8") === "title = \"product policy\"\n" &&
   fs.readFileSync(path.join(itmp, "cog.toml"), "utf8") === "# product release adapter\n" &&
   fs.readFileSync(path.join(itmp, ".github", "CODEOWNERS"), "utf8") === customOwners &&
   JSON.parse(fs.readFileSync(path.join(itmp, ".github", "rulesets", "main.json"), "utf8")).rules.find((r) => r.type === "pull_request").parameters.required_approving_review_count === 2,
  "install: --force updates managed runtime but preserves every project-owned policy file");
ok(forced.migrationRequired.includes("branch-lifecycle-policy-review") &&
   forced.notes.some((note) => /branch-lifecycle-policy-review/.test(note)),
  "install: preserved AGENTS policy reports branch lifecycle review as an explicit migration");
// settings.json merge keeps foreign keys.
const cur = JSON.parse(fs.readFileSync(dstSet, "utf8")); cur.model = "opus"; fs.writeFileSync(dstSet, JSON.stringify(cur));
installJson(itmp, []);
ok(JSON.parse(fs.readFileSync(dstSet, "utf8")).model === "opus", "installer assertion 15");
// Invalid existing settings.json is reported and left untouched.
fs.writeFileSync(dstSet, "{ broken");
const br = installJson(itmp, []);
ok(br.settings && br.settings.status === "error", "invalid .claude/settings.json -> merge error, file untouched");
ok(fs.readFileSync(dstSet, "utf8") === "{ broken", "invalid settings.json remains unchanged");
// A non-git target gets a note; file installation still runs.
const nogit = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-nogit-"));
const ng = installJson(nogit, []);
ok(Array.isArray(ng.notes) && ng.notes.some((n) => /not a git repository/.test(n)), "non-git target -> note about git init");
ok(ng.ok === false && /installation failed/.test(ng.reason || ""), "installer assertion 16");
const gitlab = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-gitlab-"));
execFileSync("git", ["init", "-q"], { cwd: gitlab });
execFileSync("git", ["remote", "add", "origin", "https://gitlab.com/ExampleOrg/example-target.git"], { cwd: gitlab });
const portableInstall = installJson(gitlab, []);
const portableConfig = JSON.parse(fs.readFileSync(path.join(gitlab, "harness.config.json"), "utf8"));
ok(portableInstall.ok === true && portableInstall.adapters.server === "none" && portableInstall.adapters.release === "none" &&
   portableConfig.capabilities.serverPolicy === "none" && portableConfig.capabilities.release === "none" &&
   !fs.existsSync(path.join(gitlab, ".github")) && !fs.existsSync(path.join(gitlab, "cog.toml")) && !fs.existsSync(path.join(gitlab, "CHANGELOG.md")),
  "install: non-GitHub origin stays provider-neutral unless adapters are selected explicitly");
const explicitGenericRelease = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-generic-release-"));
execFileSync("git", ["init", "-q"], { cwd: explicitGenericRelease });
execFileSync("git", ["remote", "add", "origin", "https://gitlab.com/ExampleOrg/release-target.git"], { cwd: explicitGenericRelease });
const genericReleaseInstall = installJson(explicitGenericRelease, ["--release-provider", "cocogitto"]);
ok(genericReleaseInstall.ok === true && fs.readFileSync(path.join(explicitGenericRelease, "cog.toml"), "utf8").includes("Project-owned Cocogitto baseline") &&
   JSON.parse(fs.readFileSync(path.join(explicitGenericRelease, "harness.config.json"), "utf8")).release.remote === "none",
  "install: explicit Cocogitto adapter on a non-GitHub remote uses a provider-neutral project template");
const legacyTarget = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-legacy-config-"));
execFileSync("git", ["init", "-q"], { cwd: legacyTarget });
execFileSync("git", ["remote", "add", "origin", "https://github.com/ExampleOrg/legacy-target.git"], { cwd: legacyTarget });
const legacyConfigText = JSON.stringify({ ui: { globs: ["**/*.qml"] }, debugAudit: { enabled: true } }, null, 2) + "\n";
fs.writeFileSync(path.join(legacyTarget, "harness.config.json"), legacyConfigText);
const legacyInstall = installJson(legacyTarget, ["--force"]);
ok(legacyInstall.ok === true && fs.readFileSync(path.join(legacyTarget, "harness.config.json"), "utf8") === legacyConfigText &&
   legacyInstall.migrationRequired.includes("schema-v2-capabilities") && legacyInstall.migrationRequired.includes("ui-routing-v2-review") &&
   legacyInstall.migrationRequired.includes("release-contract-v2-review") && legacyInstall.migrationRequired.includes("server-policy-v2-review"),
  "install: legacy project config is preserved and reported as a separate reviewed migration");
try {
  fs.rmSync(itmp, { recursive: true, force: true }); fs.rmSync(nogit, { recursive: true, force: true });
  fs.rmSync(gitlab, { recursive: true, force: true }); fs.rmSync(explicitGenericRelease, { recursive: true, force: true });
  fs.rmSync(legacyTarget, { recursive: true, force: true });
  fs.rmSync(invalidArgsTarget, { recursive: true, force: true });
} catch {}

// ---------- hygiene: NUL bytes ----------
console.log("\nsource hygiene:");
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(js|json|md)$/.test(e.name)) out.push(p);
  }
  return out;
}
const nulFiles = walk(__dirname).filter((f) => fs.readFileSync(f).includes(0));
ok(nulFiles.length === 0, "source hygiene assertion 1" + (nulFiles.length ? "source hygiene assertion 1" + nulFiles.join(", ") + ")" : ""));

// ---------- hygiene: key docs integrity ----------
// Catches truncated/corrupt markdown. Regression 99bf0c7 cut AGENTS.md in the
// middle of a table with a broken UTF-8 byte and lost the ## Env section. A
// truncated multibyte tail fails decode->encode roundtrip and produces U+FFFD, so
// both signals are checked.
console.log("\ndocs integrity:");
function docCheck(rel) {
  let buf;
  try { buf = fs.readFileSync(path.join(REPO, rel)); } catch { return { exists: false }; }
  let text = "", roundtrips = false;
  try { text = buf.toString("utf8"); roundtrips = Buffer.from(text, "utf8").equals(buf); } catch {}
  return {
    exists: true,
    endsNewline: buf.length > 0 && buf[buf.length - 1] === 10,
    noReplacement: !buf.includes(Buffer.from([0xef, 0xbf, 0xbd])),
    validUtf8: roundtrips,
    text,
  };
}
for (const rel of ["AGENTS.md", "README.md"]) {
  const d = docCheck(rel);
  ok(d.exists, rel + "docs integrity assertion 1");
  ok(d.exists && d.endsNewline, rel + "docs integrity assertion 2");
  ok(d.exists && d.validUtf8, rel + "docs integrity assertion 3");
  ok(d.exists && d.noReplacement, rel + "docs integrity assertion 4");
}
const agentsDoc = docCheck("AGENTS.md");
ok(agentsDoc.exists && /^##\s+Env\b/m.test(agentsDoc.text),
  "docs integrity assertion 5");

try { fs.rmSync(NEUTRAL, { recursive: true, force: true }); } catch {}
console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
