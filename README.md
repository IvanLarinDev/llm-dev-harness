# llm-dev-harness

Экономичный dev-loop харнесс для агентных правок кода — работает с **любой LLM/раннером**.
Каждый заход в код идёт через один цикл (EXPLORE → PLAN → IMPLEMENT+TEST → VERIFY →
COMMIT → PR → REPORT), и цикл гарантируется исполняемыми хуками, а не инструкциями.
Полное описание — в [`AGENTS.md`](./AGENTS.md).

> **Честная граница.** Локальные хуки — **гигиена** (ловят ошибки до коммита), а не защита
> от состязательного агента: у агента write-доступ к рабочему дереву. **Настоящий
> enforcement — только серверный ruleset** (`.github/rulesets/main.json`).

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

## Установка

```bash
lefthook install               # слой 1: .git/hooks/* — срабатывает для любого агента/человека
node hooks/apply-ruleset.js    # слой 0: серверный ruleset (нужен gh + admin; Free — Pro/публичный репо)
node hooks/doctor.js           # проверить окружение: lefthook/gitleaks/cog в PATH, конфиги
```

Слой 2 (агент, опционально): скопировать блок `hooks` из
[`settings.example.json`](./settings.example.json) в `.claude/settings.json` —
это один хук `guard.js` на PreToolUse + условный `stop-reminder.js` на Stop.

## Три слоя

**0 — серверный ruleset (единственный настоящий гейт):** require PR, зелёный check
`verify`, блок force-push/delete main. `--no-verify` и правка локальных хуков его не обходят.

**1 — lefthook (гигиена):** commit-msg → `cog verify` + запрет соавторства;
pre-commit → gitleaks + запрет коммита на main; pre-push → `verify.js` + `design-gate.js`.
Escape (человеку): `HARNESS_ALLOW_MAIN=1` (релиз/hotfix), `LEFTHOOK=0` (разовый пропуск).

**2 — agent-adapter:** `guard.js` блокирует попытки агента обойти харнесс
(`--no-verify`, `core.hooksPath`, `LEFTHOOK=0`, правка `hooks/`/конфигов харнесса),
дегенеративные циклы (тривиальные серии, N× одно действие, чередование A-B-A-B) и
даёт ранние подсказки (main, DESIGN-стадия). Осознанный обход: `HARNESS_ACK_BYPASS=1`.

## Проверка

```bash
node hooks/test.js                     # self-test suite харнесса
node hooks/verify.js [--list]          # исполняемый VERIFY (авто-детект стеков)
node hooks/design-gate.js --base main  # DESIGN-гейт по diff ветки
node hooks/doctor.js                   # окружение
node hooks/apply-ruleset.js --dry-run  # показать ruleset без применения
```

## CI

`.github/workflows/ci.yml` (job `verify` — это контекст required-check в ruleset):
gitleaks + `cog check` + `verify.js` + `design-gate.js` на push в main и на PR.
На **GitHub Free + private** workflow работает, но required стать не может (BACKLOG P0-0).

## GUI: DESIGN-стадия

UI-изменение (глобы в [`harness.config.json`](./harness.config.json)) проходит pre-push/CI
только если в diff ветки затронут одобренный набор мокапов:

```bash
node hooks/new-mockups.js <feature>   # ≥4 стилистически разных HTML-мокапа
# показать пользователю → approval → создать design/mockups/<feature>/APPROVED
# повторное использование старого набора: дописать строку в его APPROVED
```

## Env

| Переменная | Назначение | Default |
|------------|-----------|---------|
| `HARNESS_ALLOW_MAIN=1` | коммит на main (релиз/hotfix) | — |
| `HARNESS_ACK_BYPASS=1` | одобренный пользователем обход guard.js | — |
| `HARNESS_LOOP_THRESHOLD` | порог циклов shell | `5` |
| `HARNESS_TOOLLOOP_THRESHOLD` | порог циклов file-tools | `12` |
| `LEFTHOOK=0` | пропуск lefthook (человек; агенту заблокирует guard) | — |
