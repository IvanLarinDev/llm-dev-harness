#!/usr/bin/env node
// stop-reminder.js — AGENT-ADAPTER hook (runtime-agnostic), note-only.
// Fires when the agent tries to end its turn. Reminds it not to declare the loop
// done before VERIFY / COMMIT / REPORT, and surfaces uncommitted work.
// Never blocks (exit 0); prints a note (stdout JSON + stderr mirror).

const { execSync } = require("child_process");
const path = require("path");

let projectDir = process.cwd();
try {
  const { parse } = require(path.join(__dirname, "_input.js"));
  // parse() is async and reads stdin; a Stop payload may be empty — resolve fast.
  parse().then((ctx) => finish(ctx.projectDir || projectDir)).catch(() => finish(projectDir));
} catch {
  finish(projectDir);
}

function gitStatus(cwd) {
  try {
    return execSync("git status --porcelain", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch { return ""; }
}

function finish(cwd) {
  const status = gitStatus(cwd);
  const text =
    "ℹ️ stop-reminder: закрыты ли все шаги loop из AGENTS.md?\n" +
    "  4. VERIFY (тесты/lint/build/git diff), 5. COMMIT на feature-ветке, 6. REPORT.\n" +
    "  Если пользователь явно принял результат — loop завершён корректно.\n\n" +
    (status ? "git status:\n" + status : "Рабочее дерево чистое (нечего коммитить).");
  try { process.stdout.write(JSON.stringify({ additionalContext: text }) + "\n"); } catch {}
  process.stderr.write(text + "\n");
  process.exit(0);
}
