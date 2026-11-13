/** Offline desktop pilot, end to end: the real desktop core (desktop/src/core)
 * against the real server service (src/server/offline) on two separate
 * SQLite databases, joined by an in-process transport that can drop the
 * connection or lose a response. Made-up business; no network, no
 * production database, no real money. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import { HttpError } from "@/server/db";
import * as off from "@/server/offline/service";
import { signGrant, verifyGrant, type SignedGrant } from "@/offline/protocol";
import { OfflineDevice, TransportError, type Transport } from "../../desktop/src/core/device.ts";
import { Mirror, readOnlySql } from "../../desktop/src/core/mirror.ts";

const keys = generateKeyPairSync("ed25519");
const PUB = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIV = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.OFFLINE_GRANT_PRIVATE_KEY = Buffer.from(PRIV).toString("base64");

let db: DatabaseSync;
let sql: Sql;
let root: string;
let clock: Date;
// "Now" for the test: an hour ago (the server checks sale dates and stamps rows with the real clock).
const T = new Date(Date.now() - 3_600_000).toISOString();
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const all = (q: string, ...a: unknown[]) => db.prepare(q).all(...(a as never[])) as Record<string, unknown>[];

/** Users the fake login knows (password in clear here only, for the test). */
const LOGINS: Record<string, { password: string; caller: Caller }> = {};
/** The network between the two: up, down, or answering but losing the reply. */
const net = { down: false, loseReplyOf: null as string | null, failPullAfter: -1, pulls: 0 };

const transport: Transport = {
  async post<R>(path: string, body: unknown, headers: Record<string, string>): Promise<R> {
    if (net.down) throw new TransportError("fetch failed", null);
    const b = body as Record<string, unknown>;
    try {
      let result: unknown;
      if (path === "/api/auth/login/") {
        const l = LOGINS[String(b.username)];
        if (!l || l.password !== b.password) throw new HttpError(401, "Incorrect username or password.");
        return { userId: l.caller.userId, token: `tok-${b.username}` } as R;
      }
      const caller = () => {
        const u = Object.entries(LOGINS).find(([n]) => headers.Authorization === `Bearer tok-${n}`);
        if (!u) throw new HttpError(401, "Your session has ended.");
        return u[1].caller;
      };
      const device = () => off.deviceFromAuth(sql, headers["X-Mavin-Device"] ?? null);
      off.checkProtocol(b.protocol);
      switch (b.action) {
        case "provision": result = await off.provisionDevice(sql, caller(), b); break;
        case "enrol": result = await off.enrolUser(sql, await device(), caller()); break;
        case "pull": {
          if (net.failPullAfter >= 0 && net.pulls++ >= net.failPullAfter) throw new TransportError("connection reset", null);
          result = await off.pull(sql, await device(), b.cursor, b.status as never);
          break;
        }
        case "push": result = { results: await off.push(sql, await device(), b.ops, b.status as never) }; break;
        case "mirror": result = await off.mirrorPage(sql, await device(), b.table, b.offset, b.since, clock); break;
        default: throw new HttpError(400, "Unknown action.");
      }
      // The server did the work, but the reply never arrives.
      if (net.loseReplyOf === b.action) { net.loseReplyOf = null; throw new TransportError("socket hang up", null); }
      return { result } as R;
    } catch (e) {
      if (e instanceof TransportError) throw e;
      if (e instanceof HttpError) throw new TransportError(e.message, e.status);
      throw e;
    }
  },
};

const secrets = new Map<string, string>();
const opened: OfflineDevice[] = [];
const mirrors: Mirror[] = [];
const newDevice = () => { const d = new OfflineDevice({ dataRoot: root, publicKeyPem: PUB, appVersion: "0.1.0-test", transport, secrets: { get: (k) => secrets.get(k) ?? null, set: (k, v) => void secrets.set(k, v) }, now: () => clock }); opened.push(d); return d; };

