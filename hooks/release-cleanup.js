#!/usr/bin/env node
// release-cleanup.js - remove merged development/release branches after a
// published release has passed artifact smoke testing.
//
// Dry-run is the default. --apply authorizes deletion, but only for branches
// with a known development prefix whose commits are ancestors of --base.
// Dirty worktrees, the current worktree, and locally unmerged branches block
// cleanup for that branch. Tags are never touched.
//
// Usage:
//   node hooks/release-cleanup.js [--root <dir>] [--base origin/main]
//     [--remote origin] [--no-fetch] [--apply] [--json]

const path = require("path");
const { execFileSync } = require("child_process");

const BRANCH_PREFIXES = [
  "codex/", "feat/", "fix/", "docs/", "chore/", "refactor/",
  "release/", "hotfix/", "test/", "ci/", "improvement/",
];
const PROTECTED_BRANCHES = new Set(["main", "master"]);

function parseArgs(argv) {
  const a = {
    root: process.cwd(), base: "origin/main", remote: "origin",
    fetch: true, apply: false, json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") a.root = argv[++i];
    else if (argv[i] === "--base") a.base = argv[++i];
    else if (argv[i] === "--remote") a.remote = argv[++i];
    else if (argv[i] === "--no-fetch") a.fetch = false;
    else if (argv[i] === "--apply") a.apply = true;
    else if (argv[i] === "--json") a.json = true;
  }
  a.root = path.resolve(a.root);
  return a;
}

function run(root, args, opts = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.remote ? 60000 : 10000,
    killSignal: "SIGKILL",
  }).trim();
}

function result(root, args, opts) {
  try { return { ok: true, out: run(root, args, opts) }; }
  catch (e) { return { ok: false, error: String((e && e.stderr) || (e && e.message) || "").trim() }; }
}

function lines(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isManagedBranch(name) {
  return !PROTECTED_BRANCHES.has(name) && BRANCH_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isAncestor(root, ref, base) {
  return result(root, ["merge-base", "--is-ancestor", ref, base]).ok;
}

function parseWorktrees(text) {
  const out = [];
  let item = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (raw.startsWith("worktree ")) {
      if (item) out.push(item);
      item = { path: raw.slice("worktree ".length), branch: "" };
    } else if (item && raw.startsWith("branch refs/heads/")) {
      item.branch = raw.slice("branch refs/heads/".length);
    }
  }
  if (item) out.push(item);
  return out;
}

function samePath(a, b) {
  const normalize = (value) => path.resolve(value).replace(/\\/g, "/").toLowerCase();
  return normalize(a) === normalize(b);
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const report = {
    ok: true,
    apply: a.apply,
    base: a.base,
    remote: a.remote,
    candidates: [],
    removedWorktrees: [],
    deletedLocal: [],
    deletedRemote: [],
    blocked: [],
    errors: [],
  };

  if (!result(a.root, ["rev-parse", "--is-inside-work-tree"]).ok) {
    report.errors.push("not a git repository");
  }
  if (!result(a.root, ["rev-parse", "--verify", "--quiet", a.base]).ok) {
    report.errors.push(`base ref not found: ${a.base}`);
  }
  if (!result(a.root, ["remote", "get-url", a.remote]).ok) {
    report.errors.push(`remote not found: ${a.remote}`);
  }
  if (report.errors.length === 0 && a.fetch) {
    const fetched = result(a.root, ["fetch", a.remote, "--prune"], { remote: true });
    if (!fetched.ok) report.errors.push(`fetch failed: ${fetched.error}`);
  }

  if (report.errors.length === 0) {
    const localRefs = lines(run(a.root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]));
    const remotePrefix = `${a.remote}/`;
    const remoteRefs = lines(run(a.root, ["for-each-ref", "--format=%(refname:short)", `refs/remotes/${a.remote}`]))
      .filter((ref) => ref.startsWith(remotePrefix) && ref !== `${a.remote}/HEAD`)
      .map((ref) => ({ ref, name: ref.slice(remotePrefix.length) }));
    const worktrees = parseWorktrees(run(a.root, ["worktree", "list", "--porcelain"]));
    const worktreeByBranch = new Map(worktrees.filter((item) => item.branch).map((item) => [item.branch, item.path]));
    const localSet = new Set(localRefs);
    const remoteMap = new Map(remoteRefs.map((item) => [item.name, item.ref]));
    const names = new Set([...localRefs, ...remoteRefs.map((item) => item.name)]);

    for (const name of [...names].filter(isManagedBranch).sort()) {
      const localExists = localSet.has(name);
      const remoteRef = remoteMap.get(name) || "";
      const localMerged = localExists && isAncestor(a.root, name, a.base);
      const remoteMerged = !!remoteRef && isAncestor(a.root, remoteRef, a.base);
      if (!localMerged && !remoteMerged) continue;

      const entry = { branch: name, local: localExists, remote: !!remoteRef, worktree: worktreeByBranch.get(name) || "" };
      const reasons = [];
      if (localExists && !localMerged) reasons.push("local branch contains commits not merged into base");
      if (remoteRef && !remoteMerged) reasons.push("remote branch contains commits not merged into base");
      if (entry.worktree && samePath(entry.worktree, a.root)) reasons.push("branch is checked out in the cleanup worktree");
      if (entry.worktree && !samePath(entry.worktree, a.root)) {
        const status = result(entry.worktree, ["status", "--porcelain"]);
        if (!status.ok) reasons.push("cannot inspect linked worktree");
        else if (status.out) reasons.push("linked worktree is dirty");
      }

      if (reasons.length) {
        report.blocked.push({ ...entry, reasons });
        continue;
      }
      report.candidates.push(entry);
    }

    if (a.apply) {
      for (const entry of report.candidates) {
        let localSafe = true;
        if (entry.worktree) {
          const removed = result(a.root, ["worktree", "remove", entry.worktree]);
          if (!removed.ok) {
            localSafe = false;
            report.errors.push(`cannot remove worktree for ${entry.branch}: ${removed.error}`);
          } else {
            report.removedWorktrees.push(entry.worktree);
          }
        }
        if (entry.local && localSafe) {
          const deleted = result(a.root, ["branch", "-d", entry.branch]);
          if (!deleted.ok) {
            localSafe = false;
            report.errors.push(`cannot delete local branch ${entry.branch}: ${deleted.error}`);
          } else {
            report.deletedLocal.push(entry.branch);
          }
        }
        if (entry.remote && localSafe) {
          const deleted = result(a.root, ["push", a.remote, "--delete", entry.branch], { remote: true });
          if (!deleted.ok) report.errors.push(`cannot delete remote branch ${entry.branch}: ${deleted.error}`);
          else report.deletedRemote.push(entry.branch);
        }
      }
    }
  }

  report.ok = report.errors.length === 0 && report.blocked.length === 0;
  if (a.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`release cleanup (${a.apply ? "apply" : "dry-run"}): ${a.base}`);
    for (const entry of report.candidates) console.log(`  ${a.apply ? "deleted" : "candidate"}: ${entry.branch}`);
    for (const entry of report.blocked) console.log(`  blocked: ${entry.branch} (${entry.reasons.join("; ")})`);
    for (const error of report.errors) console.log(`  error: ${error}`);
    if (!a.apply && report.candidates.length) console.log("\nRe-run with --apply after release smoke testing succeeds.");
    console.log(report.ok ? "\nrelease cleanup passed." : "\nrelease cleanup incomplete.");
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) main();
