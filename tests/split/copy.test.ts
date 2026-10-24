/** The one-time copy of a tenant's existing data from the platform database
 * into its own Hospital / Clinic database, between two real SQLite databases
 * with the complete schema (v1..v38). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { copyTenantData, markerKey, type SqlRunner } from "@/lib/dbSplit";

const H1 = "hosp-1";
const H2 = "hosp-2";
const C1 = "clin-1";
const PH = "pharm-1";
const NOW = "2026-10-24T10:00:00.000Z";

let platform: DatabaseSync;
let hospital: DatabaseSync;
let clinic: DatabaseSync;

const runner = (db: DatabaseSync): SqlRunner => ({
  select: async (sql, params = []) => db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[],
  execute: async (sql, params = []) => db.prepare(sql).run(...(params as never[])),
});

function insert(db: DatabaseSync, table: string, values: Record<string, unknown>) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown }[];
  const r: Record<string, unknown> = { created_at: NOW, updated_at: NOW, ...values };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in r)) r[c.name] = c.name.endsWith("_at") || c.name === "date" ? NOW : "x";
  const keys = Object.keys(r).filter((k) => cols.some((c) => c.name === k));
  db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k]) as never[]));
}

const count = (db: DatabaseSync, table: string, where = "1=1", ...p: unknown[]) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...(p as never[])) as { n: number }).n;

beforeEach(() => {
  platform = fullSchemaDb(38);
  hospital = fullSchemaDb(38);
  clinic = fullSchemaDb(38);

  // Platform: sign-in data for every tenant, plus the existing hospital / clinic / pharmacy data.
  for (const [id, type] of [[H1, "hospital"], [H2, "hospital"], [C1, "clinic"], [PH, "hospital_pharmacy"]]) insert(platform, "tenants", { id, name: id, business_type: type });
  insert(platform, "users", { id: "u1", tenant_id: H1, username: "h1", password_hash: "x", role: "owner", display_name: "H1" });

  for (const t of [H1, H2]) {
    insert(platform, "hospital_patients", { id: `p-${t}`, tenant_id: t, mr_no: `MR-${t}`, name: `Patient ${t}` });
    insert(platform, "hospital_services", { id: `s-${t}`, tenant_id: t, code: `C-${t}`, name: "Consult" });
    insert(platform, "hospital_episodes", { id: `e-${t}`, tenant_id: t, episode_no: `OPD-${t}`, patient_id: `p-${t}`, date: "2026-10-24" });
    insert(platform, "staff", { id: `st-${t}`, tenant_id: t, name: `Staff ${t}` });
    insert(platform, "banks", { id: `b-${t}`, tenant_id: t, name: `Bank ${t}` });
    insert(platform, "suppliers", { id: `su-${t}`, tenant_id: t, name: `Supplier ${t}` });
    insert(platform, "products", { id: `pr-${t}`, tenant_id: t, name: `Item ${t}` });
    insert(platform, "settings", { key: `${t}::tax_rate`, value: "5" });
  }
  insert(platform, "settings", { key: "global_flag", value: "on" });

  insert(platform, "clinic_patients", { id: "cp1", tenant_id: C1, name: "Clinic Patient" });
  insert(platform, "clinic_doctors", { id: "cd1", tenant_id: C1, name: "Doc" });
  insert(platform, "clinic_prescriptions", { id: "rx1", tenant_id: C1, patient_id: "cp1", date: "2026-10-24" });
  insert(platform, "clinic_rx_items", { id: "ri1", prescription_id: "rx1", product_name: "Panadol" });
  insert(platform, "clinic_pharmacy_link", { id: "l1", clinic_tenant_id: C1, pharmacy_tenant_id: PH });
  insert(platform, "pharmacy_rx_notifications", { id: "n1", pharmacy_tenant_id: PH, prescription_id: "rx1", clinic_tenant_id: C1 });
  insert(platform, "products", { id: "pr-ph", tenant_id: PH, name: "Pharmacy Item" });
});

test("hospital tenant: its rows (incl. Purchase Cell data, staff, banks) are copied; other tenants' rows are not", async () => {
  const r = await copyTenantData(runner(platform), runner(hospital), H1);
  assert.equal(r.skipped, false);
  assert.ok(r.rows >= 8);
  for (const [table, id] of [["hospital_patients", `p-${H1}`], ["hospital_services", `s-${H1}`], ["hospital_episodes", `e-${H1}`], ["staff", `st-${H1}`], ["banks", `b-${H1}`], ["suppliers", `su-${H1}`], ["products", `pr-${H1}`]]) {
    assert.equal(count(hospital, table, "id = ?", id), 1, `${table} copied`);
  }
  // No other hospital's, clinic's or pharmacy's data.
  for (const table of ["hospital_patients", "hospital_services", "hospital_episodes", "staff", "banks", "suppliers", "products"]) {
    assert.equal(count(hospital, table, "tenant_id != ?", H1), 0, `${table} holds only ${H1}`);
  }
  assert.equal(count(hospital, "clinic_patients"), 0);
  assert.equal(count(hospital, "pharmacy_rx_notifications"), 0);
  // Sign-in data stays on the platform.
  assert.equal(count(hospital, "tenants", "id IN (?, ?, ?, ?)", H1, H2, C1, PH), 0);
  assert.equal(count(hospital, "users", "id = ?", "u1"), 0);
});

test("settings: the tenant's own keys and the global ones come across, other tenants' do not", async () => {
  await copyTenantData(runner(platform), runner(hospital), H1);
  assert.equal(count(hospital, "settings", "key = ?", `${H1}::tax_rate`), 1);
  assert.equal(count(hospital, "settings", "key = 'global_flag'"), 1);
  assert.equal(count(hospital, "settings", "key = ?", `${H2}::tax_rate`), 0);
});

test("clinic tenant: patients, doctors, prescription items (no tenant column) and its pharmacy link are copied", async () => {
  await copyTenantData(runner(platform), runner(clinic), C1);
  assert.equal(count(clinic, "clinic_patients", "id = 'cp1'"), 1);
  assert.equal(count(clinic, "clinic_doctors", "id = 'cd1'"), 1);
  assert.equal(count(clinic, "clinic_prescriptions", "id = 'rx1'"), 1);
  assert.equal(count(clinic, "clinic_rx_items", "id = 'ri1'"), 1);
  assert.equal(count(clinic, "clinic_pharmacy_link", "id = 'l1'"), 1);
  assert.equal(count(clinic, "products"), 0, "the pharmacy's products are not the clinic's");
  assert.equal(count(clinic, "pharmacy_rx_notifications"), 0, "the mailbox stays on the platform");
});

test("nothing is removed or changed in the source database", async () => {
  const before = (table: string) => count(platform, table);
  const tables = ["tenants", "users", "hospital_patients", "staff", "banks", "products", "settings", "clinic_patients", "clinic_rx_items", "pharmacy_rx_notifications"];
  const snapshot = tables.map(before);
  await copyTenantData(runner(platform), runner(hospital), H1);
  await copyTenantData(runner(platform), runner(clinic), C1);
  assert.deepEqual(tables.map(before), snapshot);
  assert.equal(count(platform, "hospital_patients", "id = ?", `p-${H1}`), 1);
});

test("copied rows are identical to the originals", async () => {
  await copyTenantData(runner(platform), runner(hospital), H1);
  const a = platform.prepare(`SELECT * FROM hospital_patients WHERE id = ?`).get(`p-${H1}`);
  const b = hospital.prepare(`SELECT * FROM hospital_patients WHERE id = ?`).get(`p-${H1}`);
  assert.deepEqual(b, a);
});

test("running it again changes nothing: marker set, no duplicates; a forced rerun does not overwrite newer edits", async () => {
  await copyTenantData(runner(platform), runner(hospital), H1);
  assert.equal(count(hospital, "sync_meta", "key = ?", markerKey(H1)), 1);
  const again = await copyTenantData(runner(platform), runner(hospital), H1);
  assert.equal(again.skipped, true);

  // Edit in the new database, drop the marker, copy again: INSERT OR IGNORE keeps the edit.
  hospital.prepare(`UPDATE hospital_patients SET name = 'Edited in hospital db' WHERE id = ?`).run(`p-${H1}`);
  hospital.prepare(`DELETE FROM sync_meta WHERE key = ?`).run(markerKey(H1));
  await copyTenantData(runner(platform), runner(hospital), H1);
  assert.equal(count(hospital, "hospital_patients", "tenant_id = ?", H1), 1);
  assert.equal((hospital.prepare(`SELECT name FROM hospital_patients WHERE id = ?`).get(`p-${H1}`) as { name: string }).name, "Edited in hospital db");
});

test("a short copy is reported, not accepted", async () => {
  const target = runner(hospital);
  const failing: SqlRunner = {
    select: target.select,
    // Silently drops every hospital_patients insert.
    execute: async (sql, params) => (sql.includes('INTO "hospital_patients"') ? undefined : target.execute(sql, params)),
  };
  await assert.rejects(copyTenantData(runner(platform), failing, H1), /came out short/);
  assert.equal(count(hospital, "sync_meta", "key = ?", markerKey(H1)), 0, "no marker after a failed copy, so it is retried");
});

test("the two new databases are independent: writes to one never appear in the other", async () => {
  await copyTenantData(runner(platform), runner(hospital), H1);
  await copyTenantData(runner(platform), runner(clinic), C1);
  insert(hospital, "hospital_patients", { id: "new-h", tenant_id: H1, mr_no: "MR-NEW", name: "New Hospital Patient" });
  insert(clinic, "clinic_patients", { id: "new-c", tenant_id: C1, name: "New Clinic Patient" });
  assert.equal(count(hospital, "clinic_patients", "id = 'new-c'"), 0);
  assert.equal(count(clinic, "hospital_patients", "id = 'new-h'"), 0);
  assert.equal(count(platform, "hospital_patients", "id = 'new-h'"), 0);
  assert.equal(count(platform, "clinic_patients", "id = 'new-c'"), 0);
  // And an update in the hospital database is read back from it.
  hospital.prepare(`UPDATE hospital_patients SET phone = '0300' WHERE id = 'new-h'`).run();
  assert.equal((hospital.prepare(`SELECT phone FROM hospital_patients WHERE id = 'new-h'`).get() as { phone: string }).phone, "0300");
});