function tenant(id: string, type = "retail_pharmacy", flags = ["+desktop.offline"]) {
  run(`INSERT INTO tenants (id, name, business_type, denied_actions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, id, `Shop ${id}`, type, JSON.stringify(flags), T, T);
}
function user(id: string, tenantId: string, username: string, role: "owner" | "staff" = "owner", permissions: string[] | null = null) {
  run(`INSERT INTO users (id, tenant_id, username, display_name, role, password_hash, password_salt, is_active, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x', 1, ?, ?, ?)`,
    id, tenantId, username, `User ${username}`, role, permissions ? JSON.stringify(permissions) : null, T, T);
  LOGINS[username] = { password: "pass-1234", caller: { userId: id, role, tenantId, permissions } };
}
function product(id: string, tenantId: string, name: string, o: { packing?: number; tax?: number; price?: number; narcotic?: boolean; imei?: boolean; barcode?: string } = {}) {
  run(`INSERT INTO products (id, tenant_id, name, barcode, packing, gst_rate_pct, is_narcotic, track_imei, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, tenantId, name, o.barcode ?? null, o.packing ?? 1, o.tax ?? 0, o.narcotic ? 1 : 0, o.imei ? 1 : 0, T, T);
  if (o.price != null) run(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, `${id}-pr`, id, tenantId, o.price, T, T);
}
function batch(id: string, productId: string, tenantId: string, qty: number, expiry: string, branch = `main-${tenantId}`) {
  run(`INSERT INTO product_batches (id, product_id, tenant_id, branch_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 40, ?, ?)`, id, productId, tenantId, branch, `B-${id}`, expiry, qty, T, T);
}
const serverQty = (id: string) => Number(one(`SELECT qty FROM product_batches WHERE id = ?`, id).qty);
const invoices = () => all(`SELECT * FROM invoices WHERE tenant_id = 't1'`);

async function provisioned() {
  const d = newDevice();
  await d.provision("owner1", "pass-1234");
  const r = await d.sync();
  assert.equal(r.error, null);
  return d;
}

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  root = mkdtempSync(join(tmpdir(), "mavin-offline-"));
  clock = new Date(T);
  secrets.clear();
  for (const k of Object.keys(LOGINS)) delete LOGINS[k];
  Object.assign(net, { down: false, loseReplyOf: null, failPullAfter: -1, pulls: 0 });
  tenant("t1");
  tenant("t2");
  user("u1", "t1", "owner1");
  user("u2", "t2", "owner2");
  user("s1", "t1", "cashier", "staff", ["invoices"]);
  product("p1", "t1", "Panadol 500mg", { packing: 10, price: 100, barcode: "8964000001" });
  product("p2", "t1", "Syrup X", { price: 250.5, tax: 18 });
  product("pn", "t1", "Controlled Y", { price: 300, narcotic: true });
  product("pi", "t1", "Phone Z", { price: 30000, imei: true });
  batch("b1a", "p1", "t1", 5, "2027-01-31");
  batch("b1b", "p1", "t1", 20, "2028-06-30");
  batch("b2", "p2", "t1", 3, "2027-12-31");
  batch("bn", "pn", "t1", 4, "2027-12-31");
  product("q1", "t2", "Other shop item", { price: 70 });
  batch("bq", "q1", "t2", 9, "2027-12-31");
});
afterEach(() => {
  for (const d of opened.splice(0)) d.close();
  for (const m of mirrors.splice(0)) m.close();
  rmSync(root, { recursive: true, force: true });
});

test("provision online, download, sell offline, restart, reconnect: one invoice, stock taken once", async () => {
  let d = await provisioned();
  const st = d.status();
  assert.ok(st.provisioned && st.catalogReady && st.tenantName === "Shop t1" && /^D[0-9A-F]{4}$/.test(st.deviceCode));
  assert.deepEqual(d.search("panadol").map((p) => [p.name, p.available, p.price]), [["Panadol 500mg", 25, 100]]);
  assert.deepEqual(d.search("8964000001").map((p) => p.id), ["p1"], "barcode");

  net.down = true;
  // 7 packs: 5 from the earlier expiry, 2 from the next (FEFO, as online).
  const { sale, receipt } = d.createSale({ lines: [{ productId: "p1", unit: "pack", qty: 7 }, { productId: "p2", unit: "pack", qty: 1 }], tendered: 1000 });
  assert.deepEqual(sale.lines.map((l) => [l.batchId, l.qtyPacks]), [["b1a", 5], ["b1b", 2], ["b2", 1]]);
  assert.equal(sale.totals.payable, 995.59); // 700 + 250.5 * 1.18
  assert.equal(sale.totals.change, 4.41);
  assert.match(receipt, /Not submitted to FBR/);
  assert.equal(d.search("panadol")[0].available, 18, "local stock moved at once");
  assert.equal((await d.sync()).error?.startsWith("No connection"), true);
  assert.equal(d.status().provisioned && d.status().pending, 1);

  // Power cut / restart: everything is still there.
  d.close();
  d = newDevice();
  assert.equal(d.status().provisioned && d.status().pending, 1);
  assert.equal(d.search("panadol")[0].available, 18);
  assert.equal(invoices().length, 0, "nothing reached the server yet");

  // The connection comes back: the app syncs at once (retry delays are for repeated failures).
  net.down = false;
  const r = await d.sync({ manual: true });
  assert.equal(r.error, null);
  assert.equal(r.applied, 1);
  const inv = invoices();
  assert.equal(inv.length, 1);
  assert.equal(inv[0].id, sale.saleId);
  assert.equal(inv[0].offline_ref, sale.offlineRef);
  assert.equal(inv[0].invoice_no, 1);
  assert.equal(inv[0].branch_id, "main-t1");
  assert.equal(Number(inv[0].payable), 995.59);
  assert.equal(inv[0].fbr_invoice_no, null, "no FBR number is invented");
  assert.equal(all(`SELECT * FROM invoice_items WHERE invoice_id = ?`, sale.saleId).length, 3);
  assert.deepEqual([serverQty("b1a"), serverQty("b1b"), serverQty("b2")], [0, 18, 2]);
  // After the download includes the sale, the local figure is the server's (not subtracted twice).
  assert.equal(d.search("panadol")[0].available, 18);
  assert.equal(d.status().provisioned && d.status().pending, 0);
  assert.equal(d.recentSales()[0].server_invoice_no, 1);
});

test("the same operation delivered again, or after a lost reply, makes one sale", async () => {
  const d = await provisioned();
  d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 2 }], tendered: 1000 });
  net.loseReplyOf = "push";
  assert.match(String((await d.sync()).error), /No connection/);
  assert.equal(invoices().length, 1, "the server applied it");
  const r = await d.sync({ manual: true });
  assert.equal(r.error, null);
  assert.equal(invoices().length, 1, "the repeat got the stored answer");
  assert.equal(serverQty("b2"), 1, "stock taken once");
  // A raw repeat of the same body: still one.
  const body = JSON.parse(String((all(`SELECT payload FROM offline_ops`)[0]).payload));
  const dev = (await off.deviceFromAuth(sql, `${d.status().provisioned ? all(`SELECT id FROM offline_devices`)[0].id : ""}:${[...secrets.values()][0]}`));
  const again = await off.push(sql, dev, [{ opId: String(one(`SELECT op_id FROM offline_ops`).op_id), kind: "sale.create", entityId: body.saleId, schemaVersion: 1, dependsOn: [], occurredAt: body.occurredAt, userId: body.userId, payload: body }]);
  assert.equal(again[0].status, "applied");
  assert.equal(invoices().length, 1);
});

test("cloud stock changed meanwhile: the sale is kept and a visible exception is raised, no invented stock", async () => {
  const d = await provisioned();
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 3 }], tendered: 1000 });
  // Meanwhile the web counter sold 2 of the same batch.
  run(`UPDATE product_batches SET qty = 1, updated_at = ? WHERE id = 'b2'`, T);
  net.down = false;
  const r = await d.sync();
  assert.equal(r.conflicts, 1);
  assert.equal(invoices().length, 1, "sale and cash kept");
  assert.equal(serverQty("b2"), 0, "never below zero");
  const x = all(`SELECT * FROM offline_exceptions`);
  assert.equal(x.length, 1);
  assert.equal(x[0].qty, 2);
  assert.equal(x[0].invoice_id, sale.saleId);
  assert.equal(d.status().provisioned && d.status().conflicts, 1);
  const owner: Caller = LOGINS.owner1.caller;
  assert.equal((await off.listExceptions(sql, owner, "t1"))[0].status, "open");
  await assert.rejects(off.resolveException(sql, owner, String(x[0].id), ""), /Say what was done/);
  await off.resolveException(sql, owner, String(x[0].id), "Counted shelf, adjusted stock");
  assert.equal(one(`SELECT status FROM offline_exceptions`).status, "resolved");
  assert.equal(Number(one(`SELECT payable FROM invoices`).payable), Number(sale.totals.payable), "the sale itself is never rewritten");
});

test("an interrupted first download resumes where it stopped", async () => {
  for (let i = 0; i < 620; i++) { product(`bulk${String(i).padStart(4, "0")}`, "t1", `Bulk ${i}`, { price: 10 }); batch(`bb${i}`, `bulk${String(i).padStart(4, "0")}`, "t1", 1, "2028-01-01"); }
  const d = newDevice();
  await d.provision("owner1", "pass-1234");
  net.failPullAfter = 1; // the second page fails
  assert.match(String((await d.sync()).error), /No connection/);
  const after1 = d.status();
  assert.ok(after1.provisioned && !after1.catalogReady && after1.downloading && after1.products === 500);
  net.failPullAfter = -1;
  net.pulls = 0;
  const r = await d.sync();
  assert.equal(r.error, null);
  const s = d.status();
  assert.ok(s.provisioned && s.catalogReady && s.products === 624);
  assert.ok(r.pulledPages < 7, "did not start again from the first page");
});

test("downloads never create outgoing operations (no sync loop)", async () => {
  const d = await provisioned();
  run(`UPDATE price_list SET sale_price = 120, updated_at = ? WHERE id = 'p1-pr'`, T);
  run(`UPDATE product_batches SET qty = 30, updated_at = ? WHERE id = 'b1b'`, T);
  const r = await d.sync();
  assert.equal(r.pushed, 0);
  assert.equal(d.search("panadol")[0].price, 120);
  assert.equal(d.search("panadol")[0].available, 35);
  const again = await d.sync();
  assert.equal(again.pushed, 0);
  assert.equal(all(`SELECT * FROM offline_ops`).length, 0);
});

test("signing out and restarting keep pending work; offline sign-in only within the allowance", async () => {
  let d = await provisioned();
  net.down = true;
  d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 300 });
  d.signOut();
  d.close();
  d = newDevice();
  await assert.rejects(d.signIn("owner1", "wrong"), /Incorrect/);
  await assert.rejects(d.signIn("cashier", "pass-1234"), /not signed in online on this computer/);
  const u = await d.signIn("owner1", "pass-1234");
  assert.equal(u.online, false);
  assert.equal(d.status().provisioned && d.status().pending, 1);
  // 72 hours later the allowance has ended: no selling, but the pending sale is kept and can be sent.
  const ends = d.status().provisioned ? String(d.status().allowanceEndsAt) : "";
  assert.ok(Date.parse(ends) - Date.now() > 71 * 3600_000, "72 hours from the server's time");
  clock = new Date(Date.parse(ends) + 3600_000);
  assert.match(String(d.sellBlock()), /allowance ended/);
  assert.throws(() => d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 300 }), /allowance ended/);
  net.down = false;
  const r = await d.sync({ manual: true });
  assert.equal(r.applied, 1);
  const renewed = d.status().provisioned ? String(d.status().allowanceEndsAt) : "";
  assert.ok(Date.parse(renewed) > Date.parse(ends), "reconnecting issued a new allowance");
});

test("a computer clock moved back blocks offline sales", async () => {
  const d = await provisioned();
  d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 300 });
  clock = new Date(Date.parse(T) - 3600_000);
  assert.match(String(d.sellBlock()), /clock is earlier/);
});

test("an edited or foreign allowance is not accepted", () => {
  const p = { v: 1 as const, deviceId: "x", deviceCode: "DAAAA", tenantId: "t1", tenantName: "", businessType: "", branchId: "b", branchName: "", users: [], modules: ["sale.cash" as const], issuedAt: T, expiresAt: "2099-01-01T00:00:00Z" };
  const g = signGrant(p, PRIV);
  assert.ok(verifyGrant(g, PUB));
  const tampered: SignedGrant = { ...g, payload: Buffer.from(JSON.stringify({ ...p, expiresAt: "2199-01-01T00:00:00Z" })).toString("base64url") };
  assert.equal(verifyGrant(tampered, PUB), null);
  const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.equal(verifyGrant(signGrant(p, other), PUB), null);
});

test("editing the saved allowance on disk does not extend it", async () => {
  const d = await provisioned();
  const file = join(root, JSON.parse(readFileSync(join(root, "device.json"), "utf8")).dbFile);
  d.close();
  const { DatabaseSync } = await import("node:sqlite");
  const raw = new DatabaseSync(file);
  const g = JSON.parse(String((raw.prepare(`SELECT value FROM meta WHERE key = 'grant'`).get() as { value: string }).value)) as SignedGrant;
  const p = JSON.parse(Buffer.from(g.payload, "base64url").toString());
  p.expiresAt = "2199-01-01T00:00:00Z";
  raw.prepare(`UPDATE meta SET value = ? WHERE key = 'grant'`).run(JSON.stringify({ ...g, payload: Buffer.from(JSON.stringify(p)).toString("base64url") }));
  raw.close();
  const d2 = newDevice();
  assert.equal(d2.grant(), null);
  net.down = true;
  await d2.signIn("owner1", "pass-1234");
  assert.match(String(d2.sellBlock()), /no valid offline allowance/);
});

test("businesses and branches stay apart", async () => {
  const d = await provisioned();
  assert.deepEqual(d.search("other shop"), [], "another business's products are never downloaded");
  // Another business's owner cannot sign in on this device.
  await assert.rejects(d.signIn("owner2", "pass-1234"), /another business/);
  // A forged sale using another business's batch is not applied.
  const dev = (await off.deviceFromAuth(sql, `${String(one(`SELECT id FROM offline_devices`).id)}:${[...secrets.values()][0]}`));
  const { sale } = (() => { net.down = true; return d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 300 }); })();
  const forged = { ...sale, saleId: "forged-sale-0001", offlineRef: sale.offlineRef!.replace(/\d+$/, "999999"), lines: sale.lines.map((l) => ({ ...l, lineId: "forged-line-0001", batchId: "bq", productId: "q1" })) };
  const res = await off.push(sql, dev, [{ opId: "forged-op-00001", kind: "sale.create", entityId: forged.saleId, schemaVersion: 1, dependsOn: [], occurredAt: forged.occurredAt, userId: forged.userId, payload: forged }]);
  assert.equal(res[0].status, "held");
  assert.equal(serverQty("bq"), 9);
  assert.equal(all(`SELECT * FROM invoices WHERE id = 'forged-sale-0001'`).length, 0);
  // Wrong device secret.
  await assert.rejects(off.deviceFromAuth(sql, `${String(one(`SELECT id FROM offline_devices`).id)}:${"x".repeat(43)}`), /not set up/);
  // A second active device on the same branch is refused.
  await assert.rejects(off.provisionDevice(sql, LOGINS.owner1.caller, {}), /already has an offline checkout device/);
  // Other business types are not offered offline billing.
  tenant("t3", "lab");
  user("u3", "t3", "lab1");
  await assert.rejects(off.provisionDevice(sql, LOGINS.lab1.caller, {}), /pharmacies, medical stores and general stores only/);
  // Without the Super Admin's switch: no device.
  tenant("t4", "general_store", []);
  user("u4", "t4", "gs1");
  await assert.rejects(off.provisionDevice(sql, LOGINS.gs1.caller, {}), /not enabled/);
  // Device management of another business is refused.
  await assert.rejects(off.listDevices(sql, LOGINS.owner2.caller, "t1"), /Only the business owner/);
});

test("revoked device: its unsent sales are held for review, not lost, not applied until approved", async () => {
  const d = await provisioned();
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 300 });
  const id = String(one(`SELECT id FROM offline_devices`).id);
  await off.revokeDevice(sql, LOGINS.owner1.caller, id, "Computer replaced");
  net.down = false;
  const r = await d.sync();
  assert.equal(r.held, 1);
  assert.match(String(r.error), /turned off/, "the allowance is not renewed");
  assert.equal(invoices().length, 0);
  assert.equal(serverQty("b2"), 3);
  const held = await off.listHeld(sql, LOGINS.owner1.caller, "t1");
  assert.equal(held[0].offlineRef, sale.offlineRef);
  const res = await off.decideHeld(sql, LOGINS.owner1.caller, held[0].opId, true, "");
  assert.equal(res.status, "applied");
  assert.equal(invoices().length, 1);
  assert.equal(serverQty("b2"), 2);
  assert.equal(String(one(`SELECT decided_by FROM offline_ops`).decided_by), "u1");
});

test("loose units: quantities and money stay exact", async () => {
  const d = await provisioned();
  const { sale } = d.createSale({ lines: [{ productId: "p1", unit: "loose", qty: 3 }], tendered: 50 });
  assert.equal(sale.lines[0].qtyPacks, 0.3);
  assert.equal(sale.totals.payable, 30);
  await d.sync();
  assert.equal(Number(one(`SELECT qty FROM invoice_items`).qty), 0.3);
  assert.equal(Math.round(serverQty("b1a") * 1e6) / 1e6, 4.7);
  // The rest of a pack: 47 tablets left in the first batch, sold exactly to zero.
  const r = d.createSale({ lines: [{ productId: "p1", unit: "loose", qty: 47 }], tendered: 500 });
  assert.deepEqual(r.sale.lines.map((l) => [l.batchId, l.qtyPacks]), [["b1a", 4.7]]);
  await d.sync();
  assert.equal(serverQty("b1a"), 0);
});

test("controlled medicines need the buyer; IMEI products stay online-only", async () => {
  const d = await provisioned();
  assert.throws(() => d.createSale({ lines: [{ productId: "pn", unit: "pack", qty: 1 }], tendered: 300 }), /buyer's name and mobile/);
  d.createSale({ lines: [{ productId: "pn", unit: "pack", qty: 1 }], customerName: "Ali", customerPhone: "03001234567", tendered: 300 });
  assert.match(String(d.search("phone z")[0]?.onlineOnly), /IMEI/);
  assert.throws(() => d.createSale({ lines: [{ productId: "pi", unit: "pack", qty: 1 }], tendered: 30000 }), /IMEI/);
  assert.equal((await d.sync()).applied, 1);
});

test("a staff login enrolled online can sell offline; the server keeps captured prices", async () => {
  const d = await provisioned();
  const u = await d.signIn("cashier", "pass-1234");
  assert.equal(u.online, true);
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 300 });
  // Price raised online before the sale arrives: the invoice keeps the counter's price.
  run(`UPDATE price_list SET sale_price = 999 WHERE id = 'p2-pr'`);
  await d.sync();
  assert.equal(Number(one(`SELECT sale_price FROM invoice_items WHERE invoice_id = ?`, sale.saleId).sale_price), 250.5);
});

test("a forged total or tampered line is refused before anything is booked", async () => {
  const d = await provisioned();
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 300 });
  const dev = await off.deviceFromAuth(sql, `${String(one(`SELECT id FROM offline_devices`).id)}:${[...secrets.values()][0]}`);
  const bad = { ...sale, saleId: "bad-sale-000001", totals: { ...sale.totals, payable: 1 } };
  const res = await off.push(sql, dev, [{ opId: "bad-op-0000001", kind: "sale.create", entityId: bad.saleId, schemaVersion: 1, dependsOn: [], occurredAt: bad.occurredAt, userId: bad.userId, payload: bad }]);
  assert.equal(res[0].status, "rejected");
  assert.match(String(res[0].error), /totals/);
  assert.equal(invoices().length, 0);
});

test("the local database keeps a backup before a schema change and refuses a newer one", async () => {
  const d = await provisioned();
  const file = d.backupNow();
  assert.ok(readFileSync(file).length > 0);
  d.close();
  const { DatabaseSync } = await import("node:sqlite");
  const dbFile = join(root, JSON.parse(readFileSync(join(root, "device.json"), "utf8")).dbFile);
  const raw = new DatabaseSync(dbFile);
  raw.exec("PRAGMA user_version = 99");
  raw.close();
  assert.throws(() => newDevice(), /newer MAVIN desktop version/);
  writeFileSync(join(root, "touch"), "");
});

test("server change log records web edits for devices to pull", () => {
  const before = Number(one(`SELECT COUNT(*) AS n FROM offline_changes`).n);
  run(`UPDATE product_batches SET qty = qty + 1 WHERE id = 'b1a'`);
  run(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES ('np', 'p1', 't1', 110, ?, ?)`, T, T);
  const rows = all(`SELECT tbl, row_id, tenant_id, branch_id FROM offline_changes ORDER BY seq DESC LIMIT 2`);
  assert.equal(Number(one(`SELECT COUNT(*) AS n FROM offline_changes`).n), before + 2);
  assert.deepEqual(rows.map((r) => r.tbl).sort(), ["price_list", "product_batches"]);
  assert.equal(rows.find((r) => r.tbl === "product_batches")!.branch_id, "main-t1");
});

