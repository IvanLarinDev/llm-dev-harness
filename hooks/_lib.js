// _lib.js — shared helpers for the harness hooks (guard.js, design-gate.js).
// Single source of truth for: glob→regex, harness.config.json loading, path
// normalization. No CLI, no side effects.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_UI_GLOBS = ["**/*.ui", "**/*.qml", "**/*.slint", "**/ui/**", "**/views/**", "**/widgets/**"];
const DEFAULT_MOCKUPS = {
  dir: "design/mockups",
  min: 4,
  mockupExtensions: [".html", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".pdf"],
  approvalFile: "APPROVED",
};
const DEFAULT_PROTECTED = [
  "hooks/", "lefthook.yml", "harness.config.json", ".gitleaks.toml", "cog.toml",
  ".github/rulesets/", ".github/workflows/", ".claude/settings.json", ".git/",
];

// Линт/формат-конфиги ЦЕЛЕВОГО проекта (паттерн ECC config-protection): агенты
// «чинят» красный VERIFY, ослабляя конфиг вместо кода. Блокируем правку
// СУЩЕСТВУЮЩЕГО конфига; создание с нуля — легитимный bootstrap. Смешанные файлы
// (pyproject.toml, package.json, tsconfig.json) намеренно НЕ в списке.
const DEFAULT_LINT_CONFIGS = [
  ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml",
  "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts",
  ".eslintignore",
  ".prettierrc", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml",
  "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs", ".prettierignore",
  "biome.json", "biome.jsonc",
  "ruff.toml", ".ruff.toml",
  "rustfmt.toml", ".rustfmt.toml", "clippy.toml", ".clippy.toml",
  ".editorconfig", ".flake8", "mypy.ini", ".mypy.ini", "pytest.ini",
  ".stylelintrc", ".stylelintrc.json", ".stylelintrc.yml", "stylelint.config.js",
  ".markdownlint.json", ".markdownlint.yaml", ".markdownlintrc", ".shellcheckrc",
];

// glob → RegExp (supports **, *, literal)
function globToRe(g) {
  const re = g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "@@DS@@").replace(/\*\*/g, "@@SS@@").replace(/\*/g, "[^/]*")
    .replace(/@@DS@@/g, "(?:.*/)?").replace(/@@SS@@/g, ".*");
  return new RegExp("^" + re + "$");
}

// harness.config.json (missing/broken file → defaults; hooks stay fail-open)
function loadConfig(root) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(root, "harness.config.json"), "utf8")); } catch {}
  const ui = c.ui || {};
  return {
    uiGlobs: ui.globs || DEFAULT_UI_GLOBS,
    mockups: { ...DEFAULT_MOCKUPS, ...(ui.mockups || {}) },
    protected: (c.protected && c.protected.paths) || DEFAULT_PROTECTED,
    lintConfigs: (c.protected && c.protected.lintConfigs) || DEFAULT_LINT_CONFIGS,
  };
}

// Absolute/relative path → normalized repo-relative posix path.
// Collapses ./ and ..; strips the project prefix case-insensitively — WITHOUT
// normalization "./lefthook.yml" or "design/../hooks/x" would dodge prefix checks.
function normRel(fp, projectDir) {
  let f = String(fp).replace(/\\/g, "/");
  const pd = String(projectDir || "").replace(/\\/g, "/").replace(/\/$/, "");
  if (pd && f.toLowerCase().startsWith(pd.toLowerCase() + "/")) f = f.slice(pd.length + 1);
  f = path.posix.normalize(f);
  if (f.startsWith("./")) f = f.slice(2);
  return f;
}

// Is rel under one of the protected prefixes? Case-insensitive: Windows/macOS
// filesystems are case-insensitive, so "Lefthook.yml" IS lefthook.yml there.
function isProtectedPath(rel, protectedList) {
  const r = rel.toLowerCase();
  return protectedList.some((pref) => {
    const p = pref.toLowerCase();
    return r === p || r === p.replace(/\/$/, "") || r.startsWith(p.endsWith("/") ? p : p + "/");
  });
}

