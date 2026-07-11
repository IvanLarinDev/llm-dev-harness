# AGENTS.md - Assistive Dev Loop

This harness should remove coordination work while keeping expensive boundaries
safe. The inner loop is fast and advisory; commit, push, merge, and release gates
remain strict.

## Default loop

```text
1. EXPLORE        read relevant code, tests, and risks
2. PLAN           get approval for non-trivial scope
3. IMPLEMENT      code and tests together
4. CHECK          node hooks/task.js check (fast, changed groups)
5. FINISH         node hooks/task.js finish (full VERIFY + DESIGN)
6. COMMIT/REPORT  feature branch only; push/PR only when authorized
7. USER DECISION  accept, revise, or reject
```

An explicit “do it”/“делай” approves normal reversible implementation steps in
the stated scope; do not stop for a second approval unless authority expands,
data could be lost, or a meaningful product choice is missing.

Use the coordinator when possible:

```text
node hooks/task.js start <slug>
node hooks/task.js status
node hooks/task.js check
node hooks/task.js finish
node hooks/task.js report
node hooks/task.js finish --commit "feat(scope): subject"
```

`start` creates a temporary worktree from the accepted base when invoked on
`main`, activates Lefthook, and records pre-existing dirt so read-only work does
not trigger false Stop reminders. `status` shows branch health, local dirt,
recent gates, and Papercuts follow-up candidates. `report` produces the changed /
verified / remaining / manual-test handoff. `finish` never pushes, merges, or
releases, and `finish --commit` refuses to stage while recorded pre-task dirt
remains.

## Boundaries

- Inner work: focused tests, advisory DESIGN, advisory loop/lint-policy notes.
- Commit: Gitleaks, branch guard, Conventional Commit, no AI trailers.
- Push/CI: full VERIFY and hard DESIGN gate.
- Release: exact tag, evidence, checksum, smoke, and cleanup contract.
- Never bypass hooks, force-push, reset hard, or discard a dirty tree without
  explicit authority.

Work on `codex/*`, `feat/*`, `fix/*`, `docs/*`, or another configured managed
prefix; never commit directly on `main`/`master`. A trivial typo may skip a
formal plan, but still needs the relevant check and a feature branch.

## Explore and edit

- Verify structure with `rg`, file reads, and existing tests; do not assume it.
- Read existing files/call sites before editing them.
- Preserve user changes in a dirty worktree. Use a temporary worktree when
  changes overlap or the canonical checkout is not clean.
- Code and regression tests move together. If no runner exists, report it and
  propose the smallest useful one.
- Debug leftovers (`debugger`, `breakpoint`, `pdb.set_trace`, `dbg!`) fail VERIFY.

## VERIFY

```text
node hooks/verify.js --mode fast --base origin/main
node hooks/verify.js --mode full
node hooks/verify.js --mode release --base origin/main
node hooks/test.js --only verify,doctor
node hooks/test.js --list
```

`fast` selects changed stacks and source-harness test groups. `full` is the
pre-push/CI contract. `release` is full plus strict audit behavior. A failed or
warning-producing run must be read, not judged only by its exit code.

`doctor` distinguishes repository defects from environment provisioning:

```text
node hooks/doctor.js
node hooks/doctor.js --strict-env
node hooks/doctor.js --server
```

Missing tools/mount/network are visible `ENV` results and do not block locally
unless `--strict-env` is requested. Real contract drift remains `FAIL`.

## DESIGN

Backend-only changes outside configured UI globs skip DESIGN.

- `cosmetic`: copy, accessibility text, spacing, or a proven visual regression;
  one scoped approval plus screenshot/regression/manual verification.
- `existing-ui`: preserve the current visual language; compare four layouts or
  interaction placements and include a real baseline.
- `new-ui`: compare four distinct visual directions.
- `animation`: compare four text or executable variants for one scenario.

```text
node hooks/new-mockups.js <feature> --kind cosmetic --ui <path> --reason <why> --verification <evidence> --approved-by <source>
node hooks/new-mockups.js <feature> --kind existing-ui --baseline <path>
node hooks/new-mockups.js <feature> --kind new-ui
node hooks/new-mockups.js <feature> --kind animation --fidelity text|js --example <scenario>
```

`task check` reports missing approval without blocking. `task finish`, pre-push,
and CI block unresolved UI evidence. `WAIVER.json` remains available only for an
explicit user-approved skip.

## Git lifecycle

Use Conventional Commits: `<type>(<scope>): <subject>`. `feat` is MINOR, `fix`
is PATCH, and `!`/`BREAKING CHANGE` is MAJOR. Do not add co-author or generated
trailers.

Push only when requested. After a PR is server-confirmed `MERGED` and resulting
`main` CI is green, use the exact cleanup helper, then the terminal audit:

```text
node hooks/post-merge-cleanup.js --branch <branch> --base origin/main
node hooks/post-merge-cleanup.js --branch <branch> --base origin/main --apply
node hooks/repo-state-audit.js --root <canonical-root> --base main --remote origin --fetch --strict
```

Cleanup never forces dirty, diverged, ambiguous, or unmerged refs. Keep one
persistent canonical checkout on clean `main`; temporary feature/release
worktrees must be removed after acceptance.

## Release routing

Run the release flow only on an explicit full-release request. Before any
release action, read `docs/release-flow.md` completely. A full-release request
authorizes the normal branch/PR/tag/GitHub Release/cleanup sequence described
there, but never bypasses, force-pushes, history repair, or data loss.

## Ownership and capabilities

The cross-project contract is `docs/universal-contract.md`.

- Harness-managed: `hooks/`, `lefthook.yml`, `settings.example.json`.
- Project-owned: `AGENTS.md`, `harness.config.json`, `cog.toml`, secret policy,
  changelog, attributes, and `.github/`; install/update never replaces them.
- `harness.config.json` selects UI, release, and server-policy capabilities.
- A fresh install is not enforceable until bootstrap files are tracked through
  a separate PR and Lefthook is active.

Local hooks protect against mistakes; the server ruleset is the strongest gate.
Standard guard mode blocks bypass/protected-file/corruption hazards and reports
loops or lint-policy edits as advice. `HARNESS_PROFILE=strict` restores hard
loop/lint blocking; `minimal` keeps only anti-bypass and protected files.

## Papercuts

Record concrete friction while it is fresh and continue working:

```text
papercuts add "<what failed and what would have prevented it>" --tag <area>
```

Do not log secrets, private output, general status, or speculation. Contract v1
stores absolute `cwd`/`repo` in tracked JSONL; use `PAPERCUTS_FILE` outside the
repository when those paths are not acceptable. Tracked mode is append-only and
Gitleaks-scanned. Releases render sanitized record text and automation candidate
groups directly into release notes; the raw paths are never copied into that
section.

## Special routing

- Dropwheel installer/doctor/guard/design/verify reports: use
  `$harness-triage` and `docs/dropwheel-harness-inbox.md`.
- Color Team Review: use `$color-team-review`; report verdict, evidence-based
  findings, good decisions, priority fixes, minimal plan, and verdict-changing
  questions only.

## Report

Report changed behavior, exact verification commands/results, remaining work,
and manual test notes. Read-only/review tasks must explicitly say why pre-existing
dirty files remain uncommitted. The loop is complete only after the user accepts
the result.
