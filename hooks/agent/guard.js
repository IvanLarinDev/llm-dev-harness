#!/usr/bin/env node
// guard.js — единый agent-adapter хук (PreToolUse на Bash/Write/Edit/Read и т.п.).
// Заменяет прежние bypass-guard / loop-guard / tool-loop-guard / branch-guard /
// design-guard: один файл, один вызов в конфиге раннера.
//
// БЛОК (exit 2):
//   • обход харнесса: --no-verify / git commit -n, core.hooksPath (config и -c),
//     LEFTHOOK=0, lefthook uninstall, запись в .git/hooks;
//   • правка файлов самого харнесса (hooks/, lefthook.yml, конфиги, workflows);
//     escape для обоих: HARNESS_ACK_BYPASS=1 (осознанный, одобренный пользователем);
//   • дегенеративные циклы: серия тривиальных команд, N× одно и то же действие
//     подряд, чередование двух действий (A-B-A-B…);
//   • мусор tool-разметки / низкоэнтропийная команда (сбой стриминга).
// NOTE (exit 0 + additionalContext):
//   • git commit/merge/push или правка файлов на main/master;
//   • правка UI-файла — напоминание о DESIGN-стадии.
//
// Пороги: HARNESS_LOOP_THRESHOLD (shell, по умолчанию 5),
//         HARNESS_TOOLLOOP_THRESHOLD (file-tools, 12); чередование = 2×порог.
// Ошибка самого хука никогда не блокирует работу (fail-open → exit 0).

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { parse, block } = require(path.join(__dirname, "_input.js"));

const T_SH = Number(process.env.HARNESS_LOOP_THRESHOLD) || 5;
const T_FT = Number(process.env.HARNESS_TOOLLOOP_THRESHOLD) || 12;
const TTL_MS = 2 * 60 * 60 * 1000;
const HIST_MAX = 2 * Math.max(T_SH, T_FT) + 4;

function envAllow(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}
// Обнулить строки в кавычках, чтобы commit -m "про -n флаг" не считался обходом.
function scrubQuotes(cmd) {
  return cmd.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

// ---------- state (per session, в tmpdir) ----------
function stateFile(sessionId, projectDir) {
  const id = sessionId || "proj-" + crypto.createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `harness-guard-${id}.json`);
}
function readState(p) {
  try {
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Date.now() - s.ts > TTL_MS) return { hist: [], streak: 0 };
    return { hist: s.hist || [], streak: s.streak || 0 };
  } catch { return { hist: [], streak: 0 }; }
}
function writeState(p, s) {
  try { fs.writeFileSync(p, JSON.stringify({ ...s, ts: Date.now() })); } catch {}
}

