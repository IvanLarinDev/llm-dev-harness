# Dropwheel Harness Inbox

Dropwheel is the canary project for this harness. Reports arrive from:

- `C:\Users\poweruser\projects\csharp\dropwheel\reports\harness-canary`
- `inbox\dropwheel` when the canary is run with `-MirrorToAgentsInbox`
- `review-handoff-*.md` / `review-handoff-*.json` files created by a
  Dropwheel review
- a Codex thread or issue that pastes the same report contents

## Auto-Fix Loop

1. Read the latest unprocessed report or handoff Markdown and JSON.
2. Confirm the `agents` SHA, `dropwheel` SHA, owner hint, failed command, and
   failing worktree path.
3. If install, doctor, harness syntax, guard, design gate, release-preflight,
   CI/ruleset/CODEOWNERS, or verify runner failed because of source harness
   behavior, treat it as an `agents` harness bug.
4. If the report only says installer-created harness files are untracked in
   Dropwheel, and product verify passed, treat it as `dropwheel-harness-update`
   and route it back to Dropwheel auto-fix. Do not patch source harness code.
5. If install and doctor passed but Dropwheel build/tests failed, inspect
   whether the harness invoked an unreasonable contract. If the contract is
   fine, route the fix back to Dropwheel.
6. For valid harness bugs, fix automatically. Reproduce in a disposable target
   worktree when useful, change the smallest harness behavior, and add a
   regression test in `agents`.
7. If the main `agents` checkout is dirty before the run, create an isolated
   local worktree under `.codex\auto-fix-worktrees` and make code changes there.
   Keep inbox bookkeeping in the main checkout.
8. If the checkout used for the fix is clean and verification passes, create a
   local feature branch commit with a Conventional Commit message. Do not push,
   merge, release, reset, force-push, or bypass hooks unless the user explicitly
   asks.
9. Run:

   ```powershell
   node hooks\verify.js
   powershell -ExecutionPolicy Bypass -File C:\Users\poweruser\projects\csharp\dropwheel\scripts\harness-canary.ps1 -AgentsRoot <fixed-agents-root>
   ```

10. Report the fix with the original canary run id or review handoff id and the
   verification commands.
11. Move closed `.md`/`.json` pairs into `inbox\dropwheel\_processed`.

Do not edit Dropwheel application code from this repo unless the user explicitly
asks for cross-repo work. The default handoff for Dropwheel-owned failures is a
short report back to the Dropwheel project.
