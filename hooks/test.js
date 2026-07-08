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
const BRANCH_GUARD = path.join(__dirname, "branch-guard.js");
const NO_COAUTHOR = path.join(__dirname, "no-coauthor.js");
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
ok(/no-coauthor:[\s\S]*node hooks\/no-coauthor\.js/.test(lh), "lefthook commit-msg -> Windows-safe no-coauthor Node script");
ok(fs.existsSync(NO_COAUTHOR), "no-coauthor.js на месте");
ok(/pre-commit:/.test(lh) && /gitleaks/.test(lh), "lefthook pre-commit -> gitleaks (secrets)");
ok(/HARNESS_ALLOW_MAIN/.test(lh), "lefthook держит escape-hatch HARNESS_ALLOW_MAIN");
ok(/branch-guard:[\s\S]*node hooks\/branch-guard\.js/.test(lh), "lefthook branch-guard -> Windows-safe Node script");
ok(fs.existsSync(BRANCH_GUARD), "branch-guard.js на месте");
ok(/pre-push:/.test(lh) && /verify\.js/.test(lh), "lefthook pre-push -> verify.js");
ok(/pre-push:[\s\S]*design-gate\.js/.test(lh), "lefthook pre-push -> design-gate.js");
ok(/design-gate\.js --base origin\/main/.test(lh), "lefthook design-gate uses fresh remote base origin/main");
const cog = readRepo("cog.toml");
ok(/from_latest_tag/.test(cog) && /\[changelog\]/.test(cog), "cog.toml на месте (bump + changelog)");
ok(/from_latest_tag\s*=\s*true/.test(cog) && /ignore_merge_commits\s*=\s*true/.test(cog) && /tag_prefix\s*=\s*"v"/.test(cog),
  "cog.toml release-safe: latest v* tag + merge commits ignored");
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
ok(!!prr && prr.parameters.required_approving_review_count >= 1 && prr.parameters.require_code_owner_review === true,
  "ruleset требует approving review + code-owner review для self-verifying harness");
const ci = readRepo(".github/workflows/ci.yml");
ok(/push:\s*\n\s*branches:\s*\[main\]/.test(ci), "CI: push-триггер только на main (нет двойного прогона PR)");
ok(/doctor\.js/.test(ci) && /design-gate\.js/.test(ci) && /verify\.js/.test(ci), "CI гоняет doctor.js + verify.js + design-gate.js");
ok(/uses:\s*actions\/checkout@[0-9a-f]{40}\s*# actions\/checkout@v\d/.test(ci) &&
   /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*# actions\/setup-node@v\d/.test(ci) &&
   /uses:\s*gitleaks\/gitleaks-action@[0-9a-f]{40}\s*# gitleaks\/gitleaks-action@v\d/.test(ci) &&
   /uses:\s*cocogitto\/cocogitto-action@[0-9a-f]{40}\s*# cocogitto\/cocogitto-action@v\d/.test(ci),
  "CI: GitHub Actions pinned to full SHAs with Dependabot-readable comments");
ok(/AGENTSHIELD_INTEGRITY:\s*"sha512-/.test(ci) && /NPM_CONFIG_IGNORE_SCRIPTS:\s*"true"/.test(ci),
  "CI: AgentShield npm package has integrity pin and install scripts disabled");
ok(/cocogitto-action@[0-9a-f]{40}[\s\S]*check:\s*false[\s\S]*cog check "\$\{\{ github\.event\.pull_request\.base\.sha \}\}\.\.HEAD" --ignore-merge-commits/.test(ci),
  "CI: conventional commit check uses explicit PR range, not latest tag (works before first release tag)");
const jobIds = [...ci.matchAll(/^  ([A-Za-z0-9_-]+):\s*\n\s+runs-on:/gm)].map((m) => m[1]);
const requiredContexts = (((rsc || {}).parameters || {}).required_status_checks || []).map((c) => c.context);
ok(requiredContexts.length > 0 && requiredContexts.every((ctx) => jobIds.includes(ctx)),
  "CI/ruleset contract: required status check contexts match workflow job ids");
ok(/design-gate\.js --strict --base/.test(ci), "CI запускает design-gate в strict mode");
ok(/AGENTSHIELD_VERSION:\s*"1\.4\.0"/.test(ci) && /continue-on-error:\s*true/.test(ci),
  "CI: security-скан ecc-agentshield с прибитой версией, пока совещательный (continue-on-error)");

