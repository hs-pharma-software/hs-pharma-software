#!/usr/bin/env node
/**
 * Mavin Pharmacy Offline: license keys and license files (run by MAVIN.pk staff only).
 *
 *   node scripts/standalone/issue-license.cjs keygen [--dir <folder outside the repo>]
 *       Makes the Ed25519 signing key pair. The PRIVATE key stays in that folder
 *       (default: %USERPROFILE%\.mavin-license-keys) and must never be committed or
 *       shipped; the PUBLIC key is written to desktop-standalone/resources/license-public.pem
 *       and bundled with the app.
 *
 *   node scripts/standalone/issue-license.cjs issue --request <MAVIN-REQUEST-1... or file>
 *        --licensee "Pharmacy name" --expires 2027-12-31 [--kind activation|renewal]
 *        [--key <private.pem>] [--out <file.lic>]
 *       Signs a license for the installation in the request code. Prints it and
 *       (with --out) saves it; the pharmacy imports it offline in
 *       Settings > Mavin Pharmacy Offline > License.
 */
const { generateKeyPairSync, createPrivateKey, sign, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const defaultDir = path.join(os.homedir(), ".mavin-license-keys");
const repoRoot = path.join(__dirname, "..", "..");

function fail(m) { console.error(m); process.exit(1); }

/** The signed license text (also used by the server: src/server/standalone/license.ts). */
function signLicense(privatePem, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, body, createPrivateKey(privatePem));
  return `MAVIN-LICENSE-1.${body.toString("base64url")}.${sig.toString("base64url")}`;
}

function parseRequest(r) {
  let text = String(r || "").trim();
  if (text && fs.existsSync(text)) text = fs.readFileSync(text, "utf8").trim();
  const m = /^MAVIN-REQUEST-1\.([A-Za-z0-9_-]+)$/.exec(text.replace(/\s+/g, ""));
  if (!m) fail("The request code must start with MAVIN-REQUEST-1.");
  const j = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  if (!/^[0-9a-f-]{36}$/.test(j.installationId || "")) fail("The request code has no valid installation id.");
  return j;
}

if (cmd === "keygen") {
  const dir = opt("dir", defaultDir);
  if (path.resolve(dir).startsWith(path.resolve(repoRoot))) fail("Keep the private key OUTSIDE the repository.");
  const priv = path.join(dir, "license-private.pem");
  if (fs.existsSync(priv)) fail(`A private key already exists at ${priv}. Remove it first if you really want a new pair (every issued license would stop verifying in new builds).`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const pub = path.join(repoRoot, "desktop-standalone", "resources", "license-public.pem");
  fs.mkdirSync(path.dirname(pub), { recursive: true });
  fs.writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }));
  console.log(`Private key (keep safe, never commit): ${priv}`);
  console.log(`Public key (bundled with the app):     ${pub}`);
} else if (cmd === "issue") {
  const req = parseRequest(opt("request"));
  const licensee = String(opt("licensee", req.pharmacy || "")).trim();
  const expires = String(opt("expires", ""));
  const kind = opt("kind", "renewal");
  if (!licensee) fail("--licensee is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) fail("--expires must be YYYY-MM-DD.");
  if (kind !== "activation" && kind !== "renewal") fail("--kind is activation or renewal.");
  const keyFile = opt("key", path.join(defaultDir, "license-private.pem"));
  if (!fs.existsSync(keyFile)) fail(`No private key at ${keyFile}.`);
  const payload = { v: 1, licenseId: randomUUID(), installationId: req.installationId, licensee, kind, issuedAt: new Date().toISOString(), expiresAt: new Date(`${expires}T23:59:59.000+05:00`).toISOString() /* end of that day, Pakistan time */ };
  const text = signLicense(fs.readFileSync(keyFile, "utf8"), payload);
  const out = opt("out");
  if (out) fs.writeFileSync(out, text + "\n");
  console.log(text);
  console.error(`\nLicense ${payload.licenseId} for ${licensee}, installation ${req.installationId}, valid until ${expires}.${out ? ` Saved to ${out}.` : ""}`);
} else {
  fail("Usage: issue-license.cjs keygen [--dir <folder>] | issue --request <code|file> --licensee <name> --expires YYYY-MM-DD [--kind activation|renewal] [--key <pem>] [--out <file>]");
}

module.exports = { signLicense };
