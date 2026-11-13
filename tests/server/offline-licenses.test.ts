/** Super Admin › Offline Tenants (src/server/standalone/licenses.ts): licenses
 * generated on the server are accepted by the desktop's own license check. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import * as lic from "@/server/standalone/licenses";
import { LocalDb } from "../../desktop-standalone/src/core/localdb.ts";
import { License } from "../../desktop-standalone/src/core/license.ts";

const SCHEMA = readFileSync(new URL("../../desktop/resources/schema.sql", import.meta.url), "utf8");
const keys = generateKeyPairSync("ed25519");
const PUB = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIV = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { OFFLINE_LICENSE_PRIVATE_KEY: Buffer.from(PRIV).toString("base64") };
const deps = () => ({ env, appPublicPem: PUB, now: () => clock });
const admin = { userId: "sa", role: "super_admin", tenantId: null } as Caller;
const owner = { userId: "o1", role: "owner", tenantId: "t1", permissions: null, actions: [], tenantDeniedActions: [] } as Caller;
const request = (installationId: string, pharmacy = "City Pharmacy") =>
  `MAVIN-REQUEST-1.${Buffer.from(JSON.stringify({ v: 1, installationId, pharmacy, appVersion: "1.0.0", at: "2026-11-12T00:00:00.000Z" })).toString("base64url")}`;

let db: DatabaseSync;
let sql: Sql;
let clock: Date;
beforeEach(() => { db = fullSchemaDb(); sql = sqliteSql(db); clock = new Date("2026-11-12T08:00:00.000Z"); });

test("the server's public key is the one bundled in the app", () => {
  // Same key whatever line endings the checkout gave the file (CRLF on Windows).
  const pem = (s: string) => s.replace(/\r\n/g, "\n").trim();
  assert.equal(pem(lic.APP_PUBLIC_KEY_PEM), pem(readFileSync(new URL("../../desktop-standalone/resources/license-public.pem", import.meta.url), "utf8")));
});

test("Super Admin only; a bad code, a missing key, a wrong key and an unavailable category are refused", async () => {
  const base = { requestCode: request(randomUUID()), category: "retail_pharmacy", name: "City Pharmacy", expires: "2027-11-30" };
  await assert.rejects(lic.issue(sql, owner, base, deps()), /Super Admin only/);
  await assert.rejects(lic.issue(sql, admin, { ...base, requestCode: "hello" }, deps()), /must start with MAVIN-REQUEST-1/);
  await assert.rejects(lic.issue(sql, admin, base, { ...deps(), env: {} }), /not set up on the server/);
  const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await assert.rejects(lic.issue(sql, admin, base, { ...deps(), env: { OFFLINE_LICENSE_PRIVATE_KEY: other } }), /does not match the key built into/);
  await assert.rejects(lic.issue(sql, admin, { ...base, category: "restaurant" }, deps()), /no offline edition for Restaurant/);
  await assert.rejects(lic.issue(sql, admin, { ...base, expires: "2026-11-01" }, deps()), /must be in the future/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM offline_licenses").get() as { n: number }).n, 0);
});

test("the generated key activates that installation in the desktop app; a renewal needs no new code; history kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mavin-offline-lic-"));
  const local = new LocalDb(join(dir, "pharmacy.db"), SCHEMA);
  try {
    const installationId = randomUUID();
    local.setMeta("installation_id", installationId);
    local.setMeta("trial_started_at", "2026-11-01T00:00:00.000Z");
    const app = new License(local, PUB, () => clock);
    assert.equal(app.info().canTransact, false, "trial over");

    const p = lic.preview(admin, { requestCode: request(installationId) });
    assert.deepEqual([p.installationId, p.pharmacy, p.appVersion], [installationId, "City Pharmacy", "1.0.0"]);
    const first = await lic.issue(sql, admin, { requestCode: request(installationId), category: "retail_pharmacy", name: "City Pharmacy", ownerName: "Asif", phone: "03001234567", city: "Lahore", expires: "2027-11-30" }, deps());
    assert.equal(first.kind, "activation");
    assert.match(first.fileName, /^City-Pharmacy-2027-11-30\.lic$/);
    const info = app.import(first.licenseText, "admin");
    assert.deepEqual([info.status, info.canTransact, info.licensee], ["active", true, "City Pharmacy"]);
    assert.equal(info.expiresAt, "2027-11-30T18:59:59.000Z", "end of 30 Nov, Pakistan time");

    const list1 = await lic.list(sql, admin);
    const t = list1.tenants[0] as Record<string, unknown>;
    assert.deepEqual([t.name, t.category, t.city, Number(t.licenses)], ["City Pharmacy", "retail_pharmacy", "Lahore", 1]);

    clock = new Date("2027-11-20T08:00:00.000Z");
    const renewal = await lic.issue(sql, admin, { tenantId: String(t.id), category: "retail_pharmacy", name: "City Pharmacy", expires: "2028-11-30" }, deps());
    assert.equal(renewal.kind, "renewal");
    assert.equal(app.import(renewal.licenseText, "admin").expiresAt, "2028-11-30T18:59:59.000Z");

    // A key for another installation is refused by the app.
    const elsewhere = await lic.issue(sql, admin, { requestCode: request(randomUUID(), "Other"), category: "medical_store", name: "Other Store", expires: "2028-01-31" }, deps());
    assert.throws(() => app.import(elsewhere.licenseText, "admin"), /another installation/);

    const h = await lic.history(sql, admin, { tenantId: String(t.id) });
    assert.deepEqual(h.map((x) => x.kind), ["renewal", "activation"]);
    assert.equal((await lic.list(sql, admin)).tenants.length, 2);
    await assert.rejects(lic.list(sql, owner), /Super Admin only/);
  } finally {
    local.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline_* tables stay out of reach of the browser's SQL", async () => {
  const { analyzeSql, authorize } = await import("@/server/sqlPolicy");
  const known = new Set(["offline_tenants", "offline_licenses"]);
  for (const t of known) assert.equal(authorize(analyzeSql(`SELECT * FROM ${t}`), admin, known).ok, false);
});
