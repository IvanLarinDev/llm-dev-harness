# BACKLOG - llm-dev-harness

This backlog tracks engineering risk for the harness itself. P0 closes holes in
the enforcement model, P1 improves quality materially, and P2 is maturity or
automation.

## Current Review Merge

The latest Color Team review for the Dropwheel-installed harness was folded into
this source repository only. Do not patch the generated copy in
`C:\Users\poweruser\projects\csharp\dropwheel`; reinstall from this repo after
merge.

Resolved in this hardening pass:

- CI now targets `windows-latest`, installs .NET `10.0.x`, and keeps AgentShield
  explicitly on `bash`, so WPF targets are not verified on an incompatible Linux
  runner.
- `node hooks/verify.js` always includes harness syntax when harness files are
  present and adds git whitespace hygiene through `git diff --check` plus
  `git diff --cached --check`.
- `--changed` now runs harness syntax for changed harness files even when
  `hooks/test.js` is not tracked in a target install.
- Release preflight requires annotated tags, validates `CHANGELOG.md`, and has a
  post-merge mode that rejects tags outside `origin/main`.
- Target installs no longer hardcode the source maintainer in CODEOWNERS and no
  longer enable required code-owner review unless `--code-owner` is provided.
- Guard path handling covers common file-tool aliases and quoted shell paths, so
  protected harness writes cannot slip through `filename`, `target_file`, or
  quoted `rm "hooks/..."` style commands.
- Tracked repo text was converted to English/ASCII to avoid mixed-language
  instructions and Windows mojibake.

Remaining watch items:

- Keep AgentShield advisory until false positives are measured; then decide
  whether to make it a required check.
- Source-repo ruleset may still require code-owner review; target installs should
  enable it only with a real second maintainer or team.
- Target repositories still need artifact workflows appropriate to their own
  binary/package formats; the source harness workflow publishes a source ZIP.

## P0 - Server Enforcement

Local git hooks are an inner loop. They are fast, but `git commit --no-verify`
can bypass them. Real enforcement is the outer loop on GitHub: rulesets,
required status checks, required PRs, and blocked force-push/delete.

- **P0-0. Repository plan and visibility.** Private repositories need a GitHub
  plan that supports required rulesets/checks, or the repo must be public. Before
  publishing any repo, run a full-history `gitleaks detect`; public history and
  forks cannot be reliably recalled.
- **P0-1. CI mirror. Done.** `.github/workflows/ci.yml` runs doctor, gitleaks,
  cocogitto, `node hooks/verify.js`, strict `design-gate.js`, and advisory
  AgentShield. Current hardening makes the job Windows/.NET compatible for WPF
  targets.
- **P0-2. Ruleset on `main`. Done as versioned JSON.** It requires PRs, the
  pinned `verify` check, conversation resolution, and blocks force-push/delete.
  Apply with `node hooks/apply-ruleset.js`.
- **P0-3. PR flow ergonomics. Open.** Add a pull request template and optional
  `gh pr create` helper that reflects the loop: VERIFY, tests, DESIGN approval
  when GUI files changed, and release notes if relevant.
- **P0-4. Agent anti-bypass guard. Done.** `hooks/agent/guard.js` blocks
  no-verify, hook path rewrites, lefthook uninstall, `.git/hooks` writes,
  protected harness writes, lint-config weakening, degenerate loops, and
  malformed payloads. This pass adds path alias and quoted-path regressions.

## P1 - Quality

- **P1-5. GUI design-gate. Done.** User-visible GUI work requires at least four
  mode-appropriate DESIGN variants plus `APPROVED`, touched in the same branch
  diff; backend-only work outside UI paths skips the gate.
- **P1-6. Secret scanning. Done via gitleaks.**
- **P1-7. Signed commits. Deferred.** If it becomes mandatory, enforce it through
  the server ruleset rather than a local helper.
- **P1-8. Executable VERIFY. Done.** Multi-stack auto-detect, config overrides,
  `--changed`, debug audit, harness syntax, and git whitespace hygiene are
  covered by tests.
- **P1-9. CODEOWNERS and Dependabot. Updated.** Source repos can keep strict
  owners. Target installs default to a non-deadlocking template and require
  `--code-owner @org/team` to enable code-owner review.
- **P1-10. AgentShield audit. Advisory.** Keep `continue-on-error: true` until
  false positives are known.
- **P1-11. Debug audit. Done.** Changed files are scanned for hard debug markers
  and optional soft markers.

## P2 - Maturity

- **P2-10. Loop guard for non-shell tools. Done.**
- **P2-11. Release automation. Done via two-PR flow, cocogitto, post-merge
  preflight, source ZIP workflow, and safe merged-branch cleanup.**
- **P2-12. Doctor. Done.** Checks environment, tracked bootstrap files, line
  endings, required CI/ruleset contract, and release config.
- **P2-13. Quality-gate helper. Removed.** Prefer real linters/tests and git diff
  self-review over bespoke heuristics.
- **P2-14. Commit helper. Removed.** Use `cog commit`.

## Covered Practices

Conventional Commits, co-author trailer rejection, local main protection,
tag-vs-branch release discipline, runaway-loop guard, portable runner contract,
self-test suite, debug audit, GUI design approval, release preflight, and
server-side ruleset enforcement.
