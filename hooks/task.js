#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const taskState = require("./task-state.js");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, killSignal: "SIGKILL" }).trim();
}

function repoRoot(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

function hasRef(root, ref) {
  try { git(root, ["rev-parse", "--verify", ref]); return true; }
  catch { return false; }
}

function parseArgs(argv) {
  const out = { command: argv[0] || "", slug: "", base: "", branch: "", dir: "", commit: "", dryRun: false, json: false, errors: [] };
  let i = 1;
  if (out.command === "start" && argv[i] && !argv[i].startsWith("--")) out.slug = argv[i++];
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (["--base", "--branch", "--dir", "--commit"].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) out.errors.push(`${arg} requires a value`);
      else out[arg.slice(2)] = argv[++i];
    } else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.json = true;
    else out.errors.push(`unknown argument: ${arg}`);
  }
  if (!["start", "check", "finish"].includes(out.command)) out.errors.push("command must be start, check, or finish");
  if (out.command === "start" && !/^[a-z0-9][a-z0-9-]{0,50}$/.test(out.slug)) out.errors.push("start requires a lowercase slug (letters, digits, hyphens)");
  return out;
}

function defaultBase(root) {
  if (hasRef(root, "origin/main")) return "origin/main";
  if (hasRef(root, "main")) return "main";
  if (hasRef(root, "origin/master")) return "origin/master";
  return "HEAD";
}

function startPlan(root, args) {
  const current = git(root, ["branch", "--show-current"]);
  const base = args.base || defaultBase(root);
  const branch = args.branch || `codex/${args.slug}`;
  const protectedBranch = ["main", "master"].includes(current);
  const useCurrent = !protectedBranch && current && !args.dir && !args.branch;
  const suffix = Date.now().toString(36);
  const worktree = useCurrent ? root : path.resolve(args.dir || path.join(os.tmpdir(), `harness-${path.basename(root)}-${args.slug}-${suffix}`));
  return { root, current, base, branch: useCurrent ? current : branch, worktree, createWorktree: !useCurrent };
}

function runInherited(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) return { ok: false, code: 1, error: result.error.message };
  return { ok: result.status === 0, code: result.status || 0, error: "" };
}

function emit(value, json) {
  if (json) console.log(JSON.stringify(value));
  else {
    console.log(`task ${value.command}: ${value.ok ? "ready" : "failed"}`);
    if (value.branch) console.log(`  branch: ${value.branch}`);
    if (value.worktree) console.log(`  worktree: ${value.worktree}`);
    if (value.next) console.log(`  next: ${value.next}`);
    for (const note of value.notes || []) console.log(`  note: ${note}`);
  }
}

function start(root, args) {
  const plan = startPlan(root, args);
  if (args.dryRun) return { ok: true, command: "start", ...plan, dryRun: true, notes: [] };
  if (plan.createWorktree) {
    if (fs.existsSync(plan.worktree)) return { ok: false, command: "start", ...plan, notes: ["worktree path already exists"] };
    if (hasRef(root, `refs/heads/${plan.branch}`)) return { ok: false, command: "start", ...plan, notes: ["branch already exists"] };
    git(root, ["worktree", "add", "-b", plan.branch, plan.worktree, plan.base]);
  }
  const notes = [];
  const lefthook = process.platform === "win32" ? "lefthook.cmd" : "lefthook";
  const hook = runInherited(lefthook, ["install"], plan.worktree);
  if (!hook.ok) notes.push(`lefthook activation needs attention${hook.error ? `: ${hook.error}` : ""}`);
  taskState.saveBaseline(plan.worktree);
  return { ok: true, command: "start", ...plan, notes, next: "node hooks/task.js check" };
}

function check(root, args) {
  const base = args.base || defaultBase(root);
  const verify = runInherited(process.execPath, [path.join(root, "hooks", "verify.js"), "--mode", "fast", "--base", base], root);
  const design = verify.ok ? runInherited(process.execPath, [path.join(root, "hooks", "design-gate.js"), "--base", base, "--advisory"], root) : { ok: false, code: verify.code };
  return { ok: verify.ok && design.ok, command: "check", branch: git(root, ["branch", "--show-current"]), worktree: root, notes: [], next: "node hooks/task.js finish", code: verify.ok ? design.code : verify.code };
}

function commitBranch(root) {
  const branch = git(root, ["branch", "--show-current"]);
  return { branch, allowed: Boolean(branch) && !["main", "master"].includes(branch) };
}

function finish(root, args) {
  const commitTarget = commitBranch(root);
  if (args.commit && !commitTarget.allowed) {
    return {
      ok: false,
      command: "finish",
      branch: commitTarget.branch,
      worktree: root,
      notes: [commitTarget.branch ? `refusing to commit on protected branch ${commitTarget.branch}` : "refusing to commit from detached HEAD"],
      code: 1,
    };
  }
  const base = args.base || defaultBase(root);
  const verify = runInherited(process.execPath, [path.join(root, "hooks", "verify.js"), "--mode", "full", "--base", base], root);
  if (!verify.ok) return { ok: false, command: "finish", worktree: root, notes: ["full VERIFY failed"], code: verify.code };
  const design = runInherited(process.execPath, [path.join(root, "hooks", "design-gate.js"), "--base", base], root);
  if (!design.ok) return { ok: false, command: "finish", worktree: root, notes: ["DESIGN gate failed"], code: design.code };
  const diff = runInherited("git", ["diff", "--check"], root);
  if (!diff.ok) return { ok: false, command: "finish", worktree: root, notes: ["git diff --check failed"], code: diff.code };
  const stagedDiff = runInherited("git", ["diff", "--cached", "--check"], root);
  if (!stagedDiff.ok) return { ok: false, command: "finish", worktree: root, notes: ["git diff --cached --check failed"], code: stagedDiff.code };
  const notes = [];
  if (args.commit) {
    git(root, ["add", "-A"]);
    const committed = runInherited("git", ["commit", "-m", args.commit], root);
    if (!committed.ok) return { ok: false, command: "finish", worktree: root, notes: ["commit failed"], code: committed.code };
    notes.push("changes committed; push remains explicit");
  }
  const status = git(root, ["status", "--porcelain"]);
  if (!status) taskState.clearBaseline(root);
  else notes.push("uncommitted changes remain; rerun with --commit after reviewing the diff");
  return { ok: true, command: "finish", branch: git(root, ["branch", "--show-current"]), worktree: root, notes, next: status ? `node hooks/task.js finish --commit "<type(scope): subject>"` : "push or open a PR only when authorized" };
}

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  if (args.errors.length) { emit({ ok: false, command: args.command || "task", notes: args.errors }, args.json); return 2; }
  let root;
  try { root = repoRoot(cwd); }
  catch (error) { emit({ ok: false, command: args.command, notes: [String(error.stderr || error.message || error).trim()] }, args.json); return 1; }
  let result;
  try {
    result = args.command === "start" ? start(root, args) : args.command === "check" ? check(root, args) : finish(root, args);
  } catch (error) {
    result = { ok: false, command: args.command, notes: [String(error.stderr || error.message || error).trim()] };
  }
  emit(result, args.json);
  return result.ok ? 0 : (result.code || 1);
}

if (require.main === module) process.exit(main());

module.exports = { parseArgs, defaultBase, startPlan, commitBranch, main };
