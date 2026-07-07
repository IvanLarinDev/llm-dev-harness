#!/usr/bin/env node
// commit.js — interactive/scripted conventional-commit helper (BACKLOG P2-14).
// Builds a `<type>(<scope>)!: <subject>` message, validates it with the same lib as
// the commit-msg hook, then commits (or just prints it). For humans who don't want to
// hand-format messages; the git-native hook still enforces correctness either way.
//
// Scripted:    node hooks/commit.js --type feat --scope core --subject "add x" [--body "..."] [--breaking] [--print]
// Interactive: node hooks/commit.js          (prompts for type/scope/subject/body)
//   --print  = output the message, do not commit (used by tests / previews)

const path = require("path");
const readline = require("readline");
const { execFileSync } = require("child_process");
const { lint, TYPES } = require(path.join(__dirname, "lib", "commit-lint.js"));

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const has = (n) => process.argv.includes(n);

function build({ type, scope, subject, body, breaking }) {
  const header = `${type}${scope ? `(${scope})` : ""}${breaking ? "!" : ""}: ${subject}`;
  return body ? `${header}\n\n${body}` : header;
}

function finish(msg) {
  const r = lint(msg);
  if (!r.ok) {
    console.error("commit.js: сообщение не проходит проверку:\n  • " + r.errors.map((e) => e.message.split("\n")[0]).join("\n  • "));
    process.exit(1);
  }
  if (has("--print")) { console.log(msg); process.exit(0); }
  try { execFileSync("git", ["commit", "-m", msg], { stdio: "inherit" }); process.exit(0); }
  catch (e) { process.exit(e.status || 1); }
}

if (has("--type") || has("--subject")) {
  finish(build({
    type: arg("--type", ""), scope: arg("--scope", ""), subject: arg("--subject", ""),
    body: arg("--body", ""), breaking: has("--breaking"),
  }));
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  (async () => {
    console.log(`type ∈ {${TYPES.join(", ")}}`);
    const type = (await ask("type: ")).trim();
    const scope = (await ask("scope (Enter — пропустить): ")).trim();
    const subject = (await ask("subject: ")).trim();
    const body = (await ask("body (Enter — пропустить): ")).trim();
    const breaking = /^y/i.test((await ask("breaking change? (y/N): ")).trim());
    rl.close();
    finish(build({ type, scope, subject, body, breaking }));
  })();
}
