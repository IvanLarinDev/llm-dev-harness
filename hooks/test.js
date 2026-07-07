#!/usr/bin/env node
// test.js — self-test suite for the dev-loop harness. Cross-platform (no bash).
// Runs commit-lint unit tests plus a full git-native integration test in a throwaway
// repo under os.tmpdir(): pre-commit / commit-msg / pre-push, escape hatch, and the
// runtime-agnostic loop-guard. This is the repo's VERIFY step:  node hooks/test.js
//
// Exit 0 = all green, exit 1 = at least one failure.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { lint } = require(path.join(__dirname, "lib", "commit-lint.js"));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg); }
}
function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}
function tryGit(cwd, args, env = {}) {
  try {
    execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, stdio: "pipe" });
    return 0;
  } catch (e) { return e.status || 1; }
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

// ---------- unit: commit-lint ----------
console.log("commit-lint (unit):");
ok(lint("feat: add x").ok, "feat: add x accepted");
ok(lint("fix(parser): handle EOF").ok, "scoped fix accepted");
ok(lint("feat(api)!: drop v1").ok, "breaking ! accepted");
ok(lint("Merge branch 'x'").ok, "merge header accepted");
ok(!lint("updated stuff").ok, "non-conventional rejected");
ok(!lint("FEAT: x").ok, "uppercase type rejected");
ok(!lint("feat: x\n\nCo-Authored-By: A <a@b.c>").ok, "co-author trailer rejected");
ok(!lint("fix: x\n\n🤖 Generated with Y").ok, "robot/generated rejected");
ok(lint("feat: x\n\n# Co-Authored-By: commented out").ok, "commented trailer ignored");

