# BACKLOG — llm-dev-harness

> **Миграция (2026-07):** commit-lint/secret-scan/release/git-hook-раннер выпилены и заменены
> боевыми стандартами — **lefthook** (`lefthook.yml`), **gitleaks** (`.gitleaks.toml`),
> **cocogitto** (`cog.toml`). Своим осталась AGENTS.md-петля, agent-хук и loop/design-гейты.
> Реальный enforcement вынесен в серверный ruleset (`.github/rulesets/main.json`, `hooks/apply-ruleset.js`).
>
> **Lean-rewrite (7cbf0e8):** три отдельных agent-хука (bypass/design/tool-loop-guard) слиты в
> один `hooks/agent/guard.js`; отдельные helper'ы `quality-gate.js` и `setup-signing.js` убраны.
> Статусы ниже с пометкой «✅ СДЕЛАНО» отражают это состояние, а не исходные имена файлов.

Что не хватает харнессу, сверено с практикой топовых GitHub-проектов (2026). Приоритеты:
**P0** — закрывает реальную дыру в текущей модели; **P1** — сильно повышает качество;
**P2** — зрелость/автоматизация.

> **Плановое ограничение (важно).** Репозиторий приватный, а на **GitHub Free приватные
> репо не получают branch protection / rulesets с required status checks** — это Pro/Team/
> Enterprise или публичный репо. Пока план Free+private, серверное принуждение недоступно,
> и «защита main» остаётся только совещательной (локальные хуки). См. P0-0.

---

## P0 — серверный слой (сейчас его нет, а без него всё обходится)

Локальные git-хуки — это **inner loop**: быстро, но обходится одним `git commit --no-verify`
и защищает только локального пользователя. Настоящее принуждение — **outer loop на сервере**:
GitHub Rulesets + required status checks + required PR. Сейчас у харнесса есть только слой 1
(локальный) и слой 2 (agent-adapter). Серверного слоя нет.

- **P0-0. План/приватность. ✅ РЕШЕНО: Free + private, без серверного принуждения.**
  Следствие: rulesets/required-checks недоступны, защита `main` остаётся **локальной/совещательной**
  (git-native pre-push + PR-дисциплина + agent bypass-guard). CI (P0-1) запускается и показывает
  статус, но не может блокировать merge. Пересмотреть при переходе на Pro/Team или публичный репо.

- **P0-1. CI-зеркало проверок. ⏳ АВТОРИЗОВАНО, ждёт пуша workflow.** Готовы: `.github/workflows/ci.yml`
  (gitleaks + cocogitto `cog check` + `node hooks/verify.js` + `design-gate.js` на push/PR) —
  серверный бэкстоп против `--no-verify` (перепроверяет каждый коммит PR через cocogitto-action).
  `cog check` (в CI через cocogitto-action) — серверный бэкстоп против `--no-verify`. **Файл workflow не запушен из этой сессии**: у gh-токена нет
  скоупа `workflow`, а SSH к GitHub из окружения заблокирован (порты 22 и 443). Добавить workflow:
  `gh auth refresh -s workflow -h github.com` → закоммитить `.github/workflows/ci.yml` → push;
  либо добавить файл через веб-UI GitHub. На Free+private он **не станет required** (см. P0-0).

- **P0-2. Ruleset на `main`** *(перенос из прошлого предложения — «branch protection»)*.
  Хранить как versioned JSON + инсталлятор `gh api`. Правила: require PR, require CI-check из P0-1,
  block прямого push/force-push/deletion, require conversation resolution. Прямой push в main
  остаётся только через bootstrap/hotfix (наш hatch), на сервере — через bypass «for PRs only».

- **P0-3. Ответ на «как пушить в main?» → PR-flow + эргономика.** Раздел в AGENTS.md:
  feature → PR → CI зелёный (required) → review/CODEOWNERS → **squash-merge**. Хелпер
  `gh pr create` (тело из conventional-коммитов), `.github/pull_request_template.md` с чеклистом
  loop'а (VERIFY сделан, тесты, мокапы для GUI). Для solo: ruleset «bypass for PRs only» +
  самоапрув, но required CI обязателен.

- **P0-4. Анти-чит агента (специфично для AI-харнесса). ✅ СДЕЛАНО.** `hooks/agent/guard.js`
  блокирует `git commit --no-verify`, `git push --no-verify`, `git commit -n`, правку
  `core.hooksPath`, `lefthook uninstall`, `LEFTHOOK=0` (варианты имени `git`/`git.exe`/`git.cmd`;
  обход только через `HARNESS_ACK_BYPASS=1`). Строки в кавычках обнуляются, чтобы сообщение
  коммита с «-n» не было ложным срабатыванием. Покрыто self-test'ами.
  Настоящий backstop против `--no-verify` — серверный required-check (P0-1), пока недоступен на Free.

---

## P1 — качество и твои требования

- **P1-5. GUI design-gate (твоё требование: 4 мокапа). ✅ СДЕЛАНО.** Стадия **DESIGN** (2.5) в loop
  между PLAN и IMPLEMENT, обязательная для GUI. Реализация:
  - `harness.config.json` — UI-globs (`*.ui`/`*.qml`/`ui/`/`views/`/`widgets/`…), `min=4`, каталог мокапов.
  - `hooks/design-gate.js` — **жёсткий** гейт (exit 1) для VERIFY/CI: UI-изменения проходят,
    только если одобренный набор ≥4 мокапов с файлом `APPROVED` **затронут в diff этой же ветки**
    (иначе один старый approval открывал бы гейт навсегда).
  - `hooks/agent/guard.js` — warn при правке UI-файла (design-note, часть единого agent-хука).
  - `hooks/new-mockups.js` — генерит 4 стилистически разных HTML-мокапа под фичу.
  - Покрыто self-test'ами. Возможное усиление (позже): поддержать `Design-Approved:` trailer
    как альтернативу файлу APPROVED.

