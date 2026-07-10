# llm-dev-harness

A compact dev-loop harness for agent-assisted code changes. It works with any
LLM runner that can execute git hooks and, optionally, agent adapter hooks.

The canonical operating contract is [AGENTS.md](./AGENTS.md): loop stages,
bootstrap, release flow, enforcement layers, and environment variables. This
README covers the stack and installation.

> Honest boundary: local hooks are hygiene. They catch mistakes before commit,
> but they are not a defense against an adversarial actor with write access to
> the worktree. When the GitHub server-policy adapter is enabled, the strongest
> repository gate is `.github/rulesets/main.json`, where the required `verify`
> check is pinned to GitHub Actions through `integration_id`.
> This source repository uses a solo-maintainer ruleset: PR + pinned `verify`
> are required, while approving/code-owner review is advisory to avoid a
> self-approval deadlock. Target installs keep regular approving review by
> default.

## Stack

| Task | Tool | Config |
|---|---|---|
| Git hook runner | lefthook | [lefthook.yml](./lefthook.yml) |
| Secret scanning | gitleaks | [.gitleaks.toml](./.gitleaks.toml) |
| Conventional Commits, SemVer, changelog | cocogitto | [cog.toml](./cog.toml) |
| Server enforcement | GitHub ruleset | [.github/rulesets/main.json](./.github/rulesets/main.json) |
| Multi-stack VERIFY | local harness | [hooks/verify.js](./hooks/verify.js) |
| GUI DESIGN gate | local harness | [hooks/design-gate.js](./hooks/design-gate.js) |
| Release branch start | local harness | [hooks/release-start.js](./hooks/release-start.js) |
| Release manifest bump | local harness | [hooks/release-manifest-bump.js](./hooks/release-manifest-bump.js) |
| Release preflight | local harness | [hooks/release-preflight.js](./hooks/release-preflight.js) |
| Post-merge branch cleanup | local harness | [hooks/post-merge-cleanup.js](./hooks/post-merge-cleanup.js) |
| Release branch cleanup | local harness | [hooks/release-cleanup.js](./hooks/release-cleanup.js) |
| Repository topology audit | local harness | [hooks/repo-state-audit.js](./hooks/repo-state-audit.js) |
| Source ZIP release | GitHub Actions | [.github/workflows/release.yml](./.github/workflows/release.yml) |
| Agent adapter | local harness | [hooks/agent/guard.js](./hooks/agent/guard.js) |
| Agent config security audit | ecc-agentshield | [.github/workflows/ci.yml](./.github/workflows/ci.yml) |

Shared helpers live in [hooks/_lib.js](./hooks/_lib.js). VERIFY planning and
debug-audit policy live in [hooks/verify-core.js](./hooks/verify-core.js), with
[hooks/verify.js](./hooks/verify.js) kept as the CLI/runner wrapper.
The cross-project ownership, capabilities, state model, and threat boundary are
defined in [docs/universal-contract.md](./docs/universal-contract.md).

## DESIGN routing

The DESIGN stage follows the user-visible question instead of generating four
unrelated themes for every UI-path change.

| Change type | Required evidence |
|---|---|
| Backend with no UI impact | None. `design-gate.js` skips when no changed path matches `ui.globs` after `ui.exclude`. |
| Animation, low cost | Four written motion variants for one concrete scenario. |
| Animation, high fidelity | Four executable HTML/JavaScript motion prototypes. |
| Existing UI element or flow | The current visual language with four layout, placement, or interaction alternatives. |
| New UI from scratch | Four stylistically distinct visual directions. |

Generate an explicit evidence type:

```bash
node hooks/new-mockups.js <feature> --kind existing-ui --baseline <repo-path>
node hooks/new-mockups.js <feature> --kind new-ui
node hooks/new-mockups.js <feature> --kind animation --fidelity text --example "<scenario>"
node hooks/new-mockups.js <feature> --kind animation --fidelity js --example "<scenario>"
node hooks/new-mockups.js <feature> --kind backend
```

