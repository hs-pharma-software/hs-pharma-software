// Builds the web app as static files for the desktop (../out), through the
// server (NEXT_PUBLIC_DB_MODE=server), with every database/API secret blanked
// so none can be baked into the bundle, then checks the output for the
// values of every secret in .env.local (names only are printed).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const env = {
  ...process.env,
  TAURI_BUILD: "1",
  NEXT_PUBLIC_DB_MODE: "server",
  NEXT_PUBLIC_DESKTOP: "electron",
  NEXT_PUBLIC_API_BASE_URL: "",
  NEXT_PUBLIC_TURSO_AUTH_TOKEN: "",
  NEXT_PUBLIC_TURSO_DATABASE_URL: "",
  NEXT_PUBLIC_GEMINI_API_KEY: "",
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
};
const r = spawnSync("npx", ["next", "build"], { cwd: root, env, stdio: "inherit", shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);

// Secret check.
const envFile = path.join(root, ".env.local");
const values = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; })
    .filter(([k, v]) => v.length >= 12 && !["NEXT_PUBLIC_DB_MODE", "NEXT_PUBLIC_APP_URL"].includes(k))
  : [];
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(p); } })(path.join(root, "out"));
const leaks = values.filter(([, v]) => files.some((f) => fs.readFileSync(f).includes(v))).map(([k]) => k);
if (leaks.length) { console.error(`STOP: secret values found in the desktop bundle: ${leaks.join(", ")}`); process.exit(1); }
console.log(`Desktop web bundle: ${files.length} files, no secret values found.`);
