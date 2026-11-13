/** The desktop app's local copy of a business (Phase 1), end to end: the
 * real desktop code (desktop/src/core/replicaSync.ts, mirror.ts) against the
 * real server code (src/server/replica.ts) on two separate SQLite databases.
 * Made-up businesses; no network. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import type { Caller } from "@/server/sqlPolicy";
import type { Schema, Scope } from "@/server/tenantScope";
import { replicaChanges, replicaPage, replicaTables, type ReplicaInfo } from "@/server/replica";
import { Mirror } from "../../desktop/src/core/mirror.ts";
import { answerableLocally, copiedTables, copyReady, fillCopy, followCopy, type ReplicaCall } from "../../desktop/src/core/replicaSync.ts";

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

const T = "2026-11-13T00:00:00.000Z";
const BR: Scope["branch"] = { active: "br-a", accessible: ["br-a"], mainId: "br-a", writable: true };
const owner: Caller = { userId: "owner-t1", role: "owner", tenantId: "t1", permissions: null, actions: [], tenantDeniedActions: [], businessType: "restaurant" };
let db: DatabaseSync;
let info: ReplicaInfo;
let root: string;
const copies: Mirror[] = [];
const net = { failAfter: -1, calls: 0 };

const ins = (t: string, r: Record<string, unknown>) => {
  const k = Object.keys(r);
  db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
};

/** The desktop's call to /api/replica, answered by the server code as this login. */
const call: ReplicaCall = async <R,>(body: Record<string, unknown>): Promise<R> => {
  if (net.failAfter >= 0 && net.calls++ >= net.failAfter) throw new Error("fetch failed");
  const sql = sqliteSql(db);
  if (body.action === "tables") return (await replicaTables(sql, owner, info, BR)) as R;
  if (body.action === "page") return (await replicaPage(sql, owner, info, BR, body.table, body.after)) as R;
  const { tables } = await replicaTables(sql, owner, info, BR);
  return (await replicaChanges(sql, owner, info, BR, body.since, new Set(tables))) as R;
};

const newCopy = () => { const m = new Mirror(join(root, "copy.db"), SCHEMA_SQL); copies.push(m); return m; };

