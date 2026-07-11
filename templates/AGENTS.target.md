# AGENTS.md - Project Dev Loop

This repository uses llm-dev-harness. Project code and policy remain owned by
this repository; harness updates may replace only files listed as `managed` in
`.harness/installation.json`.

## Loop

1. EXPLORE the repository and existing tests.
2. PLAN non-trivial behavior changes and obtain user approval.
3. For user-visible UI work, prepare DESIGN evidence and obtain approval.
4. IMPLEMENT code and tests together.
5. CHECK with `node hooks/task.js check`; FINISH with `node hooks/task.js finish`,
   inspect output, and self-review the diff.
6. COMMIT on a feature branch and merge through a verified PR, never directly to
   `main` or `master`.
7. MERGE+CLEANUP only after the PR is server-confirmed MERGED and its resulting
   `main` verification is green. Delete the development branch and finish with
   the strict remote-aware topology gate. Release/hotfix branches wait for
   artifact smoke testing.
8. REPORT changed, verified, remaining, and manual-test notes.

A trivial typo may skip a written plan. It does not skip VERIFY or the branch/PR
contract.

Prefer the coordinator: `node hooks/task.js start <slug>` creates an isolated
worktree and baseline; `status` shows branch health, local dirt, recent gates,
and follow-up candidates; `check` is fast/advisory; `finish` runs full gates;
`report` produces changed/verified/remaining/manual-test handoff notes. Commits
require explicit `--commit "type(scope): subject"` and are refused while
recorded pre-task dirt remains. It never pushes.

## Design Routing

- Backend-only work with no UI impact skips mockups.
- Cosmetic copy/spacing/accessibility/regression fixes use one scoped approval
  plus screenshot, regression, or manual verification evidence.
- Animation may use four written variants for a low-cost decision or four
  executable HTML/JavaScript prototypes for high-fidelity comparison.
- Changes to an existing UI keep its visual language and compare layouts,
  placement, or interaction alternatives.
- UI created from scratch compares at least four distinct visual directions.

Use `node hooks/new-mockups.js --help` and configure framework paths through
`harness.config.json -> ui.globs` and `ui.exclude`.

## Ownership And Updates

- `hooks/`, `lefthook.yml`, and `settings.example.json` are harness-managed.
- `AGENTS.md`, `harness.config.json`, `cog.toml`, `.gitleaks.toml`,
  `.gitattributes`, `CHANGELOG.md`, and `.github/` are project-owned.
- `node install.js --update` updates managed files only when their current hash
  matches the previous installation baseline.
- `--replace-managed` explicitly replaces locally modified managed files. It
  never authorizes replacing project-owned files.

After first installation, commit the harness through a bootstrap PR. Until that
PR is merged, installer output reports `bootstrapRequired: true` and the loop is
not fully enforceable from a clean checkout.

When GitHub server policy is enabled, use `node hooks/apply-ruleset.js --check`
for read-only live drift detection. Apply policy only as a separate explicit
operation. Keep one persistent canonical project directory on clean `main` when
idle. Feature/release worktrees are temporary and must be removed after their
cycle; never create a persistent sibling `<repo>-main` checkout unless the user
explicitly configures an external two-root pipeline. Use
`repo-state-audit.js --root <canonical-root> --base main --strict --remote origin --fetch`
as the terminal gate.

The GitHub adapter runs `.github/workflows/branch-cleanup.yml` only after the
`verify` workflow succeeds for a push to the default branch. It resolves the
MERGED PR from that exact commit, verifies the GitHub Actions check and reviewed
head SHA, skips forks plus `release/*`/`hotfix/*`, and deletes an ancestor or
patch-equivalent development branch with an exact OID lease. On another Git
provider, the coordinator runs `post-merge-cleanup.js` explicitly after
equivalent provider evidence. The terminal topology audit remains mandatory and
rejects leftover local or remote branches.
Project branch conventions live in `harness.config.json -> branchLifecycle`;
configure managed, protected, and retained prefixes there rather than changing
the cleanup gates.

## Release

Run a release only on explicit user request and only when the configured release
capability is enabled. Derive SemVer from Conventional Commits, prepare the tag
on a release branch, merge the release PR, verify the tag is the exact release
tip with `release-preflight.js --require-release-tip`, then publish and smoke-test
the artifacts declared by this project. Use `release.versioning.manifests` to
scope independent-version monorepos and `release-artifacts.js` for configured
build/smoke/version evidence. Workflow-owned artifacts require downloaded
schema-version-1 `release-evidence.json` during `--phase all`; the helper checks
the exact tag/version and recomputes the published asset SHA-256. A harness
source ZIP is not a universal artifact contract.

Never force-push, delete unmerged work, bypass hooks, weaken verification policy,
edit `.harness/installation.json` by hand, or overwrite dirty worktrees without
explicit approval.