// ---------- config (ui-глобы, защищённые пути) ----------
const DEFAULT_UI_GLOBS = ["**/*.ui", "**/*.qml", "**/*.slint", "**/ui/**", "**/views/**", "**/widgets/**"];
const DEFAULT_PROTECTED = [
  "hooks/", "lefthook.yml", "harness.config.json", ".gitleaks.toml", "cog.toml",
  ".github/rulesets/", ".github/workflows/", ".claude/settings.json", ".git/",
];
function loadCfg(projectDir) {
  const def = { uiGlobs: DEFAULT_UI_GLOBS, mockDir: "design/mockups", mockMin: 4, protected: DEFAULT_PROTECTED };
  try {
    const c = JSON.parse(fs.readFileSync(path.join(projectDir, "harness.config.json"), "utf8"));
    const ui = c.ui || {};
    return {
      uiGlobs: ui.globs || def.uiGlobs,
      mockDir: (ui.mockups && ui.mockups.dir) || def.mockDir,
      mockMin: (ui.mockups && ui.mockups.min) || def.mockMin,
      protected: (c.protected && c.protected.paths) || def.protected,
    };
  } catch { return def; }
}
function globToRe(g) {
  const re = g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "@@DS@@").replace(/\*\*/g, "@@SS@@").replace(/\*/g, "[^/]*")
    .replace(/@@DS@@/g, "(?:.*/)?").replace(/@@SS@@/g, ".*");
  return new RegExp("^" + re + "$");
}
function relativize(fp, projectDir) {
  let f = String(fp).replace(/\\/g, "/");
  const pd = String(projectDir).replace(/\\/g, "/").replace(/\/$/, "");
  if (pd && f.toLowerCase().startsWith(pd.toLowerCase() + "/")) f = f.slice(pd.length + 1);
  return f;
}
function currentBranch(cwd) {
  try {
    const b = execSync("git symbolic-ref --short HEAD", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return b === "HEAD" ? "" : b;
  } catch { return ""; }
}

// ---------- детекторы циклов ----------
const CORRUPTION_RE = /<\/?tool|^\s*["']\s*,?\s*\d*\s*</i;
function isTrivial(cmd) {
  const c = cmd.trim();
  if (!c) return true;
  if (/^echo\s+(['"]?)([^\s|;&"'{}]{1,8})\1$/.test(c)) return true;
  if (/^ls(\s+-{1,2}[a-zA-Z-]+)*\s*$/.test(c)) return true;
  if (/^(pwd|true|false|clear|date|:)\s*$/.test(c)) return true;
  return false;
}
function isLowEntropy(cmd) {
  const t = cmd.trim().split(/\s+/).filter(Boolean);
  if (t.length < 8) return false;
  return new Set(t).size / t.length < 0.35;
}
function tailRepeat(h) {
  if (!h.length) return 0;
  const k = h[h.length - 1];
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i] === k; i--) n++;
  return n;
}
function tailAlt(h) {
  if (h.length < 4) return 0;
  const a = h[h.length - 1], b = h[h.length - 2];
  if (a === b) return 0;
  let n = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i] === ((h.length - 1 - i) % 2 === 0 ? a : b)) n++;
    else break;
  }
  return n;
}
function loopCheck(st, p, T) {
  const rep = tailRepeat(st.hist);
  if (rep >= T) {
    writeState(p, { hist: [], streak: 0 });
    block(`🛑 guard: ${rep}× подряд одно и то же действие — похоже на зацикливание.\n` +
      `   ${st.hist[st.hist.length - 1].slice(0, 120)}\n` +
      `   Остановись, сверься с планом/TodoWrite, смени подход. Порог: ${T}.`);
  }
  const alt = tailAlt(st.hist);
  if (alt >= 2 * T) {
    writeState(p, { hist: [], streak: 0 });
    block(`🛑 guard: чередование двух действий ${alt} шагов подряд (A-B-A-B…) — цикл без прогресса.\n` +
      `   Остановись, сверься с планом/TodoWrite, смени подход. Порог: ${2 * T}.`);
  }
}

// ---------- обход харнесса (shell) ----------
// Замечание про -n: у git commit это --no-verify (обход), у merge/revert — безобидное.
const BYPASS = [
  { re: /\bgit\s+commit\b[^\n]*(?:\s--no-verify\b|\s-[a-z]*n[a-z]*\b)/i,
    why: "--no-verify / -n на git commit — пропускает pre-commit и commit-msg" },
  { re: /\bgit\s+(merge|push)\b[^\n]*\s--no-verify\b/i,
    why: "--no-verify на git merge/push — пропускает хуки" },
  { re: /\bgit\b[^\n]*\bcore\.hookspath\b/i,
    why: "core.hooksPath (git config или git -c) — отключение/подмена git-хуков" },
  { re: /\blefthook\s+uninstall\b/i,
    why: "lefthook uninstall — снятие всех git-хуков" },
  { re: /(^|[\s;&|])LEFTHOOK\s*=\s*(0|false)\b/i,
    why: "LEFTHOOK=0 — отключение lefthook-хуков (агенту нельзя; это escape для человека)" },
];
function isGitHooksWrite(scrubbed) {
  return /\.git[\/\\]hooks\b/i.test(scrubbed) &&
    /(^|[\s;&|])(rm|mv|cp|tee|chmod|ln|truncate|sed)\b|>/.test(scrubbed);
}

// ---------- notes ----------
function emitNotes(notes) {
  if (!notes.length) process.exit(0);
  const text = notes.join("\n");
  try { process.stdout.write(JSON.stringify({ additionalContext: text }) + "\n"); } catch {}
  process.stderr.write(text + "\n");
  process.exit(0);
}

