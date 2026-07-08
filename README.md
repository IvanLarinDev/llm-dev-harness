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
Флаги: `--force` (обновить уже существующие файлы), `--with-ci` (положить и `.github/`:
CI-зеркало, CODEOWNERS, dependabot), `--with-ruleset` (сразу применить серверный ruleset,
нужен gh admin), `--json` (машиночитаемый отчёт).

Что делает установщик по слоям: слой 1 — `lefthook install` (git-хуки для любого
агента/человека); слой 2 — вплетает `guard.js` на PreToolUse и `stop-reminder.js` на Stop
(контракт: exit 0 = allow, exit 2 = block; notes — `hookSpecificOutput.additionalContext`,
Stop — `{"decision":"block","reason":…}`). Слой 0 (реальный enforcement, серверный ruleset)
остаётся ручным шагом `node hooks/apply-ruleset.js` — нужен gh с admin-правами и план
Pro/публичный репо.

Вручную то же самое: `lefthook install`, скопировать блок `hooks` из
[`settings.example.json`](./settings.example.json) в `.claude/settings.json`,
`node hooks/apply-ruleset.js`, `node hooks/doctor.js`.

## Проверка

```bash
node hooks/test.js                     # self-test suite харнесса
node hooks/verify.js [--list]          # исполняемый VERIFY (авто-детект стеков)
node hooks/design-gate.js --base main  # DESIGN-гейт по diff ветки
node hooks/doctor.js                   # окружение
node hooks/apply-ruleset.js --dry-run  # показать ruleset без применения
```

CI: `.github/workflows/ci.yml` (job `verify` = required-check контекст в ruleset).
Слои, DESIGN-стадия, release flow и env-переменные — в [`AGENTS.md`](./AGENTS.md).
