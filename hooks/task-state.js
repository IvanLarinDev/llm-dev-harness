const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function run(root, args) {
  return execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    timeout: 10000, killSignal: "SIGKILL",
  }).trim();
}

function stateFile(root) {
  const id = crypto.createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `harness-task-baseline-${id}.json`);
}

function dirtyPaths(status) {
  const records = String(status).split("\0");
  const paths = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const code = record.slice(0, 2);
    paths.push(record.slice(3));
    // In porcelain v1 -z, rename/copy entries carry the original path as the
    // next NUL-delimited record. The first path is the current one to hash.
    if (/[RC]/.test(code) && i + 1 < records.length) i++;
  }
  return paths;
}

function capture(root) {
  const status = run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const working = run(root, ["diff", "--binary", "--no-ext-diff"]);
  const staged = run(root, ["diff", "--cached", "--binary", "--no-ext-diff"]);
  const files = [];
  for (const rel of dirtyPaths(status)) {
    const abs = path.resolve(root, rel);
    let hash = "missing";
    try {
      const stat = fs.statSync(abs);
      hash = stat.isFile() ? crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex") : "directory";
    } catch {}
    files.push({ rel, hash });
  }
  const fingerprint = crypto.createHash("sha256")
    .update(JSON.stringify({ status, working, staged, files }))
    .digest("hex");
  return { root: path.resolve(root), status, fingerprint, capturedAt: new Date().toISOString() };
}

function saveBaseline(root) {
  const value = capture(root);
  const file = stateFile(root);
  const temp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
  return value;
}

function loadBaseline(root) {
  try { return JSON.parse(fs.readFileSync(stateFile(root), "utf8")); }
  catch { return null; }
}

function clearBaseline(root) {
  try { fs.rmSync(stateFile(root), { force: true }); } catch {}
}

function unchangedFromBaseline(root) {
  const baseline = loadBaseline(root);
  if (!baseline) return false;
  try { return capture(root).fingerprint === baseline.fingerprint; }
  catch { return false; }
}

module.exports = { capture, saveBaseline, loadBaseline, clearBaseline, unchangedFromBaseline, stateFile, dirtyPaths };
