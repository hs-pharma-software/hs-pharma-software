/** Dashboard "today" tiles: counted on the business's local date (invoices
 * are saved with it; the database's date('now') is UTC), with invoices whose
 * flags are empty, and Cash In / Cash Out include the money moved by sales,
 * returns, purchases, party payments and expenses, not only cash-register entries. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { getTodaySummary } from "@/lib/repo/dashboard";

const T = "pharm-a";
const DAY = "2026-10-31";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});

let n = 0;
const ins = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...(args as never[]));
const invoice = (date: string, total: number, paid: number, flags: { ret?: number; memo?: number | null; quote?: number | null } = {}) =>
  ins(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'x', 'x')`,
    `i${++n}`, T, n, date, total, total, paid, total - paid, flags.ret ?? 0, flags.memo === undefined ? 0 : flags.memo, flags.quote === undefined ? 0 : flags.quote);

test("today's sales and invoices: local date, empty flags count, quotations / memorized / other days do not", async () => {
  invoice(DAY, 1000, 1000);
  invoice(DAY, 500, 200, { memo: null, quote: null });
  invoice(DAY, 300, 300, { ret: 1 });
  invoice(DAY, 9999, 0, { quote: 1 });
  invoice(DAY, 9999, 0, { memo: 1 });
  invoice("2026-10-30", 7777, 7777);
  invoice(`${DAY} 10:15`, 100, 100);
  ins(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, paid, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('other', 'pharm-b', 1, ?, 5000, 5000, 0, 0, 0, 'x', 'x')`, DAY);
  const s = await getTodaySummary(DAY);
  assert.deepEqual([s.sales, s.invoiceCount], [1000 + 500 - 300 + 100, 3]);
});

test("cash in / out: sale payments, refunds, purchases, party payments, expenses and the cash register", async () => {
  invoice(DAY, 1000, 800);
  invoice(DAY, 200, 200, { ret: 1 });
  ins(`INSERT INTO purchases (id, tenant_id, date, payable, paid_amount, balance, is_return, created_at, updated_at) VALUES ('p1', ?, ?, 3000, 2500, 500, 0, 'x', 'x'), ('p2', ?, ?, 400, 400, 0, 1, 'x', 'x')`, T, DAY, T, DAY);
  ins(`INSERT INTO ledger_adjustments (id, tenant_id, party_type, party_id, date, paid_amount, created_at, updated_at) VALUES ('l1', ?, 'customer', 'c1', ?, 150, 'x', 'x'), ('l2', ?, 'supplier', 's1', ?, 600, 'x', 'x')`, T, DAY, T, DAY);
  ins(`INSERT INTO expenses (id, tenant_id, date, amount, created_at, updated_at) VALUES ('e1', ?, ?, 70, 'x', 'x')`, T, DAY);
  ins(`INSERT INTO cash_register_entries (id, tenant_id, date, transaction_type, amount, created_at, updated_at) VALUES ('r1', ?, ?, 'in', 50, 'x', 'x'), ('r2', ?, ?, 'out', 30, 'x', 'x')`, T, DAY, T, DAY);
  const s = await getTodaySummary(DAY);
  assert.equal(s.cashIn, 800 + 400 + 150 + 50);
  assert.equal(s.cashOut, 200 + 2500 + 600 + 70 + 30);
  assert.equal(s.expenses, 70);
  assert.deepEqual(await getTodaySummary("2026-11-01"), { sales: 0, invoiceCount: 0, expenses: 0, cashIn: 0, cashOut: 0 });
});