`existing-ui` requires at least one current UI source file as its baseline.
Animation variants share the same concrete example so timing and feedback can
be compared directly. `backend` creates no DESIGN directory and does not bypass
a real UI-path diff. Mixed backend/UI tasks create evidence only for their
user-visible slice.

Every non-backend set contains a `DESIGN.json` manifest, four mode-appropriate
variants, and `NOTES.md`. Create `design/mockups/<feature>/APPROVED` only after
the user selects a direction, and include `ui: <changed-ui-path-or-glob>` so the
approval is bound to the current UI diff. Legacy approved sets without
`DESIGN.json` remain valid only when `APPROVED` carries that scope. For explicit
user-approved skips, create `design/mockups/<feature>/WAIVER.json` with
`schemaVersion`, `feature`, `uiPaths`, `reason`, `date`, and `approvedBy` or
`approvalSource`.

## Install

```bash
node install.js ../my-project
node install.js --target ../my-project
node install.js
node install.js --dry-run
node install.js --target ../my-project --update
```

Double-click wrappers are also available: `install.cmd` on Windows and
`install.sh` on POSIX.

Useful flags:

- `--update`: update harness-managed runtime files that still match their recorded installation hashes.
- `--replace-managed`: explicitly replace locally modified managed runtime; project-owned files remain untouched.
- `--force`: compatibility alias for `--update --replace-managed`; it no longer overwrites project policy.
- `--require-enforceable`: return non-zero while bootstrap or hook activation is pending.
- `--with-ci`: add optional Dependabot; CI, CODEOWNERS, and ruleset templates are installed by default.
- `--code-owner @org/team`: write a real CODEOWNERS owner and enable required code-owner review in the target ruleset.
- `--with-ruleset`: apply the server ruleset immediately; requires `gh` admin access and a plan/repo that supports rulesets.
- `--server-provider auto|github|none`: auto enables GitHub policy only for a GitHub origin.
- `--release-provider auto|cocogitto|none`: auto enables Cocogitto only for a GitHub origin.
- `--json`: emit a machine-readable report.

The installer records managed hashes in `.harness/installation.json`. It only
seeds `AGENTS.md`, `harness.config.json`, release config, secret policy, and
`.github/` when those project-owned files are missing. Subsequent install/update
runs preserve them byte-for-byte.
For non-GitHub and local origins, auto mode writes no `.github/`, `cog.toml`, or
`CHANGELOG.md`; select an adapter explicitly when the project needs one.

Without `--code-owner`, a new install writes a CODEOWNERS template but keeps
`require_code_owner_review=false` in the target ruleset. This preserves the
regular approving-review requirement without deadlocking solo-maintainer
repositories on an owner that does not exist in the target project. The target
ruleset comment is rewritten to match that policy; re-run with
`--code-owner @org/team` when a real owner should become a required reviewer.

## Bootstrap PR

After installation, commit the harness into the target repository through a
separate bootstrap PR before treating the loop as mandatory. At minimum, commit
`hooks/`, `.harness/installation.json`, `AGENTS.md`, `harness.config.json`,
`lefthook.yml`, `.gitleaks.toml`, and `settings.example.json`; add `cog.toml` and
`CHANGELOG.md` when release is enabled, and `.github/` for GitHub server policy.

`node hooks/doctor.js` checks both presence and git tracking. If harness files
are local but untracked, a clean worktree from `origin/main` cannot run
`node hooks/verify.js`, `design-gate.js`, or `cog bump --auto`.
The installer reports this expected first-run state as `bootstrapRequired: true`
and exits zero; use `--require-enforceable` when automation needs a hard gate.

## Verify