test("a device behind the trimmed change log downloads everything again", async () => {
  const d = await provisioned();
  run(`UPDATE product_batches SET qty = 21 WHERE id = 'b1b'`);
  run(`UPDATE offline_changes SET changed_at = '2000-01-01T00:00:00.000Z'`);
  run(`UPDATE product_batches SET qty = 22 WHERE id = 'b1b'`);
  assert.ok((await off.pruneChanges(sql)).removed > 0);
  const r = await d.sync();
  assert.equal(r.error, null);
  assert.equal(d.search("panadol")[0].available, 27);
  assert.equal(d.status().provisioned && d.status().catalogReady, true);
});

// ── The screens' read-only copy (desktop/src/core/mirror.ts) ──

/** The server database's structure, built the way desktop/scripts/schema.cjs builds resources/schema.sql. */
const SCHEMA_SQL = (() => {
  const rs = readFileSync(join(import.meta.dirname, "..", "..", "src-tauri", "src", "lib.rs"), "utf8");
  const parts: string[] = [];
  for (let v = 1; ; v++) {
    const m = new RegExp(String.raw`fn ${v === 1 ? "schema_sql" : `schema_sql_v${v}`}\(\)[^{]*\{\s*r#"([\s\S]*?)"#`).exec(rs);
    if (!m) break;
    parts.push(`${m[1]}\n;`);
  }
  return parts.join("\n");
})();
const COPY_TABLES = off.MIRROR_TABLES;
const HIST = off.HISTORY_TABLES;
/** What the desktop does after a sync: recent history, then its own sales on top. */
async function history(m: Mirror, d: OfflineDevice, o?: { fullEveryMs?: number }) {
  await m.refreshHistory(HIST, (t, off2, since) => d.mirrorPage(t, off2, since), clock, o);
  m.overlay(d.localSales(30), d.stockNow(), "t1", "main-t1");
}
async function copyOf(d: OfflineDevice) {
  const m = new Mirror(join(root, "mirror", "copy.db"), SCHEMA_SQL);
  mirrors.push(m);
  await m.refresh(COPY_TABLES, (t, o) => d.mirrorPage(t, o));
  await history(m, d);
  return m;
}
/** A row on the server with only the given values (required columns get a plain default). */
function serverRow(table: string, values: Record<string, unknown>) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  const v: Record<string, unknown> = { created_at: T, updated_at: T, ...values };
  for (const c of cols) if (c.notnull && c.dflt_value == null && v[c.name] === undefined) v[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : "";
  const keys = Object.keys(v).filter((k) => cols.some((c) => c.name === k));
  run(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => v[k]));
}
const copyQty = (m: Mirror, id: string) => Number(m.query(`SELECT qty FROM product_batches WHERE id = ?`, [id])[0]?.qty);

