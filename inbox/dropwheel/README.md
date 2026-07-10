# Dropwheel Canary Reports

Machine-generated canary reports from Dropwheel can be mirrored here with:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\poweruser\projects\csharp\dropwheel\scripts\harness-canary.ps1 -MirrorToAgentsInbox
```

Review handoffs can also be written here as `review-handoff-*.md` plus
`review-handoff-*.json` when Dropwheel review finds harness-owned issues even
though the canary is green.

Each run or handoff should include a `.md` summary and a `.json` structured
report. Treat these files as auto-fix inputs, not as source-of-truth harness
changes. For harness-owned findings, the agents automation may create a local
feature-branch commit after `node hooks\verify.js` and the Dropwheel canary pass.
Move closed items to `_processed`.
