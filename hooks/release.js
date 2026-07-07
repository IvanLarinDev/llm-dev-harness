#!/usr/bin/env node
// release.js — local release automation (BACKLOG P2-11), automates AGENTS.md R1–R2.
// Computes the next SemVer from conventional commits since the last tag, drafts a
// CHANGELOG section, and (optionally) writes CHANGELOG.md + creates an annotated tag.
// It NEVER pushes (push is the gated R3 step). Portable: pure node + git, no deps.
//
// Usage:
//   node hooks/release.js                 # dry-run: print next version + changelog draft
//   node hooks/release.js --write-changelog
//   node hooks/release.js --tag           # write changelog + create annotated tag (no push)
//   [--from <tag>] [--root <dir>] [--json]

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const has = (n) => process.argv.includes(n);
const ROOT = arg("--root", process.cwd());
function git(args) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
function gitSafe(args) { try { return git(args); } catch { return ""; } }

function lastTag() {
  const t = arg("--from", null);
  if (t) return t;
  return gitSafe(["describe", "--tags", "--abbrev=0"]) || "";
}
function parseVersion(tag) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(tag || "");
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : { major: 0, minor: 0, patch: 0 };
}
function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const raw = gitSafe(["log", "--no-merges", "--format=%s%x1f%b%x1e", range]);
  return raw.split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => {
    const i = r.indexOf("\x1f"); return { subject: r.slice(0, i).trim(), body: r.slice(i + 1).trim() };
  });
}
const HEADER = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|improvement)(\([^)]+\))?(!)?:\s+(.+)/;
function classify(commits) {
  let breaking = false, feat = false, patch = false;
  const groups = { feat: [], fix: [], other: [] };
  for (const c of commits) {
    const m = HEADER.exec(c.subject);
    if ((m && m[3] === "!") || /\bBREAKING CHANGE\b/.test(c.body)) breaking = true;
    const type = m ? m[1] : "other";
    if (type === "feat") { groups.feat.push(c.subject); feat = true; }
    else if (type === "fix" || type === "perf") { groups.fix.push(c.subject); patch = true; }
    else { groups.other.push(c.subject); patch = true; }
  }
  const level = breaking ? "major" : feat ? "minor" : patch ? "patch" : null;
  return { level, groups };
}
function bump(v, level) {
  if (level === "major") return { major: v.major + 1, minor: 0, patch: 0 };
  if (level === "minor") return { major: v.major, minor: v.minor + 1, patch: 0 };
  if (level === "patch") return { major: v.major, minor: v.minor, patch: v.patch + 1 };
  return v;
}
function fmt(v) { return `v${v.major}.${v.minor}.${v.patch}`; }
function changelog(nextTag, groups) {
  const date = new Date().toISOString().slice(0, 10);
  let out = `## ${nextTag} — ${date}\n`;
  const sec = (title, arr) => arr.length ? `\n### ${title}\n` + arr.map((s) => `- ${s}`).join("\n") + "\n" : "";
  out += sec("Features", groups.feat) + sec("Fixes", groups.fix) + sec("Other", groups.other);
  return out;
}

(function main() {
  const tag = lastTag();
  const cur = parseVersion(tag);
  const commits = commitsSince(tag);
  const { level, groups } = classify(commits);

  if (!commits.length || !level) {
    const msg = `release: с прошлого тега (${tag || "нет"}) нет релизных коммитов — релизить нечего.`;
    if (has("--json")) console.log(JSON.stringify({ ok: true, next: null, level: null }));
    else console.log(msg);
    process.exit(0);
  }

  const next = bump(cur, level);
  const nextTag = fmt(next);
  const notes = changelog(nextTag, groups);

  if (has("--json")) { console.log(JSON.stringify({ ok: true, from: tag || null, level, next: nextTag })); }
  else {
    console.log(`release: ${tag || "(нет тега)"} → ${nextTag}  (${level})`);
    console.log("\n" + notes);
  }

  if (has("--write-changelog") || has("--tag")) {
    const clPath = path.join(ROOT, "CHANGELOG.md");
    let prev = ""; try { prev = fs.readFileSync(clPath, "utf8"); } catch {}
    const header = prev.startsWith("# ") ? "" : "# Changelog\n\n";
    fs.writeFileSync(clPath, header + notes + "\n" + prev.replace(/^# Changelog\n\n/, ""));
    console.log("CHANGELOG.md обновлён.");
  }
  if (has("--tag")) {
    execFileSync("git", ["tag", "-a", nextTag, "-m", `release ${nextTag}\n\n${notes}`], { cwd: ROOT, stdio: "inherit" });
    console.log(`annotated tag ${nextTag} создан (НЕ запушен — push это gated-этап R3).`);
  }
  process.exit(0);
})();