(async () => {
  try {
    const { tool, command, filePath, sessionId, projectDir } = await parse();
    const isShell = /^(bash|shell|sh|exec|run|terminal|execute)/i.test(tool) || (!tool && command);
    const isFile = /^(write|edit|multiedit|applypatch|create|str_replace|notebookedit)/i.test(tool);
    const isRead = /^read/i.test(tool);

    const p = stateFile(sessionId, projectDir);
    const st = readState(p);
    const cfg = loadCfg(projectDir);
    const notes = [];

    if (isShell && typeof command === "string" && command) {
      const scrubbed = scrubQuotes(command);

      // 1) обход харнесса
      const hit = BYPASS.find((b) => b.re.test(scrubbed)) ||
        (isGitHooksWrite(scrubbed) ? { why: "прямое вмешательство в .git/hooks" } : null);
      if (hit) {
        if (envAllow("HARNESS_ACK_BYPASS")) {
          notes.push(`⚠️ guard: обход харнесса разрешён явно (HARNESS_ACK_BYPASS=1): ${hit.why}. Обоснуй в отчёте.`);
        } else {
          block(`🛑 guard: команда обходит harness — заблокировано.\n   Причина: ${hit.why}.\n` +
            `   Если обход реально нужен и одобрен пользователем — повтори с HARNESS_ACK_BYPASS=1.`);
        }
      }

      // 2) сбой стриминга / мусор
      if (CORRUPTION_RE.test(scrubbed)) {
        writeState(p, { hist: [], streak: 0 });
        block(`🛑 guard: мусор tool-разметки в команде — верный признак сбоя стриминга/парсинга.\n   ${JSON.stringify(command.slice(0, 120))}`);
      }
      if (isLowEntropy(command)) {
        writeState(p, { hist: [], streak: 0 });
        block(`🛑 guard: аномально низкая энтропия токенов команды (паттерн «echo a echo a …»).\n   ${JSON.stringify(command.slice(0, 120))}`);
      }

      // 3) циклы
      st.streak = isTrivial(command) ? st.streak + 1 : 0;
      st.hist.push("sh::" + command.trim());
      if (st.hist.length > HIST_MAX) st.hist.shift();
      if (st.streak >= T_SH) {
        writeState(p, { hist: [], streak: 0 });
        block(`🛑 guard: ${st.streak} тривиальных команд подряд (echo/ls/pwd/…) — дегенеративный паттерн.\n` +
          `   Остановись и реши задачу одним осмысленным шагом. Порог: HARNESS_LOOP_THRESHOLD=${T_SH}.`);
      }
      loopCheck(st, p, T_SH);
      writeState(p, st);

      // 4) ранние подсказки про main
      const branch = currentBranch(projectDir);
      if (["main", "master"].includes(branch)) {
        if (/\bgit\s+(commit|merge)\b/.test(scrubbed))
          notes.push(`⚠️ guard: git commit/merge на «${branch}» — pre-commit отклонит. Перейди на feature-ветку (релиз: HARNESS_ALLOW_MAIN=1).`);
      }
      if (/\bgit\s+push\b/.test(scrubbed) && /\b(main|master)\b/.test(scrubbed) && !/refs\/tags|v\d/.test(scrubbed))
        notes.push(`⚠️ guard: прямой push в main/master отклонит серверный ruleset. main обновляется через PR.`);

      emitNotes(notes);
    }

    if ((isFile || isRead) && filePath) {
      const rel = relativize(filePath, projectDir);

      // 1) файлы самого харнесса — только с явного разрешения
      if (isFile && cfg.protected.some((pref) => rel === pref || rel.startsWith(pref))) {
        if (envAllow("HARNESS_ACK_BYPASS")) {
          notes.push(`⚠️ guard: правка файла харнесса (${rel}) разрешена явно (HARNESS_ACK_BYPASS=1).`);
        } else {
          block(`🛑 guard: правка файла харнесса заблокирована: ${rel}\n` +
            `   Хуки/конфиги харнесса агент не меняет сам по себе.\n` +
            `   Если изменение одобрено пользователем — повтори с HARNESS_ACK_BYPASS=1.`);
        }
      }

      // 2) циклы (Read/Write/Edit одного и того же объекта)
      st.streak = 0;
      st.hist.push(tool.toLowerCase() + "::" + rel);
      if (st.hist.length > HIST_MAX) st.hist.shift();
      loopCheck(st, p, T_FT);
      writeState(p, st);

      // 3) подсказки: DESIGN-стадия и main
      if (isFile) {
        const mockRoot = cfg.mockDir.replace(/\\/g, "/").replace(/\/$/, "");
        if (!rel.startsWith(mockRoot + "/") && cfg.uiGlobs.map(globToRe).some((re) => re.test(rel)))
          notes.push(`⚠️ guard: правка GUI-файла (${rel}). DESIGN-стадия: ≥${cfg.mockMin} мокапа + APPROVED до кода ` +
            `(node hooks/new-mockups.js <feature>). Жёсткий гейт — design-gate.js в pre-push/CI.`);
        const branch = currentBranch(projectDir);
        if (["main", "master"].includes(branch))
          notes.push(`⚠️ guard: правишь файлы на «${branch}». Нужна feature-ветка: git checkout -b feat/…`);
      }
      emitNotes(notes);
    }

    process.exit(0);
  } catch {
    process.exit(0); // fail-open: хук не должен вешать сессию
  }
})();
