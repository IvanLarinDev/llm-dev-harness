# CLAUDE.md - repository operating notes

## Cowork Mode File Access

In Cowork mode this folder can have two inconsistent access paths:

- File tools such as Read, Write, and Edit write directly to the real disk.
  They are the source of truth for file contents.
- `bash` through `mcp__workspace__bash` may operate through a separate mounted
  sandbox. Its cache can diverge from NTFS, and writes/deletes may be gated.

That mismatch can produce false damage signals: phantom `.git/index.lock`, files
that look truncated, or `rm` failing with `Operation not permitted`. Treat those
as mount artifacts, not evidence that the real disk is broken.

Rules:

1. Edit repository files through file tools, not bash writes such as `sed -i`,
   redirects, `node fs.writeFileSync`, `cat > file`, or `tee`.
2. Use bash only for running and reading commands, such as `node hooks/test.js`
   or `node hooks/verify.js`. Do not infer file contents from stale bash output;
   read the file directly.
3. Run git-heavy work such as commit, checkout, rebase, lefthook, and cog in Code
   mode or a native Windows terminal, not through Cowork bash.
4. If bash `rm` fails with `Operation not permitted`, request the appropriate
   Cowork delete permission for the path instead of doing filesystem forensics.
5. Run `node hooks/doctor.js` natively on Windows. Its `.git` lock probe writes
   into `.git`, and mounted bash can leave misleading artifacts.

## Harness

Canonical instructions live in [AGENTS.md](./AGENTS.md). Before editing hooks,
read the "Harness Layers" section. Harness files such as `hooks/`,
`lefthook.yml`, configs, and workflows are protected by `guard.js` and should be
changed only for explicit harness work.

After changes, run `node hooks/test.js`, then `node hooks/verify.js`.
