#!/usr/bin/env node
// install.js — установщик llm-dev-harness в целевой репозиторий «в один клик».
//
// Что делает:
//   1. копирует хуки и конфиги харнесса в целевой проект (не затирая существующее);
//   2. генерит целевой harness.config.json (без self-test-пина — target авто-детектит
//      свои стеки), если его ещё нет;
//   3. вплетает agent-guard в .claude/settings.json МЕРЖЕМ — чужие ключи и хуки
//      сохраняются, наши записи не дублируются при повторном запуске;
//   4. ставит lefthook-хуки (lefthook install) и прогоняет doctor.
//
// Идемпотентно, кроссплатформенно (Windows/macOS/Linux), без внешних зависимостей.
// Двойной клик: install.cmd (Windows) / install.sh (POSIX) — обёртки над этим файлом.
//
// Использование:
//   node install.js [--target <dir>] [--force] [--dry-run] [--with-ci]
//                   [--with-ruleset] [--json]
//     --target        куда ставить (default: текущий каталог)
//     --force         перезаписать уже существующие файлы харнесса
//     --dry-run       показать план, ничего не писать
//     --with-ci       также положить .github/ (CI-зеркало, CODEOWNERS, dependabot)
//     --with-ruleset  применить серверный ruleset (нужен gh admin; см. apply-ruleset.js)
//     --json          машиночитаемый отчёт
//
// Exit 0 = установка прошла (или dry-run), 1 = целевой каталог непригоден или
//          критический шаг упал.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = __dirname;
const { DEFAULT_UI_GLOBS, DEFAULT_MOCKUPS } = require(path.join(SRC, "hooks", "_lib.js"));

// Файлы харнесса, которые едут в целевой репозиторий. harness.config.json НЕ здесь
// (генерится отдельно), test.js НЕ здесь (это dev-self-test источника, завязанный на
// его доки/CI). .github/rulesets/main.json нужен apply-ruleset.js — копируем всегда.
const FILES = [
  "hooks/_lib.js", "hooks/verify.js", "hooks/design-gate.js", "hooks/doctor.js",
  "hooks/new-mockups.js", "hooks/apply-ruleset.js", "hooks/branch-guard.js", "hooks/no-coauthor.js",
  "hooks/agent/_input.js", "hooks/agent/guard.js", "hooks/agent/stop-reminder.js",
  "lefthook.yml", "cog.toml", ".gitleaks.toml", "settings.example.json",
  ".gitattributes", "AGENTS.md", ".github/rulesets/main.json",
];
const CI_FILES = [".github/workflows/ci.yml", ".github/CODEOWNERS", ".github/dependabot.yml"];

// ---------- args ----------
function parseArgs(argv) {
  const a = { target: process.cwd(), force: false, dryRun: false, withCi: false, withRuleset: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") a.target = argv[++i];
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else if (argv[i] === "--with-ci") a.withCi = true;
    else if (argv[i] === "--with-ruleset") a.withRuleset = true;
    else if (argv[i] === "--json") a.json = true;
  }
  a.target = path.resolve(a.target);
  return a;
}

// ---------- целевой harness.config.json ----------
// Дефолты UI-глобов/мокапов переиспользуем из _lib (DRY). verify НЕ пиним — в чужом
// проекте нужен авто-детект стеков, а не прогон нашего self-test.
function defaultConfig() {
  return JSON.stringify({
    ui: { globs: DEFAULT_UI_GLOBS, mockups: DEFAULT_MOCKUPS },
    debugAudit: { enabled: true, base: "main", soft: false, exclude: [], strict: true },
  }, null, 2) + "\n";
}

// ---------- копирование одного файла ----------
function copyOne(rel, force, dryRun) {
  const src = path.join(SRC, rel), dst = path.join(a.target, rel);
  let exists = false;
  try { fs.accessSync(dst); exists = true; } catch {}
  if (exists && !force) return { rel, action: "skip" };
  if (!dryRun) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
  return { rel, action: exists ? "overwrite" : "write" };
}

// ---------- harness.config.json (генерим, если нет) ----------
function writeConfig(force, dryRun) {
  const dst = path.join(a.target, "harness.config.json");
  let exists = false;
  try { fs.accessSync(dst); exists = true; } catch {}
  if (exists && !force) return { action: "skip" };
  if (!dryRun) fs.writeFileSync(dst, defaultConfig());
  return { action: exists ? "overwrite" : "write" };
}

