# Full Release Flow

Read this document only for an explicit full-release request. That request is
standing authorization for normal release pushes, PR creation/merge, the
computed SemVer tag, GitHub Release publication, and exact cleanup. It never
authorizes bypasses, force-pushes, deletion of unmerged work, rollback, or loss
of a dirty worktree.

## Preconditions

- All intended feature/fix work is merged through PRs.
- Each PR and the resulting `main` push are green.
- Merged development branches are cleaned with exact provider evidence.
- Create release work in a new clean temporary worktree from `origin/main`.
- The latest tag must be an ancestor of `origin/main`.

## Sequence

| Step | Action | Gate |
|---|---|---|
| R0 | Merge intended work and run post-merge cleanup. | No release from a feature branch. |
| R1 | Fetch/prune; in a clean release worktree run doctor, release-mode VERIFY, and inspect the latest tag. | Clean HEAD exactly at `origin/main`; valid release graph. |
| R2 | Run `node hooks/release-start.js --base origin/main`; apply `release-manifest-bump.js`; commit `chore(release): prepare vX.Y.Z`; run Cocogitto annotated bump. | Computed version must match merged Conventional Commits and manifests. |
| R2.5 | Run `node hooks/release-preflight.js --tag vX.Y.Z --base origin/main`. | Clean tree; annotated local tag at release HEAD; remote tag absent; manifests/changelog match. |
| R3 | Push only `release/vX.Y.Z`, create its PR, wait for checks, merge with a merge commit, confirm server-side `MERGED`. | Never squash/rebase the release PR; do not push the tag yet. |
| R4 | Fetch `origin/main`, wait for main CI, run post-merge preflight with `--require-tag-in-base --require-release-tip`. | Exact two-parent release merge; no concurrent main history outside the tag. |
| R5 | Push `vX.Y.Z`; wait for every tag workflow step. | Workflow builds from the exact tag, runs release VERIFY, checksums and smoke-tests artifacts, records evidence, and publishes the GitHub Release. |
| R6 | Inspect the release, download all contracted assets/evidence together, run `release-artifacts.js --phase all`. | Exact tag/version, HTTPS workflow/release URLs, successful smoke, asset, and checksum all agree. |
| R7 | From a separate clean base worktree run release cleanup dry-run and `--apply`, then strict topology audit. | Dirty/unmerged refs are never forced; tags remain. |
| R8 | Report tag, merge SHAs, workflow/release URLs, asset hashes, smoke and cleanup results, and rollback boundary. | Release is complete only after R6 and R7. |

## Commands

```text
node hooks/doctor.js --strict-env
node hooks/verify.js --mode release
node hooks/release-start.js --base origin/main
node hooks/release-manifest-bump.js --tag vX.Y.Z
node hooks/release-preflight.js --tag vX.Y.Z --base origin/main
node hooks/release-preflight.js --tag vX.Y.Z --base origin/main --require-tag-in-base --require-release-tip
node hooks/release-artifacts.js --tag vX.Y.Z --phase all --evidence <download-dir>/release-evidence.json
node hooks/release-cleanup.js --base origin/main
node hooks/release-cleanup.js --base origin/main --apply
node hooks/repo-state-audit.js --root <canonical-root> --base main --remote origin --fetch --strict
```

## Invariants

- `release-start.js` attaches detached release work to `release/vX.Y.Z` before
  Cocogitto; never whitelist arbitrary detached `HEAD`.
- The local annotated tag stays private until the release PR is merged and R4
  proves the tag is the exact second parent of fresh `origin/main`.
- Workflow-owned evidence must identify the exact tag/version, artifact and
  checksum names, HTTPS workflow/release URLs, and `smokePassed: true`.
- Source repositories may publish a source ZIP; installed targets must define
  artifacts appropriate to their runtime and must not inherit that assumption.
- Independent-version monorepos configure manifest scope explicitly.
- Release/hotfix branches are retained until tag publication and artifact smoke
  testing complete; cleanup never deletes tags.

## GitHub merge reality

After `gh pr merge`, a dirty local checkout can make follow-up sync fail even
though GitHub already merged the PR. Always verify with server state and merge
commit data. Synchronize only a clean checkout with fetch plus fast-forward.

## Rollback boundary

Before publication, changing/deleting a local tag requires explicit approval.
After publication, rollback requires a separate decision: delete the GitHub
Release if appropriate and use a revert PR. Never silently recreate published
tags or rewrite released history.