- **P1-6. Secret scanning. ✅ МИГРИРОВАНО НА gitleaks.** Самописный `secret-scan.js` удалён; секреты
  ловит **gitleaks** (`.gitleaks.toml`, `useDefault=true` → 100+ детекторов), встроен в lefthook
  `pre-commit` и в CI. Инлайн-исключение `gitleaks:allow` (+ legacy `secret-scan:allow` в allowlist).

- **P1-7. Signed commits. ⏸️ Helper убран в lean-rewrite.** Отдельный `setup-signing.js` удалён как
  редко нужный: SSH-подпись включается вручную (`git config commit.gpgsign true` + allowed_signers).
  «Require signed» как жёсткий гейт — это ruleset (нужен Pro/public, см. P0-0).

- **P1-8. Исполняемый VERIFY. ✅ СДЕЛАНО.** `hooks/verify.js` — мульти-стек авто-детект
  (Python/Qt: `ruff`+`pytest`; C#/WPF: `dotnet format`+`build -warnaserror`+`test`;
  Rust/Tauri: `cargo fmt`+`clippy -D warnings`+`test`; Node: `npm lint/build/test`), fail-fast,
  warnings-as-errors по умолчанию, монорепо (шаги в каталоге маркера), `--list`/`--stack`/`--json`.
  Переопределение через `harness.config.json` → `verify`. Покрыто self-test'ами; сам харнесс
  прогоняет свой `node test.js` через verify. Это же — команда для CI (P0-1).
  `--changed`/`--base` (верифицировать только тронутые стеки для скорости) — ✅ добавлено (99bf0c7).
  Возможное усиление (позже): baseline-diff warning'ов вместо доверия к `-Werror`-флагам.

- **P1-9. CODEOWNERS + Dependabot. ✅ СДЕЛАНО (SHA-пиннинг — опционально).** `.github/CODEOWNERS`
  (owner на `*`, `/hooks/`, `/.github/`) и `.github/dependabot.yml` (github-actions, weekly) — в `main`
  и **уже работают**: Dependabot сразу открыл PR на апдейт экшенов (checkout→v7, setup-node→v6).
  `ci.yml` (добавлен пользователем, PR #6) сейчас на `@v4`-тегах. Строгий SHA-пиннинг опционален:
  запинить на commit-SHA (checkout `9c091bb…`=v7.0.0, setup-node `48b55a…`=v6.4.0) и дать Dependabot
  их поддерживать, либо просто мёржить его версионные PR. Пуш workflow — только из твоей сессии
  (скоуп `workflow`). На Free+private review по CODEOWNERS — совещательны (см. P0-0).

---

## P2 — зрелость

- **P2-10. loop-guard для не-Bash tool'ов. ✅ СДЕЛАНО.** Часть единого `hooks/agent/guard.js` — блок
  дегенеративных серий не-Bash tool'ов: считает ТОЧНЫЕ повторы (tool+target) подряд, любой другой
  target сбрасывает streak (нулевой FP на нормальном редактировании). Порог
  `HARNESS_TOOLLOOP_THRESHOLD` (12). Тесты есть.
- **P2-11. Release-автоматизация. ✅ МИГРИРОВАНО НА cocogitto.** Самописный `release.js` удалён.
  `cog bump --auto` считает next SemVer из conventional-коммитов, ставит annotated-тег и генерит
  CHANGELOG (`cog.toml`). Push — по-прежнему gated (R3). CI-публикация (SLSA/SBOM) — опциональный workflow.
- **P2-12. `harness doctor`. ✅ СДЕЛАНО.** `hooks/doctor.js` — проверка окружения: node/git,
  lefthook/gitleaks/cog в PATH + wiring в `.git/hooks`, LF + отсутствие NUL в конфигах, валидность
  `harness.config.json`, git-identity. Ловит ровно те грабли, что мы поймали (CRLF, NUL). Тесты есть.
- **P2-13. Quality-gate для AI-кода. ⏸️ Убран в lean-rewrite.** Отдельный `quality-gate.js` (маркеры
  merge-конфликта, переросшие файлы, TODO) удалён как дублирующий VERIFY + git diff self-review из
  loop-шага 4. При возврате — делать через тест-раннеры (реальное покрытие/сложность per-language),
  а не самописным эвристическим гейтом.
- **P2-14. Интерактивный commit-хелпер. ✅ МИГРИРОВАНО НА cocogitto.** Самописный `hooks/commit.js`
  удалён — его заменяет `cog commit <type> <scope> <subject>` (идёт в комплекте cocogitto). Одной зависимостью меньше.

---

## Практики, которые харнесс УЖЕ покрывает (для полноты)
Conventional Commits (git-native `commit-msg`, не обходится через `-F`/editor), запрет
со-авторства, защита main локально, защита от прямого push тегов-vs-веток, runaway-loop guard,
portable-контракт под любой раннер, self-test suite. Это соответствует связке
commitlint+husky, но без `node_modules` и не привязано к JS/Claude.
