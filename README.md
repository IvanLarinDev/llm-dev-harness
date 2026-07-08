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

Общие хелперы хуков (глобы, конфиг, нормализация путей) — [`hooks/_lib.js`](./hooks/_lib.js).

## Установка

```bash
lefthook install               # слой 1: .git/hooks/* — срабатывает для любого агента/человека
node hooks/apply-ruleset.js    # слой 0: серверный ruleset (нужен gh + admin; Free — Pro/публичный репо)
node hooks/doctor.js           # проверить окружение: lefthook/gitleaks/cog в PATH, конфиги
```

Слой 2 (агент, опционально): скопировать блок `hooks` из
[`settings.example.json`](./settings.example.json) в `.claude/settings.json` —
один хук `guard.js` на PreToolUse + условный `stop-reminder.js` на Stop.
Контракт хуков: exit 0 = allow, exit 2 = block; notes — `hookSpecificOutput.
additionalContext` (PreToolUse), Stop — `{"decision":"block","reason":…}`.

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
