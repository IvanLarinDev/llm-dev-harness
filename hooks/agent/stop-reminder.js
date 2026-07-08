#!/usr/bin/env node
// stop-reminder.js — Stop-хук. Напоминает про VERIFY / COMMIT / REPORT ТОЛЬКО если
// в рабочем дереве есть незакоммиченные изменения; чистое дерево → молчит.
//
// Контракт Stop-хука Claude Code: additionalContext на Stop НЕ поддерживается —
// единственный способ донести текст до модели: {"decision":"block","reason":"…"}.
// Защита от зацикливания: если раннер прислал stop_hook_active=true (мы уже
// блокировали этот Stop), выходим молча — иначе агент никогда не остановится.

const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function stateFile(cwd) {
  const id = crypto.createHash("sha1").update(String(cwd)).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `harness-stop-reminder-${id}.json`);
}
function statusHash(status) {
  return crypto.createHash("sha1").update(String(status)).digest("hex");
}
function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}
function writeState(file, state) {
  const tmp = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...state, ts: Date.now() }));
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

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
    status = execSync("git status --porcelain", { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 3000, killSignal: "SIGKILL" })
      .toString().trim();
  } catch {}
  if (!status) process.exit(0);

  const file = stateFile(cwd);
  const hash = statusHash(status);
  const state = readState(file);
  if (state.hash === hash && state.reminded === true) process.exit(0);
  writeState(file, { hash, reminded: true });

  const lines = status.split("\n");
  const shown = lines.slice(0, 20).join("\n") + (lines.length > 20 ? `\n... ещё ${lines.length - 20}` : "");
  const harnessLike = lines.filter((l) => /(?:^.. |^\?\? )(?:(?:\.github\/rulesets\/)|(?:hooks\/)|(?:\.claude\/)|(?:\.codex\/)|AGENTS\.md|lefthook\.yml|harness\.config\.json|settings\.example\.json|cog\.toml|\.gitleaks\.toml|\.gitattributes)/.test(l.replace(/\\/g, "/")));
  const harnessNote = harnessLike.length
    ? "\nПохоже, часть dirty tree — bootstrap/harness/local files. Если они оставлены намеренно, повторный Stop с тем же git status будет разрешён.\n"
    : "\nЕсли dirty tree оставлено намеренно и отчёт уже объясняет почему, повторный Stop с тем же git status будет разрешён.\n";
  const reason =
    "stop-reminder: есть незакоммиченные изменения — закрыты ли шаги loop?\n" +
    "  4. VERIFY (node hooks/verify.js + git diff review) -> 5. COMMIT на feature-ветке -> 6. REPORT.\n" +
    "Коммит не всегда нужен: можно явно отчитаться, почему изменения остаются uncommitted.\n" +
    harnessNote +
    "git status:\n" + shown;
  try { process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n"); } catch {}
  process.stderr.write(reason + "\n");
  process.exit(0);
})();
