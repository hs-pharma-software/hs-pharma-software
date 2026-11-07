/** Invoice PDF / WhatsApp: per-business switches (off by default), staff
 * permissions, ownership and branch checks, the PDF itself, the message and
 * the phone check. Nothing is sent anywhere. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { PDFDocument } from "pdf-lib";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { authorizeInvoice, buildInvoicePdf, pdfFileName, shareMessage } from "@/server/invoicePdf";
import { callerCan, type Caller } from "@/server/sqlPolicy";
import { tenantAllows, toggleTenantAction } from "@/lib/tenantFeatures";
import { normalizePhone } from "@/lib/invoiceShare";
import { clearBranchCache } from "@/server/branches";
import type { Sql } from "@/server/subSupers";

const T = "2026-11-07T10:00:00.000Z";
let db: DatabaseSync;
let sql: Sql;
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const allowA = (list: string[]) => run(`UPDATE tenants SET denied_actions = ? WHERE id = 'ta'`, JSON.stringify(list));
const owner = (t = "ta"): Caller => ({ userId: `own-${t}`, role: "owner", tenantId: t, tenantDeniedActions: JSON.parse(String((db.prepare(`SELECT denied_actions FROM tenants WHERE id = ?`).get(t) as { denied_actions: string | null }).denied_actions ?? "[]")) });
const NO_ORIGIN = "http://127.0.0.1:9"; // footer images unreachable in tests: text is used instead

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  clearBranchCache();
  for (const t of ["ta", "tb"]) {
    run(`INSERT INTO tenants (id, name, subscription_status, business_type, address, phone, created_at, updated_at) VALUES (?, ?, 'active', 'retail_pharmacy', 'Main Bazar, Sargodha', '0300-0000000', ?, ?)`, t, t === "ta" ? "Alpha Pharmacy" : "Beta Pharmacy", T, T);
  }
  run(`INSERT INTO products (id, name, tenant_id, created_at, updated_at) VALUES ('p1', 'PANADOL 500MG TABLET', 'ta', ?, ?)`, T, T);
  run(`INSERT INTO invoices (id, invoice_no, date, total, discount_rs, charges, payable, paid, balance, is_return, is_memorized, is_quotation, inv_on, customer_name, customer_phone, tenant_id, created_at, updated_at)
       VALUES ('ia', 101, '2026-11-07', 1000, 50, 0, 950, 500, 450, 0, 0, 0, 'credit', 'Ali Khan', '0300-1234567', 'ta', ?, ?)`, T, T);
  run(`INSERT INTO invoice_items (id, invoice_id, product_id, qty, bonus_qty, purchase_price, sale_price, tax_pct, tax_rs, discount_pct, discount_rs, total, tenant_id, created_at, updated_at)
       VALUES ('ii1', 'ia', 'p1', 10, 0, 60, 100, 0, 0, 0, 0, 1000, 'ta', ?, ?)`, T, T);
  run(`INSERT INTO invoices (id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, tenant_id, created_at, updated_at) VALUES ('ib', 7, '2026-11-07', 10, 10, 10, 0, 0, 0, 0, 'tb', ?, ?)`, T, T);
});

test("switches: off for every business until the Super Admin ticks them; each one on its own", () => {
  assert.equal(tenantAllows([], "invoice.pdf"), false);
  assert.equal(tenantAllows([], "invoice.whatsapp"), false);
  assert.equal(tenantAllows([], "invoice.edit"), true, "other actions unchanged: on unless denied");
  const pdfOn = toggleTenantAction([], "invoice.pdf");
  assert.deepEqual(pdfOn, ["+invoice.pdf"]);
  assert.equal(tenantAllows(pdfOn, "invoice.pdf"), true);
  assert.equal(tenantAllows(pdfOn, "invoice.whatsapp"), false);
  assert.deepEqual(toggleTenantAction(pdfOn, "invoice.pdf"), []);
});

test("server: business A allowed, business B not; staff follow the owner's settings and need Invoices", async () => {
  await assert.rejects(authorizeInvoice(sql, owner(), "ia", "pdf", null), /not enabled/);
  allowA(["+invoice.pdf"]);
  const inv = await authorizeInvoice(sql, owner(), "ia", "pdf", null);
  assert.equal(inv.no, 101);
  await assert.rejects(authorizeInvoice(sql, owner(), "ia", "whatsapp", null), /WhatsApp is not enabled/, "independent switches");
  await assert.rejects(authorizeInvoice(sql, owner("tb"), "ib", "pdf", null), /not enabled/, "business B has it off");
  // Another business's invoice is not found, even with the feature on.
  await assert.rejects(authorizeInvoice(sql, owner(), "ib", "pdf", null), /not found/);
  const staff = (perms: string[] | null, denied: string[] = []): Caller => ({ userId: "s1", role: "staff", tenantId: "ta", permissions: perms, actions: denied, tenantDeniedActions: ["+invoice.pdf"] });
  assert.ok(await authorizeInvoice(sql, staff(["invoices"]), "ia", "pdf", null));
  await assert.rejects(authorizeInvoice(sql, staff(["invoices"], ["invoice.pdf"]), "ia", "pdf", null), /not enabled/, "owner took it away");
  await assert.rejects(authorizeInvoice(sql, staff(["products"]), "ia", "pdf", null), /Invoices section/);
  assert.equal(callerCan({ userId: "a", role: "super_admin", tenantId: null }, "invoice.pdf"), true);
  await assert.rejects(authorizeInvoice(sql, { userId: "a", role: "super_admin", tenantId: null }, "ia", "pdf", null), /business's login/);
});

test("branch: an invoice of a branch the login cannot open is not found", async () => {
  allowA(["+invoice.pdf"]);
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, status, created_at, updated_at) VALUES ('main-ta', 'ta', 'MAIN', 'Main', 1, 'active', ?, ?), ('b2', 'ta', 'B2', 'Second', 0, 'active', ?, ?)`, T, T, T, T);
  run(`UPDATE invoices SET branch_id = 'b2' WHERE id = 'ia'`);
  const staff: Caller = { userId: "s1", role: "staff", tenantId: "ta", permissions: null, actions: [], tenantDeniedActions: ["+invoice.pdf"] };
  await assert.rejects(authorizeInvoice(sql, staff, "ia", "pdf", null), /not found/, "staff without branch B2");
  assert.ok(await authorizeInvoice(sql, owner(), "ia", "pdf", null), "the owner opens every branch");
});

test("PDF: a real PDF of the saved invoice; long invoices run over several pages", async () => {
  allowA(["+invoice.pdf"]);
  const inv = await authorizeInvoice(sql, owner(), "ia", "pdf", null);
  const bytes = await buildInvoicePdf(sql, inv, NO_ORIGIN);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  // 120 lines with long names: several pages (headings repeat on each).
  for (let i = 0; i < 120; i++) {
    run(`INSERT INTO invoice_items (id, invoice_id, product_id, qty, bonus_qty, purchase_price, sale_price, tax_pct, tax_rs, discount_pct, discount_rs, total, line_batch, tenant_id, created_at, updated_at)
         VALUES (?, 'ia', 'p1', 1, 0, 1, 2, 0, 0, 0, 0, 2, 'B-0042', 'ta', ?, ?)`, `x${i}`, T, T);
  }
  run(`UPDATE invoices SET fbr_invoice_no = '1234567DI1730000000001' WHERE id = 'ia'`);
  const long = await buildInvoicePdf(sql, inv, NO_ORIGIN);
  assert.ok((await PDFDocument.load(long)).getPageCount() >= 3);
  assert.equal(pdfFileName(inv), "Invoice-101.pdf");
});

test("WhatsApp: short message without products; phone check for Pakistan and other countries", async () => {
  allowA(["+invoice.whatsapp"]);
  const inv = await authorizeInvoice(sql, owner(), "ia", "whatsapp", null);
  const msg = shareMessage(inv);
  assert.equal(msg, "Dear customer, your invoice #101 from Alpha Pharmacy is ready. Total: PKR 950.00. Thank you.");
  assert.ok(!/PANADOL/i.test(msg));
  assert.equal(inv.customerPhone, "0300-1234567");
  const ok = (s: string) => { const r = normalizePhone(s); return r.ok ? r.intl : r.error; };
  assert.equal(ok("0300-1234567"), "923001234567");
  assert.equal(ok("+92 300 1234567"), "923001234567");
  assert.equal(ok("3001234567"), "923001234567");
  assert.equal(ok("0092 300 1234567"), "923001234567");
  assert.equal(ok("+44 7700 900123"), "447700900123");
  assert.match(ok(""), /Enter/);
  assert.match(ok("12345"), /does not look/);
  assert.match(ok("+92 42 1234567"), /03xx/, "a Pakistani landline is not a WhatsApp mobile");
});
