#!/usr/bin/env node
// test.js — self-test suite харнесса. Кроссплатформенный (без bash).
// Проверяет конфиги делегированных инструментов (lefthook/gitleaks/cocogitto/ruleset/CI),
// guard.js (обход, циклы, защита файлов, lint-конфиги, fact-force, профили),
// design-gate и verify. Guard-тесты гоняются IN-PROCESS через экспортируемую run()
// (паттерн ECC-диспетчера) — на порядок быстрее спавна node на каждый кейс;
// CLI-контракт (stdin/exit-коды) покрыт отдельной секцией со спавном.
// Запуск: node hooks/test.js.  Exit 0 = зелёное, 1 = есть провалы.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  + " + msg); }
  else { fail++; console.log("  X " + msg); }
}
function runHook(hookPath, payloadObj, env = {}) {
  try {
    execFileSync("node", [hookPath], {
      input: JSON.stringify(payloadObj), encoding: "utf8",
      env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (e) { return e.status || 1; }
}
function hookOutput(hookPath, payloadObj, env = {}) {
  // stdout+stderr независимо от exit-кода
  try {
    return execFileSync("node", [hookPath], {
      input: JSON.stringify(payloadObj), encoding: "utf8",
      env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) { return String(e.stdout || "") + String(e.stderr || ""); }
}

const GUARD = path.join(__dirname, "agent", "guard.js");
const STOP = path.join(__dirname, "agent", "stop-reminder.js");
const DESIGN_GATE = path.join(__dirname, "design-gate.js");
const NEW_MOCKUPS = path.join(__dirname, "new-mockups.js");
const VERIFY = path.join(__dirname, "verify.js");
const REPO = path.join(__dirname, "..");
function readRepo(f) { try { return fs.readFileSync(path.join(REPO, f), "utf8"); } catch { return ""; } }
// guard блокирует правки файлов харнесса относительно projectDir — тесты гоняем
// из нейтрального каталога, чтобы проверять именно относительные пути.
const NEUTRAL = fs.mkdtempSync(path.join(os.tmpdir(), "harness-neutral-"));
function sess(name) {
  return { HARNESS_SESSION_ID: name + "-" + Date.now() + "-" + Math.random().toString(36).slice(2), HARNESS_PROJECT_DIR: NEUTRAL };
}

// ---------- in-process guard runner ----------
const guardMod = require(GUARD);
function grun(payload, env = {}) {
  const ti = payload.tool_input || {};
  const ctx = {
    tool: payload.tool_name || "",
    command: typeof ti.command === "string" ? ti.command : "",
    filePath: ti.file_path || "",
    sessionId: env.HARNESS_SESSION_ID || "",
    projectDir: env.HARNESS_PROJECT_DIR || NEUTRAL,
    stopHookActive: false, truncated: false, parseError: false, raw: payload,
  };
  return guardMod.run(ctx, { ...process.env, ...env });
}
const gexit = (payload, env = {}) => grun(payload, env).exitCode;
function gout(payload, env = {}) { const r = grun(payload, env); return String(r.stdout) + String(r.stderr); }

// ---------- конфиги делегированных инструментов ----------
console.log("\nconfigs (lefthook + gitleaks + cocogitto + ruleset + ci):");
const lh = readRepo("lefthook.yml");
ok(/commit-msg:/.test(lh) && /cog verify/.test(lh), "lefthook commit-msg -> cog verify (conventional)");
ok(/no-coauthor/.test(lh) && /co-authored-by/i.test(lh), "lefthook commit-msg -> no-coauthor grep");
ok(/pre-commit:/.test(lh) && /gitleaks/.test(lh), "lefthook pre-commit -> gitleaks (secrets)");
ok(/HARNESS_ALLOW_MAIN/.test(lh), "lefthook держит escape-hatch HARNESS_ALLOW_MAIN");
ok(/pre-push:/.test(lh) && /verify\.js/.test(lh), "lefthook pre-push -> verify.js");
ok(/pre-push:[\s\S]*design-gate\.js/.test(lh), "lefthook pre-push -> design-gate.js");
const cog = readRepo("cog.toml");
ok(/from_latest_tag/.test(cog) && /\[changelog\]/.test(cog), "cog.toml на месте (bump + changelog)");
const gl = readRepo(".gitleaks.toml");
ok(/useDefault\s*=\s*true/.test(gl), "gitleaks расширяет дефолтный ruleset");
let ruleset = {};
try { ruleset = JSON.parse(readRepo(".github/rulesets/main.json")); } catch {}
ok(ruleset.enforcement === "active" && ruleset.target === "branch", "ruleset — активный branch-ruleset");
const rNames = (ruleset.rules || []).map((r) => r.type);
ok(["deletion", "non_fast_forward", "pull_request", "required_status_checks"].every((t) => rNames.includes(t)),
  "ruleset: block delete/force-push, require PR + status check");
const rsc = (ruleset.rules || []).find((r) => r.type === "required_status_checks");
ok(!!rsc && rsc.parameters.required_status_checks.some((c) => c.context === "verify"),
  "ruleset требует CI-check verify (совпадает с job id в ci.yml)");
ok(!!rsc && rsc.parameters.required_status_checks.some((c) => c.context === "verify" && c.integration_id === 15368),
  "ruleset пинит check verify на GitHub Actions (integration_id) — статус нельзя подделать через API");
const prr = (ruleset.rules || []).find((r) => r.type === "pull_request");
ok(!!prr && prr.parameters.require_code_owner_review === false,
  "ruleset не требует code-owner review (иначе deadlock соло-мейнтейнера)");
const ci = readRepo(".github/workflows/ci.yml");
ok(/push:\s*\n\s*branches:\s*\[main\]/.test(ci), "CI: push-триггер только на main (нет двойного прогона PR)");
ok(/design-gate\.js/.test(ci) && /verify\.js/.test(ci), "CI гоняет verify.js + design-gate.js");

// ---------- no-coauthor grep (паттерн из lefthook.yml, через RegExp) ----------
console.log("\nno-coauthor pattern:");
const nm = lh.match(/grep -qiE '([^']+)'/);
ok(!!nm, "паттерн no-coauthor найден в lefthook.yml");
if (nm) {
  const re = new RegExp(nm[1], "i");
  ok(re.test("Co-Authored-By: Claude <noreply@anthropic.com>"), "ловит Co-Authored-By");
  ok(re.test("\u{1F916} Generated with Claude Code"), "ловит Generated with Claude");
  ok(re.test("generated by an AI assistant"), "ловит generated by an AI");
  ok(!re.test("fix(proto): regenerate stubs generated with protoc"), "НЕ ловит generated with protoc");
  ok(!re.test("feat(ui): add robot emoji \u{1F916} to status bar"), "НЕ ловит одиночный emoji в тексте");
}

// ---------- guard: обход харнесса ----------
console.log("\nguard: bypass detection:");
const bp = (cmd, env = {}) => gexit({ tool_name: "Bash", tool_input: { command: cmd } }, { ...sess("bp"), ...env });
ok(bp('git commit -m "feat: x" --no-verify') === 2, "блок: git commit --no-verify");
ok(bp('git commit -n -m "feat: x"') === 2, "блок: git commit -n");
ok(bp("git push origin main --no-verify") === 2, "блок: git push --no-verify");
ok(bp("git config core.hooksPath /dev/null") === 2, "блок: git config core.hooksPath");
ok(bp('git -c core.hooksPath=/dev/null commit -m "feat: x"') === 2, "блок: git -c core.hooksPath (инлайн)");
ok(bp("lefthook uninstall") === 2, "блок: lefthook uninstall");
ok(bp('LEFTHOOK=0 git commit -m "feat: x"') === 2, "блок: LEFTHOOK=0");
ok(bp("rm -rf .git/hooks") === 2, "блок: запись/удаление в .git/hooks");
ok(bp("ls .git/hooks") === 0, "НЕ блок: чтение .git/hooks (ls)");
ok(bp('git commit -m "docs: add -n / --no-verify support notes"') === 0, "НЕ блок: -n внутри сообщения коммита");
ok(bp('git commit -m "feat(core): real change"') === 0, "НЕ блок: обычный коммит");
ok(bp("git commit --no-verify -m x", { HARNESS_ACK_BYPASS: "1" }) === 0, "HARNESS_ACK_BYPASS=1 разрешает осознанный обход");
ok(!/HARNESS_ACK_BYPASS/.test(gout({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, sess("hint"))),
  "block-сообщение НЕ содержит рецепт обхода (имя env-переменной)");

// ---------- guard: shell-запись в защищённые пути ----------
console.log("\nguard: protected paths via shell:");
ok(bp("sed -i 's/x/y/' hooks/agent/guard.js") === 2, "блок: sed -i по hooks/");
ok(bp("echo bad >> lefthook.yml") === 2, "блок: редирект в lefthook.yml");
ok(bp("rm -rf hooks") === 2, "блок: rm -rf hooks (без слэша)");
ok(bp("mv lefthook.yml lefthook.yml.bak") === 2, "блок: mv lefthook.yml");
ok(bp("tee .github/workflows/ci.yml") === 2, "блок: tee в workflows");
ok(bp("node hooks/verify.js") === 0, "НЕ блок: запуск node hooks/verify.js");
ok(bp("node hooks/test.js") === 0, "НЕ блок: запуск self-теста");
ok(bp("cat hooks/agent/guard.js") === 0, "НЕ блок: чтение хука (cat)");
ok(bp("git add hooks/ lefthook.yml") === 0, "НЕ блок: git add файлов харнесса");
ok(bp("sed -i 's/x/y/' hooks/agent/guard.js", { HARNESS_ACK_BYPASS: "1" }) === 0, "ACK_BYPASS=1 разрешает shell-правку");

// ---------- guard: сбой стриминга ----------
console.log("\nguard: stream corruption:");
ok(bp("cd /x && echo garbage 183<tool_call>") === 2, "блок: мусор tool-разметки (<tool_call>)");
ok(bp("echo garbage </tool_use> x") === 2, "блок: мусор tool-разметки (</tool_use>)");
ok(bp("echo a echo a echo a echo a echo a") === 2, "блок: низкая энтропия токенов");
ok(bp("cat > a.html <<EOF\n<toolbar>hi</toolbar>\nEOF") === 0, "НЕ блок: heredoc с <toolbar> (легитимный HTML)");

// ---------- guard: циклы (shell) ----------
console.log("\nguard: shell loops:");
let S = sess("triv");
let last = 0;
for (const c of ["echo a", "echo b", "ls", "pwd", "echo c"]) last = gexit({ tool_name: "Bash", tool_input: { command: c } }, S);
ok(last === 2, "блок: 5 тривиальных команд подряд");
S = sess("real-reset");
gexit({ tool_name: "Bash", tool_input: { command: "echo a" } }, S);
gexit({ tool_name: "Bash", tool_input: { command: "npm run build -- --verbose" } }, S);
for (const c of ["echo b", "echo c", "ls"]) last = gexit({ tool_name: "Bash", tool_input: { command: c } }, S);
ok(last === 0, "настоящая команда сбрасывает streak тривиальных");
S = sess("ident");
for (let i = 0; i < 5; i++) last = gexit({ tool_name: "Bash", tool_input: { command: "npm run build -- --verbose" } }, S);
ok(last === 2, "блок: 5x одна и та же настоящая команда подряд");
S = sess("alt");
for (let i = 0; i < 5; i++) {
  gexit({ tool_name: "Bash", tool_input: { command: "npm test -- --run-suite alpha" } }, S);
  last = gexit({ tool_name: "Bash", tool_input: { command: "git diff --stat HEAD~1" } }, S);
}
ok(last === 2, "блок: чередование A-B-A-B (10 шагов)");
S = sess("alt-break");
for (let i = 0; i < 4; i++) {
  gexit({ tool_name: "Bash", tool_input: { command: "npm test -- --run-suite alpha" } }, S);
  gexit({ tool_name: "Bash", tool_input: { command: "git diff --stat HEAD~1" } }, S);
}
last = gexit({ tool_name: "Bash", tool_input: { command: "node hooks/verify.js --list" } }, S);
ok(last === 0, "третья команда разрывает чередование");

// ---------- guard: циклы (file-tools) ----------
console.log("\nguard: file-tool loops:");
S = sess("ft");
for (let i = 0; i < 12; i++) last = gexit({ tool_name: "Read", tool_input: { file_path: "/tmp/same.txt" } }, S);
ok(last === 2, "блок: 12x Read одного файла подряд");
S = sess("ft2");
for (let i = 0; i < 11; i++) gexit({ tool_name: "Edit", tool_input: { file_path: "/tmp/a.py" } }, S);
ok(gexit({ tool_name: "Edit", tool_input: { file_path: "/tmp/b.py" } }, S) === 0, "другой файл сбрасывает серию");
ok(gexit({ tool_name: "Read", tool_input: {} }, sess("ft3")) === 0, "нет target -> не проверяется");

// ---------- guard: защита файлов харнесса ----------
console.log("\nguard: protected harness files:");
const ed = (fp, env = {}) => gexit({ tool_name: "Edit", tool_input: { file_path: fp } }, { ...sess("prot"), ...env });
ok(ed("lefthook.yml") === 2, "блок: правка lefthook.yml");
ok(ed("hooks/agent/guard.js") === 2, "блок: правка hooks/...");
ok(ed(".claude/settings.json") === 2, "блок: правка .claude/settings.json");
ok(ed(".github/workflows/ci.yml") === 2, "блок: правка CI workflow");
ok(ed("src/app.py") === 0, "НЕ блок: обычный файл проекта");
ok(ed("lefthook.yml", { HARNESS_ACK_BYPASS: "1" }) === 0, "HARNESS_ACK_BYPASS=1 разрешает правку харнесса");
ok(ed("./lefthook.yml") === 2, "блок: обход через ./-префикс (нормализация путей)");
ok(ed("design/../hooks/agent/guard.js") === 2, "блок: обход через ../-траверс");
ok(ed("Lefthook.yml") === 2, "блок: обход через регистр (Windows/macOS ФС регистронезависимы)");
ok(ed("hooks2/readme.md") === 0, "НЕ блок: hooks2/ — не hooks/");

// ---------- guard: lint-config protection (паттерн ECC config-protection) ----------
console.log("\nguard: lint-config protection:");
fs.writeFileSync(path.join(NEUTRAL, ".eslintrc.json"), "{}");
ok(ed(".eslintrc.json") === 2, "блок: правка существующего .eslintrc.json");
ok(ed("ruff.toml") === 0, "НЕ блок: создание нового lint-конфига (файла ещё нет)");
ok(ed(".eslintrc.json", { HARNESS_ACK_BYPASS: "1" }) === 0, "ACK_BYPASS=1 разрешает правку lint-конфига");
ok(ed("pyproject.toml") === 0, "НЕ блок: pyproject.toml (смешанный файл — не в списке)");
ok(bp("sed -i 's/select/ignore/' ruff.toml") === 2, "блок: sed -i по ruff.toml (shell, без проверки существования)");
ok(bp("echo lax >> src/.eslintrc.json") === 2, "блок: редирект в .eslintrc.json (вложенный путь)");
ok(bp("cat ruff.toml") === 0, "НЕ блок: чтение lint-конфига");
ok(bp("rm myruff.toml") === 0, "НЕ блок: похожее имя (myruff.toml) — не lint-конфиг");
ok(bp("echo x > src/hooks/useAuth.ts") === 0, "НЕ блок: src/hooks/ проекта (React) — не файлы харнесса");

// ---------- guard: fact-force (EXPLORE перед IMPLEMENT, паттерн ECC GateGuard) ----------
console.log("\nguard: fact-force:");
fs.writeFileSync(path.join(NEUTRAL, "existing.py"), "x = 1");
let SF = sess("ff");
ok(/не читав/.test(gout({ tool_name: "Edit", tool_input: { file_path: "existing.py" } }, SF)),
  "Edit существующего файла без Read -> note");
ok(!/не читав/.test(gout({ tool_name: "Edit", tool_input: { file_path: "existing.py" } }, SF)),
  "повторная правка того же файла -> note один раз, без спама");
SF = sess("ff2");
grun({ tool_name: "Read", tool_input: { file_path: "existing.py" } }, SF);
ok(!/не читав/.test(gout({ tool_name: "Edit", tool_input: { file_path: "existing.py" } }, SF)),
  "Read перед Edit -> без note");
ok(!/не читав/.test(gout({ tool_name: "Write", tool_input: { file_path: "brand-new.py" } }, sess("ff3"))),
  "Write нового файла -> без note (нечего читать)");

// ---------- guard: профили строгости ----------
console.log("\nguard: strictness profiles:");
ok(gexit({ tool_name: "Edit", tool_input: { file_path: ".eslintrc.json" } }, { ...sess("pf1"), HARNESS_PROFILE: "minimal" }) === 0,
  "minimal: lint-конфиг не блокируется (только анти-обход + файлы харнесса)");
ok(gexit({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, { ...sess("pf2"), HARNESS_PROFILE: "minimal" }) === 2,
  "minimal: анти-обход остаётся");
ok(gexit({ tool_name: "Edit", tool_input: { file_path: "lefthook.yml" } }, { ...sess("pf3"), HARNESS_PROFILE: "minimal" }) === 2,
  "minimal: файлы харнесса остаются под защитой");
let SP = sess("pf4"), lastP = 0;
for (const c of ["echo a", "echo b", "ls", "pwd", "echo c"]) lastP = gexit({ tool_name: "Bash", tool_input: { command: c } }, { ...SP, HARNESS_PROFILE: "minimal" });
ok(lastP === 0, "minimal: loop-детекторы выключены");
SP = sess("pf5");
for (let i = 0; i < 3; i++) lastP = gexit({ tool_name: "Bash", tool_input: { command: "npm run build" } }, { ...SP, HARNESS_PROFILE: "strict" });
ok(lastP === 2, "strict: порог повторов вдвое ниже (3x одинаковых -> блок)");
ok(gexit({ tool_name: "Edit", tool_input: { file_path: ".eslintrc.json" } }, { ...sess("pf6"), HARNESS_DISABLED_CHECKS: "lintconfig" }) === 0,
  "HARNESS_DISABLED_CHECKS=lintconfig отключает проверку точечно");

// ---------- guard: DESIGN-подсказка ----------
console.log("\nguard: design note:");
const dn = gout({ tool_name: "Edit", tool_input: { file_path: "src/ui/panel.qml" } }, sess("dn1"));
ok(/DESIGN|мокап/i.test(dn), "правка UI-файла -> note про DESIGN-стадию");
ok(/"hookSpecificOutput"/.test(dn) && /"hookEventName"\s*:\s*"PreToolUse"/.test(dn),
  "note в формате Claude Code (hookSpecificOutput.additionalContext), не только top-level");
const dn2 = gout({ tool_name: "Edit", tool_input: { file_path: "src/core/logic.py" } }, sess("dn2"));
ok(!/DESIGN|мокап/i.test(dn2), "обычный файл -> без note");

// ---------- guard: CLI-обёртка (spawn-контракт stdin/exit-кодов) ----------
console.log("\nguard: CLI contract:");
ok(runHook(GUARD, { tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, sess("cli1")) === 2, "CLI: блок -> exit 2");
ok(runHook(GUARD, { tool_name: "Bash", tool_input: { command: "echo ok" } }, sess("cli2")) === 0, "CLI: allow -> exit 0");
ok(typeof guardMod.run === "function", "guard экспортирует run(ctx, env) для in-process диспетчера");
const rr = grun({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, sess("ip1"));
ok(rr.exitCode === 2 && /guard/.test(rr.stderr), "run(): блок приходит результатом, без process.exit");

// ---------- guard: fail-closed на битом вводе ----------
console.log("\nguard: fail-closed input:");
function runRaw(hookPath, rawStr, env = {}) {
  try {
    execFileSync("node", [hookPath], { input: rawStr, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    return 0;
  } catch (e) { return e.status || 1; }
}
ok(runRaw(GUARD, "{broken json...", sess("fc1")) === 2, "непустой битый JSON -> fail-closed блок (не слепой allow)");
ok(runRaw(GUARD, "", sess("fc2")) === 0, "пустой stdin -> fail-open (ручной запуск)");

// ---------- design-gate ----------
console.log("\ndesign-gate:");
function gate(root, files) {
  try {
    execFileSync("node", [DESIGN_GATE, "--root", root, "--files", files.join(",")], { encoding: "utf8", stdio: "pipe" });
    return 0;
  } catch (e) { return e.status || 1; }
}
const dtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-design-"));
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1, "блок: UI-изменение без мокапов");
ok(gate(dtmp, ["src/core/logic.py"]) === 0, "пропуск: не-UI изменение");
execFileSync("node", [NEW_MOCKUPS, "login"], { env: { ...process.env, HARNESS_ROOT: dtmp }, stdio: "pipe" });
const fdir = path.join(dtmp, "design", "mockups", "login");
ok(fs.readdirSync(fdir).filter((f) => f.endsWith(".html")).length === 4, "new-mockups создаёт 4 HTML-мокапа");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/login/01-minimal-light.html"]) === 1,
  "блок: мокапы есть, но нет APPROVED");
fs.writeFileSync(path.join(fdir, "APPROVED"), "approved: test\n");
ok(gate(dtmp, ["src/ui/main_window.ui", "design/mockups/login/APPROVED"]) === 0,
  "пропуск: одобренный набор затронут в diff ветки");
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1,
  "блок: старый approval НЕ в diff ветки — вечного пропуска больше нет");
ok(gate(dtmp, ["design/mockups/login/02-dark-pro.html"]) === 0, "пропуск: правки только мокапов не триггерят гейт");
// fail-open при недоступной базе — но ГРОМКИЙ (skipped:true в --json), не молчаливый
const noGit = fs.mkdtempSync(path.join(os.tmpdir(), "harness-nogit-"));
let gateJson = {};
try {
  gateJson = JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", noGit, "--base", "no-such-ref", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch (e) { try { gateJson = JSON.parse(String(e.stdout || "{}")); } catch {} }
ok(gateJson.skipped === true && /гейт ПРОПУЩЕН|diff/.test(gateJson.warn || ""),
  "недоступная база diff -> fail-open с явным warning, не молчаливый пропуск");
try { fs.rmSync(noGit, { recursive: true, force: true }); } catch {}
try { fs.rmSync(dtmp, { recursive: true, force: true }); } catch {}

// ---------- verify runner ----------
console.log("\nverify runner:");
function verifyExit(root) {
  try { execFileSync("node", [VERIFY, "--root", root], { encoding: "utf8", stdio: "pipe" }); return 0; }
  catch (e) { return e.status || 1; }
}
function verifyList(root) {
  try { return JSON.parse(execFileSync("node", [VERIFY, "--root", root, "--list", "--json"], { encoding: "utf8", stdio: "pipe" })); }
  catch { return { plan: [] }; }
}
const vtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verify-"));
fs.writeFileSync(path.join(vtmp, "Cargo.toml"), "[package]\n");
fs.mkdirSync(path.join(vtmp, "app"));
fs.writeFileSync(path.join(vtmp, "app", "App.csproj"), "<Project/>");
fs.writeFileSync(path.join(vtmp, "pyproject.toml"), "[project]\n");
const ids = verifyList(vtmp).plan.map((p) => p.stack);
ok(ids.includes("rust") && ids.includes("dotnet") && ids.includes("python"),
  "авто-детект rust/dotnet/python по маркер-файлам");
const etmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifyexec-"));
fs.writeFileSync(path.join(etmp, "m.txt"), "x");
fs.writeFileSync(path.join(etmp, "stepA.js"), "process.exit(0)");
fs.writeFileSync(path.join(etmp, "stepB.js"), "require('fs').writeFileSync('ran_b','1');process.exit(2)");
fs.writeFileSync(path.join(etmp, "stepC.js"), "require('fs').writeFileSync('ran_c','1')");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { failFast: true, stacks: [{ id: "t", markers: ["m.txt"], steps: [
  { name: "a", run: "node stepA.js" }, { name: "b", run: "node stepB.js" }, { name: "c", run: "node stepC.js" }] }] } }));
ok(verifyExit(etmp) === 1, "verify падает на провале обязательного шага");
ok(fs.existsSync(path.join(etmp, "ran_b")) && !fs.existsSync(path.join(etmp, "ran_c")),
  "fail-fast: шаг после провала не запускается");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "opt", run: "node stepB.js", optional: true }] }] } }));
