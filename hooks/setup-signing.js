#!/usr/bin/env node
// setup-signing.js — opt-in helper to enable SSH commit signing (BACKLOG P1-7).
//
// The harness bans co-author trailers so commits "look like the author"; signing makes
// that cryptographic. This configures REPO-LOCAL SSH signing (safe, reversible) using an
// existing SSH key. It does NOT touch global config and does NOT run automatically —
// you invoke it: `node hooks/setup-signing.js`.
//
// "Require signed commits" as a hard gate is a ruleset feature (needs Pro/Team or a public
// repo — see BACKLOG P0-0); locally this just enables signing.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function git(args) { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
function trySet(k, v) { try { execFileSync("git", ["config", k, v], { stdio: "ignore" }); return true; } catch { return false; } }

function findPubKey() {
  try { const k = git(["config", "user.signingkey"]); if (k) return k; } catch {}
  const dir = path.join(os.homedir(), ".ssh");
  for (const name of ["id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(function main() {
  try { git(["rev-parse", "--is-inside-work-tree"]); }
  catch { console.error("setup-signing: запусти внутри git-репозитория."); process.exit(1); }

  const key = findPubKey();
  if (!key) {
    console.error(
      "setup-signing: SSH-ключ не найден (~/.ssh/id_ed25519.pub и т.п.).\n" +
      "  Создай ключ:  ssh-keygen -t ed25519 -C \"you@example.com\"\n" +
      "  Затем повтори  node hooks/setup-signing.js  и добавь ключ в GitHub → Settings → SSH and GPG keys (тип: Signing key)."
    );
    process.exit(1);
  }

  trySet("gpg.format", "ssh");
  trySet("user.signingkey", key);
  trySet("commit.gpgsign", "true");
  trySet("tag.gpgsign", "true");

  // allowed_signers enables local `git log --show-signature` verification.
  try {
    const email = git(["config", "user.email"]) || "you@example.com";
    const pub = fs.readFileSync(key, "utf8").trim();
    const asPath = path.join(process.cwd(), ".git", "allowed_signers");
    fs.writeFileSync(asPath, `${email} ${pub}\n`);
    trySet("gpg.ssh.allowedSignersFile", asPath);
  } catch {}

  console.log("✅ setup-signing: SSH-подпись коммитов включена для этого репозитория.");
  console.log(`   ключ: ${key}`);
  console.log("   Проверка: git log --show-signature -1");
  console.log("   Не забудь добавить этот ключ в GitHub как Signing key (иначе GitHub покажет Unverified).");
  console.log("   Откат: git config --unset commit.gpgsign");
})();