// ---------- integration: git-native hooks ----------
const HOOKS_GIT = path.join(__dirname, "git");
const LOOP_GUARD = path.join(__dirname, "agent", "loop-guard.js");
const BYPASS_GUARD = path.join(__dirname, "agent", "bypass-guard.js");
const DESIGN_GATE = path.join(__dirname, "design-gate.js");
const DESIGN_GUARD = path.join(__dirname, "agent", "design-guard.js");
const NEW_MOCKUPS = path.join(__dirname, "new-mockups.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-selftest-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });

git(repo, ["init", "-q", "-b", "main"]);
git(repo, ["config", "user.email", "selftest@harness.local"]);
git(repo, ["config", "user.name", "selftest"]);
git(repo, ["config", "core.hooksPath", HOOKS_GIT]);
fs.writeFileSync(path.join(repo, "f.txt"), "a\n");
git(repo, ["add", "f.txt"]);

console.log("\ngit-native hooks (integration):");
ok(tryGit(repo, ["commit", "-m", "feat: init"]) !== 0, "pre-commit blocks commit on main");
ok(tryGit(repo, ["commit", "-m", "chore(init): bootstrap"], { HARNESS_ALLOW_MAIN: "1" }) === 0,
   "HARNESS_ALLOW_MAIN allows main commit");
fs.writeFileSync(path.join(repo, "g.txt"), "g\n"); git(repo, ["add", "g.txt"]);
ok(tryGit(repo, ["commit", "-m", "chore(init): second"], { HARNESS_ALLOW_MAIN: "1 " }) === 0,
   "escape hatch tolerates trailing space (Windows `set VAR=1 &`)");

git(repo, ["checkout", "-q", "-b", "feat/x"]);
fs.appendFileSync(path.join(repo, "f.txt"), "b\n"); git(repo, ["add", "f.txt"]);
ok(tryGit(repo, ["commit", "-m", "updated stuff"]) !== 0, "commit-msg blocks non-conventional header");
ok(tryGit(repo, ["commit", "-m", "feat: real", "-m", "Co-Authored-By: A <a@b.c>"]) !== 0,
   "commit-msg blocks co-author trailer");
ok(tryGit(repo, ["commit", "-m", "feat(core): real change"]) === 0, "good conventional commit passes");

const bare = path.join(tmp, "remote.git");
git(repo, ["init", "-q", "--bare", bare]);
git(repo, ["remote", "add", "origin", bare]);
ok(tryGit(repo, ["push", "-q", "origin", "feat/x"]) === 0, "pre-push allows feature branch");
git(repo, ["tag", "-a", "v0.0.1", "-m", "rel"]);
ok(tryGit(repo, ["push", "-q", "origin", "v0.0.1"]) === 0, "pre-push allows tag push");
git(repo, ["checkout", "-q", "main"]);
ok(tryGit(repo, ["push", "origin", "main"]) !== 0, "pre-push blocks direct push to main");
ok(tryGit(repo, ["push", "-q", "origin", "main"], { HARNESS_ALLOW_MAIN: "1" }) === 0,
   "HARNESS_ALLOW_MAIN allows main push");

// ---------- agent-adapter: loop-guard ----------
console.log("\nloop-guard (agent-adapter):");
const S = { HARNESS_SESSION_ID: "selftest-" + Date.now() };
ok(runHook(LOOP_GUARD, { tool_name: "Bash", tool_input: { command: "cd /x && echo garbage 183<tool" } }, S) === 2,
   "blocks tool-markup corruption");
ok(runHook(LOOP_GUARD, { tool_name: "Bash", tool_input: { command: "echo a echo a echo a echo a echo a" } }, S) === 2,
   "blocks low-entropy command");
ok(runHook(LOOP_GUARD, { toolName: "shell", input: { command: "npm run build" } }, S) === 0,
   "allows a real command (alt field names)");

// ---------- agent-adapter: bypass-guard ----------
console.log("\nbypass-guard (agent-adapter):");
ok(runHook(BYPASS_GUARD, { tool_name: "Bash", tool_input: { command: 'git commit -m "feat: x" --no-verify' } }) === 2,
   "blocks git commit --no-verify");
ok(runHook(BYPASS_GUARD, { tool_name: "Bash", tool_input: { command: 'git commit -n -m "feat: x"' } }) === 2,
   "blocks git commit -n");
ok(runHook(BYPASS_GUARD, { tool_name: "Bash", tool_input: { command: "git push origin main --no-verify" } }) === 2,
   "blocks git push --no-verify");
ok(runHook(BYPASS_GUARD, { tool_name: "Bash", tool_input: { command: "git config core.hooksPath /dev/null" } }) === 2,
   "blocks core.hooksPath tampering");
ok(runHook(BYPASS_GUARD, { tool_name: "Bash", tool_input: { command: 'git commit -m "docs: add -n / --no-verify support notes"' } }) === 0,
   "does NOT false-positive on -n inside a commit message");
ok(runHook(BYPASS_GUARD, { tool_name: "Bash", tool_input: { command: 'git commit -m "feat(core): real change"' } }) === 0,
   "allows a normal commit");
ok(runHook(BYPASS_GUARD, { tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, { HARNESS_ACK_BYPASS: "1" }) === 0,
   "HARNESS_ACK_BYPASS allows an acknowledged bypass");

// ---------- DESIGN-gate (P1-5) ----------
console.log("\ndesign-gate (P1-5):");
function gate(root, files) {
  try {
    execFileSync("node", [DESIGN_GATE, "--root", root, "--files", files.join(",")], { encoding: "utf8", stdio: "pipe" });
    return 0;
  } catch (e) { return e.status || 1; }
}
const dtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-design-"));
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1, "gate blocks UI change without approved mockups");
ok(gate(dtmp, ["src/core/logic.py"]) === 0, "gate ignores non-UI change");
// scaffolder produces 4 mockups
execFileSync("node", [NEW_MOCKUPS, "login"], { env: { ...process.env, HARNESS_ROOT: dtmp }, stdio: "pipe" });
const fdir = path.join(dtmp, "design", "mockups", "login");
const htmls = fs.readdirSync(fdir).filter((f) => f.endsWith(".html"));
ok(htmls.length === 4, "new-mockups scaffolds 4 HTML mockups");
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1, "gate still blocks until APPROVED exists");
fs.writeFileSync(path.join(fdir, "APPROVED"), "");
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 0, "gate passes with >=4 mockups + APPROVED");
ok(gate(dtmp, ["design/mockups/login/01-minimal-light.html"]) === 0, "changes only under mockups dir don't trigger gate");

