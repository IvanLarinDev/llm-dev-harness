#!/usr/bin/env node
// release-trunk.js - one-command atomic release for trunk mode.
//
// PR mode releases go through release-start.js + a release PR. In trunk mode
// (harness.config.json branchLifecycle.mode="trunk") the release happens on
// main directly: Cocogitto creates the version commit and annotated tag, and
// `git push --atomic` publishes the branch and the tag together. Either both
// arrive on origin or neither does, so a local-only tag cannot be left behind.
// Any failure after the bump rolls main back to the pre-release commit and
// deletes the local tag.
//
// Usage:
//   node hooks/release-trunk.js [--root <dir>] [--json] [--dry-run]
//     --dry-run  run every precondition and report the next version, no bump

const path = require("path");
const { execFileSync } = require("child_process");
const { loadReleaseConfig } = require("./release-config.js");
const { isTrunk } = require("./workflow-mode.js");
const { parseVersion } = require("./release-start.js");

function parseArgs(argv) {
  const a = { root: process.cwd(), json: false, dryRun: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) a.errors.push("--root requires a directory");
      else a.root = argv[++i];
    } else if (argv[i] === "--json") a.json = true;
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else a.errors.push(`unknown option: ${argv[i]}`);
  }
  a.root = path.resolve(a.root);
  return a;
}

function git(root, args, timeout = 10000) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    killSignal: "SIGKILL",
  }).trim();
}

function gitOut(root, args) {
  try { return git(root, args); } catch { return ""; }
}

function gitOk(root, args) {
  try { git(root, args); return true; } catch { return false; }
}

function commandError(error) {
  const stderr = String(error && error.stderr || "").trim();
  const stdout = String(error && error.stdout || "").trim();
  return stderr || stdout || String(error && error.message || error || "command failed");
}

function defaultRunCogDryRun(root) {
  return execFileSync("cog", ["bump", "--auto", "--dry-run"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000, killSignal: "SIGKILL",
  }).trim();
}

function defaultRunCogBump(root, tag) {
  execFileSync("cog", ["bump", "--auto", "--annotated", tag], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: 300000, killSignal: "SIGKILL",
  });
}

// The pre-push lefthook runs the full VERIFY suite, so the push budget is generous.
function defaultPushAtomic(root, branch, tag) {
  execFileSync("git", ["push", "--atomic", "origin", `refs/heads/${branch}`, `refs/tags/${tag}`], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: 600000, killSignal: "SIGKILL",
  });
}

