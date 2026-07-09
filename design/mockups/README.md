# design/mockups

This directory stores mode-appropriate DESIGN evidence for user-visible UI
work. The evidence should answer the actual design question; four unrelated
themes are useful only when the UI is being created from scratch.

## Routing

| Change | Evidence |
|---|---|
| Backend with no UI impact | None. The gate skips when no changed path matches `ui.globs`. |
| Animation, low cost | Four written variants for one concrete scenario. |
| Animation, high fidelity | Four executable HTML/JavaScript motion prototypes. |
| Existing UI element or flow | Current visual language with four layout, placement, or interaction alternatives. |
| New UI from scratch | Four stylistically distinct visual directions. |

For a mixed backend/UI task, create evidence only for the user-visible slice.

## Commands

```text
node hooks/new-mockups.js <feature> --kind existing-ui --baseline <repo-path>
node hooks/new-mockups.js <feature> --kind new-ui
node hooks/new-mockups.js <feature> --kind animation --fidelity text --example <scenario>
node hooks/new-mockups.js <feature> --kind animation --fidelity js --example <scenario>
node hooks/new-mockups.js <feature> --kind backend
```

`existing-ui` requires a current repo UI file as its baseline. Animation
requires a concrete example so reviewers compare the same event and outcome.
`backend` creates no directory; it is an explicit reminder that the gate will
skip only when the diff does not touch configured UI paths.

## Structure

```text
design/mockups/
  <feature>/
    DESIGN.json
    01-<variant>.<html-or-md>
    02-<variant>.<html-or-md>
    03-<variant>.<html-or-md>
    04-<variant>.<html-or-md>
    NOTES.md
    APPROVED
```

`DESIGN.json` records the change kind, fidelity where relevant, baseline
references, concrete animation example, and variant files. Create `APPROVED`
only after the user selects a direction.

## Flow

1. Classify the user-visible change.
2. Run the matching command and refine all generated variants.
3. Show the alternatives to the reviewer and pick a direction.
4. Create `design/mockups/<feature>/APPROVED`.
5. Implement the GUI code.
6. Run `node hooks/design-gate.js --base main`.

Exit 0 means the gate is satisfied or there is no UI-path change. Exit 1 means
the branch lacks valid approved DESIGN evidence.