test("the read-only copy holds only this business's data, never passwords or credentials", async () => {
  // Another business whose id differs only where this one's has "_" (a LIKE wildcard).
  tenant("t_x");
  tenant("tAx");
  run(`INSERT INTO settings (key, value, updated_at) VALUES ('t1::invoice_footer', 'Thank you', ?), ('t1::fbr_production_token', 'SECRET-FBR', ?), ('t1::openai_api_key', 'sk-SECRET', ?), ('t2::invoice_footer', 'Other shop', ?), ('global_thing', 'x', ?)`, T, T, T, T, T);
  const d = await provisioned();
  const m = await copyOf(d);
  assert.deepEqual(m.query(`SELECT id FROM tenants`, []).map((r) => r.id), ["t1"]);
  assert.deepEqual(m.query(`SELECT key, value FROM settings`, []), [{ key: "t1::invoice_footer", value: "Thank you" }]);
  const users = m.query(`SELECT id, password_hash, password_salt FROM users ORDER BY id`, []);
  assert.deepEqual(users.map((u) => u.id), ["s1", "u1"]);
  assert.ok(users.every((u) => !u.password_hash && !u.password_salt), "no password checks in the copy");
  assert.deepEqual(m.query(`SELECT id FROM products ORDER BY id`, []).map((r) => r.id), ["p1", "p2", "pi", "pn"]);
  assert.deepEqual(m.query(`SELECT id FROM product_batches ORDER BY id`, []).map((r) => r.id), ["b1a", "b1b", "b2", "bn"]);
  // A device for t1 cannot ask for a table outside the list.
  await assert.rejects(d.mirrorPage("offline_devices", 0), /Unknown table/);
  await assert.rejects(d.mirrorPage("users; DROP TABLE users", 0), /Unknown table/);
});

