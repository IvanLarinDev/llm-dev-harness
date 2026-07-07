# BACKLOG — llm-dev-harness

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

- **P0-0. Решить вопрос с планом/приватностью.** Варианты: (a) GitHub Pro (~$4/мес) → rulesets
  на приватном; (b) сделать репо публичным → rulesets бесплатно; (c) остаться Free+private →
  serverное принуждение невозможно, CI-проверки будут только видимыми, не блокирующими merge.
  Это блокер для P0-1…P0-3.

- **P0-1. CI-зеркало проверок** *(перенос из прошлого предложения)*. `.github/workflows/ci.yml`:
  прогон `node hooks/test.js` + commit-lint по всем коммитам PR + (для проектов) lint/build/test.
  Тот же контроль, что локально, но его нельзя обойти `--no-verify`. → делаем required check.

- **P0-2. Ruleset на `main`** *(перенос из прошлого предложения — «branch protection»)*.
  Хранить как versioned JSON + инсталлятор `gh api`. Правила: require PR, require CI-check из P0-1,
  block прямого push/force-push/deletion, require conversation resolution. Прямой push в main
  остаётся только через bootstrap/hotfix (наш hatch), на сервере — через bypass «for PRs only».

- **P0-3. Ответ на «как пушить в main?» → PR-flow + эргономика.** Раздел в AGENTS.md:
  feature → PR → CI зелёный (required) → review/CODEOWNERS → **squash-merge**. Хелпер
  `gh pr create` (тело из conventional-коммитов), `.github/pull_request_template.md` с чеклистом
  loop'а (VERIFY сделан, тесты, мокапы для GUI). Для solo: ruleset «bypass for PRs only» +
  самоапрув, но required CI обязателен.

- **P0-4. Анти-чит агента (специфично для AI-харнесса). ✅ СДЕЛАНО.** `hooks/agent/bypass-guard.js`
  блокирует `git commit --no-verify`, `git push --no-verify`, `git commit -n` и правку
  `core.hooksPath` (обход только через `HARNESS_ACK_BYPASS=1`). Строки в кавычках обнуляются,
  чтобы сообщение коммита с «-n» не было ложным срабатыванием. Покрыто self-test'ами.
  Настоящий backstop против `--no-verify` — серверный required-check (P0-1), пока недоступен на Free.

---

## P1 — качество и твои требования

- **P1-5. GUI design-gate (твоё требование: 4 мокапа).** Новая стадия **DESIGN** в loop между
  PLAN и IMPLEMENT, обязательная для GUI-работы:
  - для нового GUI — **≥4 стилистически разных мокапа** + явный approval до кода;
  - для изменения GUI — мокап(ы) нового состояния (и, где нужно, before/after).
  - Хранение: `design/mockups/<feature>/` (можно генерировать HTML/SVG-варианты и рендерить).
  - Soft-гейт в CI: если PR трогает UI-пути (`*.ui`, `*.qml`, каталоги виджетов) и нет ≥4 мокапов
    в `design/mockups/**` или `Design-Approved: <ссылка>` в теле PR → fail.
  - Привязка к стеку (PyQt/Qt): гейт срабатывает на `.ui`/`.qml`/виджет-модулях.

- **P1-6. Secret scanning.** `gitleaks` в `pre-commit` + в CI. Утечка секретов из AI-кода —
  топ-риск 2026. Дёшево, высокий эффект.

- **P1-7. Signed commits.** SSH/GPG-подпись (или Sigstore `gitsign`) + ruleset «require signed».
  Логично усиливает вашу политику «коммиты выглядят как от автора» — теперь ещё и криптографически.

- **P1-8. Исполняемый VERIFY.** Сейчас VERIFY — проза «прогони тесты/lint/build». Нужен
  `harness.config`/npm-scripts, задающие `verify`/`lint`/`build`/`test` per-project, чтобы шаг 4
  был исполняемым, а не на доверии. Для Qt/Python: `ruff` + `pytest` + сборка. Это же переиспользует
  CI из P0-1.

- **P1-9. CODEOWNERS + Dependabot + пиннинг Actions по SHA.** `.github/CODEOWNERS` (в т.ч. на
  `.github/workflows/` и `hooks/`), `.github/dependabot.yml`, все сторонние Actions — на полный
  commit-SHA. Стандарт supply-chain.

---

## P2 — зрелость

- **P2-10. loop-guard для не-Bash tool'ов.** Runaway-серии `Read`/`Write`/`Edit` сейчас не
  ловятся (в AGENTS.md честно отмечено). Общий per-tool счётчик через тот же `_input.js`.
- **P2-11. Release-автоматизация.** `release-please` (PR-based, ревью-шаг — подходит вашему
  gated-подходу) или `semantic-release` (полностью авто). + SBOM и artifact attestations (SLSA)
  в release-workflow.
- **P2-12. `harness doctor`.** Проверка окружения: node в PATH git-bash, exec-бит хуков, EOL=LF,
  core.hooksPath. Ловит те же грабли, что мы уже поймали (CRLF, trailing space).
- **P2-13. Quality-gate для AI-кода.** Порог покрытия/сложности (CodeScene-подход): «относиться к
  AI-коду как к недоверенному вводу, пока не проверен».
- **P2-14. Интерактивный commit-хелпер** (commitizen-подобный) — опционально, для людей.

---

## Практики, которые харнесс УЖЕ покрывает (для полноты)
Conventional Commits (git-native `commit-msg`, не обходится через `-F`/editor), запрет
со-авторства, защита main локально, защита от прямого push тегов-vs-веток, runaway-loop guard,
portable-контракт под любой раннер, self-test suite. Это соответствует связке
commitlint+husky, но без `node_modules` и не привязано к JS/Claude.
