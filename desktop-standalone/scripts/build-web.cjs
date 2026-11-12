// Builds MAVIN's web app as static files for Mavin Pharmacy Offline:
// NEXT_PUBLIC_EDITION=standalone (its own local database, no server), every
// database/API secret blanked so none can be baked in. Then keeps only the
// Pharmacy screens (no Super Admin console, websites, other business types,
// public site or any FBR page), copies the result to desktop-standalone/web,
// and checks it for secret values and FBR/PRAL addresses.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const env = {
  ...process.env,
  TAURI_BUILD: "1",
  NEXT_PUBLIC_EDITION: "standalone",
  NEXT_PUBLIC_DB_MODE: "",
  NEXT_PUBLIC_DESKTOP: "",
  NEXT_PUBLIC_API_BASE_URL: "",
  NEXT_PUBLIC_TURSO_AUTH_TOKEN: "",
  NEXT_PUBLIC_TURSO_DATABASE_URL: "",
  NEXT_PUBLIC_GEMINI_API_KEY: "",
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
};
const r = spawnSync("npx", ["next", "build"], { cwd: root, env, stdio: "inherit", shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);

const out = path.join(root, "out");
const web = path.join(__dirname, "..", "web");
fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(out, web, { recursive: true });

// Not part of this edition (routes only; the shared code they use stays for the Pharmacy screens).
const REMOVE = ["admin", "sub-super", "site", "web", "web-meta", "hospital", "clinic", "lab", "lab-report", "restaurant", "electric", "dist", "banquet", "cloth", "mobile", "my-appraisals", "set-password"];
for (const d of REMOVE) fs.rmSync(path.join(web, d), { recursive: true, force: true });
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) {
      if (/fbr|pral/i.test(f)) { fs.rmSync(p, { recursive: true, force: true }); continue; }
      walk(p);
    } else files.push(p);
  }
})(web);

// Secret check: no value of .env.local may be in the bundle.
const envFile = path.join(root, ".env.local");
const values = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; })
    .filter(([k, v]) => v.length >= 12 && !["NEXT_PUBLIC_DB_MODE", "NEXT_PUBLIC_APP_URL"].includes(k))
  : [];
const leaks = values.filter(([, v]) => files.some((f) => fs.readFileSync(f).includes(v))).map(([k]) => k);
if (leaks.length) { console.error(`STOP: secret values found in the bundle: ${leaks.join(", ")}`); process.exit(1); }
// FBR / PRAL addresses in shared code are unreachable here (the window blocks every network request), but report them.
const fbrRefs = files.filter((f) => /\.(js|html)$/.test(f) && /gw\.fbr\.gov\.pk|pral\.com\.pk/.test(fs.readFileSync(f, "utf8"))).length;
console.log(`Mavin Pharmacy Offline web bundle: ${files.length} files, no secret values. Files still mentioning FBR/PRAL addresses in shared code: ${fbrRefs} (network blocked in the app).`);
