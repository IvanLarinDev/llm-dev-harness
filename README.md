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
node hooks/test.js                    # unit + integration self-tests (временный git-репо)
node hooks/verify.js                  # исполняемый VERIFY: авто-детект стеков → lint/build/test
node hooks/verify.js --list           # показать план без запуска
node hooks/design-gate.js --base main # DESIGN-гейт: UI-изменения требуют ≥4 одобренных мокапа
node hooks/lint-commits.js --base main # conventional-commits + no-coauthor по коммитам ветки
node hooks/secret-scan.js --all        # поиск секретов (private keys, токены, high-entropy)
node hooks/setup-signing.js            # (opt-in) включить SSH-подпись коммитов в этом репо
node hooks/doctor.js                   # проверка окружения (hooksPath, LF/NUL, config, identity)
node hooks/quality-gate.js --base main # AI-code гигиена: конфликт-маркеры, гигантские файлы
node hooks/commit.js                   # интерактивный conventional-commit (или --type/--subject)
node hooks/release.js                  # dry-run: next SemVer + CHANGELOG (--tag создаёт тег, без push)
```

## Безопасность / supply-chain

- **secret-scan** встроен в git-native `pre-commit` — коммит с секретом (AWS/GitHub/Google/Slack/
  Stripe токен, private key, high-entropy значение) блокируется. Ложное срабатывание — метка
  `secret-scan:allow` в строке.
- **Signed commits**: `node hooks/setup-signing.js` включает SSH-подпись (усиливает политику
  «коммиты как от автора»). Жёсткое требование подписи — через ruleset (нужен Pro/public).
- **CODEOWNERS** (`.github/CODEOWNERS`) + **Dependabot** (`.github/dependabot.yml`), Actions в
  `ci.yml` запиннены на commit-SHA. На Free+private ревью по CODEOWNERS совещательны.

## CI (серверное зеркало)

`.github/workflows/ci.yml` гоняет те же проверки (`verify.js` + `lint-commits.js` + `design-gate.js`)
на push/PR — там, где `--no-verify` их уже не пропустит. На **GitHub Free + private** workflow
запускается и показывает статус, но **не может быть required** (не блокирует merge); required-check
и ruleset требуют Pro/Team или публичного репо.

## VERIFY (мульти-стек)

`hooks/verify.js` делает шаг VERIFY исполняемым. Он определяет стеки по маркер-файлам и гоняет
lint→build→test **fail-fast** с warnings-as-errors по умолчанию:

| Стек | Маркер | Шаги по умолчанию |
|------|--------|-------------------|
| Python/Qt | `pyproject.toml`/`requirements.txt`/`setup.py` | `ruff check` · `ruff format --check` · `pytest -q` |
| C#/WPF | `*.sln`/`*.csproj` | `dotnet format --verify-no-changes` · `dotnet build -warnaserror` · `dotnet test` |
| Rust/Tauri | `Cargo.toml` | `cargo fmt --check` · `cargo clippy -- -D warnings` · `cargo test` |
| Node (фронт Tauri и пр.) | `package.json` | `npm run lint/build/test --if-present` |

Переопределение — в `harness.config.json` → `verify.stacks` (если задать, авто-детект отключается).
Монорепо поддерживается: шаги запускаются в каталоге каждого найденного маркера.

## GUI: DESIGN-стадия (≥4 мокапа)

Для UI-работы (`*.ui`, `*.qml`, каталоги `ui/`/`views/`/`widgets/` — см. `harness.config.json`)
харнесс требует **≥4 стилистически разных мокапа + approval до кода**:

```bash
node hooks/new-mockups.js <feature>   # создаст design/mockups/<feature>/ с 4 HTML-мокапами
# довести макеты → выбрать направление → создать пустой design/mockups/<feature>/APPROVED
```

`hooks/design-gate.js` (в VERIFY/CI) блокирует UI-изменения без одобренного набора; подробности —
в `design/mockups/README.md`.

## Конфигурация (env)

| Переменная | Назначение | По умолчанию |
|------------|-----------|--------------|
| `HARNESS_ALLOW_MAIN=1` | Разрешить коммит/пуш на `main` (релиз/hotfix/bootstrap) | — |
| `HARNESS_ACK_BYPASS=1` | Осознанно разрешить обход хуков агентом (`--no-verify` и т.п.) | — |
| `HARNESS_LOOP_THRESHOLD` | Порог блокировки loop-guard | `5` |
| `HARNESS_SESSION_ID` / `HARNESS_PROJECT_DIR` | Если раннер не выставляет свои | автоопределение |
