#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const SEVERITY_RANK = { minor: 0, major: 1, blocker: 2 };

function warning(list, count, label) {
  if (count) list.push(`skipped ${count} ${label}${count === 1 ? "" : "s"}`);
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function foldLog(text) {
  const cuts = new Map();
  const resolves = new Map();
  const counts = { torn: 0, malformed: 0, unknown: 0, duplicateCuts: 0, duplicateResolves: 0, orphans: 0 };
  let complete = String(text || "");

  if (complete && !complete.endsWith("\n")) {
    counts.torn++;
    const lastNewline = complete.lastIndexOf("\n");
    complete = lastNewline < 0 ? "" : complete.slice(0, lastNewline + 1);
  }

  for (const raw of complete.split("\n")) {
    if (!raw) continue;
    let value;
    try { value = JSON.parse(raw); } catch { counts.malformed++; continue; }

    if (value && value.kind === "cut") {
      const valid = typeof value.id === "string" && /^pc_[0-9a-f]{12}$/.test(value.id) &&
        validTimestamp(value.ts) && typeof value.agent === "string" && typeof value.text === "string" &&
        Object.hasOwn(SEVERITY_RANK, value.severity) && Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string") &&
        typeof value.cwd === "string" && (value.repo === null || typeof value.repo === "string");
      if (!valid) { counts.malformed++; continue; }
      if (cuts.has(value.id)) counts.duplicateCuts++;
      else cuts.set(value.id, { ...value, tags: [...value.tags].sort() });
    } else if (value && value.kind === "resolve") {
      const valid = typeof value.id === "string" && /^pc_[0-9a-f]{12}$/.test(value.id) &&
        validTimestamp(value.ts) && typeof value.agent === "string" && (value.note === null || value.note === undefined || typeof value.note === "string");
      if (!valid) { counts.malformed++; continue; }
      if (resolves.has(value.id)) counts.duplicateResolves++;
      else resolves.set(value.id, value);
    } else {
      counts.unknown++;
    }
  }

  for (const id of resolves.keys()) if (!cuts.has(id)) counts.orphans++;
  const items = [...cuts.values()].map((cut) => ({
    cut,
    resolution: resolves.get(cut.id) || null,
    status: resolves.has(cut.id) ? "resolved" : "open",
  }));
  items.sort((left, right) =>
    SEVERITY_RANK[right.cut.severity] - SEVERITY_RANK[left.cut.severity] ||
    Date.parse(right.cut.ts) - Date.parse(left.cut.ts) ||
    left.cut.id.localeCompare(right.cut.id));

  const warnings = [];
  warning(warnings, counts.torn, "torn final line");
  warning(warnings, counts.malformed, "malformed line");
  warning(warnings, counts.unknown, "unknown event");
  warning(warnings, counts.duplicateCuts, "duplicate cut");
  warning(warnings, counts.duplicateResolves, "duplicate resolve");
  warning(warnings, counts.orphans, "orphan resolve");
  return { items, warnings };
}

function markdown(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|\-])/g, "\\$1");
}

function code(value) {
  return `\`${String(value ?? "").replace(/`/g, "'")}\``;
}

function heading(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderItems(items) {
  if (!items.length) return "_None._\n";
  const lines = [];
  for (const item of items) {
    const cut = item.cut;
    const tags = cut.tags.length ? cut.tags.map(code).join(", ") : "none";
    lines.push(`- **${cut.severity}** ${code(cut.id)} — ${markdown(cut.text)}`);
    lines.push(`  - Reported ${code(cut.ts)} by ${code(cut.agent)}; tags: ${tags}`);
    if (item.resolution) {
      const note = item.resolution.note ? ` — ${markdown(item.resolution.note)}` : "";
      lines.push(`  - Resolved ${code(item.resolution.ts)} by ${code(item.resolution.agent)}${note}`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderDigest(folded, options = {}) {
  const tag = options.tag || "unversioned";
  const repository = options.repository || "repository";
  const open = folded.items.filter((item) => item.status === "open");
  const resolved = folded.items.filter((item) => item.status === "resolved");
  const lines = [
    `# Papercuts snapshot for ${heading(tag)}`,
    "",
    `Append-only friction snapshot for ${markdown(repository)} at release ${code(tag)}.`,
    "",
    "| Status | Count |",
    "|---|---:|",
    `| Open | ${open.length} |`,
    `| Resolved | ${resolved.length} |`,
    `| Total | ${folded.items.length} |`,
    "",
    "## Open",
    "",
    renderItems(open).trimEnd(),
    "",
    "## Resolved",
    "",
    renderItems(resolved).trimEnd(),
  ];
  if (folded.warnings.length) {
    lines.push("", "## Data quality warnings", "", ...folded.warnings.map((item) => `- ${markdown(item)}`));
  }
  return lines.join("\n") + "\n";
}

function parseArgs(argv) {
  const out = { input: ".papercuts.jsonl", output: "", tag: "", repository: "" };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--input", "--output", "--tag", "--repository"].includes(key)) throw new Error(`unknown argument: ${key}`);
    if (!argv[i + 1]) throw new Error(`${key} requires a value`);
    out[key.slice(2)] = argv[++i];
  }
  if (!out.output) throw new Error("--output is required");
  if (!out.tag) throw new Error("--tag is required");
  return out;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const input = path.resolve(args.input);
  const output = path.resolve(args.output);
  const text = fs.existsSync(input) ? fs.readFileSync(input, "utf8") : "";
  const folded = foldLog(text);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderDigest(folded, { tag: args.tag, repository: args.repository }), "utf8");
  const open = folded.items.filter((item) => item.status === "open").length;
  const resolved = folded.items.length - open;
  console.log(JSON.stringify({ ok: true, data: { output, open, resolved, warnings: folded.warnings } }));
}

if (require.main === module) {
  try { run(); } catch (error) {
    console.error(`papercuts-release: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { foldLog, renderDigest, parseArgs, run };