test("the page can only read the copy", async () => {
  for (const ok of [`SELECT * FROM products`, ` with x as (select 1) select * from x;`, `SELECT 'DELETE; DROP' AS t FROM products -- UPDATE`]) assert.ok(readOnlySql(ok), ok);
  for (const bad of [`DELETE FROM products`, `SELECT 1; DELETE FROM products`, `UPDATE products SET name = 'x'`, `PRAGMA writable_schema = 1`, `ATTACH 'x.db' AS y`, `WITH x AS (SELECT 1) DELETE FROM products`, `INSERT INTO products SELECT * FROM products`])
    assert.equal(readOnlySql(bad), false, bad);
  const d = await provisioned();
  const m = await copyOf(d);
  assert.throws(() => m.query(`DELETE FROM products`, []), /Only reading/);
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM products`, [])[0].n, 4);
});

test("offline sales show in the copy at once; after sync its stock stays right even before the copy refreshes", async () => {
  const d = await provisioned();
  const m = await copyOf(d);
  assert.deepEqual([copyQty(m, "b1a"), copyQty(m, "b1b")], [5, 20]);

  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p1", unit: "pack", qty: 7 }], tendered: 700 });
  m.overlay(d.localSales(30), d.stockNow(), "t1", "main-t1");
  assert.deepEqual([copyQty(m, "b1a"), copyQty(m, "b1b")], [0, 18], "the sale's stock is taken in the copy");
  const listed = m.query(`SELECT id, invoice_no, offline_ref, payable, description FROM invoices`, []);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, sale.saleId);
  assert.equal(listed[0].invoice_no, null);
  assert.equal(listed[0].offline_ref, sale.offlineRef);
  assert.match(String(listed[0].description), /Pending sync/);
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?`, [sale.saleId])[0].n, 2);

  // Online again: sent and downloaded; the catalogue part of the copy not refreshed yet (it refreshes every few minutes).
  net.down = false;
  assert.equal((await d.sync({ manual: true })).applied, 1);
  await history(m, d);
  assert.deepEqual([copyQty(m, "b1a"), copyQty(m, "b1b")], [0, 18], "not the old figure back, not taken twice");
  const now = m.query(`SELECT id, invoice_no, offline_ref FROM invoices`, []);
  assert.deepEqual(now.map((r) => [r.id, r.invoice_no, r.offline_ref]), [[sale.saleId, 1, sale.offlineRef]], "the server's own invoice, numbered");
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?`, [sale.saleId])[0].n, 2);

  // A full refresh, then history and the overlay: still the same.
  await m.refresh(COPY_TABLES, (t, o) => d.mirrorPage(t, o));
  await history(m, d);
  assert.deepEqual([copyQty(m, "b1a"), copyQty(m, "b1b")], [0, 18]);
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM invoices`, [])[0].n, 1, "one invoice listed, not two");
});