ok(verifyExit(etmp) === 0, "optional-шаг падает -> warning, не провал");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "ok2", run: "node stepB.js", okCodes: { 2: "допустимо" } }] }] } }));
ok(verifyExit(etmp) === 0, "okCodes: допустимый ненулевой exit (напр. pytest 5 «нет тестов») -> warning, не провал");

// --changed: фильтр стеков по diff ветки (детерминированно через --files)
function verifyListArgs(root, extra) {
  try { return JSON.parse(execFileSync("node", [VERIFY, "--root", root, "--list", "--json", ...extra], { encoding: "utf8", stdio: "pipe" })); }
  catch { return { plan: [] }; }
}
function verifyExitArgs(root, extra) {
  try { execFileSync("node", [VERIFY, "--root", root, ...extra], { encoding: "utf8", stdio: "pipe" }); return 0; }
  catch (e) { return e.status || 1; }
}
const ctmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifychg-"));
fs.mkdirSync(path.join(ctmp, "py")); fs.writeFileSync(path.join(ctmp, "py", "pyproject.toml"), "[project]\n");
fs.mkdirSync(path.join(ctmp, "js")); fs.writeFileSync(path.join(ctmp, "js", "package.json"), "{}\n");
let chg = verifyListArgs(ctmp, ["--changed", "--files", "py/app.py"]);
ok(chg.plan.length === 1 && chg.plan[0].stack === "python" && chg.plan[0].dir === "py",
  "--changed: только затронутый стек (py) в плане, нетронутый (js) отброшен");
