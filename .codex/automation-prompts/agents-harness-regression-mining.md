# Agents Harness Regression Mining Prompt

Mine recent harness evidence for missing regression tests or recurring failure
patterns.

## Parallel Worker Mode

When invoked by the orchestrator as a parallel discovery worker, this prompt is
read-only:

- do not edit harness source or tests;
- do not create branches, commits, merges, pushes, or releases;
- do not move inbox items into `_processed`;
- do not run the Dropwheel canary unless assigned as a verification worker;
- return structured candidate findings only.

For each candidate include `owner`, `severity`, `confidence`, `evidence`,
`impact`, `recommendation`, `testToAdd`, checked reports/inbox items, and a
stable `fingerprint`:

```text
agents-harness|regression|<hook-or-contract>|<missing-test-or-failure-mode>
```

The orchestrator owns dedupe, branch creation, inbox movement, and merge
decisions after parallel workers finish.

## Inputs

- `git status --short`
- `git log --oneline --decorate -20`
- `hooks\test.js`
- `inbox\dropwheel\*.md`
- `inbox\dropwheel\*.json`
- Dropwheel canary reports mirrored into the inbox

Ignore `_processed` items except for duplicate detection.

## Process

1. Look for:
   - fixed harness bugs without a regression assertion in `hooks\test.js`;
   - repeated handoff signatures;
   - false-green or false-red behavior in installer, doctor, verify, guard, or
     design-gate;
   - ownership routing mistakes between `agents-harness`,
     `dropwheel-harness-update`, and `dropwheel`.
2. For each candidate, require evidence from code, test output, or a report.
3. In normal serialized or assigned fix-worker mode, if a small
   confirmed/likely harness regression test is missing, add the test and the
   smallest source fix only if needed.
4. In normal serialized or assigned fix-worker mode, run:

   ```powershell
   node hooks\verify.js
   powershell -ExecutionPolicy Bypass -File C:\Users\poweruser\projects\csharp\dropwheel\scripts\harness-canary.ps1 -AgentsRoot <fixed-agents-root>
   ```

5. In normal serialized or assigned fix-worker mode, if green, create a local
   feature branch and conventional commit. If the main checkout is dirty, use
   `.codex\auto-fix-worktrees`.
6. Do not edit Dropwheel product code.

Finish quietly when no actionable regression candidate exists.
