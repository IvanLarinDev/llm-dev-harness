# Agents Harness Discovery Review Prompt

Find and fix real harness risks in `agents`.

This task reviews harness source behavior, not Dropwheel product code. It may
fix small confirmed harness issues automatically when verification and the
Dropwheel canary pass.

## Parallel Worker Mode

When invoked by the orchestrator as a parallel discovery worker, this prompt is
read-only:

- do not edit harness source, docs, tests, or inbox files;
- do not create branches, commits, merges, pushes, or releases;
- do not move inbox items into `_processed`;
- do not run the Dropwheel canary unless assigned as a verification worker;
- return structured candidate findings only.

For each candidate include `owner`, `severity`, `confidence`, `category`,
`evidence`, `impact`, `recommendation`, `testToAdd`, checked scope, and a
stable `fingerprint`:

```text
agents-harness|<subsystem>|<file-or-contract>|<invariant-or-failure-mode>
```

The orchestrator owns dedupe, branch creation, inbox movement, and merge
decisions after parallel workers finish.

## Scope

Review:

- `install.js`
- `hooks/**`
- `harness.config.json`
- `lefthook.yml`
- `.github/workflows/**`
- `.github/rulesets/**`
- `.github/CODEOWNERS`
- `AGENTS.md`, `README.md`, and harness docs only when they affect agent
  behavior or operator safety
- `inbox\dropwheel\*.md` and `*.json` for incoming evidence

Do not edit Dropwheel application code from this automation.

## Process

1. Inspect current state:

   ```powershell
   git status --short
   node hooks\verify.js --list
   ```

2. Choose a review slice:
   - changed harness files first;
   - otherwise recent Dropwheel handoffs/canary failures;
   - otherwise one rotating harness subsystem: installer, doctor, verify,
     guard, design-gate, release-preflight, CI/ruleset/CODEOWNERS.
3. Run an evidence-first Color Team Review on that slice:
   - focus on false positives/false negatives, bypasses, stale worktree
     scanning, bad ownership routing, unsafe installer behavior, CI drift,
     release safety, and unclear failure output;
   - do not invent findings.
4. In normal serialized or assigned fix-worker mode, if a confirmed or likely
   harness-owned P0/P1 issue can be fixed without user product judgment:
   - reproduce it if practical;
   - if the current checkout is dirty, create an isolated worktree under
     `.codex\auto-fix-worktrees`;
   - make the smallest harness source fix;
   - add or update regression coverage;
   - run `node hooks\verify.js`;
   - run Dropwheel canary against the fixed agents root:

     ```powershell
     powershell -ExecutionPolicy Bypass -File C:\Users\poweruser\projects\csharp\dropwheel\scripts\harness-canary.ps1 -AgentsRoot <fixed-agents-root>
     ```

   - if both pass, create a local feature branch and conventional commit.
5. If the finding is product-owned or only `dropwheel-harness-update`, route it
   back to Dropwheel instead of editing harness source.
6. If no substantial finding exists, report the checked slice and residual risk.

## Safety

- Never push, merge, release, reset, force-push, or use bypass environment
  variables.
- Never weaken harness checks just to remove a finding.
- Keep findings merged by root cause; do not create duplicate work.