// ---------- no-coauthor policy ----------
console.log("\nno-coauthor policy:");
const noCoauthor = require(NO_COAUTHOR);
ok(noCoauthor.hasForbiddenTrailer("Co-Authored-By: Claude <noreply@anthropic.com>"), "ловит Co-Authored-By");
ok(noCoauthor.hasForbiddenTrailer("\u{1F916} Generated with Claude Code"), "ловит Generated with Claude");
ok(noCoauthor.hasForbiddenTrailer("generated by an AI assistant"), "ловит generated by an AI");
ok(!noCoauthor.hasForbiddenTrailer("fix(proto): regenerate stubs generated with protoc"), "НЕ ловит generated with protoc");
ok(!noCoauthor.hasForbiddenTrailer("feat(ui): add robot emoji \u{1F916} to status bar"), "НЕ ловит одиночный emoji в тексте");
function noCoauthorExit(message) {
  const file = path.join(os.tmpdir(), "harness-no-coauthor-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".txt");
  fs.writeFileSync(file, message);
  try {
    execFileSync("node", [NO_COAUTHOR, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (e) {
    return e.status || 1;
  } finally {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}
ok(noCoauthorExit("feat(ui): add setting\n") === 0, "CLI пропускает чистое сообщение");
ok(noCoauthorExit("feat(ui): add setting\n\nCo-Authored-By: Claude <noreply@example.test>\n") === 1,
  "CLI блокирует co-author trailer");

// ---------- guard: обход харнесса ----------
console.log("\nguard: bypass detection:");
const bp = (cmd, env = {}) => gexit({ tool_name: "Bash", tool_input: { command: cmd } }, { ...sess("bp"), ...env });
ok(bp('git commit -m "feat: x" --no-verify') === 2, "блок: git commit --no-verify");
ok(bp('git commit -n -m "feat: x"') === 2, "блок: git commit -n");
ok(bp("git push origin main --no-verify") === 2, "блок: git push --no-verify");
ok(bp("git config core.hooksPath /dev/null") === 2, "блок: git config core.hooksPath");
ok(bp('git -c core.hooksPath=/dev/null commit -m "feat: x"') === 2, "блок: git -c core.hooksPath (инлайн)");
ok(bp("git.exe commit --no-verify -m x") === 2, "блок: git.exe commit --no-verify (Windows-имя git)");
ok(bp("git.cmd commit -n -m x") === 2, "блок: git.cmd commit -n (Windows-имя git)");
ok(bp("lefthook uninstall") === 2, "блок: lefthook uninstall");
ok(bp('LEFTHOOK=0 git commit -m "feat: x"') === 2, "блок: LEFTHOOK=0");
ok(bp("rm -rf .git/hooks") === 2, "блок: запись/удаление в .git/hooks");
ok(bp("ls .git/hooks") === 0, "НЕ блок: чтение .git/hooks (ls)");
ok(bp('git commit -m "docs: add -n / --no-verify support notes"') === 0, "НЕ блок: -n внутри сообщения коммита");
ok(bp('git commit -m "feat(core): real change"') === 0, "НЕ блок: обычный коммит");
ok(bp("git commit --no-verify -m x", { HARNESS_ACK_BYPASS: "1" }) === 0, "HARNESS_ACK_BYPASS=1 разрешает осознанный обход");
ok(!/HARNESS_ACK_BYPASS/.test(gout({ tool_name: "Bash", tool_input: { command: "git commit --no-verify -m x" } }, sess("hint"))),
  "block-сообщение НЕ содержит рецепт обхода (имя env-переменной)");

// ---------- branch-guard CLI ----------
console.log("\nbranch-guard:");
function runBranchGuard(root, env = {}) {
  try {
    execFileSync("node", [BRANCH_GUARD], { cwd: root, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (e) { return e.status || 1; }
}
const btmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-branchguard-"));
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: btmp });
ok(runBranchGuard(btmp) === 1, "branch-guard: main блокируется");
ok(runBranchGuard(btmp, { HARNESS_ALLOW_MAIN: "1" }) === 0, "branch-guard: HARNESS_ALLOW_MAIN=1 пропускает main");
execFileSync("git", ["checkout", "-q", "-b", "feat/test"], { cwd: btmp });
ok(runBranchGuard(btmp) === 0, "branch-guard: feature-ветка проходит");
try { fs.rmSync(btmp, { recursive: true, force: true }); } catch {}

// ---------- guard: shell-запись в защищённые пути ----------
console.log("\nguard: protected paths via shell:");
ok(bp("sed -i 's/x/y/' hooks/agent/guard.js") === 2, "блок: sed -i по hooks/");
ok(bp("echo bad >> lefthook.yml") === 2, "блок: редирект в lefthook.yml");
ok(bp("rm -rf hooks") === 2, "блок: rm -rf hooks (без слэша)");
ok(bp("mv lefthook.yml lefthook.yml.bak") === 2, "блок: mv lefthook.yml");
ok(bp("tee .github/workflows/ci.yml") === 2, "блок: tee в workflows");
ok(bp("del hooks\\agent\\guard.js") === 2, "блок: del по hooks/ (cmd, backslash-путь)");
ok(bp("move lefthook.yml lefthook.bak") === 2, "блок: move lefthook.yml (cmd)");
ok(bp("rd /s hooks") === 2, "блок: rd hooks (cmd)");
ok(bp("Remove-Item lefthook.yml") === 2, "блок: Remove-Item lefthook.yml (PowerShell)");
ok(bp("Set-Content .github\\workflows\\ci.yml -Value x") === 2, "блок: Set-Content в workflows (PowerShell, backslash)");
ok(bp("Copy-Item x lefthook.yml") === 2, "блок: Copy-Item в lefthook.yml (PowerShell, цель — второй аргумент)");
ok(bp("del notes.txt") === 0, "НЕ блок: del обычного файла");
ok(bp("Remove-Item build\\temp.log") === 0, "НЕ блок: Remove-Item обычного файла");
ok(bp("node hooks/verify.js") === 0, "НЕ блок: запуск node hooks/verify.js");
ok(bp("node hooks/test.js") === 0, "НЕ блок: запуск self-теста");
ok(bp("cat hooks/agent/guard.js") === 0, "НЕ блок: чтение хука (cat)");
ok(bp("git add hooks/ lefthook.yml") === 0, "НЕ блок: git add файлов харнесса");
ok(bp("sed -i 's/x/y/' hooks/agent/guard.js", { HARNESS_ACK_BYPASS: "1" }) === 0, "ACK_BYPASS=1 разрешает shell-правку");

// ---------- guard: обход защиты через инлайн-eval интерпретатора ----------
console.log("\nguard: interpreter-eval protected write:");
ok(/интерпретатор/i.test(gout({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('hooks/agent/guard.js','x')\"" } }, sess("ie1"))),
  "node -e writeFileSync в hooks/ -> сообщение про инлайн-eval интерпретатора");
ok(gexit({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('hooks/agent/guard.js','x')\"" } }, sess("ie1b")) === 2,
  "node -e writeFileSync в hooks/ -> жёсткий блок");
ok(gexit({ tool_name: "Bash", tool_input: { command: "python -c \"open('lefthook.yml','w').write('x')\"" } }, sess("ie2")) === 2,
  "python -c open('lefthook.yml','w') -> жёсткий блок");
ok(gexit({ tool_name: "Bash", tool_input: { command: "bash -c 'rm -rf hooks/'" } }, sess("ie3")) === 2,
  "bash -c 'rm -rf hooks/' -> жёсткий блок (глагол спрятан в кавычках от write-детекции)");
ok(gexit({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('hooks/agent/guard.js','x')\"" } }, { ...sess("ie8"), HARNESS_ACK_BYPASS: "1" }) === 0,
  "ACK_BYPASS=1 разрешает инлайн-eval protected write");
ok(!/интерпретатор/i.test(gout({ tool_name: "Bash", tool_input: { command: "node -e \"console.log(1+1)\"" } }, sess("ie4"))),
  "node -e без записи и без пути харнесса -> без ноты");
ok(!/интерпретатор/i.test(gout({ tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('build/out.txt','x')\"" } }, sess("ie5"))),
  "node -e запись в обычный файл (build/) -> без ноты");
ok(!/интерпретатор/i.test(gout({ tool_name: "Bash", tool_input: { command: "ssh -c aes256 host" } }, sess("ie6"))),
  "ssh -c … -> без ноты (не интерпретатор, `sh` в `ssh` не матчит по границе слова)");
ok(!/интерпретатор/i.test(gout({ tool_name: "Bash", tool_input: { command: "node hooks/verify.js" } }, sess("ie7"))),
  "node hooks/verify.js (без -e) -> без ноты");

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
ok(bp("Set-Content src\\.eslintrc.json -Value x") === 2, "блок: Set-Content в .eslintrc.json (PowerShell, backslash-путь)");
ok(bp("del ruff.toml") === 2, "блок: del ruff.toml (cmd)");
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
function gateResult(root, files) {
  try {
    return JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", root, "--files", files.join(","), "--json"], { encoding: "utf8", stdio: "pipe" }));
  } catch (e) { try { return JSON.parse(String(e.stdout || "{}")); } catch { return {}; } }
}
const dtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-design-"));
ok(gate(dtmp, ["src/ui/main_window.ui"]) === 1, "блок: UI-изменение без мокапов");
ok((gateResult(dtmp, ["src/Dropwheel/UI/Foo.xaml"]).uiChanged || []).includes("src/Dropwheel/UI/Foo.xaml"),
  "design-gate: UI-глобы матчятся case-insensitive (**/ui/** ловит /UI/)");
ok(gate(dtmp, ["src/core/logic.py"]) === 0, "пропуск: не-UI изменение");
const staleMain = fs.mkdtempSync(path.join(os.tmpdir(), "harness-design-stale-main-"));
function sgit(args) {
  return execFileSync("git", args, { cwd: staleMain, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function swrite(rel, text) {
  const p = path.join(staleMain, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
sgit(["init", "-q", "-b", "main"]);
sgit(["config", "user.name", "Harness Test"]);
sgit(["config", "user.email", "harness@example.test"]);
swrite("README.md", "base\n");
sgit(["add", "."]);
sgit(["commit", "-q", "-m", "chore: base"]);
const baseCommit = sgit(["rev-parse", "HEAD"]);
sgit(["branch", "feature/readme"]);
swrite("src/ui/app.js", "console.log('ui');\n");
for (let i = 1; i <= 4; i++) swrite(`design/mockups/open/${String(i).padStart(2, "0")}.html`, "<!doctype html>\n");
swrite("design/mockups/open/APPROVED", "approved\n");
sgit(["add", "."]);
sgit(["commit", "-q", "-m", "feat(ui): add upstream ui"]);
const remoteMain = sgit(["rev-parse", "HEAD"]);
sgit(["update-ref", "refs/remotes/origin/main", remoteMain]);
sgit(["update-ref", "refs/heads/main", baseCommit]);
sgit(["checkout", "-q", "-f", "feature/readme"]);
sgit(["merge", "-q", "--no-ff", "-m", "merge origin/main", "origin/main"]);
fs.appendFileSync(path.join(staleMain, "README.md"), "feature\n");
sgit(["add", "README.md"]);
sgit(["commit", "-q", "-m", "docs(readme): update"]);
let staleGate = {};
try {
  staleGate = JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", staleMain, "--json"], { encoding: "utf8", stdio: "pipe" }));
} catch (e) { try { staleGate = JSON.parse(String(e.stdout || "{}")); } catch {} }
ok(staleGate.base === "origin/main" && Array.isArray(staleGate.uiChanged) && staleGate.uiChanged.length === 0,
  "design-gate default prefers origin/main, so stale local main does not add upstream UI noise");
fs.mkdirSync(path.join(staleMain, "src", "ui"), { recursive: true });
fs.writeFileSync(path.join(staleMain, "src", "ui", "scratch.ui"), "<ui/>\n");
staleGate = {};
try {
  staleGate = JSON.parse(execFileSync("node", [DESIGN_GATE, "--root", staleMain, "--json"], { encoding: "utf8", stdio: "pipe" }));
} catch (e) { try { staleGate = JSON.parse(String(e.stdout || "{}")); } catch {} }
ok(Array.isArray(staleGate.uiChanged) && staleGate.uiChanged.length === 0,
  "design-gate ignores untracked local UI files; it gates branch diff, not dirty workspace noise");
try { fs.rmSync(staleMain, { recursive: true, force: true }); } catch {}
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
let strictExit = 0, strictJson = {};
try {
  execFileSync("node", [DESIGN_GATE, "--root", noGit, "--base", "no-such-ref", "--strict", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  strictExit = e.status || 1;
  try { strictJson = JSON.parse(String(e.stdout || "{}")); } catch {}
}
ok(strictExit === 1 && strictJson.skipped === true && strictJson.ok === false,
  "design-gate --strict: недоступная база diff -> fail-closed для CI");
try { fs.rmSync(noGit, { recursive: true, force: true }); } catch {}
try { fs.rmSync(dtmp, { recursive: true, force: true }); } catch {}

// ---------- verify runner ----------
console.log("\nverify runner:");
function verifyExit(root) {
  try { execFileSync("node", [VERIFY, "--root", root], { encoding: "utf8", stdio: "pipe", maxBuffer: 8 * 1024 * 1024 }); return 0; }
  catch (e) { return e.status || 1; }
}
function verifyOutput(root) {
  try { return execFileSync("node", [VERIFY, "--root", root], { encoding: "utf8", stdio: "pipe", maxBuffer: 8 * 1024 * 1024 }); }
  catch (e) { return String(e.stdout || "") + String(e.stderr || ""); }
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
const dotnetPlan = verifyList(vtmp).plan.find((p) => p.stack === "dotnet");
ok(dotnetPlan && dotnetPlan.steps.includes("format"), "dotnet verify включает format");
ok(/dotnet format --verify-no-changes[^}]*optional:\s*true/.test(readRepo("hooks/verify.js")),
  "dotnet format --verify-no-changes staged rollout: warning-only by default");
const etmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifyexec-"));
fs.writeFileSync(path.join(etmp, "m.txt"), "x");
fs.writeFileSync(path.join(etmp, "stepA.js"), "process.exit(0)");
fs.writeFileSync(path.join(etmp, "stepB.js"), "require('fs').writeFileSync('ran_b','1');console.error('error WHITESPACE: fix me');process.exit(2)");
fs.writeFileSync(path.join(etmp, "stepC.js"), "require('fs').writeFileSync('ran_c','1')");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { failFast: true, stacks: [{ id: "t", markers: ["m.txt"], steps: [
  { name: "a", run: "node stepA.js" }, { name: "b", run: "node stepB.js" }, { name: "c", run: "node stepC.js" }] }] } }));
ok(verifyExit(etmp) === 1, "verify падает на провале обязательного шага");
ok(fs.existsSync(path.join(etmp, "ran_b")) && !fs.existsSync(path.join(etmp, "ran_c")),
  "fail-fast: шаг после провала не запускается");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "opt", run: "node stepB.js", optional: true }] }] } }));
