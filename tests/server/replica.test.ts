/** The desktop app's local copy (Phase 1): every business table logs its
 * changes (migration v88), and the copy is read as the signed-in login
 * through the same rules as /api/db. Two made-up businesses; no network. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { Caller } from "@/server/sqlPolicy";
import type { Schema, Scope } from "@/server/tenantScope";
import type { Sql } from "@/server/subSupers";
import { replicaChanges, replicaPage, replicaTables, type ReplicaInfo } from "@/server/replica";
import { REPLICA_EXCLUDED, replicaTableKind } from "@/server/replicaTables";

const T = "2026-11-13T00:00:00.000Z";
let db: DatabaseSync;
let sql: Sql;
let info: ReplicaInfo;

const owner = (t = "t1"): Caller => ({ userId: `owner-${t}`, role: "owner", tenantId: t, permissions: null, actions: [], tenantDeniedActions: [], businessType: "retail_pharmacy" });
const cashier: Caller = { userId: "staff-1", role: "staff", tenantId: "t1", permissions: ["dashboard", "invoices", "customers"], actions: [], tenantDeniedActions: [], businessType: "retail_pharmacy" };
const BR_A: Scope["branch"] = { active: "br-a", accessible: ["br-a"], mainId: "br-a", writable: true };

const ins = (t: string, r: Record<string, unknown>) => {
  const k = Object.keys(r);
  db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
};

beforeEach(() => {
  db = fullSchemaDb();
  db.exec("PRAGMA foreign_keys = OFF");
  sql = sqliteSql(db);
  for (const t of ["t1", "t2"]) {
    ins("tenants", { id: t, name: `Shop ${t}`, business_type: "retail_pharmacy", created_at: T, updated_at: T });
    ins("users", { id: `owner-${t}`, tenant_id: t, username: `owner_${t}`, password_hash: "h", password_salt: "s", role: "owner", is_active: 1, created_at: T, updated_at: T });
    ins("products", { id: `p-${t}`, tenant_id: t, name: `Med ${t}`, created_at: T, updated_at: T });
    ins("product_batches", { id: `b-${t}`, product_id: `p-${t}`, tenant_id: t, branch_id: t === "t1" ? "br-a" : null, batch_no: "B1", qty: 10, purchase_price: 80, created_at: T, updated_at: T });
    ins("purchases", { id: `pur-${t}`, tenant_id: t, branch_id: t === "t1" ? "br-a" : null, purchase_no: 1, date: "2026-11-12", payable: 800, created_at: T, updated_at: T });
    ins("settings", { key: `${t}::pharmacy_name`, value: `Name ${t}`, updated_at: T });
    ins("settings", { key: `${t}::fbr_production_token`, value: "secret-token", updated_at: T });
  }
  ins("users", { id: "staff-1", tenant_id: "t1", username: "cashier", password_hash: "h", password_salt: "s", role: "staff", is_active: 1, created_at: T, updated_at: T });
  ins("product_batches", { id: "b-t1-other", product_id: "p-t1", tenant_id: "t1", branch_id: "br-b", batch_no: "B2", qty: 5, purchase_price: 70, created_at: T, updated_at: T });
  const schema: Schema = new Map();
  for (const r of db.prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`).all() as { t: string; c: string }[]) {
    if (!schema.has(r.t)) schema.set(r.t, new Set());
    schema.get(r.t)!.add(r.c);
  }
  info = { names: new Set(schema.keys()), schema };
});

async function copyAll(caller: Caller, table: string, branch = BR_A) {
  const out: Record<string, unknown>[] = [];
  let after: string | null = "";
  while (after !== null) {
    const p = await replicaPage(sql, caller, info, branch, table, after);
    out.push(...p.rows);
    after = p.next;
  }
  return out;
}

test("every business table records its changes (insert, update, delete triggers)", () => {
  const missing: string[] = [];
  const trig = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_dc_%'`).all() as { name: string }[]).map((r) => r.name));
  for (const [t, cols] of info.schema) {
    if (REPLICA_EXCLUDED.has(t) || !replicaTableKind(t, [...cols])) continue;
    const pk = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; pk: number }[]).filter((c) => c.pk);
    if (pk.length !== 1) continue;
    for (const ev of ["ins", "upd", "del"]) if (!trig.has(`trg_dc_${t}_${ev}`)) missing.push(`${t}_${ev}`);
  }
  assert.deepEqual(missing, [], "a new business table needs its change triggers (scripts/gen-data-changes.ts)");
});

test("the tables a login may copy: business data yes, credentials and server records never", async () => {
  const { tables } = await replicaTables(sql, owner(), info, BR_A);
  for (const t of ["invoices", "invoice_items", "products", "product_batches", "customers", "settings", "tenants", "rest_orders", "clinic_patients"]) assert.ok(tables.includes(t), t);
  for (const t of ["fbr_credentials", "payment_merchants", "offline_ops", "data_changes", "subscription_plans"]) assert.ok(!tables.includes(t), t);
  // A cashier without the Purchase, Suppliers or Reports section: no purchases (as online).
  const staffTables = (await replicaTables(sql, cashier, info, BR_A)).tables;
  assert.ok(!staffTables.includes("purchases") && staffTables.includes("invoices"));
  await assert.rejects(replicaTables(sql, { ...owner(), role: "super_admin", tenantId: null } as Caller, info), /business login/);
});

test("the first copy holds only this business and branch, without passwords, secrets or hidden purchase prices", async () => {
  assert.deepEqual((await copyAll(owner(), "products")).map((r) => r.id), ["p-t1"]);
  assert.deepEqual((await copyAll(owner(), "product_batches")).map((r) => r.id), ["b-t1"], "branch A only");
  assert.ok((await copyAll(owner(), "users")).every((u) => !("password_hash" in u) && !("password_salt" in u)));
  assert.deepEqual((await copyAll(owner(), "settings")).map((r) => r.key), ["t1::pharmacy_name"], "credential settings never leave");
  assert.equal((await copyAll(owner(), "product_batches"))[0].purchase_price, 80, "the owner sees purchase prices");
  assert.ok(!("purchase_price" in (await copyAll(cashier, "product_batches"))[0]), "hidden from this cashier, as online");
  await assert.rejects(replicaPage(sql, owner(), info, BR_A, "fbr_credentials", ""), /Unknown table/);
});

test("pages resume where they stopped", async () => {
  for (let i = 0; i < 2500; i++) ins("customers", { id: `c-${String(i).padStart(5, "0")}`, tenant_id: "t1", name: `C${i}`, created_at: T, updated_at: T });
  const all = await copyAll(owner(), "customers");
  assert.equal(all.length, 2500);
  assert.equal(new Set(all.map((r) => r.id)).size, 2500);
});

test("changes since a point: this business's rows now, removed ones as deletions, other businesses never", async () => {
  const { seq } = await replicaTables(sql, owner(), info, BR_A);
  const tables = new Set((await replicaTables(sql, owner(), info, BR_A)).tables);
  db.prepare(`UPDATE products SET name = 'Renamed' WHERE id = 'p-t1'`).run();
  db.prepare(`UPDATE products SET name = 'Theirs' WHERE id = 'p-t2'`).run();
  ins("customers", { id: "c-new", tenant_id: "t1", name: "New", created_at: T, updated_at: T });
  db.prepare(`DELETE FROM settings WHERE key = 't1::pharmacy_name'`).run();
  db.prepare(`UPDATE product_batches SET qty = 1 WHERE id = 'b-t1-other'`).run();
  const r = await replicaChanges(sql, owner(), info, BR_A, seq, tables);
  assert.equal(r.upserts.products?.[0].name, "Renamed");
  assert.equal(r.upserts.products?.length, 1, "not the other business's");
  assert.deepEqual(r.upserts.customers?.map((c) => c.id), ["c-new"]);
  assert.deepEqual(r.deletes.settings, ["t1::pharmacy_name"]);
  assert.deepEqual(r.deletes.product_batches, ["b-t1-other"], "another branch: not in this copy");
  assert.ok(r.seq > seq);
  assert.equal(r.more, false);
  const again = await replicaChanges(sql, owner(), info, BR_A, r.seq, tables);
  assert.deepEqual([again.upserts, again.deletes], [{}, {}], "nothing new");
});
