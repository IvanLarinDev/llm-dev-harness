# llm-dev-harness

A compact dev-loop harness for agent-assisted code changes. It works with any
LLM runner that can execute git hooks and, optionally, agent adapter hooks.

The canonical operating contract is [AGENTS.md](./AGENTS.md): loop stages,
bootstrap, release flow, enforcement layers, and environment variables. This
README covers the stack and installation.

> Honest boundary: local hooks are hygiene. They catch mistakes before commit,
> but they are not a defense against an adversarial actor with write access to
> the worktree. Real enforcement is the server-side GitHub ruleset in
> `.github/rulesets/main.json`, where the required `verify` check is pinned to
> GitHub Actions through `integration_id`.
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
| Release preflight | local harness | [hooks/release-preflight.js](./hooks/release-preflight.js) |
| Agent adapter | local harness | [hooks/agent/guard.js](./hooks/agent/guard.js) |
| Agent config security audit | ecc-agentshield | [.github/workflows/ci.yml](./.github/workflows/ci.yml) |

Shared helpers live in [hooks/_lib.js](./hooks/_lib.js). VERIFY planning and
debug-audit policy live in [hooks/verify-core.js](./hooks/verify-core.js), with
[hooks/verify.js](./hooks/verify.js) kept as the CLI/runner wrapper.

## Install

```bash
node install.js --target ../my-project
node install.js
node install.js --dry-run
```

Double-click wrappers are also available: `install.cmd` on Windows and
`install.sh` on POSIX.

Useful flags:

- `--force`: overwrite existing harness files.
- `--with-ci`: add optional Dependabot; CI, CODEOWNERS, and ruleset templates are installed by default.
- `--code-owner @org/team`: write a real CODEOWNERS owner and enable required code-owner review in the target ruleset.
- `--with-ruleset`: apply the server ruleset immediately; requires `gh` admin access and a plan/repo that supports rulesets.
- `--json`: emit a machine-readable report.

Without `--code-owner`, the installer writes a CODEOWNERS template but keeps
`require_code_owner_review=false` in the target ruleset. This preserves the
regular approving-review requirement without deadlocking solo-maintainer
repositories on an owner that does not exist in the target project. The target
ruleset comment is rewritten to match that policy; re-run with
`--code-owner @org/team` when a real owner should become a required reviewer.

## Bootstrap PR

After installation, commit the harness into the target repository through a
separate bootstrap PR before treating the loop as mandatory. At minimum, commit
`hooks/`, `AGENTS.md`, `harness.config.json`, `lefthook.yml`, `cog.toml`,
`.gitleaks.toml`, `settings.example.json`, and `.github/` when CI/rulesets are
enabled.

`node hooks/doctor.js` checks both presence and git tracking. If harness files
are local but untracked, a clean worktree from `origin/main` cannot run
`node hooks/verify.js`, `design-gate.js`, or `cog bump --auto`.

## Verify

```bash
node hooks/test.js
node hooks/test.js --repeat 3
node hooks/verify.js [--list]
node hooks/verify.js --changed --base origin/main
node hooks/design-gate.js --base origin/main
node hooks/release-preflight.js --tag vX.Y.Z --base origin/main
node hooks/doctor.js
node hooks/apply-ruleset.js --dry-run
```

PowerShell-safe lefthook diagnostics:

```powershell
lefthook.cmd run pre-commit --command branch-guard --force --verbose
$msg = Join-Path $env:TEMP "commit-msg.txt"; Set-Content $msg "fix(hooks): test"; lefthook.cmd run commit-msg $msg --command no-coauthor --force --verbose
```

Use `--command` singular. If PowerShell blocks `lefthook.ps1`, run
`lefthook.cmd` or invoke the installed Node entrypoint directly.

CI uses `.github/workflows/ci.yml`; the `verify` job name is the required-check
context in the ruleset.
