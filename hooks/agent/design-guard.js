#!/usr/bin/env node
// design-guard.js — AGENT-ADAPTER hook (runtime-agnostic), WARN-ONLY.
// Early heads-up: when the agent edits a UI file, remind it that the DESIGN stage
// requires >=N approved mockups (the hard gate is hooks/design-gate.js in VERIFY/CI).
// Wire on Write/Edit tools. Always exits 0 (note-only).

const fs = require("fs");
const path = require("path");
const { parse } = require(path.join(__dirname, "_input.js"));

const ROOT = path.join(__dirname, "..", "..");
const DEFAULTS = {
  globs: ["**/*.ui", "**/*.qml", "**/*.slint", "**/ui/**", "**/views/**", "**/widgets/**"],
  mockups: { dir: "design/mockups", min: 4 },
};
function loadCfg() {
  try {
    const ui = (JSON.parse(fs.readFileSync(path.join(ROOT, "harness.config.json"), "utf8")).ui) || {};
    return { globs: ui.globs || DEFAULTS.globs, mockups: { ...DEFAULTS.mockups, ...(ui.mockups || {}) } };
  } catch { return DEFAULTS; }
}
function globToRe(g) {
  const re = g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, " DS ").replace(/\*\*/g, " SS ").replace(/\*/g, "[^/]*")
    .replace(/ DS /g, "(?:.*/)?").replace(/ SS /g, ".*");
  return new RegExp("^" + re + "$");
}

(async () => {
  const { tool, filePath } = await parse();
  if (!/^(write|edit|multiedit|applypatch|create|str_replace)/i.test(tool) || !filePath) process.exit(0);
  const cfg = loadCfg();
  const mockRoot = String(cfg.mockups.dir).replace(/\\/g, "/").replace(/\/$/, "");
  const rel = filePath.replace(/\\/g, "/").replace(new RegExp("^" + ROOT.replace(/\\/g, "/") + "/?"), "");
  if (rel.startsWith(mockRoot + "/")) process.exit(0);
  if (!cfg.globs.map(globToRe).some((re) => re.test(rel) || re.test(filePath.replace(/\\/g, "/")))) process.exit(0);

  const text =
    `⚠️ design-guard: правка GUI-файла (${rel}). DESIGN-стадия требует ` +
    `>=${cfg.mockups.min} стилистически разных мокапа + approval до кода. ` +
    `Сгенерируй: node hooks/new-mockups.js <feature>; затем ${cfg.mockups.dir}/<feature>/APPROVED. ` +
    `Жёсткий гейт — hooks/design-gate.js (VERIFY/CI).`;
  try { process.stdout.write(JSON.stringify({ additionalContext: text }) + "\n"); } catch {}
  process.stderr.write(text + "\n");
  process.exit(0);
})();
