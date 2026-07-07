#!/usr/bin/env node
// tool-loop-guard.js — AGENT-ADAPTER hook (runtime-agnostic), BLOCKING.
// loop-guard.js covers runaway *Bash* series; this covers the gap (BACKLOG P2-10):
// degenerate NON-Bash tool loops — the agent hammering the SAME tool on the SAME
// target (e.g. Read-ing or Write-ing one file over and over without progress).
//
// Precise-by-design to avoid false positives: it only counts EXACT consecutive
// repeats of (tool + target). Any different target resets the streak, so normal
// iterative editing across files is never blocked. Threshold is deliberately high.
//
// Wire on Read/Write/Edit/MultiEdit (and similar). Block = exit 2.
// Threshold: HARNESS_TOOLLOOP_THRESHOLD (default 12). State/IO errors → exit 0.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { parse } = require(path.join(__dirname, "_input.js"));

const THRESHOLD = Number(process.env.HARNESS_TOOLLOOP_THRESHOLD) || 12;
const TTL_MS = 1000 * 60 * 60 * 2;

function stateFile(sessionId, projectDir) {
  const id = sessionId || "proj-" + crypto.createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `harness-toolloop-${id}.json`);
}
function readState(p) {
  try { const s = JSON.parse(fs.readFileSync(p, "utf8")); if (Date.now() - s.ts > TTL_MS) return { key: "", streak: 0 }; return s; }
  catch { return { key: "", streak: 0 }; }
}
function writeState(p, s) { try { fs.writeFileSync(p, JSON.stringify({ ...s, ts: Date.now() })); } catch {} }

(async () => {
  const { tool, filePath, sessionId, projectDir } = await parse();
  // Only non-shell, target-bearing tools. No target → nothing precise to guard.
  if (!tool || /^(bash|shell|sh|exec|run|terminal|execute)/i.test(tool) || !filePath) process.exit(0);

  const key = `${tool.toLowerCase()}::${filePath}`;
  const p = stateFile(sessionId, projectDir);
  const st = readState(p);

  if (st.key === key) st.streak += 1;
  else { st.key = key; st.streak = 1; }

  if (st.streak >= THRESHOLD) {
    writeState(p, { key: "", streak: 0 });
    process.stderr.write(
      `🛑 tool-loop-guard: ${st.streak}× подряд одна и та же операция «${tool}» над одним и тем же ` +
        `объектом:\n   ${filePath}\n   Похоже на зацикливание без прогресса. Остановись, пересмотри ` +
        `план/TodoWrite, смени подход. Порог: HARNESS_TOOLLOOP_THRESHOLD (сейчас ${THRESHOLD}).\n`
    );
    process.exit(2);
  }

  writeState(p, st);
  process.exit(0);
})();