test("recent sales and purchases made online, on other counters or phones are in the copy; changes and deletions follow", async () => {
  const day = (n: number) => new Date(clock.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  serverRow("suppliers", { id: "sup1", tenant_id: "t1", name: "Medi Distributors" });
  serverRow("suppliers", { id: "supX", tenant_id: "t2", name: "Other shop's supplier" });
  serverRow("invoices", { id: "web1", tenant_id: "t1", branch_id: "main-t1", invoice_no: 101, date: day(1), payable: 500 });
  serverRow("invoice_items", { id: "web1-a", invoice_id: "web1", tenant_id: "t1", branch_id: "main-t1", product_id: "p1", qty: 2 });
  serverRow("invoices", { id: "phone1", tenant_id: "t1", branch_id: "main-t1", invoice_no: 102, date: day(0), payable: 80 });
  serverRow("invoices", { id: "old1", tenant_id: "t1", branch_id: "main-t1", invoice_no: 5, date: day(90), payable: 10 });
  serverRow("invoices", { id: "branch2", tenant_id: "t1", branch_id: "b2-t1", invoice_no: 7, date: day(1), payable: 10 });
  serverRow("invoices", { id: "other", tenant_id: "t2", branch_id: "main-t2", invoice_no: 1, date: day(1), payable: 10 });
  serverRow("purchases", { id: "pu1", tenant_id: "t1", branch_id: "main-t1", supplier_id: "sup1", date: day(3), total: 900 });
  serverRow("purchase_items", { id: "pu1-a", purchase_id: "pu1", tenant_id: "t1", branch_id: "main-t1", product_id: "p2", qty: 10 });

  const d = await provisioned();
  const m = await copyOf(d);
  const ids = (t: string) => m.query(`SELECT id FROM ${t} ORDER BY id`, []).map((r) => r.id);
  assert.deepEqual(ids("invoices"), ["phone1", "web1"], "this branch's last 60 days only");
  assert.deepEqual(ids("invoice_items"), ["web1-a"]);
  assert.deepEqual(ids("purchases"), ["pu1"]);
  assert.deepEqual(ids("purchase_items"), ["pu1-a"]);
  assert.deepEqual(ids("suppliers"), ["sup1"]);

  // Later: one edited, one deleted, one new, all online; then only the changes are asked for.
  clock = new Date(clock.getTime() + 3_600_000);
  const later = clock.toISOString();
  run(`UPDATE invoices SET payable = 550, updated_at = ? WHERE id = 'web1'`, later);
  run(`UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = 'phone1'`, later, later);
  serverRow("invoices", { id: "web2", tenant_id: "t1", branch_id: "main-t1", invoice_no: 103, date: day(0), payable: 70, created_at: later, updated_at: later });
  const asked: (string | null | undefined)[] = [];
  await m.refreshHistory(HIST, (t, o, since) => { if (t === "invoices") asked.push(since); return d.mirrorPage(t, o, since); }, clock);
  assert.ok(asked[0] && asked[0] < later && asked[0] > T.slice(0, 10), "only changes since the last check (with a margin)");
  assert.deepEqual(ids("invoices"), ["web1", "web2"]);
  assert.equal(m.query(`SELECT payable FROM invoices WHERE id = 'web1'`, [])[0].payable, 550);

  // An offline sale sits beside them, and leaves the overlay once the server has it.
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p1", unit: "pack", qty: 1 }], tendered: 100 });
  await history(m, d).catch(() => m.overlay(d.localSales(30), d.stockNow(), "t1", "main-t1"));
  assert.deepEqual(ids("invoices"), [sale.saleId, "web1", "web2"].sort());
  net.down = false;
  await d.sync({ manual: true });
  await history(m, d);
  assert.deepEqual(ids("invoices"), [sale.saleId, "web1", "web2"].sort(), "no duplicate, nothing hidden");
  assert.equal(m.query(`SELECT invoice_no FROM invoices WHERE id = ?`, [sale.saleId])[0].invoice_no, 104);
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM mirror_overlay`, [])[0].n, 0, "nothing of this computer's left on top");

  // Deleted online later: gone from the copy too (not brought back by this computer's record of it).
  // (The server stamped the sale with its own clock, so the deletion comes after that.)
  const stamped = Date.parse(String(one(`SELECT updated_at FROM invoices WHERE id = ?`, sale.saleId).updated_at));
  clock = new Date(Math.max(clock.getTime(), stamped) + 3_600_000);
  run(`UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = ?`, clock.toISOString(), clock.toISOString(), sale.saleId);
  await history(m, d);
  assert.deepEqual(ids("invoices"), ["web1", "web2"]);

  // An edit stamped by a device whose clock is behind is missed by "changed since", but not by the daily full check.
  run(`UPDATE invoices SET payable = 600, updated_at = ? WHERE id = 'web1'`, T);
  await history(m, d);
  assert.equal(m.query(`SELECT payable FROM invoices WHERE id = 'web1'`, [])[0].payable, 550, "missed for now");

  // The daily full check: the missed edit arrives; nothing else changes.
  clock = new Date(clock.getTime() + 25 * 3_600_000);
  await history(m, d);
  assert.deepEqual(ids("invoices"), ["web1", "web2"]);
  assert.deepEqual(ids("invoice_items"), ["web1-a"]);
  assert.equal(m.query(`SELECT payable FROM invoices WHERE id = 'web1'`, [])[0].payable, 600);
});

test("a server without some copy table yet is skipped, not fatal", async () => {
  const d = await provisioned();
  const m = new Mirror(join(root, "mirror", "copy.db"), SCHEMA_SQL);
  mirrors.push(m);
  await m.refresh(["products", "not_on_this_server", "customers"], (t, o) => d.mirrorPage(t, o));
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM products`, [])[0].n, 4);
});

// ── Version 2: credit, bonus, charges, bill discount, editing (desktop 0.2.3) ──

const inv = (id: string) => one(`SELECT * FROM invoices WHERE id = ?`, id);
const items = (id: string) => all(`SELECT * FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY batch_no`, id);
const heldReason = (opId?: string) => String(one(`SELECT error FROM offline_ops WHERE status = 'held'${opId ? " AND op_id = ?" : ""}`, ...(opId ? [opId] : [])).error);

