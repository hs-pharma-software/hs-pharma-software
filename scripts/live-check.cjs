#!/usr/bin/env node
/* Read-only check of the deployed web version after a rollout.
 *
 *   node scripts/live-check.cjs https://your-site.vercel.app
 *
 * It only sends GET requests, plus one POST to /api/db without a session
 * (which the server must refuse). It never logs in, never writes, and never
 * prints a token: when a script contains something token-like it reports the
 * file name only.
 *
 * Checks:
 *   1. the hospital pages answer (200);
 *   2. the server layer is on: /api/db refuses a request without a session;
 *   3. no database token or Turso address is in the page's scripts;
 *   4. a lab report QR link with a made-up token answers without a login
 *      (a "not found" message, not a login page or a server error).
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/live-check.cjs https://your-site");
  process.exit(2);
}

const PAGES = [
  "/", "/hospital", "/hospital/reception", "/hospital/doctor", "/hospital/patients", "/hospital/episodes", "/hospital/opd", "/hospital/ipd",
  "/hospital/emergency", "/hospital/emergency/board", "/hospital/emergency/mlc", "/hospital/admissions", "/hospital/lab", "/hospital/lab/reports",
  "/hospital/lab/critical", "/hospital/blood-bank", "/hospital/radiology", "/hospital/surgery", "/hospital/ipc", "/hospital/ipc/registers",
  "/hospital/cssd", "/hospital/medicines", "/hospital/quality", "/hospital/quality/documents", "/hospital/quality/compliance", "/hospital/facility", "/hospital/hr",
  "/my-appraisals",
];

let failed = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { failed++; console.log(`  FAIL  ${m}`); };
const warn = (m) => console.log(`  note  ${m}`);

async function get(path, init) {
  const res = await fetch(base + path, { redirect: "follow", ...init });
  return { status: res.status, text: await res.text(), type: res.headers.get("content-type") || "" };
}

(async () => {
  console.log(`Checking ${base}\n\n1. Pages`);
  let home = "";
  for (const p of PAGES) {
    try {
      const r = await get(p);
      if (p === "/") home = r.text;
      if (r.status === 200) ok(p);
      else bad(`${p} answered ${r.status}`);
    } catch (e) {
      bad(`${p}: ${e.message}`);
    }
  }

  console.log("\n2. Server layer");
  try {
    const r = await get("/api/db/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statements: [{ sql: "SELECT 1" }] }) });
    if (r.status === 401) ok("/api/db refuses a request without a session (server layer is on)");
    else if (r.status === 404) bad("/api/db not found: this deployment is not the web build with the server layer");
    else if (r.status === 500 && /SESSION_SECRET|TURSO_/i.test(r.text)) bad(`/api/db: server settings missing (${r.text.slice(0, 120).replace(/\s+/g, " ")})`);
    else bad(`/api/db answered ${r.status} without a session; expected 401`);
  } catch (e) {
    bad(`/api/db: ${e.message}`);
  }

  console.log("\n3. No database token in the page");
  const scripts = [...new Set([...home.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]))];
  if (!scripts.length) warn("no scripts found on the home page; check skipped");
  let exposed = 0;
  for (const src of scripts) {
    try {
      const r = await get(src.startsWith("http") ? src.replace(/^https?:\/\/[^/]+/, "") : src);
      const name = src.split("/").pop();
      if (/[a-z0-9-]+\.turso\.io/i.test(r.text)) { exposed++; bad(`${name} contains a Turso database address`); }
      // A Turso token is a JWT; report the file, never the value.
      if (/["'`]eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}["'`]/.test(r.text)) { exposed++; bad(`${name} contains a token-like value (JWT)`); }
    } catch (e) {
      warn(`could not read ${src}: ${e.message}`);
    }
  }
  if (scripts.length && !exposed) ok(`${scripts.length} scripts checked: no Turso address or token`);

  console.log("\n4. Public lab report link");
  try {
    const r = await get("/api/public/lab-report/?token=live-check-not-a-real-token");
    if (r.status === 404 || (r.status === 200 && /not found|invalid|no report/i.test(r.text))) ok("answers without a login and finds no report for a made-up token");
    else if (r.status === 401) bad("asks for a login: QR report links would not open for patients");
    else warn(`answered ${r.status}; open a real QR link to confirm it shows the report`);
  } catch (e) {
    warn(`could not check: ${e.message}`);
  }

  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
})();
