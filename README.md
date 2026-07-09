# llm-dev-harness

Экономичный dev-loop харнесс для агентных правок кода — работает с **любой LLM/раннером**.
Каждый заход в код идёт через один цикл (EXPLORE → PLAN → IMPLEMENT+TEST → VERIFY →
COMMIT → PR → REPORT), и цикл гарантируется исполняемыми хуками, а не инструкциями.
**Канонический документ — [`AGENTS.md`](./AGENTS.md)**: loop, правила этапов, слои,
release flow, env-переменные. Здесь — только стек и установка.

> **Честная граница.** Локальные хуки — **гигиена** (ловят ошибки и небрежность до
> коммита), а не защита от состязательного агента: у агента write-доступ к рабочему
> дереву, и намеренный обход (подстановки переменных, кавычки-конкатенация) regex-слоем
> не ловится. **Настоящий enforcement — только серверный ruleset**
> (`.github/rulesets/main.json`; required-check запинен на GitHub Actions через
> `integration_id`, иначе статус подделывается через API).

## Стек

Commit-lint / secret-scan / release / hook-раннер делегированы зрелым инструментам.
Своё — только то, чего у них нет: verify-раннер, design-гейт и agent-хук.

| Задача | Инструмент | Конфиг |
|--------|-----------|--------|
| Git-hook раннер | **lefthook** | [`lefthook.yml`](./lefthook.yml) |
| Секреты | **gitleaks** | [`.gitleaks.toml`](./.gitleaks.toml) |
| Conventional Commits + SemVer + CHANGELOG | **cocogitto** (`cog`) | [`cog.toml`](./cog.toml) |
| **Реальный enforcement** (require PR + check, block force-push) | **GitHub ruleset** | [`.github/rulesets/main.json`](./.github/rulesets/main.json) |
| VERIFY (мульти-стек lint/build/test) | *своё* | [`hooks/verify.js`](./hooks/verify.js) |
| GUI DESIGN-гейт | *своё* | [`hooks/design-gate.js`](./hooks/design-gate.js) |
| Agent-хук (обход/циклы/подсказки) | *своё* | [`hooks/agent/guard.js`](./hooks/agent/guard.js) |
| Security-аудит конфигурации агента (advisory) | **ecc-agentshield** (npx, прибитая версия) | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) |

Общие хелперы хуков (глобы, конфиг, нормализация путей) — [`hooks/_lib.js`](./hooks/_lib.js).

## Установка

В один клик — установщик [`install.js`](./install.js) кладёт хуки и конфиги в целевой
репозиторий, генерит `harness.config.json`, вплетает agent-guard в
`.claude/settings.json` (мержем, не затирая чужое), ставит lefthook-хуки и прогоняет
doctor. Идемпотентно, без внешних зависимостей.

```bash
node install.js --target ../my-project   # поставить харнесс в другой проект
node install.js                          # или в текущий каталог
node install.js --dry-run                # показать план, ничего не писать
```

Двойным кликом: `install.cmd` (Windows) или `install.sh` (POSIX) — ставят в свою папку.
Флаги: `--force` (обновить уже существующие файлы), `--with-ci` (добавить опциональный
dependabot; CI-зеркало, CODEOWNERS и ruleset ставятся по умолчанию), `--with-ruleset`
(сразу применить серверный ruleset, нужен gh admin), `--json` (машиночитаемый отчёт).

Что делает установщик по слоям: слой 1 — `lefthook install` (git-хуки для любого
агента/человека); слой 2 — вплетает `guard.js` на PreToolUse и `stop-reminder.js` на Stop
(контракт: exit 0 = allow, exit 2 = block; notes — `hookSpecificOutput.additionalContext`,
Stop — `{"decision":"block","reason":…}`). Слой 0 (реальный enforcement, серверный ruleset)
остаётся ручным шагом `node hooks/apply-ruleset.js` — нужен gh с admin-правами и план
Pro/публичный репо.

`stop-reminder.js` — именно reminder: первый Stop при dirty tree возвращает
`decision:block`, но повторный Stop с тем же `git status` пропускается. Это оставляет
выход для намеренно uncommitted bootstrap/local файлов после явного отчёта.

### Bootstrap PR

После установки в целевой репозиторий файлы харнесса нужно закоммитить в `main`
через отдельный bootstrap PR до того, как loop станет обязательным. Иначе инструкции
будут требовать `node hooks/verify.js` или `cog bump --auto`, которых нет в clean
worktree от `origin/main`.

Проверка:

```bash
node hooks/doctor.js
git ls-files hooks/verify.js cog.toml lefthook.yml AGENTS.md harness.config.json
```

Если doctor пишет `harness not bootstrapped` или файлы видны как untracked, сначала
закрой bootstrap PR. Release из такого состояния делать нельзя: clean release
worktree не воспроизведёт локальные untracked файлы.

Про `.gitignore`: файлы харнесса (`hooks/`, `lefthook.yml`, конфиги, `.github/`,
`harness.config.json`) **коммитятся** — иначе на свежем клоне у lefthook, CI и
серверного ruleset не будет кода проверок. Установщик добавляет в `.gitignore`
целевого проекта только персональный `.claude/settings.local.json` (разрешения
раннера, у каждого свои). Состояние guard живёт в системном tmp и в репозиторий
не пишется.

Вручную то же самое: `lefthook install`, скопировать блок `hooks` из
[`settings.example.json`](./settings.example.json) в `.claude/settings.json`,
`node hooks/apply-ruleset.js`, `node hooks/doctor.js`.

## Проверка

```bash
node hooks/test.js                     # self-test suite харнесса
node hooks/verify.js [--list]          # исполняемый VERIFY (авто-детект стеков)
node hooks/design-gate.js --base origin/main # DESIGN-гейт по diff ветки
node hooks/doctor.js                   # окружение
node hooks/apply-ruleset.js --dry-run  # показать ruleset без применения
```

Windows-safe диагностика lefthook из PowerShell:

```powershell
lefthook.cmd run pre-commit --command branch-guard --force --verbose
$msg = Join-Path $env:TEMP "commit-msg.txt"; Set-Content $msg "fix(hooks): test"; lefthook.cmd run commit-msg $msg --command no-coauthor --force --verbose
```

Используй `--command` (singular). Если PowerShell блокирует `lefthook.ps1`
ExecutionPolicy, запускай `lefthook.cmd` или напрямую:

```powershell
node "$env:APPDATA\npm\node_modules\lefthook\bin\index.js" run pre-commit --command branch-guard --force --verbose
node "$env:APPDATA\npm\node_modules\lefthook\bin\index.js" run commit-msg $msg --command no-coauthor --force --verbose
```

CI: `.github/workflows/ci.yml` (job `verify` = required-check контекст в ruleset).
Слои, DESIGN-стадия, release flow и env-переменные — в [`AGENTS.md`](./AGENTS.md).
