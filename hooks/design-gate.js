#!/usr/bin/env node
// design-gate.js — DESIGN-stage gate.
//
// Policy: GUI work must be preceded by design review. If a branch's changes touch UI
// paths, the SAME branch diff must also touch an APPROVED set of >= N mockups —
// otherwise one old approval would open the gate for all future UI work forever.
//
// Usage:
//   node hooks/design-gate.js [--base <ref>] [--root <dir>] [--files a,b,c] [--json]
//     --base   git ref to diff against (default: main)         [CI/local]
//     --files  explicit comma-separated changed files          [tests/CI]
//     --root   repo root to resolve config + mockups (default: cwd)
//
// Exit 0 = gate satisfied (or no UI change), exit 1 = UI changed without approved mockups.
// Internal error → exit 0 (never wedge unrelated work); missing git → treat as no changes.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---------- args ----------
function parseArgs(argv) {
  const a = { base: "main", root: process.cwd(), files: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") a.base = argv[++i];
    else if (argv[i] === "--root") a.root = argv[++i];
    else if (argv[i] === "--files") a.files = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--json") a.json = true;
  }
  return a;
}

// ---------- config ----------
const DEFAULTS = {
  globs: ["**/*.ui", "**/*.qml", "**/*.slint", "**/ui/**", "**/views/**", "**/widgets/**"],
  mockups: { dir: "design/mockups", min: 4, mockupExtensions: [".html", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".pdf"], approvalFile: "APPROVED" },
};
function loadConfig(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "harness.config.json"), "utf8"));
    const ui = cfg.ui || {};
    return {
      globs: ui.globs || DEFAULTS.globs,
      mockups: { ...DEFAULTS.mockups, ...(ui.mockups || {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

// ---------- glob → regex (supports **, *, literal) ----------
function globToRe(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "@@DS@@")
    .replace(/\*\*/g, "@@SS@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@DS@@/g, "(?:.*/)?")
    .replace(/@@SS@@/g, ".*");
  return new RegExp("^" + re + "$");
}

// ---------- changed files ----------
function changedFiles(a) {
  if (a.files) return a.files;
  for (const args of [["diff", "--name-only", `${a.base}...HEAD`], ["diff", "--name-only", a.base]]) {
    try {
      const out = execFileSync("git", args, { cwd: a.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const list = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (list.length) return list;
    } catch {}
  }
  return [];
}

// ---------- mockups scan ----------
// Одобренный набор засчитывается ТОЛЬКО если он затронут в diff этой же ветки —
// иначе один старый approval навсегда открывал бы гейт для любых будущих UI-правок.
// Повторное использование уже одобренного набора: допиши строку в его APPROVED
// (дата/ветка) — файл попадёт в diff, и связь «этот набор ↔ это изменение» явная.
function hasApprovedMockups(root, m, changed) {
  const base = path.join(root, m.dir);
  const mockRoot = m.dir.replace(/\\/g, "/").replace(/\/$/, "");
  let dirs;
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return { ok: false, reason: `нет каталога ${m.dir}/` }; }

  const stale = [];
  for (const d of dirs) {
    const dir = path.join(base, d.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    const mockups = files.filter((f) => m.mockupExtensions.includes(path.extname(f).toLowerCase()));
    const approved = files.includes(m.approvalFile);
    if (mockups.length < m.min || !approved) continue;
    if (changed.some((c) => c.startsWith(`${mockRoot}/${d.name}/`)))
      return { ok: true, feature: d.name, count: mockups.length };
    stale.push(d.name);
  }
  return {
    ok: false,
    reason: stale.length
      ? `одобренные наборы (${stale.join(", ")}) не затронуты в diff этой ветки — ` +
        `привяжи набор к изменению: допиши строку в ${m.dir}/<feature>/${m.approvalFile}`
      : `нет ${m.dir}/<feature>/ с >=${m.min} мокапами и файлом ${m.approvalFile}, затронутого в этой ветке`,
  };
}

// ---------- main ----------
(function main() {
  const a = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(a.root);
  const res = { ok: true, uiChanged: [], mockups: null };

  const uiRes = cfg.globs.map(globToRe);
  const mockRoot = cfg.mockups.dir.replace(/\\/g, "/").replace(/\/$/, "");
  const files = changedFiles(a).map((f) => f.replace(/\\/g, "/"));

  res.uiChanged = files.filter(
    (f) => !f.startsWith(mockRoot + "/") && uiRes.some((re) => re.test(f))
  );

  if (res.uiChanged.length === 0) {
    if (a.json) console.log(JSON.stringify({ ...res, note: "нет изменений в UI-путях" }));
    else console.log("OK design-gate: изменений в UI-путях нет — гейт не требуется.");
    process.exit(0);
  }

  const mk = hasApprovedMockups(a.root, cfg.mockups, files);
  res.mockups = mk;
  if (mk.ok) {
    if (a.json) console.log(JSON.stringify(res));
    else console.log(`OK design-gate: UI-изменения есть, одобренный набор мокапов затронут в ветке (${mk.feature}, ${mk.count} шт.).`);
    process.exit(0);
  }

  if (a.json) { console.log(JSON.stringify({ ...res, ok: false })); process.exit(1); }
  console.error(
    `BLOCK design-gate: изменения затрагивают GUI, но DESIGN-стадия не выполнена.\n` +
      `   UI-файлы: ${res.uiChanged.slice(0, 8).join(", ")}${res.uiChanged.length > 8 ? " ..." : ""}\n` +
      `   Требуется: ${mk.reason}.\n` +
      `   Новый набор:  node hooks/new-mockups.js <feature> → approval → создай ${cfg.mockups.dir}/<feature>/${cfg.mockups.approvalFile}.\n` +
      `   Уже одобренный набор: допиши строку в его ${cfg.mockups.approvalFile}, чтобы он попал в diff ветки.\n` +
      `   Политика: для нового/изменяемого GUI — >=${cfg.mockups.min} стилистически разных мокапа + approval.`
  );
  process.exit(1);
})();