ok(verifyExit(etmp) === 0, "optional-шаг падает -> warning, не провал");
const optOut = verifyOutput(etmp);
ok(/optional warnings[\s\S]*error WHITESPACE: fix me[\s\S]*verify summary[\s\S]*VERIFY passed\.\s*$/.test(optOut),
  "verify UX: optional diagnostics excerpt appears before summary/final passed");
fs.writeFileSync(path.join(etmp, "big.js"), "process.stdout.write('x'.repeat(2 * 1024 * 1024));");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "big", run: "node big.js" }] }] } }));
ok(verifyExit(etmp) === 0, "required step с большим stdout проходит без spawnSync maxBuffer failure");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "ok2", run: "node stepB.js", okCodes: { 2: "допустимо" } }] }] } }));
ok(verifyExit(etmp) === 0, "okCodes: допустимый ненулевой exit (напр. pytest 5 «нет тестов») -> warning, не провал");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "missing", run: "definitely_missing_harness_cmd_zzzz" }] }] } }));
ok(verifyExit(etmp) === 1, "missing required command -> clear VERIFY failure");
fs.writeFileSync(path.join(etmp, "slow.js"), "setTimeout(() => {}, 5000);\n");
fs.writeFileSync(path.join(etmp, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "t", markers: ["m.txt"], steps: [{ name: "slow", run: "node slow.js", timeoutMs: 50 }] }] } }));
ok(/timeout after 50ms/.test(verifyOutput(etmp)), "verify timeout: hung step is killed and reported clearly");

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
fs.mkdirSync(path.join(ctmp, "hooks")); fs.writeFileSync(path.join(ctmp, "hooks", "verify.js"), "console.log('fake verify');\n");
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
ok(allIds === "node,python" && fbIds === "harness,node,python",
  "--changed fail-safe: недоступная база diff -> все стеки + harness checks (не молчаливый пропуск)");
