/** Migration rehearsal on a copy of the live database.
 *
 * Rebuilds the production schema and data from a backup made by
 * scripts/backup-turso.cjs, applies exactly the statements
 * scripts/migrate-turso.cjs --from=34 sends (same splitting, same skip and
 * stop rules), then proves: the pharmacy data is unchanged, every clinic /
 * hospital table and column the code needs exists, and Pharmacy POS, Clinic
 * and Hospital operations work on the result. Nothing touches the live database.
 *
 *   LIVE_REPLICA_DIR=backups/turso-<stamp> npm test
 *
 * Skipped when LIVE_REPLICA_DIR is not set (backups are not in the repository). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { savePatient, saveAppointment, saveConsultation, doctorsRepo, prescriptionsRepo, saveRxItems, getRxItems, listAppointments, patientsRepo } from "@/lib/repo/clinic";
import {
  hospitalPatientsRepo, hospitalEpisodesRepo, hospitalDepartmentsRepo, hospitalLabRepo, nextMrNo, nextEpisodeNo, nextOrderNo,
  addCharge, addPayment, listEpisodes,
} from "@/lib/repo/hospital";
import { listInvoicesForGrid, invoicesRepo } from "@/lib/repo/invoices";
import { listProductsForGrid } from "@/lib/repo/products";
import { deductStock, listAvailableBatches } from "@/lib/repo/stock";
import { localDate, localDateTime } from "@/lib/localDate";

const DIR = process.env.LIVE_REPLICA_DIR;
const run = DIR && existsSync(join(DIR, "schema.sql")) ? test : test.skip;

/** Same statement list migrate-turso.cjs builds for a version. */
function statementsOf(n: number): string[] {
  const rs = readFileSync("src-tauri/src/lib.rs", "utf8");
  const m = new RegExp(`fn schema_sql_v${n}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(rs);
  if (!m) throw new Error(`schema_sql_v${n} not found`);
  return m[1].replace(/--[^\n]*/g, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function replica(): DatabaseSync {
  // Turso does not enforce foreign keys by default; mirror it (and load tables in any order).
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  const schema = readFileSync(join(DIR!, "schema.sql"), "utf8").split(/;\n\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
  for (const s of schema) if (!/^CREATE TABLE sqlite_/i.test(s)) db.exec(s);
  for (const f of readdirSync(DIR!)) {
    if (!f.endsWith(".json") || f === "summary.json") continue;
    const table = f.slice(0, -5);
    const rows = JSON.parse(readFileSync(join(DIR!, f), "utf8")) as Record<string, unknown>[];
    for (const r of rows) {
      const keys = Object.keys(r);
      db.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k]) as never[]));
    }
  }
  return db;
}

const PHARMACY = ["tenants", "users", "products", "product_batches", "price_list", "customers", "suppliers", "invoices", "invoice_items", "purchases", "purchase_items", "cash_register_entries", "bank_ledger_entries", "expenses", "revenues", "staff"];
const MONEY = ["total", "amount", "qty", "paid", "balance", "sale_price", "purchase_price"];

function fingerprint(db: DatabaseSync) {
  const out: Record<string, unknown> = {};
  for (const t of PHARMACY) {
    const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.length) continue;
    const sums = MONEY.filter((c) => cols.includes(c));
    out[t] = db.prepare(`SELECT COUNT(*) AS rows ${sums.map((c) => `, ROUND(COALESCE(SUM("${c}"),0),2) AS sum_${c}`).join("")} FROM "${t}"`).get();
  }
  // Every column of every row too: a migration must not change existing data at all.
  for (const t of ["products", "product_batches", "invoices", "invoice_items"]) out[`${t}_rows`] = db.prepare(`SELECT * FROM "${t}" ORDER BY id`).all();
  return out;
}

/** Applies versions 34+ like migrate-turso.cjs: "already exists"/"duplicate column" are skips; v36/v37 stop on error. */
function migrate(db: DatabaseSync): { applied: number; skipped: number; failed: string[] } {
  let applied = 0, skipped = 0;
  const failed: string[] = [];
  for (const v of [34, 35, 36, 37, 38, 39, 40, 41]) {
    for (const sql of statementsOf(v)) {
      try {
        db.exec(sql);
        applied++;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("duplicate column") || msg.includes("already exists")) { skipped++; continue; }
        failed.push(`v${v}: ${msg}`);
        if (v === 36 || v === 37) break;
      }
    }
  }
  return { applied, skipped, failed };
}

function login(tenantId: string, businessType: string) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType,
  };
  useAuthStore.setState({ currentUser: { id: "u", username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

run("migration on a copy of the live database: pharmacy unchanged, all modules work", async () => {
  const db = replica();
  setTestDb(db);
  const before = fingerprint(db);

  // What the busiest pharmacy's screens show before the migration.
  const busiest = db.prepare(`SELECT tenant_id, COUNT(*) AS n FROM invoices GROUP BY tenant_id ORDER BY n DESC LIMIT 1`).get() as { tenant_id: string; n: number } | undefined;
  const pharmacyType = busiest
    ? ((db.prepare(`SELECT business_type FROM tenants WHERE id = ?`).get(busiest.tenant_id) as { business_type: string } | undefined)?.business_type ?? "retail_pharmacy")
    : "retail_pharmacy";
  let invoicesBefore: unknown[] = [];
  let productsBefore: unknown[] = [];
  if (busiest) {
    login(busiest.tenant_id, pharmacyType);
    invoicesBefore = await listInvoicesForGrid();
    productsBefore = await listProductsForGrid();
  }

  const result = migrate(db);
  assert.deepEqual(result.failed, [], "no statement failed");
  // Running it a second time is harmless (the script is re-runnable).
  const again = migrate(db);
  assert.deepEqual(again.failed, [], "second run: no failures");

  assert.deepEqual(fingerprint(db), before, "pharmacy data is exactly as it was");

  for (const t of ["clinic_patients", "clinic_doctors", "clinic_appointments", "clinic_consultations", "clinic_prescriptions", "clinic_rx_items", "clinic_pharmacy_link", "pharmacy_rx_notifications", "pharmacy_rx_items", "hospital_patients", "hospital_services", "hospital_episodes", "hospital_charges", "hospital_payments", "hospital_departments", "hospital_lab_orders", "hospital_imaging_orders"]) {
    assert.ok((db.prepare(`PRAGMA table_info("${t}")`).all() as unknown[]).length > 0, `${t} exists`);
  }

  // Pharmacy POS: the busiest pharmacy's screens and a sale on a copy.
  if (busiest) {
    login(busiest.tenant_id, pharmacyType);
    assert.deepEqual(await listInvoicesForGrid(), invoicesBefore, "the invoice screen shows exactly the same invoices");
    assert.deepEqual(await listProductsForGrid(), productsBefore, "the product screen shows exactly the same products");
    assert.ok(invoicesBefore.length > 0 && productsBefore.length > 0);
    const batch = db.prepare(`SELECT id, product_id, qty FROM product_batches WHERE tenant_id = ? AND qty >= 1 AND deleted_at IS NULL LIMIT 1`).get(busiest.tenant_id) as { id: string; product_id: string; qty: number } | undefined;
    if (batch) {
      assert.ok((await listAvailableBatches(batch.product_id)).length > 0);
      await deductStock(batch.id, 1);
      assert.equal((db.prepare(`SELECT qty FROM product_batches WHERE id = ?`).get(batch.id) as { qty: number }).qty, batch.qty - 1, "a sale still deducts stock");
      const inv = await invoicesRepo.get((db.prepare(`SELECT id FROM invoices WHERE tenant_id = ? LIMIT 1`).get(busiest.tenant_id) as { id: string }).id);
      assert.ok(inv, "an existing invoice still opens");
    }
  }

  // Clinic on the migrated copy.
  login("replica-clinic", "clinic");
  const doc = await doctorsRepo.create({ name: "Dr Replica" });
  const pat = await savePatient(null, { name: "Replica Patient", phone: "0300" });
  const appt = await saveAppointment(null, { patient_id: pat.id, doctor_id: null, date: localDate(), status: "scheduled", type: "routine" });
  const cons = await saveConsultation(null, { patient_id: pat.id, doctor_id: doc.id, appointment_id: appt.id, date: localDate(), diagnosis: "Test" });
  const rx = await prescriptionsRepo.create({ consultation_id: cons.id, patient_id: pat.id, doctor_id: null, date: localDate(), status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: null });
  await saveRxItems(rx.id, [{ prescription_id: rx.id, product_id: null, product_name: "Panadol", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 2, instructions: null }]);
  assert.equal((await patientsRepo.get(pat.id))?.name, "Replica Patient");
  assert.equal((await listAppointments({ date: localDate() })).length, 1);
  assert.equal((await getRxItems(rx.id)).length, 1);

  // Hospital on the migrated copy.
  login("replica-hospital", "hospital");
  await hospitalDepartmentsRepo.create({ name: "Neuro Department", type: "clinical", head: null, phone: null, notes: null, is_active: 1 });
  const hp = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Huzaifa Noor", gender: "Male" });
  const ep = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("opd", localDate()), type: "opd", patient_id: hp.id, doctor_id: null, department: "Neuro Department", date: localDate(), time: null,
    status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: null, notes: null,
  });
  await addCharge({ tenant_id: "", episode_id: ep.id, service_id: null, description: "Consultation", department: null, category: null, qty: 1, rate: 1000, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: localDate(), notes: null, invoice_id: null });
  await addPayment({ tenant_id: "", episode_id: ep.id, type: "payment", amount: 400, method: "cash", reference: null, notes: null, received_at: localDateTime() });
  await hospitalLabRepo.create({
    order_no: await nextOrderNo("hospital_lab_orders"), episode_id: ep.id, patient_id: hp.id, test_name: "CBC", priority: "routine", status: "pending",
    result_value: null, unit: null, ref_range: null, flag: null, ordered_by: null, ordered_at: localDateTime(), reported_at: null, notes: null,
  });
  const [row] = await listEpisodes();
  assert.equal(row.total_charges, 1000);
  assert.equal(row.total_paid, 400);
});
