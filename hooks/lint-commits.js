#!/usr/bin/env node
// lint-commits.js — validate a RANGE of commit messages against the same rules as the
// git-native commit-msg hook (conventional commits + no co-authorship). This is the
// server-side / CI backstop for the local commit-msg hook: a `git commit --no-verify`
// slips past the local hook, but CI re-checks every commit in the PR here.
//
// Usage:
//   node hooks/lint-commits.js --base <ref>        # lint <ref>..HEAD
//   node hooks/lint-commits.js --range <a>..<b>    # lint an explicit range
// Merge commits are skipped (--no-merges). Exit 0 = all OK, 1 = a violation.

const { execFileSync } = require("child_process");
const path = require("path");
const { lint } = require(path.join(__dirname, "lib", "commit-lint.js"));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const base = arg("--base");
const range = arg("--range") || (base ? `${base}..HEAD` : "HEAD~1..HEAD");

let raw;
try {
  // %H = hash, then body; records separated by 0x1e, fields by 0x1f.
  raw = execFileSync("git", ["log", "--no-merges", "--format=%H%x1f%B%x1e", range], { encoding: "utf8" });
} catch (e) {
  console.error(`lint-commits: git log failed for range '${range}': ${e.message}`);
  process.exit(0); // don't wedge on git errors
}

const commits = raw
  .split("\x1e")
  .map((s) => s.replace(/^\s+/, ""))
  .filter(Boolean)
  .map((rec) => {
    const idx = rec.indexOf("\x1f");
    return { hash: rec.slice(0, idx), msg: rec.slice(idx + 1).trim() };
  });

let bad = 0;
for (const c of commits) {
  const r = lint(c.msg);
  const short = c.hash.slice(0, 8);
  if (r.ok) {
    console.log(`✓ ${short} ${c.msg.split("\n")[0]}`);
  } else {
    bad++;
    console.error(`✗ ${short}: ${r.errors.map((e) => e.message.split("\n")[0]).join("; ")}`);
  }
}

if (bad) {
  console.error(`\n❌ lint-commits: ${bad}/${commits.length} commit(s) violate conventional-commits / no-coauthor.`);
  process.exit(1);
}
console.log(`\n✅ lint-commits: ${commits.length} commit(s) OK.`);
process.exit(0);
