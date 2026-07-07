#!/usr/bin/env node
// branch-guard.js — AGENT-ADAPTER hook (runtime-agnostic), WARN-ONLY.
//
// Real enforcement now lives in the git-native layer (hooks/git/pre-commit,
// pre-push, commit-msg), which fires no matter which agent or human runs git.
// This adapter only gives the agent an EARLY heads-up before it even tries a bad
// action — it never blocks (blocking is the git layer's job). That removes the
// old conflict where the agent-layer blocked legitimate release/tag pushes.
//
// Wire on the shell tool and on Write/Edit tools. Always exits 0 (note-only).

const { execSync } = require("child_process");
const path = require("path");
const { parse } = require(path.join(__dirname, "_input.js"));

let lint;
try { ({ lint } = require(path.join(__dirname, "..", "lib", "commit-lint.js"))); } catch {}

const PROTECTED = new Set(["main", "master"]);

function currentBranch(cwd) {
  for (const cmd of ["git symbolic-ref --short HEAD", "git rev-parse --abbrev-ref HEAD"]) {
    try {
      const b = execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (b && b !== "HEAD") return b;
    } catch {}
  }
  return "";
}
function note(text) {
  try { process.stdout.write(JSON.stringify({ additionalContext: text }) + "\n"); } catch {}
  process.stderr.write(text + "\n");
  process.exit(0);
}
function extractCommitMessage(cmd) {
  const msgs = [];
  const reQ = /(?:^|\s)-m\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
  let m;
  while ((m = reQ.exec(cmd)) !== null) msgs.push(m[1] !== undefined ? m[1] : m[2]);
  const reE = /(?:^|\s)--message=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  while ((m = reE.exec(cmd)) !== null) msgs.push(m[1] ?? m[2] ?? m[3]);
  return msgs.join("\n\n");
}

(async () => {
  const { tool, command, projectDir } = await parse();
  const branch = currentBranch(projectDir);
  const onProtected = PROTECTED.has(branch);

  if (/^(write|edit|multiedit|applypatch|create|str_replace)/i.test(tool) && onProtected) {
    note(
      `⚠️ branch-guard: правишь файлы на «${branch}». AGENTS.md требует feature-ветку. ` +
        `git checkout -b feat/... — иначе git-native pre-commit заблокирует коммит на ${branch}.`
    );
  }

  if (/^(bash|shell|sh|exec|run|terminal|execute)/i.test(tool) && typeof command === "string") {
    if (/\bgit\s+(commit|merge)\b/.test(command) && onProtected) {
      note(
        `⚠️ branch-guard: git ${/merge/.test(command) ? "merge" : "commit"} на «${branch}». ` +
          `Будет отклонён pre-commit'ом. Перейди на feature-ветку, ` +
          `либо для релиза/hotfix: HARNESS_ALLOW_MAIN=1 ...`
      );
    }
    if (/\bgit\s+push\b/.test(command) && /\b(main|master)\b/.test(command) && !/refs\/tags|v\d/.test(command)) {
      note(`⚠️ branch-guard: прямой push в main/master будет отклонён pre-push. Пуш тегов/веток — ок.`);
    }
    // Pre-warn on a bad commit message so the agent can fix it before git rejects.
    if (lint && /\bgit\s+commit\b/.test(command)) {
      const msg = extractCommitMessage(command);
      if (msg) {
        const { ok, errors } = lint(msg);
        if (!ok) note(`⚠️ branch-guard: сообщение коммита не пройдёт commit-msg:\n   • ${errors.map((e) => e.message).join("\n   • ")}`);
      }
    }
  }
  process.exit(0);
})();