test("offline credit sale with bonus, charges and bill discount: booked as online, stock includes the bonus", async () => {
  serverRow("customers", { id: "c1", tenant_id: "t1", name: "Ali Medical" });
  const d = await provisioned();
  net.down = true;
  // 4 packs + 2 bonus of p1 (5 in b1a, then b1b), 2% off the line; bill discount 20, charges 15; 100 paid now.
  const { sale, receipt } = d.createSale({
    lines: [{ productId: "p1", unit: "pack", qty: 4, bonusQty: 2, discountPct: 2 }],
    customerId: "c1", customerName: "Ali Medical", method: "credit", paid: 100, billDiscountRs: 20, charges: 15, tendered: 100,
  });
  assert.deepEqual(sale.lines.map((l) => [l.batchId, l.qtyPacks, l.bonusPacks ?? 0]), [["b1a", 4, 1], ["b1b", 0, 1]]);
  assert.equal(sale.totals.payable, 387); // 400 - 8 - 20 + 15
  assert.equal(sale.totals.balance, 287);
  assert.match(receipt, /On account\s+287\.00/);
  assert.match(receipt, /bonus 1/);
  assert.equal(d.search("panadol")[0].available, 19, "6 packs left the local stock (bonus included)");
  net.down = false;
  assert.equal((await d.sync({ manual: true })).applied, 1);
  const i = inv(sale.saleId);
  assert.deepEqual([i.inv_on, i.customer_id, Number(i.charges), Number(i.discount_rs), Number(i.payable), Number(i.paid), Number(i.balance)], ["credit", "c1", 15, 20, 387, 100, 287]);
  assert.deepEqual(items(sale.saleId).map((x) => [Number(x.qty), Number(x.bonus_qty)]), [[4, 1], [0, 1]]);
  assert.deepEqual([serverQty("b1a"), serverQty("b1b")], [0, 19]);
});

test("credit needs a known customer; cash must be paid in full", async () => {
  const d = await provisioned();
  net.down = true;
  assert.throws(() => d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], method: "credit", paid: 0, tendered: 0 }), /needs a customer/);
  assert.throws(() => d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 10 }), /less than the bill/);
  // A customer this business does not have: the server keeps the sale for review, not in the books.
  d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], customerId: "nobody", method: "credit", paid: 0, tendered: 0 });
  net.down = false;
  assert.equal((await d.sync({ manual: true })).held, 1);
  assert.match(heldReason(), /customer/);
  assert.equal(invoices().length, 0);
});

test("editing an offline sale before it was sent: both go up in order, the books show the edit, stock taken once", async () => {
  const d = await provisioned();
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p1", unit: "pack", qty: 3 }], tendered: 300 });
  assert.equal(d.search("panadol")[0].available, 22);
  const { sale: edited } = d.createSale({ lines: [{ productId: "p1", unit: "pack", qty: 5, bonusQty: 1 }, { productId: "p2", unit: "pack", qty: 1 }], tendered: 1000, edit: { invoiceId: sale.saleId } });
  assert.equal(edited.saleId, sale.saleId);
  assert.equal(edited.offlineRef, sale.offlineRef, "same receipt");
  assert.equal(d.search("panadol")[0].available, 19, "old 3 back, new 6 out");
  assert.equal(d.status().provisioned && d.status().pending, 2);
  net.down = false;
  const r = await d.sync({ manual: true });
  assert.equal(r.applied, 2);
  assert.equal(invoices().length, 1);
  assert.equal(Number(inv(sale.saleId).payable), edited.totals.payable);
  assert.equal(items(sale.saleId).length, 3, "old line replaced by the new ones (p1 over two batches, p2)");
  assert.deepEqual([serverQty("b1a"), serverQty("b1b"), serverQty("b2")], [0, 19, 2]);
  assert.equal(d.search("panadol")[0].available, 19, "after the download, not counted twice");
});

/** An invoice made online (stock already taken), as the device's copy would hold it. */
function onlineInvoice(id: string, qty: number) {
  serverRow("invoices", { id, tenant_id: "t1", branch_id: "main-t1", invoice_no: 50, date: T.slice(0, 10), inv_on: "cash", total: qty * 250.5, payable: 100, paid: 100, balance: 0 });
  serverRow("invoice_items", { id: `${id}-1`, invoice_id: id, tenant_id: "t1", branch_id: "main-t1", product_id: "p2", batch_no: "B-b2", qty, bonus_qty: 0, sale_price: 240, tax_pct: 18, total: 1 });
  run(`UPDATE product_batches SET qty = qty - ? WHERE id = 'b2'`, qty);
  const r = inv(id);
  return {
    invoiceNo: 50, updatedAt: String(r.updated_at), date: String(r.date), offlineRef: null, fbrInvoiceNo: null as string | null, editable: true,
    items: [{ productId: "p2", batchNo: "B-b2", qty, bonusQty: 0, salePrice: 240, taxPct: 18 }],
  };
}

test("editing an invoice made online, offline: old stock back, new taken, its own price kept", async () => {
  const original = onlineInvoice("web-invoice-01", 2);
  const d = await provisioned();
  assert.equal(d.search("syrup")[0].available, 1);
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 3 }], tendered: 1000, edit: { invoiceId: "web-invoice-01", original } });
  assert.equal(sale.lines[0].pricePerPack, 240, "the invoice's price, not today's price list");
  assert.equal(d.search("syrup")[0].available, 0, "2 back, 3 out");
  net.down = false;
  assert.equal((await d.sync({ manual: true })).applied, 1);
  assert.equal(serverQty("b2"), 0);
  assert.equal(items("web-invoice-01").length, 1);
  assert.equal(Number(items("web-invoice-01")[0].qty), 3);
  assert.equal(Number(inv("web-invoice-01").payable), sale.totals.payable);
  assert.equal(all(`SELECT * FROM invoice_items WHERE invoice_id = 'web-invoice-01' AND deleted_at IS NOT NULL`).length, 1, "old line kept, marked deleted");
});

test("an invoice changed online meanwhile: the offline edit is held, not written over it; the owner can still apply it", async () => {
  const original = onlineInvoice("web-invoice-01", 1);
  const d = await provisioned();
  net.down = true;
  d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 2 }], tendered: 1000, edit: { invoiceId: "web-invoice-01", original } });
  run(`UPDATE invoices SET payable = 999, updated_at = ? WHERE id = 'web-invoice-01'`, new Date(Date.now() + 1000).toISOString());
  net.down = false;
  assert.equal((await d.sync({ manual: true })).held, 1);
  assert.match(heldReason(), /changed on MAVIN\.pk/);
  assert.equal(Number(inv("web-invoice-01").payable), 999, "the online change stays");
  const held = await off.listHeld(sql, LOGINS.owner1.caller, "t1");
  assert.equal(held[0].kind, "edit");
  const res = await off.decideHeld(sql, LOGINS.owner1.caller, held[0].opId, true, null) as { status: string };
  assert.equal(res.status, "applied");
  assert.equal(Number(items("web-invoice-01")[0].qty), 2);
  assert.equal(serverQty("b2"), 1, "3 - 1 (online) + 1 back - 2");
});

