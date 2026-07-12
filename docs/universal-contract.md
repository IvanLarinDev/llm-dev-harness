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

`.harness/installation.json` records the source version/commit, dirty-source
state, and SHA-256 of managed files. A normal install refuses uncommitted source
payloads; clean commits after a release tag are recorded as `tag-N-gSHA`, while
`--allow-dirty-source` explicitly admits a dirty snapshot and appends `+dirty`.
Detached disposable canary targets admit dirty source for pre-commit
validation but retain the same provenance marker. `--update` replaces a file
only when its current hash matches that baseline. A mismatch is a conflict.
`--replace-managed` is the explicit escape hatch for reviewed local runtime
changes; it still cannot replace project-owned files. `--force` is retained only
as a compatibility alias for `--update --replace-managed`.

`node hooks/uninstall.js` is the inverse operation for managed runtime. It
removes only hash-matching managed files and exact structured runtime additions,
preserves all project-owned files, and keeps its manifest plus executable when
conflicts remain. `--remove-modified` is required to delete reviewed modified
managed files; the uninstaller never gains authority over project-owned paths.

Legacy project policy is never silently upgraded. Installer JSON reports
`migrationRequired` entries for schema, UI routing, release contracts, server
policy, and a preserved `AGENTS.md` missing the branch lifecycle contract; the
project applies those changes in its own PR.

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

Branch conventions are configured independently from the provider adapter:

```json
{
  "branchLifecycle": {
    "managedPrefixes": ["feat/", "fix/", "task/", "story/"],
    "protectedBranches": ["main", "master"],
    "retainedPrefixes": ["release/", "hotfix/"]
  }
}
```

Cleanup considers only managed prefixes, always protects the configured base
branch in addition to `protectedBranches`, and reserves retained prefixes for
post-publication cleanup. This keeps naming project-specific without making
deletion less exact.

Branch lifecycle is a core harness rule with provider-specific evidence. Every
project uses Git ancestry, patch-equivalence classification, exact OID leases,
and the remote-aware terminal topology audit. The GitHub adapter additionally
installs a trusted `workflow_run` cleanup that runs only after `verify` succeeds
for a default-branch push, binds that SHA to one MERGED same-repository PR, and
checks the reviewed head SHA before deleting a development branch. Fork heads
and `release/*`/`hotfix/*` are excluded. Other providers keep cleanup as an
explicit coordinator action after equivalent merge and CI evidence; the harness
does not pretend that Git ancestry alone proves a server-side PR decision.

The universal local topology is one persistent canonical checkout. It returns
to clean `main` after each accepted change; feature and release worktrees are
disposable and removed after cleanup. The harness must not introduce a sibling
`<repo>-main` clone as an implicit accepted root. `--accepted-root` is reserved
for projects whose user-owned external pipeline explicitly requires two
independent persistent checkouts.

Patch-equivalent cleanup exists for squash and rebase merges. It is accepted
only when every non-merge patch outside the base already has an equivalent in
the base and provider evidence authorizes the exact branch head. Branches with
unique patches or merge commits outside the base remain ambiguous and are never
deleted automatically. Strict topology treats every remaining local or remote
branch as an incomplete lifecycle, regardless of whether it is merged,
equivalent, or unique.

Release version scope and artifact evidence are also project-owned:

```json
{
  "release": {
    "versioning": {
      "manifests": ["src/App/App.csproj"],
      "exclude": ["examples/**"],
      "allowMissing": false
    },
    "artifacts": [{
      "id": "app",
      "path": "dist/app-{version}.zip",
      "build": "npm run package",
      "smoke": "node scripts/smoke-release.js",
      "versionCommand": "node scripts/read-release-version.js"
    }]
  }
}
```

An explicit manifest list prevents unrelated independently versioned packages
from being bumped or compared to the current tag. Artifact commands receive the
tag, version, id, and repository-confined artifact path through `HARNESS_*`
environment variables. `workflowOwned: true` delegates build and smoke execution
to a project workflow; it is not a generic source-ZIP assumption. During
`--phase all`, the workflow must publish a schema-version-1
`release-evidence.json` beside the downloaded asset and checksum. Each evidence
entry carries the artifact id, exact version, asset/checksum paths, HTTPS
workflow and Release URLs, and `smokePassed: true`; the helper recomputes
SHA-256 and fails when evidence is absent or inconsistent.

## State Model

Installation and enforceability are separate states:

- `installed`: file/merge operations completed without conflicts.
- `bootstrapRequired`: required harness files exist but are not yet tracked in
  the repository. This is expected after a fresh install.
- `activationRequired`: the runtime was installed but Lefthook is unavailable or
  could not be wired on this machine.
- `enforceable`: local hooks are activated, doctor has no repository failures,
  and no `ENV` provisioning conditions remain.

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
