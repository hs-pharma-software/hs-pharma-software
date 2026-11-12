/** Mavin Pharmacy Offline: the desktop's core (local database guard, logins,
 * recovery key, license, catalogue, backup) on a temporary database. No network. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { LocalDb, guard, GuardError } from "../../desktop-standalone/src/core/localdb.ts";
import { LocalAuth, AuthFailure, TENANT_ID } from "../../desktop-standalone/src/core/auth.ts";
import { License, LicenseError, TRIAL_DAYS, GRACE_DAYS } from "../../desktop-standalone/src/core/license.ts";
import { Catalogue, drapNaming, type CataloguePage } from "../../desktop-standalone/src/core/catalogue.ts";
import { backupTo, checkBackup, swapIn, IDENTITY_KEYS, BackupError } from "../../desktop-standalone/src/core/backup.ts";

const SCHEMA = readFileSync(new URL("../../desktop/resources/schema.sql", import.meta.url), "utf8");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("ed25519");
const DAY = 86_400_000;

let dir: string;
let db: LocalDb;
let clock: Date;
const now = () => clock;

function open() {
  const d = new LocalDb(join(dir, "pharmacy.db"), SCHEMA);
  if (!d.meta("installation_id")) d.setMeta("installation_id", randomUUID());
  return d;
}
function licenseText(p: Record<string, unknown>, key = privateKey) {
  const body = Buffer.from(JSON.stringify({ v: 1, licenseId: randomUUID(), licensee: "Test Pharmacy", kind: "renewal", issuedAt: clock.toISOString(), ...p }));
  return `MAVIN-LICENSE-1.${body.toString("base64url")}.${sign(null, body, key).toString("base64url")}`;
}
const setupInput = { pharmacyName: "City Pharmacy", ownerName: "Owner Name", username: "admin", password: "correct-horse-battery" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mavin-standalone-"));
  clock = new Date("2026-11-12T08:00:00.000Z");
  db = open();
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── Guard ──

test("the page's SQL guard: one statement, no schema changes, no desktop tables, no password writes", () => {
  const o = { licenseActive: true };
  assert.equal(guard("SELECT * FROM products WHERE id = ?", o), "select");
  assert.equal(guard("INSERT INTO invoices (id) VALUES ('x')", o), "insert");
  assert.equal(guard("PRAGMA table_info(products)", o), "pragma");
  for (const bad of ["DROP TABLE invoices", "ATTACH DATABASE 'x' AS y", "SELECT 1; DELETE FROM invoices", "PRAGMA journal_mode = DELETE", "SELECT * FROM standalone_meta", "UPDATE users SET password_hash = 'x' WHERE id = 'u'", "BEGIN", "VACUUM"]) {
    assert.throws(() => guard(bad, o), GuardError, bad);
  }
  assert.equal(guard("SELECT 'standalone_meta; DROP' AS x", o), "select", "text inside strings does not count");
});

test("expired license: no new transactions, but settings, logins and reading still work", () => {
  const o = { licenseActive: false };
  assert.throws(() => guard("INSERT INTO invoices (id) VALUES ('x')", o), /license of this installation has expired/);
  assert.throws(() => guard("UPDATE product_batches SET qty = 1", o), /expired/);
  assert.equal(guard("UPDATE settings SET value = '1' WHERE key = 'k'", o), "update");
  assert.equal(guard("UPDATE users SET is_active = 0 WHERE id = 'u'", o), "update");
  assert.equal(guard("SELECT * FROM invoices", o), "select");
});

test("page reads never include password columns; batches are all or nothing", () => {
  const auth = new LocalAuth(db, now);
  auth.setup(setupInput);
  const rows = db.pageSelect("SELECT * FROM users", [], { licenseActive: true });
  assert.equal(rows.length, 1);
  assert.ok(!("password_hash" in rows[0]) && !("password_salt" in rows[0]));
  assert.throws(() => db.pageBatch([
    { sql: "INSERT INTO categories (id, name, tenant_id, created_at, updated_at) VALUES ('c1', 'A', ?, 'x', 'x')", params: [TENANT_ID] },
    { sql: "INSERT INTO nope (id) VALUES (1)" },
  ], { licenseActive: true }));
  assert.equal(db.pageSelect("SELECT COUNT(*) AS n FROM categories WHERE id = 'c1'", [], { licenseActive: true })[0].n, 0, "the first insert was rolled back");
});

// ── Setup, logins, recovery ──

test("first setup: the pharmacy (FBR off, Pharmacy sections) and its local Super Admin with a scrypt password", () => {
  const auth = new LocalAuth(db, now);
  assert.equal(auth.setupDone, false);
  assert.throws(() => auth.setup({ ...setupInput, password: "short" }), /at least 10/);
  const r = auth.setup(setupInput);
  assert.match(r.recoveryKey, /^([A-Z2-9]{5}-){5}[A-Z2-9]{5}$/);
  assert.equal(auth.superAdminId, r.userId);
  const t = db.db.prepare("SELECT business_type, fbr_allowed, allowed_modules FROM tenants WHERE id = ?").get(TENANT_ID) as Record<string, string | number>;
  assert.equal(t.business_type, "retail_pharmacy");
  assert.equal(t.fbr_allowed, 0, "FBR is off in this edition");
  assert.ok(JSON.parse(String(t.allowed_modules)).includes("purchase"));
  const u = db.db.prepare("SELECT role, password_hash FROM users WHERE id = ?").get(r.userId) as Record<string, string>;
  assert.equal(u.role, "owner");
  assert.match(u.password_hash, /^scrypt\$/);
  assert.ok(!String(db.meta("recovery_hash")).includes(r.recoveryKey.replace(/-/g, "")), "only a hash of the key is kept");
  assert.throws(() => auth.setup(setupInput), /already set up/);
});

test("sign-in: wrong passwords are slowed down; sessions end at restart and on logout", () => {
  const auth = new LocalAuth(db, now);
  auth.setup(setupInput);
  for (let i = 0; i < 5; i++) assert.throws(() => auth.login("admin", "wrong-password-1"), /Incorrect/);
  assert.throws(() => auth.login("admin", setupInput.password), /Too many wrong tries/);
  clock = new Date(clock.getTime() + 31_000);
  const s = auth.login("admin", setupInput.password);
  assert.equal(auth.sessionUser(s.session), s.userId);
  const restarted = new LocalAuth(db, now);
  assert.equal(restarted.sessionUser(s.session), null, "sessions are not kept across restarts");
  auth.logout(s.session);
  assert.equal(auth.sessionUser(s.session), null);
});

test("passwords: own, or any login by the Super Admin; staff cannot change others", () => {
  const auth = new LocalAuth(db, now);
  const { userId: admin } = auth.setup(setupInput);
  db.db.prepare("INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, is_active, created_at, updated_at) VALUES ('s1', ?, 'cashier', '!', 'x', 'staff', 1, 'x', 'x')").run(TENANT_ID);
  const sa = auth.login("admin", setupInput.password).session;
  auth.setPassword(sa, "s1", "cashier-password-1");
  const st = auth.login("cashier", "cashier-password-1").session;
  assert.throws(() => auth.setPassword(st, admin, "taken-over-password"), /Only the local Super Admin/);
  auth.setPassword(st, "s1", "cashier-password-2");
  assert.throws(() => auth.requireSuperAdmin(st), /Only the local Super Admin/);
  assert.throws(() => auth.login("cashier", "!"), /Incorrect/, "the placeholder is not a password");
});

test("recovery key: resets the Super Admin only, ends every session, replaces the key, is logged; wrong keys lock out", () => {
  const auth = new LocalAuth(db, now);
  const { recoveryKey, userId } = auth.setup(setupInput);
  const s = auth.login("admin", setupInput.password).session;
  for (let i = 0; i < 5; i++) assert.throws(() => auth.recover("AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA", "new-password-123"), /not valid/);
  assert.throws(() => auth.recover(recoveryKey, "new-password-123"), /Too many wrong recovery keys/);
  clock = new Date(clock.getTime() + 6 * 60_000);
  const r = auth.recover(recoveryKey.toLowerCase().replace(/-/g, " "), "new-password-123");
  assert.equal(r.username, "admin");
  assert.notEqual(r.recoveryKey, recoveryKey);
  assert.equal(auth.sessionUser(s), null, "the old session ended");
  assert.throws(() => auth.login("admin", setupInput.password), /Incorrect/);
  assert.equal(auth.login("admin", "new-password-123").userId, userId);
  clock = new Date(clock.getTime() + 3600_000);
  assert.throws(() => auth.recover(recoveryKey, "another-password-1"), /not valid/, "the used key no longer works");
  const actions = (db.db.prepare("SELECT action FROM standalone_audit ORDER BY id").all() as { action: string }[]).map((a) => a.action);
  assert.ok(actions.includes("admin_password_recovered") && actions.includes("recovery_failed"));
});

// ── License ──

test("trial, then activation bound to this installation; tampered, foreign and older files are refused", () => {
  const auth = new LocalAuth(db, now);
  auth.setup(setupInput);
  const lic = new License(db, PUB, now);
  assert.equal(lic.info().status, "trial");
  assert.equal(lic.info().canTransact, true);
  clock = new Date(clock.getTime() + (TRIAL_DAYS + 1) * DAY);
  assert.deepEqual([lic.info().status, lic.info().canTransact], ["expired", false]);

  const id = lic.installationId;
  const good = licenseText({ installationId: id, kind: "activation", expiresAt: "2027-12-31T23:59:59.000Z" });
  const [p, body, sig] = good.split(".");
  const tampered = `${p}.${Buffer.from(Buffer.from(body, "base64url").toString().replace("2027-12-31", "2099-12-31")).toString("base64url")}.${sig}`;
  assert.throws(() => lic.import(tampered, "admin"), /changed or was not issued/);
  assert.throws(() => lic.import(licenseText({ installationId: id, expiresAt: "2027-12-31T00:00:00.000Z" }, other.privateKey), "admin"), /changed or was not issued/);
  assert.throws(() => lic.import(licenseText({ installationId: randomUUID(), expiresAt: "2027-12-31T00:00:00.000Z" }), "admin"), /another installation/);
  const info = lic.import(good, "admin");
  assert.deepEqual([info.status, info.canTransact, info.licensee], ["active", true, "Test Pharmacy"]);
  const older = licenseText({ installationId: id, issuedAt: new Date(clock.getTime() - DAY).toISOString(), expiresAt: "2030-01-01T00:00:00.000Z" });
  assert.throws(() => lic.import(older, "admin"), /older than the one already installed/);
});

test("expiry: grace days, then blocked; a renewal restores transactions without reinstalling; the date cannot be turned back", () => {
  new LocalAuth(db, now).setup(setupInput);
  const lic = new License(db, PUB, now);
  lic.import(licenseText({ installationId: lic.installationId, kind: "activation", expiresAt: "2026-12-01T00:00:00.000Z" }), "admin");
  clock = new Date("2026-12-03T00:00:00.000Z");
  assert.deepEqual([lic.info().status, lic.info().canTransact], ["expired", true], "within the grace days");
  clock = new Date(Date.parse("2026-12-01T00:00:00.000Z") + (GRACE_DAYS + 1) * DAY);
  assert.deepEqual([lic.info().status, lic.info().canTransact], ["expired", false]);
  assert.throws(() => db.pageExecute("INSERT INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES ('i1', ?, 1, '2026-12-09', 'x', 'x')", [TENANT_ID], { licenseActive: lic.info().canTransact }), /expired/);
  lic.import(licenseText({ installationId: lic.installationId, expiresAt: "2027-12-31T00:00:00.000Z" }), "admin");
  assert.equal(lic.info().canTransact, true);
  db.pageExecute("INSERT INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES ('i1', ?, 1, '2026-12-09', 'x', 'x')", [TENANT_ID], { licenseActive: lic.info().canTransact });
  clock = new Date(clock.getTime() - 3 * DAY);
  assert.deepEqual([lic.info().status, lic.info().canTransact], ["expired", false], "the date was moved back");
  assert.match(lic.info().message, /earlier than a date this app has already seen/);
});

test("the recovery key has nothing to do with the license", () => {
  const auth = new LocalAuth(db, now);
  const { recoveryKey } = auth.setup(setupInput);
  const lic = new License(db, PUB, now);
  clock = new Date(clock.getTime() + 30 * DAY);
  const before = lic.info();
  auth.recover(recoveryKey, "new-password-123");
  assert.deepEqual([lic.info().status, lic.info().expiresAt], [before.status, before.expiresAt]);
  assert.throws(() => lic.import(recoveryKey, "admin"), LicenseError);
});

// ── Catalogue ──

const P = (id: string, f: Record<string, unknown> = {}) => ({ id, name: `Med ${id}`, company_name: "Maker", catalog_group: "pharma", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", deleted_at: null, ...f });

test("bundled catalogue on first start; updates never overwrite local edits, the pharmacy's own rows, or products in use", async () => {
  new LocalAuth(db, now).setup(setupInput);
  const pages: CataloguePage[] = [];
  const cat = new Catalogue(db, "https://app.mavin.pk/api/catalogue/pharma/", async () => pages.shift()!, now);
  cat.importBundled({ version: "v1", cursor: "2026-11-01T00:00:00.000Z", generatedAt: clock.toISOString(), rows: { products: [P("p1"), P("p2"), P("p3"), P("p4")] } });
  assert.equal(cat.status().products, 4);
  assert.equal(cat.importBundled({ version: "v1", cursor: null, generatedAt: clock.toISOString(), rows: { products: [P("p9")] } }), null, "only once");
  // The pharmacy edits p2, stocks p4, and has its own product with its own id.
  db.db.prepare("UPDATE products SET name = 'Panadol (our name)' WHERE id = 'p2'").run();
  db.db.prepare("INSERT INTO product_batches (id, product_id, batch_no, qty, tenant_id, created_at, updated_at) VALUES ('b1', 'p4', 'B', 10, ?, 'x', 'x')").run(TENANT_ID);
  db.db.prepare("INSERT INTO products (id, name, tenant_id, created_at, updated_at) VALUES ('own1', 'Our special', ?, 'x', 'x')").run(TENANT_ID);
  assert.equal(cat.due(), false, "not due within 24 hours");
  clock = new Date(clock.getTime() + 25 * 3600_000);
  assert.equal(cat.due(), true);
  pages.push({ version: "v2", cursor: "2026-11-13T00:00:00.000Z", more: false, rows: { products: [
    P("p1", { name: "Med p1 new", updated_at: "2026-11-13T00:00:00.000Z" }), P("p2", { name: "Catalogue name", updated_at: "2026-11-13T00:00:00.000Z" }),
    P("p3", { deleted_at: "2026-11-13T00:00:00.000Z" }), P("p4", { deleted_at: "2026-11-13T00:00:00.000Z" }), P("p5"), P("own1", { name: "Hijack" }),
  ] } });
  const s = await cat.sync();
  assert.equal(s.lastError, null);
  const name = (id: string) => (db.db.prepare("SELECT name, deleted_at FROM products WHERE id = ?").get(id) as { name: string; deleted_at: string | null });
  assert.equal(name("p1").name, "Med p1 new", "updated");
  assert.equal(name("p2").name, "Panadol (our name)", "local edit kept");
  assert.ok(name("p3").deleted_at, "removed upstream, unused here");
  assert.equal(name("p4").deleted_at, null, "removed upstream but stocked here: kept");
  assert.equal(name("own1").name, "Our special", "the pharmacy's own row is never touched");
  assert.equal(name("p5").name, "Med p5");
  assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM products WHERE id = 'p5'").get() as { n: number }).n, 1);
  assert.equal((db.db.prepare("SELECT qty FROM product_batches WHERE id = 'b1'").get() as { qty: number }).qty, 10, "stock untouched");
  assert.equal(cat.status().version, "v2");
});

test("catalogue: unchanged version skips, one update at a time, bounded retries, retry on reconnect", async () => {
  new LocalAuth(db, now).setup(setupInput);
  let calls = 0;
  let mode: "unchanged" | "fail" | "slow" = "fail";
  const cat = new Catalogue(db, "https://app.mavin.pk/api/catalogue/pharma/", async () => {
    calls++;
    if (mode === "fail") throw new Error("offline");
    if (mode === "slow") await new Promise((r) => setTimeout(r, 50));
    return { version: "v1", unchanged: true, rows: {}, cursor: null, more: false };
  }, now);
  cat.importBundled({ version: "v1", cursor: null, generatedAt: new Date(clock.getTime() - 2 * 24 * 3600_000).toISOString(), rows: { products: [P("p1")] } });
  assert.equal(cat.due(), true, "an old bundle is due at once");
  const s1 = await cat.sync();
  assert.match(s1.lastError ?? "", /offline/);
  assert.equal(cat.due(), false, "waits before retrying");
  await cat.sync();
  assert.equal(calls, 1, "no retry during the pause");
  mode = "slow";
  const [a, b] = await Promise.all([cat.onReconnect(), cat.sync(true)]);
  assert.equal(calls, 2, "back online: one attempt, never two at once");
  assert.equal(a.lastError, null);
  assert.equal(b.lastSuccessAt, a.lastSuccessAt);
  assert.equal(cat.due(), false);
});

test("new DRAP records: Brand Name + Strength, Generic Name as description, Manufacturer as company", () => {
  const r = drapNaming({ id: "d1", name: "x", drap_reg_no: "012345", drap_meta: JSON.stringify({ brandName: "Panadol", strength: "500mg", genericName: "Paracetamol", manufacturer: "GSK" }) });
  assert.deepEqual([r.name, r.description, r.company_name], ["Panadol 500mg", "Paracetamol", "GSK"]);
  assert.equal(drapNaming({ id: "d2", name: "Brufen 400mg", drap_reg_no: "1", drap_meta: JSON.stringify({ brandName: "Brufen 400mg", strength: "400mg" }) }).name, "Brufen 400mg", "strength not repeated");
  assert.equal(drapNaming({ id: "n1", name: "Plain" }).name, "Plain", "non-DRAP rows unchanged");
});

// ── Backup and restore ──

test("backup and restore: checked file, safety copy, this installation keeps its identity and license", () => {
  const auth = new LocalAuth(db, now);
  auth.setup(setupInput);
  db.db.prepare("INSERT INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES ('before', ?, 1, '2026-11-12', 'x', 'x')").run(TENANT_ID);
  const bak = join(dir, "backups", "b1.db");
  backupTo(db.db, bak);
  db.db.prepare("INSERT INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES ('after', ?, 2, '2026-11-12', 'x', 'x')").run(TENANT_ID);
  assert.equal(checkBackup(bak).pharmacy, "City Pharmacy");
  const junk = join(dir, "junk.db");
  writeFileSync(junk, "not a database");
  assert.throws(() => checkBackup(junk), BackupError);

  const identity = Object.fromEntries(IDENTITY_KEYS.map((k) => [k, db.meta(k)]));
  identity.installation_id = "keep-this-installation";
  db.close();
  const safety = swapIn(join(dir, "pharmacy.db"), bak, identity, clock);
  assert.ok(existsSync(safety));
  db = open();
  const ids = (db.db.prepare("SELECT id FROM invoices ORDER BY id").all() as { id: string }[]).map((r) => r.id);
  assert.deepEqual(ids, ["before"], "the backup's data");
  assert.equal(db.meta("installation_id"), "keep-this-installation", "identity stays this installation's");
});
