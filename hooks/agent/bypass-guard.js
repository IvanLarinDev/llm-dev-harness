#!/usr/bin/env node
// bypass-guard.js — AGENT-ADAPTER hook (runtime-agnostic), BLOCKING.
//
// "Make it hard to cheat the guardrails." An agent can neutralize the entire
// git-native layer with a single flag: `git commit --no-verify`, `git push --no-verify`,
// `git commit -n`, or by rewriting/unsetting core.hooksPath. This guard runs on the
// shell tool and blocks those bypasses BEFORE the command runs.
//
// It is NOT a substitute for server-side checks (a determined human can still bypass
// locally) — it exists so the *agent* cannot silently skip the harness.
//
// Escape hatch for a genuine, human-approved emergency: HARNESS_ACK_BYPASS=1
//   (mirrors HARNESS_ALLOW_MAIN — an explicit, auditable acknowledgement).
//
// Wire on the shell/Bash tool. Block = exit 2. Internal error → exit 0.

const path = require("path");
const { parse, block } = require(path.join(__dirname, "_input.js"));

function envAllow(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

// Blank out quoted substrings so a commit MESSAGE that merely mentions "-n" or
// "--no-verify" (e.g. git commit -m "add -n flag") is not mistaken for a bypass.
function scrubQuotes(cmd) {
  return cmd.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

// Notes on short flags (why `-n` is scoped to `commit` only):
//   git commit -n     → --no-verify (BYPASS)
//   git merge  -n     → --no-stat   (harmless)
//   git revert -n     → --no-commit (harmless)
// so `-n` / combined `-vn` is treated as a bypass ONLY for `git commit`.
const BYPASS = [
  { re: /\bgit\s+commit\b[^\n]*(?:\s--no-verify\b|\s-[a-z]*n[a-z]*\b)/i,
    why: "--no-verify / -n на git commit — пропускает pre-commit и commit-msg" },
  { re: /\bgit\s+merge\b[^\n]*\s--no-verify\b/i,
    why: "--no-verify на git merge — пропускает pre-merge-commit / commit-msg" },
  { re: /\bgit\s+push\b[^\n]*\s--no-verify\b/i,
    why: "--no-verify на git push — пропускает pre-push" },
  { re: /\bgit\s+config\b[^\n]*\bcore\.hookspath\b/i,
    why: "правка core.hooksPath — отключение/подмена git-native хуков" },
];

(async () => {
  const { tool, command } = await parse();
  const isShell = /^(bash|shell|sh|exec|run|terminal|execute)/i.test(tool) || (!tool && command);
  if (!isShell || typeof command !== "string" || !command) process.exit(0);

  const scrubbed = scrubQuotes(command);
  const hit = BYPASS.find((b) => b.re.test(scrubbed));
  if (!hit) process.exit(0);

  if (envAllow("HARNESS_ACK_BYPASS")) {
    try {
      process.stdout.write(JSON.stringify({
        additionalContext:
          `⚠️ bypass-guard: harness обходится осознанно (HARNESS_ACK_BYPASS=1): ${hit.why}. ` +
          `Убедись, что это одобрено пользователем и обосновано в отчёте.`,
      }) + "\n");
    } catch {}
    process.exit(0);
  }

  block(
    `🛑 bypass-guard: команда обходит harness — заблокировано.\n` +
      `   Причина: ${hit.why}.\n` +
      `   Агент не должен «тихо» отключать проверки. Если обход реально нужен и одобрен\n` +
      `   пользователем — повтори с HARNESS_ACK_BYPASS=1 и обоснуй в отчёте.\n` +
      `   Настоящая защита от --no-verify — серверный required-check (см. BACKLOG P0-1).`
  );
})();
