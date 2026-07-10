# Agents Dropwheel Auto-Fix Prompt

Poll Dropwheel handoffs and automatically fix harness-owned findings in
`agents`.

Assigned fix worker mode:

When invoked by the orchestrator as an assigned fix worker, process only the
single handoff or fingerprint named by the coordinator.

In this mode:

- create a unique isolated local worktree under `.codex\auto-fix-worktrees`;
- create or use a feature branch inside that isolated worktree;
- do not edit the shared agents checkout directly;
- do not move inbox items into `_processed`;
- write fix and verification metadata back to the run manifest;
- do not merge, push, release, reset, force-push, or use bypass variables.

The coordinator moves inbox items only after the branch is verified and either
accepted or explicitly routed away.

Inputs:

- `C:\Users\poweruser\projects\llms\agents\inbox\dropwheel\*.md`
- `C:\Users\poweruser\projects\llms\agents\inbox\dropwheel\*.json`

Ignore:

- canary reports with `OK: True` or `"ok": true` unless they are attached to a
  review handoff that names harness findings.
- files already moved under `_processed`.

Process:

1. Read newest unprocessed handoff/report pairs first.
2. Classify each item:
   - `agents-harness`: installer, doctor, verify, guard, design-gate,
     release-preflight, CI/ruleset/CODEOWNERS, or harness instruction behavior.
   - `dropwheel-harness-update`: installer output only needs to be accepted and
     tracked in Dropwheel; product verify passes.
   - `dropwheel`: application code or product behavior only.
   - `needs-triage`: ownership unclear.
3. For `dropwheel`, do not edit Dropwheel from this repo. Route the item back to
   Dropwheel auto-fix.
4. For `dropwheel-harness-update`, route the item back to Dropwheel auto-fix.
   Do not change harness source code in `agents` unless the report proves a
   source harness behavior defect.
5. For `needs-triage`, gather local evidence. Ask the user only if ownership
   cannot be classified from the report, code, and reproduction.
6. For `agents-harness`, fix automatically:
   - reproduce if possible;
   - make the smallest harness behavior change in `agents`;
   - add or update regression coverage in `agents`;
   - do not edit Dropwheel application code.
7. Before editing, run:

   ```powershell
   node hooks\doctor.js
   git status --short
   ```

8. If the current checkout is dirty before the run, do not mix harness code
   edits into it. Create an isolated local worktree for the fix under
   `.codex\auto-fix-worktrees`, for example from `origin/main`, then apply the
   harness fix there. Keep inbox bookkeeping in the main checkout.
9. If the current checkout is clean, create or switch to a local feature branch
   before editing. Never commit directly on `main`.
10. Verify in the checkout where the fix was made with:

   ```powershell
   node hooks\verify.js
   ```

11. Then run the Dropwheel canary against the fixed harness root:

    ```powershell
    powershell -ExecutionPolicy Bypass -File C:\Users\poweruser\projects\csharp\dropwheel\scripts\harness-canary.ps1 -AgentsRoot <fixed-agents-root>
    ```

12. Read verification output, not just exit codes. Fix new warnings or explain
    why they are unrelated.
13. If `verify` and canary are green, create a local conventional commit in the
    fix checkout. Do not push, merge, release, reset, force-push, or use bypass
    environment variables.
14. In normal serialized mode, when an item is closed or explicitly routed
    away, move its `.md` and `.json` into `inbox\dropwheel\_processed`. In
    assigned fix-worker mode, leave inbox movement to the coordinator.

Safety:

- Never weaken harness checks to make a finding disappear.
- Never use `--no-verify`, `LEFTHOOK=0`, `HARNESS_ACK_BYPASS=1`, or
  `HARNESS_DISABLED_CHECKS`.
- Do not edit Dropwheel application code from this automation.
- If a fix needs product judgment instead of harness judgment, route it back to
  Dropwheel.

Finish quietly when no actionable unprocessed handoffs exist.