function releaseTrunk(options, dependencies = {}) {
  const a = { root: path.resolve(options.root || process.cwd()), dryRun: options.dryRun === true };
  const runCogDryRun = dependencies.runCogDryRun || defaultRunCogDryRun;
  const runCogBump = dependencies.runCogBump || defaultRunCogBump;
  const pushAtomic = dependencies.pushAtomic || defaultPushAtomic;

  const res = { ok: false, root: a.root, branch: "", version: "", tag: "", head: "", pushed: false, rolledBack: false, results: [] };
  const add = (level, msg, extra = {}) => res.results.push({ level, msg, ...extra });
  const fail = (msg, extra) => add("FAIL", msg, extra);
  const pass = (msg, extra) => add("PASS", msg, extra);

  if (loadReleaseConfig(a.root).provider === "none") {
    fail("release capability is disabled in harness.config.json");
    return res;
  }
  if (!isTrunk(a.root)) {
    fail("trunk release requires branchLifecycle.mode=\"trunk\"; PR mode uses release-start.js + a release PR");
    return res;
  }
  if (!gitOk(a.root, ["rev-parse", "--is-inside-work-tree"])) {
    fail("not a git repository");
    return res;
  }

  const dirty = gitOut(a.root, ["status", "--porcelain"]);
  if (dirty) {
    fail("worktree is dirty", { details: dirty.split(/\r?\n/).filter(Boolean).slice(0, 20) });
    return res;
  }
  pass("worktree is clean");

  const branch = gitOut(a.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  res.branch = branch;
  if (!["main", "master"].includes(branch)) {
    fail(`trunk release runs on main/master, found: ${branch || "detached HEAD"}`);
    return res;
  }
  pass(`on trunk branch: ${branch}`);

  try {
    git(a.root, ["fetch", "origin", branch, "--tags"], 60000);
  } catch (error) {
    fail("could not fetch origin", { details: commandError(error) });
    return res;
  }
  const head = gitOut(a.root, ["rev-parse", "HEAD"]);
  const originHead = gitOut(a.root, ["rev-parse", "--verify", `origin/${branch}`]);
  res.head = head;
  if (!head || !originHead) {
    fail(`origin/${branch} not found`);
    return res;
  }
  if (head !== originHead) {
    fail(`HEAD must exactly match origin/${branch}; sync first: git pull --ff-only`, { head, origin: originHead });
    return res;
  }
  pass(`HEAD exactly matches origin/${branch}`, { head });

  let cogOutput = "";
  try {
    cogOutput = runCogDryRun(a.root);
  } catch (error) {
    fail("cog bump --auto --dry-run failed", { details: commandError(error) });
    return res;
  }
  const version = parseVersion(cogOutput);
  if (!version) {
    fail("could not parse SemVer from cog bump --auto --dry-run", { output: String(cogOutput || "").trim() });
    return res;
  }
  const tag = `v${version}`;
  res.version = version;
  res.tag = tag;
  pass(`Cocogitto selected ${tag}`);

  if (gitOk(a.root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`])) {
    fail(`local tag already exists: ${tag}`);
    return res;
  }
  let remoteTag = "";
  try {
    remoteTag = git(a.root, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], 60000);
  } catch (error) {
    fail(`could not verify remote tag state for ${tag}`, { details: commandError(error) });
    return res;
  }
  if (remoteTag) {
    fail(`remote tag already exists: ${tag}`);
    return res;
  }
  pass(`tag ${tag} is free locally and on origin`);

  if (a.dryRun) {
    pass("dry run: preconditions hold, no bump performed");
    res.ok = true;
    return res;
  }

  const rollback = () => {
    try {
      if (gitOk(a.root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`])) git(a.root, ["tag", "-d", tag]);
      git(a.root, ["reset", "--hard", head]);
      res.rolledBack = true;
      add("PASS", `rolled back to pre-release commit ${head.slice(0, 12)}`);
    } catch (error) {
      fail(`rollback failed; inspect manually (expected HEAD ${head})`, { details: commandError(error) });
    }
  };

  let manifestBump = null;
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, "release-manifest-bump.js"), "--root", a.root, "--tag", tag, "--json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000, killSignal: "SIGKILL",
    });
    manifestBump = JSON.parse(out);
  } catch (error) {
    try { manifestBump = JSON.parse(String(error.stdout || "")); } catch {}
    if (!manifestBump) {
      fail("release-manifest-bump.js failed", { details: commandError(error) });
      rollback();
      return res;
    }
  }
  if (!manifestBump.ok) {
    fail("project version manifests could not be bumped", { results: manifestBump.results || [] });
    rollback();
    return res;
  }
  if (gitOut(a.root, ["status", "--porcelain"])) {
    try {
      git(a.root, ["add", "-A"]);
      git(a.root, ["commit", "-q", "-m", `chore(release): prepare ${tag}`]);
      pass(`committed manifest bump: chore(release): prepare ${tag}`);
    } catch (error) {
      fail("could not commit manifest bump", { details: commandError(error) });
      rollback();
      return res;
    }
  } else {
    pass("no version manifests needed a bump");
  }

  try {
    runCogBump(a.root, tag);
  } catch (error) {
    fail("cog bump --auto failed", { details: commandError(error) });
    rollback();
    return res;
  }
  const tagType = gitOut(a.root, ["cat-file", "-t", `refs/tags/${tag}`]);
  const tagCommit = gitOut(a.root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{}`]);
  const newHead = gitOut(a.root, ["rev-parse", "HEAD"]);
  if (tagType !== "tag" || !tagCommit || tagCommit !== newHead) {
    fail(`bump did not produce an annotated ${tag} at HEAD`, { tagType, tagCommit, head: newHead });
    rollback();
    return res;
  }
  pass(`annotated ${tag} created at ${newHead.slice(0, 12)}`);

  try {
    pushAtomic(a.root, branch, tag);
  } catch (error) {
    fail(`atomic push failed; ${branch} and ${tag} stay local`, { details: commandError(error) });
    rollback();
    return res;
  }
  res.pushed = true;
  pass(`pushed ${branch} and ${tag} atomically`);

  let remoteAfter = "";
  try {
    remoteAfter = git(a.root, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], 60000);
  } catch {}
  if (remoteAfter) pass(`origin confirms tag ${tag}`);
  else add("WARN", `could not re-read tag ${tag} from origin; verify manually: git ls-remote --tags origin ${tag}`);

  res.ok = true;
  return res;
}

function printResult(res, json) {
  if (json) {
    console.log(JSON.stringify(res));
    return;
  }
  const icon = { PASS: "+", FAIL: "X" };
  console.log(`release trunk: ${res.root}`);
  for (const result of res.results) console.log(`  ${icon[result.level] || "!"} ${result.msg}`);
  if (res.ok && res.pushed) {
    console.log(`\n${res.tag} is on origin; the tag-triggered release workflow publishes the artifacts.`);
    console.log(`Watch it: gh run watch --exit-status (or gh release view ${res.tag})`);
  } else if (res.ok) {
    console.log(`\ndry run ok: next release would be ${res.tag}.`);
  } else {
    console.log("\nrelease trunk failed.");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length) {
    printResult({ ok: false, root: args.root, results: args.errors.map((msg) => ({ level: "FAIL", msg })) }, args.json);
    process.exit(1);
  }
  const res = releaseTrunk(args);
  printResult(res, args.json);
  process.exit(res.ok ? 0 : 1);
}

module.exports = { parseArgs, run: releaseTrunk };
if (require.main === module) main();