beforeEach(() => {
  db = fullSchemaDb();
  db.exec("PRAGMA foreign_keys = OFF");
  root = mkdtempSync(join(tmpdir(), "mavin-copy-"));
  Object.assign(net, { failAfter: -1, calls: 0 });
  for (const t of ["t1", "t2"]) {
    ins("tenants", { id: t, name: `Cafe ${t}`, business_type: "restaurant", created_at: T, updated_at: T });
    ins("users", { id: `owner-${t}`, tenant_id: t, username: `o_${t}`, password_hash: "h", password_salt: "s", role: "owner", is_active: 1, created_at: T, updated_at: T });
    ins("rest_menu_items", { id: `m-${t}`, tenant_id: t, code: `K-${t}`, name: `Karahi ${t}`, price: 1200, created_at: T, updated_at: T });
  }
  for (let i = 0; i < 2300; i++) ins("customers", { id: `c-${String(i).padStart(5, "0")}`, tenant_id: "t1", name: `Guest ${i}`, created_at: T, updated_at: T });
  ins("rest_tables", { id: "tbl-1", tenant_id: "t1", branch_id: "br-a", name: "Table 1", created_at: T, updated_at: T });
  const schema: Schema = new Map();
  for (const r of db.prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`).all() as { t: string; c: string }[]) {
    if (!schema.has(r.t)) schema.set(r.t, new Set());
    schema.get(r.t)!.add(r.c);
  }
  info = { names: new Set(schema.keys()), schema };
});
afterEach(() => {
  for (const m of copies.splice(0)) m.close();
  rmSync(root, { recursive: true, force: true });
});

test("a restaurant's whole business is copied once, then only what changes; screens read it", async () => {
  const m = newCopy();
  assert.equal(copyReady(m), false);
  await fillCopy(m, call);
  assert.equal(copyReady(m), true);
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM customers`, [])[0].n, 2300);
  assert.deepEqual(m.query(`SELECT name FROM rest_menu_items`, []).map((r) => r.name), ["Karahi t1"], "never another business's");
  assert.ok(!("password_hash" in m.query(`SELECT * FROM users`, [])[0]) || m.query(`SELECT password_hash FROM users`, [])[0].password_hash === "");
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM data_changes`, [])[0].n, 0, "no change log kept on the computer");

  // Changes on MAVIN.pk (another counter, the web, a phone): only those come down.
  db.prepare(`UPDATE rest_menu_items SET price = 1350 WHERE id = 'm-t1'`).run();
  db.prepare(`UPDATE rest_menu_items SET price = 1 WHERE id = 'm-t2'`).run();
  ins("customers", { id: "c-new", tenant_id: "t1", name: "New guest", created_at: T, updated_at: T });
  db.prepare(`DELETE FROM rest_tables WHERE id = 'tbl-1'`).run();
  const n = await followCopy(m, call);
  assert.equal(n, 3);
  assert.equal(m.query(`SELECT price FROM rest_menu_items WHERE id = 'm-t1'`, [])[0].price, 1350);
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM customers`, [])[0].n, 2301);
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM rest_tables`, [])[0].n, 0);
  assert.equal(await followCopy(m, call), 0, "nothing new: nothing downloaded");
});

test("a first copy cut off half way continues where it stopped, without duplicates", async () => {
  const m = newCopy();
  net.failAfter = 3;
  await assert.rejects(fillCopy(m, call), /fetch failed/);
  assert.equal(copyReady(m), false, "an incomplete copy is never read");
  // Something changes while the copy is unfinished: it still arrives.
  ins("customers", { id: "c-late", tenant_id: "t1", name: "Late", created_at: T, updated_at: T });
  Object.assign(net, { failAfter: -1, calls: 0 });
  m.close();
  const again = newCopy();
  await fillCopy(again, call);
  await followCopy(again, call);
  assert.equal(copyReady(again), true);
  assert.equal(again.query(`SELECT COUNT(*) AS n FROM customers`, [])[0].n, 2301);
  assert.equal(again.query(`SELECT COUNT(DISTINCT id) AS n FROM customers`, [])[0].n, 2301);
});

test("reads the copy cannot answer go to MAVIN.pk", async () => {
  const m = newCopy();
  await fillCopy(m, call);
  const copied = copiedTables(m);
  const all = m.tableNames();
  assert.ok(answerableLocally(`SELECT * FROM rest_orders o JOIN rest_order_items i ON i.order_id = o.id`, copied, all));
  assert.ok(answerableLocally(`SELECT * FROM customers, rest_tables WHERE 1`, copied, all));
  assert.ok(!answerableLocally(`SELECT * FROM invoices i, fbr_submissions s WHERE s.doc_id = i.id`, copied, all), "a table left out of the copy");
  assert.ok(!answerableLocally(`SELECT name FROM subscription_plans`, copied, all), "a platform table");
  assert.ok(answerableLocally(`SELECT 'fbr_submissions' AS label FROM customers`, copied, all), "a word inside a string is not a table");
});

test("a computer switched off for longer than the kept change log copies everything again", async () => {
  const m = newCopy();
  await fillCopy(m, call);
  // Weeks later: many changes, and the nightly job has trimmed the log past this computer's position.
  db.prepare(`UPDATE customers SET name = 'Renamed' WHERE id = 'c-00001'`).run();
  ins("customers", { id: "c-new", tenant_id: "t1", name: "New", created_at: T, updated_at: T });
  db.prepare(`UPDATE customers SET name = name WHERE id = 'c-00002'`).run();
  db.prepare(`DELETE FROM data_changes WHERE seq < (SELECT MAX(seq) FROM data_changes)`).run();
  await followCopy(m, call);
  assert.equal(copyReady(m), true);
  assert.equal(m.query(`SELECT name FROM customers WHERE id = 'c-00001'`, [])[0].name, "Renamed", "a change no longer in the log still arrived");
  assert.equal(m.query(`SELECT COUNT(*) AS n FROM customers`, [])[0].n, 2301);
});