test("FBR-submitted invoices are not edited offline; staff without Edit invoices are held", async () => {
  const original = onlineInvoice("web-invoice-01", 1);
  const d = await provisioned();
  net.down = true;
  assert.throws(() => d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 1000, edit: { invoiceId: "web-invoice-01", original: { ...original, fbrInvoiceNo: "FBR-1" } } }), /submitted to FBR/);
  // Submitted on the server after this computer saw it: held there.
  d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 1000, edit: { invoiceId: "web-invoice-01", original } });
  run(`UPDATE invoices SET fbr_invoice_no = 'FBR-9' WHERE id = 'web-invoice-01'`);
  net.down = false;
  assert.equal((await d.sync({ manual: true })).held, 1);
  assert.match(heldReason(), /FBR/);
});

test("a staff login without Edit invoices: the offline edit is held", async () => {
  const original = onlineInvoice("web-invoice-01", 1);
  const d = await provisioned();
  run(`UPDATE users SET denied_actions = ? WHERE id = 's1'`, JSON.stringify(["invoice.edit"]));
  await d.signIn("cashier", "pass-1234");
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 1000, edit: { invoiceId: "web-invoice-01", original } });
  net.down = false;
  await d.sync({ manual: true });
  const op = String(one(`SELECT op_id FROM offline_ops WHERE entity_id = ? AND user_id = 's1'`, sale.saleId).op_id);
  assert.match(heldReason(op), /may not edit invoices/);
});

test("a version 1 sale (desktop 0.2.2) is still accepted", async () => {
  const d = await provisioned();
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 1000 });
  const rest = { ...sale, customerId: undefined };
  const v1 = {
    ...rest, saleId: "v1-sale-00000001", offlineRef: sale.offlineRef!.replace(/\d+$/, "777777"),
    lines: sale.lines.map((l) => ({ ...l, lineId: "v1-line-00000001" })),
    totals: { total: sale.totals.total, discountRs: sale.totals.discountRs, taxRs: sale.totals.taxRs, payable: sale.totals.payable, paid: sale.totals.paid, balance: 0, tendered: sale.totals.tendered, change: sale.totals.change },
  };
  const dev = await off.deviceFromAuth(sql, `${all(`SELECT id FROM offline_devices`)[0].id}:${[...secrets.values()][0]}`);
  const r = await off.push(sql, dev, [{ opId: "v1-op-000000001", kind: "sale.create", entityId: v1.saleId, schemaVersion: 1, dependsOn: [], occurredAt: v1.occurredAt, userId: v1.userId, payload: v1 }]);
  assert.equal(r[0].status, "applied", r[0].error);
  assert.equal(inv("v1-sale-00000001").inv_on, "cash");
});

test("an offline edit shows in the copy at once, and the server's version replaces it after sync", async () => {
  const original = onlineInvoice("web-invoice-02", 1);
  const d = await provisioned();
  const m = await copyOf(d);
  const copyItems = () => m.query(`SELECT qty, bonus_qty FROM invoice_items WHERE invoice_id = 'web-invoice-02'`, []).map((r) => [Number(r.qty), Number(r.bonus_qty)]);
  assert.deepEqual(copyItems(), [[1, 0]]);
  net.down = true;
  const { sale } = d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 2, bonusQty: 1 }], customerId: null, tendered: 1000, edit: { invoiceId: "web-invoice-02", original } });
  m.overlay(d.localSales(30), d.stockNow(), "t1", "main-t1");
  assert.deepEqual(copyItems(), [[2, 1]], "the edited lines, not the old ones");
  assert.equal(Number(m.query(`SELECT payable FROM invoices WHERE id = 'web-invoice-02'`, [])[0].payable), sale.totals.payable);
  assert.equal(copyQty(m, "b2"), 0, "2 + 1 back, 3 out");
  net.down = false;
  await d.sync({ manual: true });
  await history(m, d);
  assert.deepEqual(copyItems(), [[2, 1]], "now the server's own rows");
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM mirror_overlay`, [])[0].n, 0);
});

// ── Super Admin: devices per branch, block / unblock, remove ──
test("Super Admin: more than one device per branch; block and unblock; remove an old device for good", async () => {
  const sa = { userId: "sa", role: "super_admin", tenantId: null } as Caller;
  const d = await provisioned();
  const id = String(one(`SELECT id FROM offline_devices`).id);
  // A second computer on the same branch: refused at first, allowed once MAVIN.pk raises the limit.
  await assert.rejects(() => off.provisionDevice(sql, LOGINS.owner1.caller, {}), /already has an offline checkout device/);
  await assert.rejects(() => off.setDevicesPerBranch(sql, LOGINS.owner1.caller, "t1", 2), /Super Admin/);
  await off.setDevicesPerBranch(sql, sa, "t1", 2);
  const second = await off.provisionDevice(sql, LOGINS.owner1.caller, { name: "Counter 2" });
  assert.ok(second.deviceId);
  await assert.rejects(() => off.provisionDevice(sql, LOGINS.owner1.caller, {}), /the most allowed: 2/);
  assert.equal((await off.listDevices(sql, sa, "t1")).perBranch, 2);
  // Block: no sync, sales sent meanwhile are held; unblock: back to work.
  await assert.rejects(() => off.blockDevice(sql, LOGINS.owner1.caller, id, true, "x"), /Super Admin/);
  await off.blockDevice(sql, sa, id, true, "Shop asked");
  net.down = true;
  d.createSale({ lines: [{ productId: "p2", unit: "pack", qty: 1 }], tendered: 1000 });
  net.down = false;
  const r = await d.sync({ manual: true });
  assert.equal(r.held, 1, "kept for review, not in the books");
  assert.equal(invoices().length, 0);
  await off.blockDevice(sql, sa, id, false, null);
  assert.equal(String(one(`SELECT status FROM offline_devices WHERE id = ?`, id).status), "active");
  // Remove: only a device that is off or blocked; then it can't connect and frees its place.
  await assert.rejects(() => off.deleteDevice(sql, sa, id), /Turn the device off or block it/);
  await off.revokeDevice(sql, LOGINS.owner1.caller, id, "replaced");
  await off.deleteDevice(sql, sa, id);
  assert.deepEqual((await off.listDevices(sql, sa, "t1")).devices.map((x) => x.name), ["Counter 2"]);
  const pulled = await d.sync({ manual: true });
  assert.match(String(pulled.error), /removed by MAVIN\.pk/);
  assert.ok((await off.provisionDevice(sql, LOGINS.owner1.caller, { name: "Counter 3" })).deviceId, "the freed place can be used");
});