chg = verifyListArgs(ctmp, ["--changed", "--files", "hooks/verify.js"]);
ok(chg.plan.some((p) => p.stack === "harness"),
  "--changed: изменение hooks/** запускает harness checks даже без package.json");
try { fs.rmSync(ctmp, { recursive: true, force: true }); } catch {}

const dirtyTmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verifydirty-"));
function dgit(args) { return execFileSync("git", args, { cwd: dirtyTmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function dwrite(rel, text) {
  const p = path.join(dirtyTmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
dgit(["init", "-q", "-b", "main"]);
dgit(["config", "user.name", "Harness Test"]);
dgit(["config", "user.email", "harness@example.test"]);
dwrite("hooks/verify.js", "console.log('base');\n");
dwrite("js/package.json", "{}\n");
dgit(["add", "."]);
dgit(["commit", "-q", "-m", "chore: base"]);
dwrite("hooks/verify.js", "console.log('dirty');\n");
chg = verifyListArgs(dirtyTmp, ["--changed"]);
ok(chg.plan.some((p) => p.stack === "harness"), "--changed: unstaged harness edit is included");
dgit(["add", "hooks/verify.js"]);
chg = verifyListArgs(dirtyTmp, ["--changed"]);
ok(chg.plan.some((p) => p.stack === "harness"), "--changed: staged harness edit is included");
dwrite("hooks/new-check.js", "console.log('new');\n");
chg = verifyListArgs(dirtyTmp, ["--changed"]);
ok(chg.plan.some((p) => p.stack === "harness"), "--changed: untracked harness file is included");
try { fs.rmSync(dirtyTmp, { recursive: true, force: true }); } catch {}

try { fs.rmSync(vtmp, { recursive: true, force: true }); fs.rmSync(etmp, { recursive: true, force: true }); } catch {}

// ---------- debug-аудит изменённых файлов ----------
console.log("\ndebug-audit:");
const dbgtmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dbgaudit-"));
fs.writeFileSync(path.join(dbgtmp, "clean.js"), "const x = 1;\nmodule.exports = x;\n");
fs.writeFileSync(path.join(dbgtmp, "bad.js"), "function f(){ debugger; return 1; }\n");
fs.writeFileSync(path.join(dbgtmp, "softy.js"), "console.log('hi');\n");
fs.writeFileSync(path.join(dbgtmp, "bp.js"), "breakpoint();\n");
fs.writeFileSync(path.join(dbgtmp, "bad.py"), "import pdb; pdb.set_trace()\n");
fs.mkdirSync(path.join(dbgtmp, "hooks"), { recursive: true });
fs.writeFileSync(path.join(dbgtmp, "hooks", "bad-hook.js"), "function f(){ debugger; return 1; }\n");
fs.writeFileSync(path.join(dbgtmp, "hooks", "fixture.js"), "const fixture = \"debugger;\";\n");
fs.writeFileSync(path.join(dbgtmp, "hooks", "comment.js"), "// debugger;\nconst x = 1;\n");
// verify с --files: аудит сканирует именно эти файлы (без git), стеков в dbgtmp нет.
function dbgExit(files, cfg) {
  fs.writeFileSync(path.join(dbgtmp, "harness.config.json"), JSON.stringify(cfg || {}));
  return verifyExitArgs(dbgtmp, ["--files", files]);
}
ok(dbgExit("bad.js", {}) === 1, "debug-аудит: debugger в изменённом .js -> VERIFY падает");
ok(dbgExit("clean.js", {}) === 0, "debug-аудит: чистый изменённый файл -> VERIFY проходит");
ok(dbgExit("bad.py", {}) === 1, "debug-аудит: pdb.set_trace в изменённом .py -> падает");
ok(dbgExit("bp.js", {}) === 0, "debug-аудит: breakpoint в .js НЕ ловится (маркер привязан к .py) — защита от FP");
ok(dbgExit("softy.js", {}) === 0, "debug-аудит: console.log при soft=false -> не падение");
ok(dbgExit("softy.js", { debugAudit: { soft: true } }) === 0, "debug-аудит: console.log при soft=true -> заметка, но не падение");
ok(dbgExit("bad.js", { debugAudit: { exclude: ["bad.js"] } }) === 0, "debug-аудит: exclude-глоб пропускает файл с hard-маркером");
ok(dbgExit("bad.js", { debugAudit: { enabled: false } }) === 0, "debug-аудит: enabled=false отключает аудит");
ok(dbgExit("hooks/bad-hook.js", {}) === 1, "debug-аудит: hooks/** больше не исключён из hard-аудита");
ok(dbgExit("hooks/fixture.js", {}) === 0, "debug-аудит: hard-маркер внутри строкового fixture не даёт self-FP");
ok(dbgExit("hooks/comment.js", {}) === 0, "debug-аудит: hard-маркер внутри комментария не даёт self-FP");
ok(verifyExitArgs(dbgtmp, ["--strict-audit"]) === 1, "debug-аудит: --strict-audit валит VERIFY, если diff scope недоступен");
try { fs.rmSync(dbgtmp, { recursive: true, force: true }); } catch {}

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
const bootRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-bootstrap-"));
execFileSync("git", ["init", "-q"], { cwd: bootRepo });
try { execFileSync("node", [path.join(REPO, "install.js"), "--target", bootRepo, "--json"], { encoding: "utf8", stdio: "pipe" }); } catch {}
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /harness not bootstrapped/.test(r.msg) && /untracked:/.test(r.msg) && r.level === "FAIL"),
  "doctor: untracked harness-файлы -> FAIL с bootstrap-сообщением");
execFileSync("git", ["add", "."], { cwd: bootRepo });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /harness bootstrap files present and tracked/.test(r.msg) && r.level === "PASS"),
  "doctor: tracked harness-файлы -> PASS bootstrap-проверки");
fs.mkdirSync(path.join(bootRepo, ".github", "workflows"), { recursive: true });
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"), "name: verify\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/verify.js\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /ruleset required check\(s\) not published/.test(r.msg) && /verify/.test(r.msg) && /build/.test(r.msg) && r.level === "FAIL"),
  "doctor: ruleset requires verify but workflow job is build -> FAIL");
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"), "name: verify\njobs:\n  verify:\n    name: build label can differ\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/verify.js\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /does not run required harness step/.test(r.msg) && /doctor/.test(r.msg) && /design-gate strict/.test(r.msg) && /secret scan/.test(r.msg) && r.level === "FAIL"),
  "doctor: job id verify без полного harness-контракта -> FAIL");
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"),
  "name: verify\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/doctor.js\n      - uses: gitleaks/gitleaks-action@v2\n      - run: node hooks/verify.js\n      - run: node hooks/design-gate.js --strict --base origin/main\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /CI job verify runs doctor, verify\.js, design-gate --strict and secret scan/.test(r.msg) && r.level === "PASS"),
  "doctor: required verify job с полным harness-контрактом -> PASS");