// design-guard agent warn
function guardStderr(payload) {
  try { execFileSync("node", [DESIGN_GUARD], { input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }); return ""; }
  catch (e) { return String(e.stderr || ""); }
}
const w = execFileSync("node", [DESIGN_GUARD], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/ui/panel.qml" } }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
ok(/design-guard/.test(w), "design-guard warns on UI-file edit");
const w2 = execFileSync("node", [DESIGN_GUARD], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/core/logic.py" } }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
ok(!/design-guard/.test(w2), "design-guard silent on non-UI edit");

try { fs.rmSync(dtmp, { recursive: true, force: true }); } catch {}

// ---------- verify runner (P1-8) ----------
console.log("\nverify runner (P1-8):");
const VERIFY = path.join(__dirname, "verify.js");
function verifyExit(root) {
  try { execFileSync("node", [VERIFY, "--root", root], { encoding: "utf8", stdio: "pipe" }); return 0; }
  catch (e) { return e.status || 1; }
}
function verifyList(root) {
  try { return JSON.parse(execFileSync("node", [VERIFY, "--root", root, "--list", "--json"], { encoding: "utf8", stdio: "pipe" })); }
  catch { return { plan: [] }; }
}
// detection
const vtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verify-"));
fs.writeFileSync(path.join(vtmp, "Cargo.toml"), "[package]\n");
fs.mkdirSync(path.join(vtmp, "app"));
fs.writeFileSync(path.join(vtmp, "app", "App.csproj"), "<Project/>");
fs.writeFileSync(path.join(vtmp, "pyproject.toml"), "[project]\n");
const ids = verifyList(vtmp).plan.map((p) => p.stack);
ok(ids.includes("rust"), "verify auto-detects rust (Cargo.toml)");
ok(ids.includes("dotnet"), "verify auto-detects dotnet (*.csproj)");
ok(ids.includes("python"), "verify auto-detects python (pyproject.toml)");
// execution + fail-fast (trivial step scripts, no toolchain needed)
const etmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifyexec-"));
fs.writeFileSync(path.join(etmp, "m.txt"), "x");
fs.writeFileSync(path.join(etmp, "stepA.js"), "process.exit(0)");
fs.writeFileSync(path.join(etmp, "stepB.js"), "require('fs').writeFileSync('ran_b','1');process.exit(2)");
fs.writeFileSync(path.join(etmp, "stepC.js"), "require('fs').writeFileSync('ran_c','1')");
const cfgFF = { verify: { failFast: true, stacks: [{ id: "t", markers: ["m.txt"], steps: [
  { name: "a", run: "node stepA.js" }, { name: "b", run: "node stepB.js" }, { name: "c", run: "node stepC.js" }] }] } };
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify(cfgFF));
ok(verifyExit(etmp) === 1, "verify fails when a required step fails");
ok(fs.existsSync(path.join(etmp, "ran_b")), "failing step actually ran");
ok(!fs.existsSync(path.join(etmp, "ran_c")), "fail-fast: later step skipped after failure");
// all-pass
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "a", run: "node stepA.js" }] }] } }));
ok(verifyExit(etmp) === 0, "verify passes when all steps pass");
// optional failing step does not fail overall
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "opt", run: "node stepB.js", optional: true }] }] } }));
ok(verifyExit(etmp) === 0, "optional failing step is a warning, not a failure");
try { fs.rmSync(vtmp, { recursive: true, force: true }); fs.rmSync(etmp, { recursive: true, force: true }); } catch {}

// ---------- hygiene: no NUL bytes in any source file ----------
console.log("\nsource hygiene:");
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(js|json|md)$/.test(e.name) || ["commit-msg", "pre-commit", "pre-push"].includes(e.name)) out.push(p);
  }
  return out;
}
const nulFiles = walk(__dirname).filter((f) => fs.readFileSync(f).includes(0));
ok(nulFiles.length === 0, "no NUL bytes in hook sources" + (nulFiles.length ? " (found: " + nulFiles.join(", ") + ")" : ""));

// ---------- cleanup ----------
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(`\n${fail ? "❌ FAIL" : "✅ PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
