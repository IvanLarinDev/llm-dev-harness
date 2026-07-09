# design/mockups

This directory supports the harness DESIGN stage for GUI work.

Any change that touches UI paths from `harness.config.json -> ui.globs` must
have an approved set of at least four stylistically distinct mockups in the same
branch diff. This is an executable gate, not a reminder.

## Structure

```text
design/mockups/
  <feature>/
    01-minimal-light.html
    02-dark-pro.html
    03-high-contrast-a11y.html
    04-playful-rounded.html
    NOTES.md
    APPROVED
```

Create `APPROVED` only after review.

## Flow

1. Run `node hooks/new-mockups.js <feature>`.
2. Turn the generated placeholders into realistic screens.
3. Show them to the reviewer and pick a direction.
4. Create `design/mockups/<feature>/APPROVED`.
5. Implement GUI code. `hooks/design-gate.js` checks the gate during VERIFY/CI.

Manual check:

```bash
node hooks/design-gate.js --base main
```

Exit 0 means OK. Exit 1 means UI changed without approved mockups.