fs.writeFileSync(path.join(bootRepo, ".github", "workflows", "ci.yml"),
  "name: verify\njobs:\n  \"verify\": # quoted job id is valid YAML\n    name: build label can differ\n    runs-on: ubuntu-latest\n    steps:\n      - run: node hooks/doctor.js\n      - uses: gitleaks/gitleaks-action@v2\n      - run: node hooks/verify.js\n      - run: node hooks/design-gate.js --strict --base origin/main\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /CI job verify runs doctor, verify\.js, design-gate --strict and secret scan/.test(r.msg) && r.level === "PASS"),
  "doctor: valid YAML variant с quoted job id/comment -> PASS");
fs.writeFileSync(path.join(bootRepo, "hooks", "test.js"), "console.log('self-test');\n");
fs.writeFileSync(path.join(bootRepo, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "harness", markers: ["test.js"], steps: [{ name: "noop", run: "node -e \"0\"" }] }] } }, null, 2) + "\n");
execFileSync("git", ["add", "."], { cwd: bootRepo });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /verify\.stacks.*harness self-test/.test(r.msg) && r.level === "FAIL"),
  "doctor: verify.stacks не может убрать обязательный harness self-test");
fs.writeFileSync(path.join(bootRepo, "harness.config.json"), JSON.stringify({ verify: { stacks: [{ id: "harness", markers: ["test.js"], steps: [{ name: "self-test", run: "node test.js" }] }] } }, null, 2) + "\n");
fs.writeFileSync(path.join(bootRepo, "AGENTS.md"), "line one\r\nline two\r\n");
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /AGENTS\.md: CRLF\/CR line endings/.test(r.msg) && r.level === "FAIL"),
  "doctor: CRLF в critical harness-файле -> FAIL");