// ---------- shell-write detection ----------
// Covers: rm/mv/cp/tee/chmod/ln/truncate/touch <…path>, sed/perl -i <…path>,
// and redirection > / >> into the path. Read-only uses (cat/ls/node hooks/x.js) pass.
function shellWriteHit(scrubbed, alt, lb, dirPrefixInRedirect) {
  const seg = "[^;|&<>]*";
  const target = lb + alt;
  const redir = dirPrefixInRedirect ? `>>?\\s*(?:[^\\s;|&]*\\/)?${alt}` : `>>?\\s*${alt}`;
  const res = [
    new RegExp(`(?:^|[\\s;&|])(?:rm|mv|cp|tee|chmod|ln|truncate|touch)\\s+${seg}${target}`, "i"),
    new RegExp(`(?:^|[\\s;&|])(?:sed|perl)\\s+${seg}\\s-[a-z]*i[a-z.]*\\b${seg}${target}`, "i"),
    new RegExp(`(?:^|[\\s;&|])(?:sed|perl)\\s+${seg}-[a-z]*i[a-z.]*\\s+${seg}${target}`, "i"),
    new RegExp(redir, "i"),
  ];
  return res.some((re) => re.test(scrubbed));
}

// Запись в защищённые пути харнесса (префиксы от корня репо).
function isProtectedShellWrite(scrubbed, protectedList) {
  const esc = (str) => str.replace(/[.\\/]/g, (m) => "\\" + m);
  // "hooks/" защищает и "hooks/x", и голое "rm -rf hooks"; файлы — по границе слова.
  const alt = "(?:\\./)?(?:" + protectedList.map((p) =>
    p.endsWith("/") ? esc(p.slice(0, -1)) + "(?:\\/|[\\s;&|]|$)" : esc(p) + "\\b"
  ).join("|") + ")";
  // Lookbehind БЕЗ "/": src/hooks/useAuth.ts (React) — не файл харнесса.
  return shellWriteHit(scrubbed, alt, "(?<=^|[\\s=:'\"(])", false);
}

// Запись в lint/format-конфиг (по basename, в любом каталоге).
function isLintConfigShellWrite(scrubbed, lintConfigs) {
  const names = lintConfigs.map((n) => n.replace(/\./g, "\\.")).join("|");
  const alt = `(?:[^\\s;|&<>]*\\/)?(?:${names})\\b`;
  return shellWriteHit(scrubbed, alt, "(?<=^|[\\s=:'\"(/])", true);
}

// rel — нормализованный путь; сравнение по basename, регистронезависимо.
function isLintConfigPath(rel, lintConfigs) {
  const base = String(rel).toLowerCase().split("/").pop();
  return lintConfigs.some((n) => n.toLowerCase() === base);
}

// ---------- changed files (branch diff) ----------
// Изменённые файлы ветки относительно базы. Возвращает {files, base} при успешном
// diff (пусть даже ПУСТОМ) или {error} если ни одна база не доступна — это РАЗНЫЕ
// исходы: пустой diff = «изменений нет», ошибка = «не смогли проверить». Молчаливый
// fail-open при ошибке означал бы, что в репо без ожидаемой базы гейт/фильтр просто
// никогда не работает. explicitFiles (тесты/CI) возвращается как есть, без git.
// Общий источник для design-gate.js (гейт) и verify.js (--changed фильтр стеков).
function changedFiles(base, root, explicitFiles) {
  if (explicitFiles) return { files: explicitFiles };
  const bases = [...new Set([base, "main", "master", "origin/HEAD"].filter(Boolean))];
  for (const b of bases) {
    for (const args of [["diff", "--name-only", `${b}...HEAD`], ["diff", "--name-only", b]]) {
      try {
        const out = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return { files: out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), base: b };
      } catch {}
    }
  }
  return { error: `git diff не удался ни для одной базы (${bases.join(", ")})` };
}

module.exports = {
  DEFAULT_UI_GLOBS, DEFAULT_MOCKUPS, DEFAULT_PROTECTED, DEFAULT_LINT_CONFIGS,
  globToRe, loadConfig, normRel, isProtectedPath,
  isProtectedShellWrite, isLintConfigShellWrite, isLintConfigPath,
  changedFiles,
};