// ---------- .gitignore: только персональный файл раннера ----------
// Файлы харнесса (hooks/, lefthook.yml, конфиги, .github/) НЕ игнорируем — они
// КОММИТЯТСЯ: иначе lefthook (ссылается на hooks/verify.js), CI и серверный ruleset
// не получат кода проверок на свежем клоне. Игнорируем лишь персональный
// .claude/settings.local.json (разрешения раннера, у каждого свои). Состояние
// guard живёт в системном tmp, в репозиторий не пишется — там игнорировать нечего.
const GITIGNORE_LINES = [".claude/settings.local.json"];
function ensureGitignore(dryRun) {
  const dst = path.join(a.target, ".gitignore");
  let cur = "";
  try { cur = fs.readFileSync(dst, "utf8"); } catch {}
  const have = new Set(cur.split(/\r?\n/).map((s) => s.trim()));
  const covered = have.has(".claude/") || have.has(".claude") || have.has("/.claude/");
  const missing = covered ? [] : GITIGNORE_LINES.filter((l) => !have.has(l));
  if (!missing.length) return { action: "already" };
  if (!dryRun) {
    const pad = cur && !cur.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(dst, cur + pad + (cur ? "\n" : "") +
      "# agent runtime (персональные настройки раннера — не коммитим)\n" + missing.join("\n") + "\n");
  }
  return { action: cur ? "appended" : "created", added: missing };
}

// ---------- мерж agent-хуков в .claude/settings.json ----------
// Наши записи не дублируются: дедуп по basename скрипта (guard.js/stop-reminder.js),
// поэтому повторный install и уже настроенный вручную .claude/settings.json — ок.
// Чужие ключи (model, permissions, свои хуки) сохраняются.
function mergeSettings(dryRun) {
  let wanted;
  try { wanted = JSON.parse(fs.readFileSync(path.join(SRC, "settings.example.json"), "utf8")).hooks; }
  catch { return { status: "error", reason: "settings.example.json источника нечитаем" }; }
  const dst = path.join(a.target, ".claude", "settings.json");
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(dst, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") return { status: "error", reason: "существующий .claude/settings.json невалиден — не трогаю" }; }
  cur.hooks = cur.hooks || {};
  const scripts = (entry) => (entry.hooks || []).map((h) => String(h.command || "").split(/[\/\\]/).pop());
  let added = 0;
  for (const ev of Object.keys(wanted)) {
    cur.hooks[ev] = cur.hooks[ev] || [];
    for (const entry of wanted[ev]) {
      const want = scripts(entry);
      const dup = cur.hooks[ev].some((e) => scripts(e).some((s) => want.includes(s)));
      if (!dup) { cur.hooks[ev].push(entry); added++; }
    }
  }
  if (!dryRun && added) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, JSON.stringify(cur, null, 2) + "\n");
  }
  return { status: added ? "merged" : "already", added };
}

// ---------- внешние шаги (активация) ----------
function runLefthook() {
  const r = spawnSync("lefthook", ["install"], { cwd: a.target, encoding: "utf8", shell: true });
  if (r.error) return { ok: false, reason: r.error.code === "ENOENT" ? "lefthook не в PATH" : String(r.error.message) };
  return { ok: r.status === 0, code: r.status };
}
function runDoctor() {
  const r = spawnSync("node", [path.join(a.target, "hooks", "doctor.js"), "--root", a.target, "--json"],
    { encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, results: [] }; }
}
function runRuleset() {
  const r = spawnSync("node", [path.join(a.target, "hooks", "apply-ruleset.js")], { cwd: a.target, encoding: "utf8" });
  return { ok: r.status === 0, out: String(r.stdout || "") + String(r.stderr || "") };
}

// ---------- main ----------
const a = parseArgs(process.argv.slice(2));

