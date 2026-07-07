#!/usr/bin/env node
// loop-guard.js — AGENT-ADAPTER hook (runtime-agnostic).
// Detects degenerate / runaway tool-loops that git cannot see: series of trivial
// commands (echo a, echo b, …), repeats of one command, or tool-markup garbage
// leaking into the shell.
//
// This is the ONE guard with no git-native equivalent — it's about the agent's
// tool loop, so it must live in the runtime-adapter layer.
//
// Wire it on the shell/Bash tool as a pre-tool-use hook. Block = exit 2.
// Stateful per session; all state/IO errors → exit 0 (never wedge the session).

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { parse } = require(path.join(__dirname, "_input.js"));

const THRESHOLD = Number(process.env.HARNESS_LOOP_THRESHOLD) || 5;
const STATE_TTL_MS = 1000 * 60 * 60 * 2; // 2h

function stateKey(sessionId, projectDir) {
  // Prefer a real session id; otherwise fall back to a per-project key so that
  // concurrent sessions in different repos don't share (and corrupt) a counter.
  const id = sessionId || "proj-" + crypto.createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `harness-loop-guard-${id}.json`);
}
function readState(p) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Date.now() - raw.ts > STATE_TTL_MS) return { streak: 0, lastCmd: "", ts: Date.now() };
    return raw;
  } catch {
    return { streak: 0, lastCmd: "", ts: Date.now() };
  }
}
function writeState(p, st) {
  try { fs.writeFileSync(p, JSON.stringify({ ...st, ts: Date.now() })); } catch {}
}

// --- detectors ---
const CORRUPTION_RE = /<\/?tool|^\s*["']\s*,?\s*\d*\s*<|<tool$/i;

function isTrivial(cmd) {
  const c = cmd.trim();
  if (!c) return true;
  if (/^echo\s+(['"]?)([^\s|;&"'{}]{1,8})\1$/.test(c)) return true; // echo <one short token>
  if (/^ls(\s+-{1,2}[a-zA-Z-]+)*\s*$/.test(c)) return true;         // bare ls / ls -la
  if (/^(pwd|true|false|clear|date)\s*$/.test(c)) return true;
  if (/^:\s*$/.test(c)) return true;
  return false;
}
function isRepeat(cmd, lastCmd) {
  return !!lastCmd && cmd.trim() === lastCmd.trim();
}
function isLowEntropy(cmd) {
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return false;
  return new Set(tokens).size / tokens.length < 0.35;
}
function classify(cmd) {
  if (CORRUPTION_RE.test(cmd)) return { severe: "мусор из tool-разметки в команде" };
  if (isLowEntropy(cmd)) return { severe: "аномально низкая энтропия токенов команды" };
  return { trivial: isTrivial(cmd), severe: null };
}

function emitBlock(reason, extra) {
  process.stderr.write(
    `🛑 loop-guard: ПОХОЖЕ НА ЗАЦИКЛИВАНИЕ.\n` +
      `   Причина: ${reason}\n   ${extra}\n` +
      `   Остановись, переосмысли задачу, проверь план/TodoWrite. ` +
      `Если команда действительно нужна — реши задачу иначе (один скрипт вместо серии) ` +
      `и поясни цель. Порог: HARNESS_LOOP_THRESHOLD (сейчас ${THRESHOLD}).\n`
  );
  process.exit(2);
}

(async () => {
  const { tool, command, sessionId, projectDir } = await parse();
  const isShell = /^(bash|shell|sh|exec|run|terminal|execute)/i.test(tool) || (!tool && command);
  if (!isShell || typeof command !== "string" || !command) process.exit(0);

  const p = stateKey(sessionId, projectDir);
  const st = readState(p);
  const { trivial, severe } = classify(command);

  if (severe) {
    writeState(p, { streak: 0, lastCmd: command });
    emitBlock(severe, `Команда: ${JSON.stringify(command.slice(0, 120))}${command.length > 120 ? "…" : ""}`);
  }

  if (trivial) {
    st.streak = isRepeat(command, st.lastCmd) ? st.streak + 2 : st.streak + 1;
    st.lastCmd = command;
    if (st.streak >= THRESHOLD) {
      writeState(p, { streak: 0, lastCmd: "" });
      emitBlock(
        `≥${THRESHOLD} тривиальных/повторяющихся команд подряд (streak=${st.streak})`,
        `Последняя: ${JSON.stringify(command.slice(0, 80))}. Дегенеративный паттерн.`
      );
    }
    writeState(p, st);
    process.exit(0);
  }

  // real command → reset streak
  if (st.streak > 0 || st.lastCmd) writeState(p, { streak: 0, lastCmd: "" });
  process.exit(0);
})();
