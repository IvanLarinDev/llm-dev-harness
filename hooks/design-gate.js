#!/usr/bin/env node
// design-gate.js - DESIGN-stage gate.
//
// Policy: user-visible GUI work must be preceded by design review. If a branch's
// changes touch UI paths, the SAME branch diff must also touch an APPROVED set of
// mode-appropriate DESIGN evidence. Legacy sets remain valid for compatibility.
//
// Usage:
//   node hooks/design-gate.js [--base <ref>] [--root <dir>] [--files a,b,c] [--json] [--strict]
//     --base   git ref to diff against (default: origin/main if available) [CI/local]
//     --files  explicit comma-separated changed files          [tests/CI]
//     --root   repo root to resolve config + mockups (default: cwd)
//     --strict diff errors fail closed (CI/server enforcement)
//
// Exit 0 = gate satisfied (or no UI change), exit 1 = UI changed without approved mockups.
// Internal error -> exit 0 locally (never wedge unrelated work), with a loud warning.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---------- args ----------
function parseArgs(argv) {
  const a = { base: null, root: process.cwd(), files: null, json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") a.base = argv[++i];
    else if (argv[i] === "--root") a.root = argv[++i];
    else if (argv[i] === "--files") a.files = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--json") a.json = true;
    else if (argv[i] === "--strict") a.strict = true;
  }
  return a;
}

function refExists(root, ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000, killSignal: "SIGKILL",
    });
    return true;
  } catch {
    return false;
  }
}
function defaultBase(root) {
  for (const ref of ["origin/main", "origin/HEAD", "main", "master"]) {
    if (refExists(root, ref)) return ref;
  }
  return "origin/main";
}

// ---------- config shared with guard.js and verify.js ----------
const { globToRe, loadConfig, changedFiles } = require(path.join(__dirname, "_lib.js"));

// ---------- DESIGN evidence scan ----------
function safeVariantFile(file) {
  return typeof file === "string" && file.length > 0 && !/[\\/]/.test(file) &&
    path.basename(file) === file && file !== "." && file !== "..";
}

function baselineCheck(root, references) {
  if (!Array.isArray(references) || references.length === 0)
    return { ok: false, reason: "existing-ui evidence requires baselineReferences from the current UI" };
  for (const reference of references) {
    if (typeof reference !== "string" || !reference.trim())
      return { ok: false, reason: "baselineReferences must contain repo-relative file paths" };
    const absolute = path.resolve(root, reference);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      return { ok: false, reason: `baseline reference is outside the repository: ${reference}` };
    try {
      if (!fs.statSync(absolute).isFile())
        return { ok: false, reason: `baseline reference is not a file: ${reference}` };
    } catch {
      return { ok: false, reason: `baseline reference does not exist: ${reference}` };
    }
  }
  return { ok: true };
}

