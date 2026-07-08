#!/usr/bin/env node
// stop-reminder.js — Stop-хук. Напоминает про VERIFY / COMMIT / REPORT ТОЛЬКО если
// в рабочем дереве есть незакоммиченные изменения; чистое дерево → молчит.
//
// Контракт Stop-хука Claude Code: additionalContext на Stop НЕ поддерживается —
// единственный способ донести текст до модели: {"decision":"block","reason":"…"}.
// Защита от зацикливания: если раннер прислал stop_hook_active=true (мы уже
// блокировали этот Stop), выходим молча — иначе агент никогда не остановится.

const { execSync } = require("child_process");
const path = require("path");

(async () => {
  let cwd = process.cwd();
  let stopHookActive = false;
  try {
    const { parse } = require(path.join(__dirname, "_input.js"));
    const ctx = await parse();
    if (ctx.projectDir) cwd = ctx.projectDir;
    stopHookActive = ctx.stopHookActive;
  } catch {}
  if (stopHookActive) process.exit(0); // уже напоминали в этом же Stop — не зацикливаемся

  let status = "";
  try {
    status = execSync("git status --porcelain", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {}
  if (!status) process.exit(0);

  const lines = status.split("\n");
  const shown = lines.slice(0, 20).join("\n") + (lines.length > 20 ? `\n... ещё ${lines.length - 20}` : "");
  const reason =
    "stop-reminder: есть незакоммиченные изменения — закрыты ли шаги loop?\n" +
    "  4. VERIFY (node hooks/verify.js + git diff review) -> 5. COMMIT на feature-ветке -> 6. REPORT.\n" +
    "Если работа реально закончена и коммит не нужен — просто заверши ответ ещё раз.\n" +
    "git status:\n" + shown;
  try { process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n"); } catch {}
  process.stderr.write(reason + "\n");
  process.exit(0);
})();