fs.writeFileSync(path.join(bootRepo, "AGENTS.md"), "line one\nline two\n");
fs.rmSync(path.join(bootRepo, ".github"), { recursive: true, force: true });
fs.rmSync(path.join(bootRepo, "hooks", "apply-ruleset.js"), { force: true });
execFileSync("git", ["add", "-A"], { cwd: bootRepo });
dres = doctor(bootRepo);
ok((dres.results || []).some((r) => /harness not bootstrapped/.test(r.msg) && /\.github\/rulesets\/main\.json/.test(r.msg) && /hooks\/apply-ruleset\.js/.test(r.msg) && r.level === "FAIL"),
  "doctor: missing tracked server-enforcement files -> FAIL bootstrap-проверки");
try { fs.rmSync(bootRepo, { recursive: true, force: true }); } catch {}

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
stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(stopOut.trim() === "", "повторный Stop с тем же dirty status -> молчит (осознанное завершение)");
fs.writeFileSync(path.join(stopRepo, "another.txt"), "x");
stopOut = hookOutput(STOP, {}, { HARNESS_PROJECT_DIR: stopRepo });
ok(/another\.txt/.test(stopOut) && /"decision"\s*:\s*"block"/.test(stopOut),
  "изменился dirty status -> stop-reminder напоминает снова");
