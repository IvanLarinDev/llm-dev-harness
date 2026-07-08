# AGENTS.md — Dev Loop

> Каждый заход агента в код идёт через один цикл. Всё, что можно проверить кодом,
> гарантируют хуки (см. «Слои харнесса»); здесь остаётся только то, что хуками не покрыть.

## Loop

```
1. EXPLORE          — изучить кодбазу, паттерны, риски
2. PLAN             — план → ⏸ APPROVAL пользователя
2.5 DESIGN (GUI)    — ≥4 мокапа → ⏸ APPROVAL → файл APPROVED
3. IMPLEMENT+TEST   — код + тесты вместе (edge cases как тесты)
4. VERIFY           — node hooks/verify.js + чтение вывода + git diff self-review
   ├─ провал/новые warnings → вернуться к 3
   └─ зелёное               → шаг 5
5. COMMIT on branch → PR (не в main)
6. REPORT           — изменено / проверено / осталось / как тестировать
7. ⏸ USER DECISION  — принять = DONE; доработать → к 2/3; отклонить → откат
```

**Сокращение:** trivial-фикс (опечатка/однострочник) — можно без plan mode;
VERIFY и feature-ветка обязательны всегда.

## Правила по этапам

**1. EXPLORE.** Не предполагать структуру — проверять (`grep`/`find`/Read).
Задача на >2–3 файла или смену поведения ⇒ нужен план.

**2. PLAN.** Нетривиальное — только через plan mode (`EnterPlanMode` → `ExitPlanMode`,
реализация после approval). В плане: что меняем, почему, как тестируем, риски/edge cases.

**2.5 DESIGN (GUI).** UI-работа (глобы в `harness.config.json → ui`) до кода:
новый GUI → ≥4 стилистически разных мокапа (`node hooks/new-mockups.js <feature>`),
показать пользователю, выбрать направление; правка GUI → мокап нового состояния.
После approval — файл `design/mockups/<feature>/APPROVED`.
Гейт `hooks/design-gate.js` (pre-push + CI) пропускает UI-изменения только если
одобренный набор **затронут в diff этой же ветки**; повторное использование старого
набора — допиши строку в его APPROVED (дата/ветка), чтобы он попал в diff.

**3. IMPLEMENT+TEST.** Код и тесты вместе. Нет тест-раннера — сказать в отчёте
и предложить минимальный.

**4. VERIFY (до коммита).** `node hooks/verify.js` — авто-детект стеков
(Python→ruff+pytest; C#→dotnet format/build -warnaserror/test; Rust→fmt+clippy -D warnings+test;
Node→npm lint/build/test), fail-fast, warnings-as-errors зашиты в шаги; переопределение —
`harness.config.json → verify`; `--list` — план без запуска. Сверх exit-кода: прочитать
вывод билда (новые warnings, deprecation, «falling back to …» — чинить или явно отметить
в отчёте) и сделать `git diff` self-review (debug-логи, закомментированный код, мусор).

**5. COMMIT → PR.** Только feature-ветка (`feat/…`, `fix/…`, `docs/…`), не main.
Conventional Commits: `<type>(<scope>): <subject>`; `feat:`→MINOR, `fix:`→PATCH,
`!`/`BREAKING CHANGE:`→MAJOR. Без соавторства (`Co-Authored-By`, «Generated with …») —
lefthook отклонит. `git push` / `--force` / `reset --hard` — только по явному запросу
пользователя.

**6. REPORT.** Что изменено / чем проверено (команды + результат) / что осталось /
как пользователю проверить руками.

**7. USER DECISION.** Loop завершён только когда пользователь принял результат.

## Release flow (только по явной просьбе, после merge в main)

| Шаг | Действие | Гейт |
|---|---|---|
| R1 | main зелёный, дерево чистое; версия: `git describe --tags --abbrev=0` | |
| R2 | SemVer из conventional-commits (`cog bump --auto`): annotated tag + CHANGELOG | ⏸ показать тэг/diff/notes → approval |
| R3 | `git push origin <branch> && git push origin vX.Y.Z` | ⏸ только после явного «да» |
| R4 | `gh run watch` — релизный workflow зелёный, без skipped-шагов | |
| R5 | `gh release view vX.Y.Z` — Published, артефакты на месте | |
| R6 | скачать артефакт, smoke-тест, версия в бинарнике = тэг | |
| R7 | знать откат: до публикации — пересоздать тэг; после — `gh release delete` + revert (с approval) | |

Hotfix: ветка от тэга (`git checkout -b hotfix/x.y.z vX.Y.Z-1`) → fix → PR в main + тэг по R2–R6.
Легитимный коммит на main (CHANGELOG релиза): `HARNESS_ALLOW_MAIN=1 git commit …`.

## Слои харнесса

**Слой 0 — серверный ruleset (единственный настоящий enforcement).**
`.github/rulesets/main.json`, ставится `node hooks/apply-ruleset.js`: require PR,
required check `verify`, блок force-push/delete main. Не обходится локально.
(Free+private: ruleset требует Pro или публичный репо — BACKLOG P0-0.)

**Слой 1 — lefthook (гигиена, для любого агента/человека).** `lefthook install`:
commit-msg → `cog verify` + запрет соавторства; pre-commit → gitleaks + запрет коммита
на main; pre-push → `verify.js` + `design-gate.js`.

**Слой 2 — agent-adapter (опционально, per-runtime).** Один хук `hooks/agent/guard.js`
на PreToolUse + `stop-reminder.js` на Stop (молчит при чистом дереве). Вход —
нормализованный JSON (`hooks/agent/_input.js`), поэтому подходит любому раннеру.
Контракт: exit 0 = allow, exit 2 = block, stdout `{"additionalContext":"…"}` = заметка.
Подключение: скопировать блок `hooks` из `settings.example.json` в `.claude/settings.json`.

| guard.js ловит | Тип |
|---|---|
| Обход харнесса: `--no-verify`/`commit -n`, `core.hooksPath` (config и `-c`), `LEFTHOOK=0`, `lefthook uninstall`, запись в `.git/hooks` | блок |
| Правку файлов самого харнесса (`hooks/`, `lefthook.yml`, конфиги, workflows, `.claude/settings.json`) | блок |
| Циклы: серия тривиальных команд; N× одно действие подряд; чередование A-B-A-B | блок |
| Мусор tool-разметки / низкоэнтропийную команду (сбой стриминга) | блок |
| git commit/push/правки на main; правку UI-файла без DESIGN | note |

Осознанный, одобренный пользователем обход блока: `HARNESS_ACK_BYPASS=1` (аудит-заметка).
Что guard не ловит: «тонкое» зацикливание из внешне осмысленных шагов — это закрывают
TodoWrite + этап 7 (пользователь видит, что todo не двигаются).

## Env

| Переменная | Назначение | Default |
|---|---|---|
| `HARNESS_ALLOW_MAIN=1` | коммит на main (релиз/hotfix/bootstrap) | — |
| `HARNESS_ACK_BYPASS=1` | одобренный пользователем обход guard.js | — |
| `HARNESS_LOOP_THRESHOLD` | порог циклов shell-команд | 5 |
| `HARNESS_TOOLLOOP_THRESHOLD` | порог циклов file-tools (Read/Write/Edit) | 12 |
| `HARNESS_SESSION_ID` / `HARNESS_PROJECT_DIR` | ключ состояния guard, если раннер не задал своих | — |
| `LEFTHOOK=0` | пропуск lefthook-хуков (только человек; агенту блокирует guard) | — |