```bash
node hooks/test.js
node hooks/test.js --repeat 3
node hooks/verify.js [--list]
node hooks/verify.js --changed --base origin/main
node hooks/design-gate.js --base origin/main
node hooks/release-start.js --base origin/main
node hooks/release-manifest-bump.js --tag vX.Y.Z --dry-run
node hooks/release-preflight.js --tag vX.Y.Z --base origin/main
node hooks/release-preflight.js --tag vX.Y.Z --base origin/main --require-tag-in-base
node hooks/post-merge-cleanup.js --branch feat/example --base origin/main
node hooks/release-cleanup.js --base origin/main
node hooks/repo-state-audit.js --root ../development --accepted-root ../accepted-main --base main --strict
node hooks/doctor.js
node hooks/apply-ruleset.js --dry-run
```

## Branch lifecycle

Development branches and releases have separate lifecycles. Merge short-lived
feature/fix/docs/chore branches through verified PRs into `main`; after the PR
is server-confirmed `MERGED` and the resulting `main` CI succeeds, run
`post-merge-cleanup.js` in dry-run mode and then with `--apply`. The helper
deletes only merged local/remote refs and clean linked worktrees.

`main` may accumulate verified but unreleased changes for as long as needed.
The eventual SemVer bump is derived from Conventional Commits since the latest
tag. Keep incomplete behavior behind feature flags so `main` remains releasable.
Dirty, diverged, and unmerged branches are preserved. Release/hotfix branches
are retained until publication and artifact smoke testing complete.

For automation that keeps separate development and accepted-main checkouts, run
`repo-state-audit.js --strict` as the terminal gate. It requires both local
`main` refs to point to the same commit, all expected worktrees to be clean, and
no extra local branches or linked worktrees to remain. The audit is read-only;
cleanup and synchronization stay explicit coordinator actions.

## Full release

A request for a full release is standing authorization for the normal release
pushes, PR merges, computed SemVer tag, GitHub Release publication, and final
cleanup of merged development/release branches. It never authorizes bypasses,
force-pushes, deletion of unmerged work, or loss of dirty worktrees.

The safe sequence is intentionally two-PR:

1. Merge and verify the feature/fix PR on `main`.
2. Create a detached worktree at fresh `origin/main`, then run
   `node hooks/release-start.js --base origin/main`. The helper attaches a
   temporary allowed branch before Cocogitto computes SemVer and leaves the
   worktree on `release/vX.Y.Z`; create the version/changelog commit and local
   annotated tag there.
3. Run prepare preflight, push only the release branch, and merge its PR with a
   merge commit so the locally tagged release commit remains in `main`.
4. Wait for `main` CI and run post-merge preflight with
   `--require-tag-in-base --require-release-tip`. The gate requires the tag to
   be the exact release-PR head and rejects any concurrent `main` history that
   the tag does not contain.
5. Push the tag. The source release workflow verifies the exact tag, builds a
   source ZIP and SHA-256, smoke-tests the ZIP, and publishes the GitHub Release.
6. Download the published assets, compare the checksum, repeat the smoke check,
   then run `release-cleanup.js --apply` from a separate clean base worktree as
   a final audit for merged branches missed by post-merge cleanup.

This repository is source-only, so its release artifact is
`llm-dev-harness-vX.Y.Z.zip` plus a checksum file. Installed target repositories
do not receive this source-specific workflow; they must define artifacts and
version checks appropriate to their own runtime.

Do not add `HEAD` to Cocogitto's `branch_whitelist`. That would also permit a
real bump commit and tag from an arbitrary detached commit. `release-start.js`
keeps detached HEAD limited to the clean-base check, rolls back its temporary
branch on failure, and runs the real bump only after the final release branch
has been selected.

PowerShell-safe lefthook diagnostics:

```powershell
lefthook.cmd run pre-commit --command branch-guard --force --verbose
$msg = Join-Path $env:TEMP "commit-msg.txt"; Set-Content $msg "fix(hooks): test"; lefthook.cmd run commit-msg $msg --command no-coauthor --force --verbose
```

Use `--command` singular. If PowerShell blocks `lefthook.ps1`, run
`lefthook.cmd` or invoke the installed Node entrypoint directly.

CI uses `.github/workflows/ci.yml`; the `verify` job name is the required-check
context in the ruleset.