chg = verifyListArgs(ctmp, ["--changed", "--files", "js/index.js,py/app.py"]);
ok(chg.plan.map((p) => p.stack).sort().join(",") === "node,python",
  "--changed: несколько затронутых стеков — оба в плане");
ok(verifyExitArgs(ctmp, ["--changed", "--files", ""]) === 0 && verifyListArgs(ctmp, ["--changed", "--files", ""]).plan.length === 0,
  "--changed: пустой список изменений -> exit 0, план пуст (нечего проверять)");
const allIds = verifyListArgs(ctmp, []).plan.map((p) => p.stack).sort().join(",");
const fbIds = verifyListArgs(ctmp, ["--changed", "--base", "no-such-ref"]).plan.map((p) => p.stack).sort().join(",");
ok(allIds === "node,python" && fbIds === allIds,
  "--changed fail-safe: недоступная база diff -> проверяются ВСЕ стеки (не молчаливый пропуск)");
try { fs.rmSync(ctmp, { recursive: true, force: true }); } catch {}

try { fs.rmSync(vtmp, { recursive: true, force: true }); fs.rmSync(etmp, { recursive: true, force: true }); } catch {}

// ---------- doctor ----------
console.log("\ndoctor:");
const DOCTOR = path.join(__dirname, "doctor.js");
function doctor(root) {
  try { return JSON.parse(execFileSync("node", [DOCTOR, "--root", root, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch (e) { try { return JSON.parse(String(e.stdout || "{}")); } catch { return { results: [] }; } }
}
const drepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-"));
execFileSync("git", ["init", "-q"], { cwd: drepo });
let dres = doctor(drepo);
ok((dres.results || []).some((r) => /lock-операции/.test(r.msg) && r.level === "PASS"),
  "doctor: .git допускает write+unlink lock-операции -> PASS (нормальная FS)");
fs.writeFileSync(path.join(drepo, ".git", "index.lock"), "");
dres = doctor(drepo);
ok((dres.results || []).some((r) => /index\.lock/.test(r.msg) && r.level === "WARN"),
  "doctor: залипший index.lock -> WARN (детект блокера коммита)");
try { fs.rmSync(drepo, { recursive: true, force: true }); } catch {}

// ---------- stop-reminder ----------
console.log("\nstop-reminder:");
const stopRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-stop-"));
execFileSync("git", ["init", "-q"], { cwd: stopRepo });
let stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(stopOut.trim() === "", "чистое дерево -> молчит (без шума)");
fs.writeFileSync(path.join(stopRepo, "wip.txt"), "x");
stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(/VERIFY/.test(stopOut) && /wip\.txt/.test(stopOut), "грязное дерево -> напоминание + git status");
ok(/"decision"\s*:\s*"block"/.test(stopOut), "напоминание в контракте Stop-хука (decision:block, additionalContext на Stop не работает)");
stopOut = hookOutput(STOP, { stop_hook_active: true }, { HARNESS_PROJECT_DIR: stopRepo });
ok(stopOut.trim() === "", "stop_hook_active=true -> молчит (защита от вечного block-цикла)");
try { fs.rmSync(stopRepo, { recursive: true, force: true }); } catch {}

// ---------- гигиена: NUL-байты ----------
console.log("\nsource hygiene:");
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(js|json|md)$/.test(e.name)) out.push(p);
  }
  return out;
}
const nulFiles = walk(__dirname).filter((f) => fs.readFileSync(f).includes(0));
ok(nulFiles.length === 0, "нет NUL-байтов в исходниках хуков" + (nulFiles.length ? " (найдено: " + nulFiles.join(", ") + ")" : ""));

try { fs.rmSync(NEUTRAL, { recursive: true, force: true }); } catch {}
console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
