/** Diagnostic lab website: "Get your report" needs the receipt/visit/order
 * number AND the patient's registered mobile; another lab's numbers never
 * match; attempts are limited; the report page opens on the lab's own address. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { findLabReport, phoneKey } from "@/server/web/labLookup";
import { resetWebRateLimits } from "@/server/web/core";
import { webRoute } from "@/lib/webRoute";
import { draftFor } from "@/lib/web/templates";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const T = new Date().toISOString();
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  resetWebRateLimits();
  for (const t of ["lab1", "lab2"]) run(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, 'lab', ?, ?)`, t, `Lab ${t}`, T, T);
  run(`INSERT INTO clinic_patients (id, tenant_id, name, phone, created_at, updated_at) VALUES ('pa', 'lab1', 'Patient A', '0300-1234567', ?, ?)`, T, T);
  run(`INSERT INTO clinic_patients (id, tenant_id, name, phone, created_at, updated_at) VALUES ('pb', 'lab2', 'Patient B', '03001234567', ?, ?)`, T, T);
  run(`INSERT INTO clinic_patients (id, tenant_id, name, phone, created_at, updated_at) VALUES ('pc', 'lab1', 'No Phone', NULL, ?, ?)`, T, T);
  run(`INSERT INTO lab_visits (id, tenant_id, visit_no, patient_id, created_at, updated_at) VALUES ('va', 'lab1', 'LV-101', 'pa', ?, ?)`, T, T);
  run(`INSERT INTO lab_visits (id, tenant_id, visit_no, patient_id, public_token, created_at, updated_at) VALUES ('vb', 'lab2', 'LV-101', 'pb', 'b'||hex(randomblob(24)), ?, ?)`, T, T);
  run(`INSERT INTO lab_visits (id, tenant_id, visit_no, patient_id, created_at, updated_at) VALUES ('vc', 'lab1', 'LV-102', 'pc', ?, ?)`, T, T);
  run(`INSERT INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES ('inv', 'lab1', 555, '2026-11-06', ?, ?)`, T, T);
  run(`INSERT INTO clinic_orders (id, tenant_id, order_no, patient_id, kind, name, ordered_at, created_at, updated_at, invoice_id, lab_visit_id) VALUES ('o1', 'lab1', 9001, 'pa', 'lab', 'CBC', ?, ?, ?, 'inv', 'va')`, T, T, T);
});

test("receipt, visit or order number plus the registered mobile opens the report", async () => {
  assert.equal(phoneKey("+92 300 1234567"), "3001234567");
  const byReceipt = await findLabReport(sql, "lab1", "#555", "+92 300 1234567", "1.1.1.1");
  assert.match(byReceipt.url, /^\/lab-report\?t=[0-9a-f]{48}$/);
  const byVisit = await findLabReport(sql, "lab1", "LV-101", "03001234567", "1.1.1.1");
  const byOrder = await findLabReport(sql, "lab1", "9001", "923001234567", "1.1.1.1");
  assert.equal(byVisit.url, byReceipt.url, "one link per visit");
  assert.equal(byOrder.url, byReceipt.url);
});

test("a number alone is not enough; other labs and patients without a mobile never match", async () => {
  await assert.rejects(findLabReport(sql, "lab1", "555", "03009999999", null), /No report matches/);
  await assert.rejects(findLabReport(sql, "lab2", "555", "03001234567", null), /No report matches/, "another lab's receipt");
  const other = await findLabReport(sql, "lab2", "LV-101", "03001234567", null);
  assert.notEqual(other.url, (await findLabReport(sql, "lab1", "LV-101", "03001234567", null)).url, "same visit number, different lab, different report");
  await assert.rejects(findLabReport(sql, "lab1", "LV-102", "03001234567", null), /No report matches/, "no mobile on file");
  await assert.rejects(findLabReport(sql, "lab1", "", "03001234567", null), /receipt or order number/);
  await assert.rejects(findLabReport(sql, "lab1", "555", "123", null), /mobile number/);
  await assert.rejects(findLabReport(sql, "lab1", "555'; DROP TABLE x", "03001234567", null), /receipt or order number/);
});

test("attempts are limited per connection", async () => {
  for (let i = 0; i < 10; i++) await findLabReport(sql, "lab1", `${i}`, "03001234567", "9.9.9.9").catch(() => undefined);
  await assert.rejects(findLabReport(sql, "lab1", "555", "03001234567", "9.9.9.9"), /Too many tries/);
});

test("the lab template has a Reports page, and the report page opens on the lab's own address", () => {
  const d = draftFor("lab", { name: "City Lab", phone: null, email: null, address: null }, false);
  const rep = d.pages.find((p) => p.slug === "reports");
  assert.ok(rep);
  assert.equal(rep!.sections[0].type, "reportLookup");
  assert.equal(d.pages[0].sections[0].buttons?.[0].href, "/reports");
  assert.deepEqual(webRoute("citylab.mavin.pk", "/lab-report"), { kind: "pass", host: "citylab.mavin.pk" });
  assert.equal(webRoute("citylab.mavin.pk", "/reports").kind, "rewrite");
});
