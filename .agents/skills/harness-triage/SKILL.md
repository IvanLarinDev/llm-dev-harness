---
name: harness-triage
description: Triage Dropwheel canary reports for the llm-dev-harness; use when a report from dropwheel indicates an installer, doctor, verify, guard, design-gate, or harness contract failure.
---

# Harness Triage

Use this skill when a Dropwheel canary report needs to become a harness fix or a
handoff back to Dropwheel.

## Inputs

- A report under `inbox/dropwheel`.
- A report under
  `C:\Users\poweruser\projects\csharp\dropwheel\reports\harness-canary`.
- A pasted report with `schema = dropwheel-harness-canary/v1`.

## Workflow

1. Read both the Markdown report and `report.json` when available.
2. Identify:
   - canary run id
   - `agents` SHA
   - `dropwheel` SHA
   - failed step
   - failed command
   - failing worktree path
   - owner hint
3. Classify ownership:
   - installer, doctor, harness syntax, guard, design gate, verify runner, or
     generated harness file failure -> `agents-harness`
   - install and doctor green, Dropwheel build/test failure -> `dropwheel`
     unless the failure proves an unreasonable harness contract
   - unclear -> `needs-triage`
4. For `agents-harness`, reproduce with the failing worktree or a fresh
   Dropwheel canary run. Fix the smallest harness behavior in this repo and add
   regression coverage.
5. Verify with `node hooks\verify.js` in this repo.
6. Rerun the Dropwheel canary:

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Users\poweruser\projects\csharp\dropwheel\scripts\harness-canary.ps1
   ```

7. Report changed files, regression coverage, and the canary rerun result.

Do not patch Dropwheel application code from the agents repo unless the user
explicitly asks for cross-repo work.
