# llm-dev-harness

Универсальный dev-loop харнесс для агентных правок кода — работает с **любой LLM/раннером**,
а не только с конкретным агентом. Заставляет каждый заход в код идти через один и тот же
проверенный цикл (EXPLORE → PLAN → IMPLEMENT+TEST → VERIFY → COMMIT → PR → REPORT) и
гарантирует его не инструкциями, а исполняемыми хуками.

Полное описание loop'а и release-flow — в [`AGENTS.md`](./AGENTS.md).

## Два слоя

**Слой 1 — git-native enforcement (`hooks/git/`).** Реальные git-хуки, подключаемые через
`core.hooksPath`. Срабатывают при самой git-операции — неважно, кто её запускает (Claude Code,
кастомный Agent SDK, Cursor, голый git в терминале). Это и делает харнесс LLM-агностичным.

| Хук | Что гарантирует | Аварийный обход |
|-----|-----------------|-----------------|
| `commit-msg` | Conventional Commits + запрет со-авторства (читает финальный файл сообщения → ловит `-m`, `-F`, heredoc, `$EDITOR`) | `git commit --no-verify` |
| `pre-commit` | Нет коммитов в `main`/`master` | `HARNESS_ALLOW_MAIN=1` или `--no-verify` |
| `pre-push` | Нет прямого пуша в `main`/`master` (теги и ветки — можно) | `HARNESS_ALLOW_MAIN=1 git push …` |

**Слой 2 — agent-adapter (`hooks/agent/`), опциональный.** Гигиена tool-loop'а, которую git
не видит: `loop-guard.js` (защита от runaway-цикла), `bypass-guard.js` (блок попыток агента
обойти harness — `--no-verify`, `core.hooksPath`), `branch-guard.js` (ранние подсказки,
warn-only), `stop-reminder.js`. Вход — нормализованный JSON (`_input.js` понимает разные
имена полей), поэтому подключается к любому раннеру через exit-код: `2` = блок, `0` = пропуск.
Пример подключения для Claude Code — в [`settings.example.json`](./settings.example.json).

## Установка

```bash
node hooks/install.js     # git config core.hooksPath hooks/git
```

Требование: Node в PATH (на Windows git-хуки исполняются через bash из Git-for-Windows).
Агент-слой (опционально): скопировать блок `hooks` из `settings.example.json` в `.claude/settings.json`.

## Проверка

```bash
node hooks/test.js        # unit + integration self-tests (создаёт временный git-репо)
```

## Конфигурация (env)

| Переменная | Назначение | По умолчанию |
|------------|-----------|--------------|
| `HARNESS_ALLOW_MAIN=1` | Разрешить коммит/пуш на `main` (релиз/hotfix/bootstrap) | — |
| `HARNESS_ACK_BYPASS=1` | Осознанно разрешить обход хуков агентом (`--no-verify` и т.п.) | — |
| `HARNESS_LOOP_THRESHOLD` | Порог блокировки loop-guard | `5` |
| `HARNESS_SESSION_ID` / `HARNESS_PROJECT_DIR` | Если раннер не выставляет свои | автоопределение |