stopOut = hookOutput(STOP, { stop_hook_active: true }, { HARNESS_PROJECT_DIR: stopRepo });
ok(stopOut.trim() === "", "stop_hook_active=true -> молчит (защита от вечного block-цикла)");
try { fs.rmSync(stopRepo, { recursive: true, force: true }); } catch {}
const stopRepo2 = fs.mkdtempSync(path.join(os.tmpdir(), "harness-stop-explained-"));
execFileSync("git", ["init", "-q"], { cwd: stopRepo2 });
fs.mkdirSync(path.join(stopRepo2, "hooks"), { recursive: true });
fs.writeFileSync(path.join(stopRepo2, "hooks", "verify.js"), "x");
fs.writeFileSync(path.join(stopRepo2, ".gitignore"), "x");
const transcript = path.join(os.tmpdir(), "harness-stop-transcript-" + process.pid + ".jsonl");
fs.writeFileSync(transcript, JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: "VERIFY проверено, commit создан. Оставшиеся uncommitted bootstrap/harness/local файлы оставлены намеренно и не относятся к правке." },
}) + "\n");
stopOut = hookOutput(STOP, { transcript_path: transcript }, { HARNESS_PROJECT_DIR: stopRepo2 });
ok(stopOut.trim() === "", "dirty только harness/local + отчёт объясняет intentional uncommitted -> Stop молчит");
try { fs.rmSync(stopRepo2, { recursive: true, force: true }); fs.rmSync(transcript, { force: true }); } catch {}
const stopRepo3 = fs.mkdtempSync(path.join(os.tmpdir(), "harness-stop-review-"));
execFileSync("git", ["init", "-q"], { cwd: stopRepo3 });
fs.writeFileSync(path.join(stopRepo3, ".gitattributes"), "x");
const transcript2 = path.join(os.tmpdir(), "harness-stop-review-transcript-" + process.pid + ".jsonl");
fs.writeFileSync(transcript2, JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: "Повторный review завершён: изменения я не правил и не коммитил. VERIFY проверено частично, commit/PR не делал, потому что задача была именно на ревью." },
}) + "\n");
stopOut = hookOutput(STOP, { transcript_path: transcript2 }, { HARNESS_PROJECT_DIR: stopRepo3 });
ok(stopOut.trim() === "", "review-only отчёт объясняет dirty tree -> Stop не перекрывает финальный ответ");
try { fs.rmSync(stopRepo3, { recursive: true, force: true }); fs.rmSync(transcript2, { force: true }); } catch {}