function validateManifestSet(root, dir, files, m) {
  const manifestFile = m.manifestFile || "DESIGN.json";
  if (!files.includes(manifestFile)) {
    const mockups = files.filter((file) => m.mockupExtensions.includes(path.extname(file).toLowerCase()));
    return mockups.length >= m.min
      ? { ok: true, count: mockups.length, kind: "legacy", legacy: true }
      : { ok: false, reason: `legacy set has ${mockups.length}/${m.min} visual mockups` };
  }

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, manifestFile), "utf8")); }
  catch { return { ok: false, reason: `${manifestFile} is not valid JSON` }; }
  if (manifest.schemaVersion !== 1)
    return { ok: false, reason: `${manifestFile} schemaVersion must be 1` };
  if (!new Set(["existing-ui", "new-ui", "animation"]).has(manifest.kind))
    return { ok: false, reason: `${manifestFile} kind must be existing-ui, new-ui, or animation` };
  if (!Array.isArray(manifest.variants) || manifest.variants.length < m.min)
    return { ok: false, reason: `${manifestFile} declares fewer than ${m.min} variants` };

  const variantFiles = manifest.variants.map((variant) => variant && variant.file);
  if (variantFiles.some((file) => !safeVariantFile(file)))
    return { ok: false, reason: `${manifestFile} variants must be direct child files` };
  if (new Set(variantFiles).size !== variantFiles.length)
    return { ok: false, reason: `${manifestFile} variants must be unique` };
  const missing = variantFiles.filter((file) => !files.includes(file));
  if (missing.length)
    return { ok: false, reason: `${manifestFile} references missing variant(s): ${missing.join(", ")}` };

  if (manifest.kind === "existing-ui") {
    const baseline = baselineCheck(root, manifest.baselineReferences);
    if (!baseline.ok) return baseline;
  }

  if (manifest.kind === "animation") {
    if (!new Set(["text", "js"]).has(manifest.fidelity))
      return { ok: false, reason: "animation evidence requires fidelity text or js" };
    if (typeof manifest.example !== "string" || !manifest.example.trim())
      return { ok: false, reason: "animation evidence requires a concrete example" };
    const expectedExtension = manifest.fidelity === "text" ? ".md" : ".html";
    const wrongType = variantFiles.find((file) => path.extname(file).toLowerCase() !== expectedExtension);
    if (wrongType)
      return { ok: false, reason: `animation/${manifest.fidelity} variant has the wrong file type: ${wrongType}` };
    if (manifest.fidelity === "js") {
      for (const file of variantFiles) {
        let source = "";
        try { source = fs.readFileSync(path.join(dir, file), "utf8"); } catch {}
        if (!/<script(?:\s|>)/i.test(source) || !/(?:\.animate\s*\(|requestAnimationFrame\s*\()/i.test(source))
          return { ok: false, reason: `animation/js variant is not an executable motion prototype: ${file}` };
      }
    }
  } else {
    const wrongType = variantFiles.find((file) => !m.mockupExtensions.includes(path.extname(file).toLowerCase()));
    if (wrongType)
      return { ok: false, reason: `${manifest.kind} variant has an unsupported visual file type: ${wrongType}` };
  }

  return {
    ok: true,
    count: variantFiles.length,
    kind: manifest.kind,
    ...(manifest.fidelity ? { fidelity: manifest.fidelity } : {}),
  };
}

// An approved set counts only if that same set is touched in this branch diff.
// Otherwise one old approval would unlock future UI work forever.
function hasApprovedMockups(root, m, changed) {
  const base = path.join(root, m.dir);
  const mockRoot = m.dir.replace(/\\/g, "/").replace(/\/$/, "");
  let dirs;
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return { ok: false, reason: `missing directory ${m.dir}/` }; }

  const stale = [];
  const invalid = [];
  for (const d of dirs) {
    const dir = path.join(base, d.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    const approved = files.includes(m.approvalFile);
    if (!approved) continue;
    const touched = changed.some((c) => c.startsWith(`${mockRoot}/${d.name}/`));
    const check = validateManifestSet(root, dir, files, m);
    if (!check.ok) {
      if (touched) invalid.push(`${d.name}: ${check.reason}`);
      continue;
    }
    if (touched) return { ok: true, feature: d.name, ...check };
    stale.push(d.name);
  }
  return {
    ok: false,
    reason: invalid.length
      ? `invalid DESIGN evidence (${invalid.join("; ")})`
      : stale.length
      ? `approved set(s) (${stale.join(", ")}) are not touched in this branch diff; ` +
        `touch ${m.dir}/<feature>/${m.approvalFile} to bind an existing approval to this change`
      : `no valid mode-aware ${m.dir}/<feature>/ with >=${m.min} variants and ${m.approvalFile} touched in this branch`,
  };
}

// ---------- main ----------
(function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.base) a.base = defaultBase(a.root);
  const cfg = loadConfig(a.root);
  const res = { ok: true, base: a.base, uiChanged: [], mockups: null };

  const uiRes = cfg.uiGlobs.map(globToRe);
  const mockRoot = cfg.mockups.dir.replace(/\\/g, "/").replace(/\/$/, "");
  const cf = changedFiles(a.base, a.root, a.files);
  if (cf.base) res.base = cf.base;
  if (cf.error) {
    // Local default = fail-open loudly; strict/CI = fail-closed.
    const warn = `design-gate: ${cf.error}; ${a.strict ? "gate cannot verify UI changes" : "gate skipped and UI changes were not checked"}. Pass --base <ref>.`;
    if (a.json) console.log(JSON.stringify({ ...res, ok: !a.strict, skipped: true, warn }));
    else console.error(warn);
    process.exit(a.strict ? 1 : 0);
  }
  const files = cf.files.map((f) => f.replace(/\\/g, "/"));

  res.uiChanged = files.filter(
    (f) => !f.startsWith(mockRoot + "/") && uiRes.some((re) => re.test(f))
  );

  if (res.uiChanged.length === 0) {
    if (a.json) console.log(JSON.stringify({ ...res, note: "no UI-path changes" }));
    else console.log("OK design-gate: no UI-path changes; gate not required.");
    process.exit(0);
  }

  const mk = hasApprovedMockups(a.root, cfg.mockups, files);
  res.mockups = mk;
  if (mk.ok) {
    if (a.json) console.log(JSON.stringify(res));
    else {
      const mode = mk.kind ? `, ${mk.kind}${mk.fidelity ? `/${mk.fidelity}` : ""}` : "";
      console.log(`OK design-gate: UI changes have approved DESIGN evidence touched in this branch (${mk.feature}, ${mk.count}${mode}).`);
    }
    process.exit(0);
  }

  if (a.json) { console.log(JSON.stringify({ ...res, ok: false })); process.exit(1); }
  console.error(
    `BLOCK design-gate: GUI changes require DESIGN approval.\n` +
      `   UI files: ${res.uiChanged.slice(0, 8).join(", ")}${res.uiChanged.length > 8 ? " ..." : ""}\n` +
      `   Required: ${mk.reason}.\n` +
      `   Existing UI: node hooks/new-mockups.js <feature> --kind existing-ui --baseline <repo-path>.\n` +
      `   Motion: use --kind animation --fidelity text|js --example <scenario>; new UI: use --kind new-ui.\n` +
      `   Existing set: touch its ${cfg.mockups.approvalFile} so it appears in this branch diff.\n` +
      `   Policy: DESIGN evidence must match the UI change type; backend-only diffs outside ui.globs need none.`
  );
  process.exit(1);
})();
