/** Server-only records never reach browser SQL (/api/db): offline device
 * secrets, payment credentials, FBR credentials and FBR submissions. Only
 * their own APIs (src/server/offline, payments, fbr) use them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";

const db = fullSchemaDb();
const known = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));
const owner: Caller = { userId: "u1", role: "owner", tenantId: "t1", permissions: null } as Caller;
const cashier: Caller = { userId: "s1", role: "staff", tenantId: "t1", permissions: ["invoices"] } as Caller;

test("offline device, payment and FBR tables are refused to browser logins, reads and writes", () => {
  const tables = ["offline_devices", "payment_merchants", "fbr_credentials", "fbr_submissions"];
  for (const t of tables) assert.ok(known.has(t), `${t} exists in the schema`);
  for (const caller of [owner, cashier]) {
    for (const t of tables) {
      for (const sql of [`SELECT * FROM ${t}`, `UPDATE ${t} SET status = 'active'`, `DELETE FROM ${t}`, `SELECT i.id FROM invoices i JOIN ${t} x ON x.tenant_id = i.tenant_id`]) {
        const d = authorize(analyzeSql(sql), caller, known);
        assert.equal(d.ok, false, `${caller.role}: ${sql}`);
      }
    }
  }
});

test("ordinary business tables still work for browser logins", () => {
  for (const sql of [`SELECT * FROM invoices`, `SELECT fbr_invoice_no FROM invoices`, `SELECT * FROM products`]) {
    assert.equal(authorize(analyzeSql(sql), owner, known).ok, true, sql);
  }
});
