// _input.js — runtime-agnostic input normalizer for the agent-adapter hooks.
//
// Different LLM harnesses describe a pending tool call with different field names.
// These hooks read a JSON payload on stdin and normalize it, so the SAME hook works
// under Claude Code, a custom Agent SDK loop, or any runner that can pipe JSON and
// react to the exit code.
//
// Normalized contract returned by parse():
//   { tool, command, filePath, sessionId, projectDir, raw }
//
// Exit-code convention (documented for all runtimes):
//   exit 0  = allow
//   exit 2  = BLOCK the pending tool call (Claude Code PreToolUse "deny")
//   stdout {"additionalContext": "..."} = non-blocking note injected into context
//   stderr text = human-readable reason (shown by most runners)

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 500); // never hang if stdin stays open
  });
}

function firstString(...vals) {
  for (const v of vals) if (typeof v === "string" && v.length) return v;
  return "";
}

async function parse() {
  let raw = {};
  try {
    raw = JSON.parse((await readStdin()) || "{}");
  } catch {
    raw = {};
  }
  const ti = raw.tool_input || raw.toolInput || raw.input || raw.arguments || {};
  return {
    tool: firstString(raw.tool_name, raw.toolName, raw.tool, raw.name),
    command: firstString(ti.command, raw.command),
    filePath: firstString(ti.file_path, ti.path, ti.filePath, raw.file_path, raw.path),
    sessionId: firstString(
      process.env.HARNESS_SESSION_ID,
      process.env.CLAUDE_SESSION_ID,
      process.env.ZCODE_SESSION_ID,
      raw.session_id,
      raw.sessionId
    ),
    projectDir: firstString(
      process.env.HARNESS_PROJECT_DIR,
      process.env.CLAUDE_PROJECT_DIR,
      process.env.ZCODE_PROJECT_DIR,
      raw.cwd,
      process.cwd()
    ),
    raw,
  };
}

function note(text) {
  // Non-blocking: Claude Code reads {additionalContext} from stdout; other runners
  // can read the stderr mirror.
  try { process.stdout.write(JSON.stringify({ additionalContext: text }) + "\n"); } catch {}
  process.stderr.write(text + "\n");
  process.exit(0);
}

function block(text) {
  process.stderr.write(text + "\n");
  process.exit(2);
}

module.exports = { parse, note, block, firstString };
