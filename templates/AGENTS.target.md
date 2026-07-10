# AGENTS.md - Project Dev Loop

This repository uses llm-dev-harness. Project code and policy remain owned by
this repository; harness updates may replace only files listed as `managed` in
`.harness/installation.json`.

## Loop

1. EXPLORE the repository and existing tests.
2. PLAN non-trivial behavior changes and obtain user approval.
3. For user-visible UI work, prepare DESIGN evidence and obtain approval.
4. IMPLEMENT code and tests together.
5. VERIFY with `node hooks/verify.js`, inspect its output, and self-review the diff.
6. COMMIT on a feature branch and merge through a verified PR, never directly to
   `main` or `master`.
7. REPORT changed, verified, remaining, and manual-test notes.

A trivial typo may skip a written plan. It does not skip VERIFY or the branch/PR
contract.

## Design Routing

- Backend-only work with no UI impact skips mockups.
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
operation. Use `repo-state-audit.js --strict --remote origin --fetch` as the
terminal gate when automation coordinates multiple checkouts.

## Release

Run a release only on explicit user request and only when the configured release
capability is enabled. Derive SemVer from Conventional Commits, prepare the tag
on a release branch, merge the release PR, verify the tag is the exact release
tip with `release-preflight.js --require-release-tip`, then publish and smoke-test
the artifacts declared by this project. A harness source ZIP is not a universal
artifact contract.

Never force-push, delete unmerged work, bypass hooks, weaken verification policy,
edit `.harness/installation.json` by hand, or overwrite dirty worktrees without
explicit approval.