// ---------- installer (install.js) ----------
console.log("\ninstaller:");
const INSTALL = path.join(REPO, "install.js");
function installJson(target, extra) {
  try {
    const s = execFileSync("node", [INSTALL, "--target", target, "--json", ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(s);
  } catch (e) { try { return JSON.parse(String(e.stdout || "{}")); } catch { return {}; } }
}
const itmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-"));
execFileSync("git", ["init", "-q"], { cwd: itmp });
// dry-run: план есть, диск не тронут
let plan = installJson(itmp, ["--dry-run"]);
ok(plan.ok === true && plan.mode === "install", "install --dry-run: ok, режим install");
ok(Array.isArray(plan.files) && plan.files.some((f) => /agent\/guard\.js/.test(f.rel)), "dry-run план включает hooks/agent/guard.js");
ok(!fs.existsSync(path.join(itmp, "hooks", "agent", "guard.js")), "dry-run ничего не пишет на диск");
// реальная установка
installJson(itmp, []);
ok(fs.existsSync(path.join(itmp, "hooks", "agent", "guard.js")) && fs.existsSync(path.join(itmp, "hooks", "branch-guard.js")) && fs.existsSync(path.join(itmp, "hooks", "no-coauthor.js")) && fs.existsSync(path.join(itmp, "lefthook.yml")), "install: хуки и конфиги скопированы");
ok(!fs.existsSync(path.join(itmp, "hooks", "test.js")), "install: dev-self-test (test.js) в target НЕ копируется");
const tcfg = JSON.parse(fs.readFileSync(path.join(itmp, "harness.config.json"), "utf8"));
ok(!tcfg.verify && Array.isArray(tcfg.ui.globs), "install: сгенерён config без self-test-пина verify (target авто-детектит стеки)");
const tset = JSON.parse(fs.readFileSync(path.join(itmp, ".claude", "settings.json"), "utf8"));
ok(/guard\.js/.test(JSON.stringify(tset.hooks.PreToolUse)), "install: guard вплетён в PreToolUse");
ok(/stop-reminder\.js/.test(JSON.stringify(tset.hooks.Stop)), "install: stop-reminder вплетён в Stop");
// .gitignore: игнорируется ТОЛЬКО персональный settings.local.json, не файлы харнесса
const gi = fs.readFileSync(path.join(itmp, ".gitignore"), "utf8");
ok(/\.claude\/settings\.local\.json/.test(gi), "install: .gitignore получает .claude/settings.local.json");
ok(!/^hooks\//m.test(gi) && !/lefthook\.yml/.test(gi) && !/harness\.config/.test(gi),
  "install: файлы харнесса в .gitignore НЕ попадают (они коммитятся)");
installJson(itmp, []);
const gi2 = fs.readFileSync(path.join(itmp, ".gitignore"), "utf8");
ok((gi2.match(/settings\.local\.json/g) || []).length === 1, "повторный install не дублирует строку в .gitignore");

// идемпотентность: повторный install не дублирует hook-записи
const preLen = tset.hooks.PreToolUse.length;
installJson(itmp, []);
const tset2 = JSON.parse(fs.readFileSync(path.join(itmp, ".claude", "settings.json"), "utf8"));
ok(tset2.hooks.PreToolUse.length === preLen, "повторный install идемпотентен (hook-записи не дублируются)");
// не затирает существующий файл без --force, затирает с --force
const gp = path.join(itmp, "hooks", "agent", "guard.js");
fs.writeFileSync(gp, "// local edit\n");
installJson(itmp, []);
ok(fs.readFileSync(gp, "utf8") === "// local edit\n", "install без --force не перезатирает существующий файл");
installJson(itmp, ["--force"]);
ok(fs.readFileSync(gp, "utf8") !== "// local edit\n", "install --force перезаписывает файлы харнесса");
// мерж settings.json сохраняет чужие ключи
const dstSet = path.join(itmp, ".claude", "settings.json");
const cur = JSON.parse(fs.readFileSync(dstSet, "utf8")); cur.model = "opus"; fs.writeFileSync(dstSet, JSON.stringify(cur));
installJson(itmp, []);
ok(JSON.parse(fs.readFileSync(dstSet, "utf8")).model === "opus", "install мержит settings.json, сохраняя чужие ключи (не затирает)");
// невалидный чужой settings.json — не трогаем, а сообщаем
fs.writeFileSync(dstSet, "{ broken");
const br = installJson(itmp, []);
ok(br.settings && br.settings.status === "error", "невалидный .claude/settings.json → ошибка мержа, файл не тронут");
ok(fs.readFileSync(dstSet, "utf8") === "{ broken", "невалидный settings.json остался как был (не затёрт)");
// не-git каталог → нота, но установка файлов проходит
const nogit = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-nogit-"));
const ng = installJson(nogit, []);
ok(Array.isArray(ng.notes) && ng.notes.some((n) => /git-репозиторий/.test(n)), "не-git target → нота про git init");
ok(ng.ok === false && /fully enforceable/.test(ng.reason || ""), "install: activation/doctor failure делает JSON ok=false");
try { fs.rmSync(itmp, { recursive: true, force: true }); fs.rmSync(nogit, { recursive: true, force: true }); } catch {}

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

// ---------- гигиена: целостность ключевых доков ----------
// Ловит обрезанный/битый markdown (регрессия 99bf0c7: AGENTS.md обрубился посреди
// таблицы битым UTF-8 байтом, потеряв секцию ## Env). Обрезанный многобайтный хвост
// не переживает decode→encode roundtrip и даёт U+FFFD — проверяем оба признака.
console.log("\ndocs integrity:");
function docCheck(rel) {
  let buf;
  try { buf = fs.readFileSync(path.join(REPO, rel)); } catch { return { exists: false }; }
  let text = "", roundtrips = false;
  try { text = buf.toString("utf8"); roundtrips = Buffer.from(text, "utf8").equals(buf); } catch {}
  return {
    exists: true,
    endsNewline: buf.length > 0 && buf[buf.length - 1] === 10,
    noReplacement: !buf.includes(Buffer.from("�")),
    validUtf8: roundtrips,
    text,
  };
}
for (const rel of ["AGENTS.md", "README.md"]) {
  const d = docCheck(rel);
  ok(d.exists, rel + ": присутствует");
  ok(d.exists && d.endsNewline, rel + ": заканчивается переводом строки (не обрезан на полуслове)");
  ok(d.exists && d.validUtf8, rel + ": валидный UTF-8, без обрезанного многобайтного хвоста");
  ok(d.exists && d.noReplacement, rel + ": нет U+FFFD (маркера битых байт)");
}
const agentsDoc = docCheck("AGENTS.md");
ok(agentsDoc.exists && /^##\s+Env\b/m.test(agentsDoc.text),
  "AGENTS.md содержит секцию ## Env (референс env-переменных, на неё ссылается guard.js)");

try { fs.rmSync(NEUTRAL, { recursive: true, force: true }); } catch {}
console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