(function main() {
  const out = { ok: true, target: a.target, mode: null, dryRun: a.dryRun, files: [], config: null, settings: null, gitignore: null, lefthook: null, doctor: null, ruleset: null, notes: [] };

  // целевой каталог должен существовать
  try { if (!fs.statSync(a.target).isDirectory()) throw 0; }
  catch { return finish(out, false, `целевой каталог не существует: ${a.target}`); }

  const isGit = fs.existsSync(path.join(a.target, ".git"));
  if (!isGit) out.notes.push("целевой каталог — не git-репозиторий: lefthook install и branch-гейты не заработают, пока не будет `git init`.");

  const selfInstall = path.resolve(a.target) === path.resolve(SRC);
  out.mode = selfInstall ? "bootstrap" : "install";

  // 1. файлы
  if (!selfInstall) {
    const list = a.withCi ? FILES.concat(CI_FILES) : FILES.slice();
    for (const rel of list) out.files.push(copyOne(rel, a.force, a.dryRun));
    out.config = writeConfig(a.force, a.dryRun);
    if (a.withCi && !FILES.includes(".github/workflows/ci.yml")) {
      // CI-зеркало положено, но активируется только пушем (нужен скоуп workflow)
      out.notes.push("CI-зеркало .github/workflows/ci.yml положено, но активируется только после push (нужен gh-скоуп workflow).");
    }
  } else {
    out.notes.push("bootstrap-режим: цель совпадает с источником, файлы уже на месте — только вплетаю хуки и активирую.");
  }

  // 2. agent-хуки в settings.json
  out.settings = mergeSettings(a.dryRun);
  if (out.settings.status === "error") out.notes.push("settings: " + out.settings.reason);

  // 2b. .gitignore: только персональный settings.local.json (файлы харнесса коммитятся)
  out.gitignore = ensureGitignore(a.dryRun);

  // 3. активация (кроме dry-run)
  if (!a.dryRun) {
    out.lefthook = runLefthook();
    if (!out.lefthook.ok) out.notes.push("lefthook: " + (out.lefthook.reason || `exit ${out.lefthook.code}`) + " — поставь lefthook и запусти `lefthook install`.");
    out.doctor = runDoctor();
    if (a.withRuleset) out.ruleset = runRuleset();
  }

  const hardFailures = [];
  if (out.settings.status === "error") hardFailures.push("settings");
  if (!a.dryRun && out.lefthook && !out.lefthook.ok) hardFailures.push("lefthook");
  if (!a.dryRun && out.doctor && out.doctor.ok === false) hardFailures.push("doctor");
  return finish(out, hardFailures.length === 0,
    hardFailures.length ? "установка не fully enforceable: " + hardFailures.join(", ") + " (см. notes/doctor)" : null);
})();

function finish(out, ok, reason) {
  out.ok = ok;
  if (reason) out.reason = reason;
  if (a.json) { console.log(JSON.stringify(out)); process.exit(ok ? 0 : 1); }

  const icon = (x) => (x === "write" ? "＋" : x === "overwrite" ? "↻" : "·");
  console.log(`\nllm-dev-harness → ${out.target}  [${out.mode}${out.dryRun ? ", dry-run" : ""}]`);
  if (out.files.length) {
    const w = out.files.filter((f) => f.action === "write").length;
    const o = out.files.filter((f) => f.action === "overwrite").length;
    const s = out.files.filter((f) => f.action === "skip").length;
    console.log(`  файлы: +${w} новых, ↻${o} перезаписано, ·${s} уже было (--force чтобы обновить)`);
    for (const f of out.files) if (f.action !== "skip") console.log(`    ${icon(f.action)} ${f.rel}`);
  }
  if (out.config) console.log(`  harness.config.json: ${out.config.action === "skip" ? "уже был (не трогаю)" : out.config.action === "write" ? "сгенерён" : "перезаписан"}`);
  if (out.settings) console.log(`  .claude/settings.json: ${out.settings.status === "merged" ? `+${out.settings.added} agent-хук(а) вплетено` : out.settings.status === "already" ? "agent-хуки уже вплетены" : "ошибка — " + out.settings.reason}`);
  if (out.gitignore) console.log(`  .gitignore: ${out.gitignore.action === "already" ? "уже покрыт (.claude/settings.local.json)" : (out.gitignore.action === "created" ? "создан" : "дополнен") + " → .claude/settings.local.json"}`);
  if (out.lefthook) console.log(`  lefthook install: ${out.lefthook.ok ? "ок" : "пропущено (" + (out.lefthook.reason || out.lefthook.code) + ")"}`);
  if (out.doctor) console.log(`  doctor: ${out.doctor.ok ? "окружение в порядке" : "есть FAIL — запусти `node hooks/doctor.js`"}`);
  if (out.ruleset) console.log(`  ruleset: ${out.ruleset.ok ? "применён" : "не применён (нужен gh admin + Pro/публичный репо)"}`);
  if (out.notes.length) { console.log("\n  дальше:"); for (const n of out.notes) console.log("   • " + n); }
  if (!out.dryRun && out.ok) {
    console.log("\n  осталось вручную (по необходимости):");
    console.log("   • серверный ruleset (реальный enforcement): node hooks/apply-ruleset.js  (gh admin, Pro/публичный репо)");
    console.log("   • проверить: node hooks/verify.js --list  и  node hooks/doctor.js");
  }
  console.log(ok ? "\n✅ установка завершена." : "\n❌ установка не завершена: " + (reason || ""));
  process.exit(ok ? 0 : 1);
}
