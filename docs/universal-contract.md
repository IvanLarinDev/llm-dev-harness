# Universal Harness Contract

llm-dev-harness is a repository-local process runtime, not a product template.
It may detect common stacks, but it must not assume a project is Dropwheel, uses
GitHub, publishes a source ZIP, or owns one independently versioned package.

## Ownership Boundary

| Owner | Files | Update rule |
|---|---|---|
| Harness | `hooks/`, `lefthook.yml`, `settings.example.json` | Hash-aware update through `install.js --update`. |
| Project | `AGENTS.md`, `harness.config.json`, `cog.toml`, `.gitleaks.toml`, `.gitattributes`, `CHANGELOG.md`, `.github/` | Seed only when missing; never replaced by install/update/force. |
| User/runtime | `.claude/settings.json`, `.gitignore` | Structured merge or append; foreign content is preserved. |

`.harness/installation.json` records the source version/commit and SHA-256 of
managed files. `--update` replaces a file only when its current hash matches that
baseline. A mismatch is a conflict. `--replace-managed` is the explicit escape
hatch for reviewed local runtime changes; it still cannot replace project-owned
files. `--force` is retained only as a compatibility alias for
`--update --replace-managed`.

## Capability Schema

`harness.config.json` schema version 2 declares adapters independently:

```json
{
  "schemaVersion": 2,
  "capabilities": {
    "ui": "auto",
    "release": "cocogitto",
    "serverPolicy": "github"
  }
}
```

- `ui`: `auto` uses configured `ui.globs` minus `ui.exclude`; `none` documents a
  backend-only repository. Explicit globs remain authoritative.
- `release`: `cocogitto` enables the bundled SemVer/changelog adapter; `none`
  removes that contract. Project artifact build, smoke, and version checks stay
  project-owned.
- `serverPolicy`: `github` enables ruleset/workflow consistency checks; `none`
  leaves enforcement to another hosting provider or to local hygiene only.

Installer `auto` mode detects a GitHub origin. GitHub repositories receive the
GitHub and Cocogitto defaults; non-GitHub/local repositories start with both
adapters set to `none`. Explicit `--release-provider cocogitto` on another host
uses a provider-neutral, project-owned Cocogitto template.

Unknown or future adapters must fail as unsupported where enforcement depends on
them; they must not silently inherit GitHub or source-ZIP behavior.

The GitHub adapter supports `solo` and `team` profiles. `solo` keeps PR and
trusted verify requirements but makes approving/code-owner review advisory;
`team` requires an approving review and can additionally require CODEOWNERS.
Profile flags are explicit structured edits to project config/policy. Ordinary
install/update/force runs still preserve those files byte-for-byte. Use
`apply-ruleset.js --check` or `doctor.js --server` for a read-only live drift
check before deciding whether to apply policy.

## State Model

Installation and enforceability are separate states:

- `installed`: file/merge operations completed without conflicts.
- `bootstrapRequired`: required harness files exist but are not yet tracked in
  the repository. This is expected after a fresh install.
- `activationRequired`: the runtime was installed but Lefthook is unavailable or
  could not be wired on this machine.
- `enforceable`: local hooks are activated and doctor has no failures.

A fresh successful installation exits zero with `bootstrapRequired: true` and
may also report `activationRequired: true` on a machine without Lefthook.
`--require-enforceable` turns any pending state into a non-zero automation gate.
Invalid Git state, malformed structured files, managed-file conflicts, failed
activation, and non-bootstrap doctor failures remain hard failures.

## Threat Boundary

Local hooks protect against mistakes and accidental bypasses, not a malicious
writer who can edit the worktree or Git configuration. Server policy is the
strongest repository gate when the provider supports protected branches and
trusted required checks. A workflow stored in the same writable repository is
still mutable through a reviewed change; organization-level required workflows
or equivalent external policy are stronger when available.

Dropwheel is one canary fixture. Canary-specific inbox routing stays in this
source repository and is never copied into target `AGENTS.md`.
