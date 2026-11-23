/** Hospital stage B: Pharmacy Department > Selected Brands (the linked
 * pharmacy's stocked brands per generic, chosen by the administrator),
 * doctors prescribing by generic, and admission / emergency orders going to
 * the pharmacy with the chosen brand. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { genericLabelFor, listSelectedBrands, removeSelectedBrand, selectBrand } from "@/lib/repo/brandSelections";
import { pharmacyCatalogue, type PharmacyBrand, type PharmacyGeneric } from "@/server/pharmacyBrands";
import { hospitalEpisodesRepo, hospitalPatientsRepo, nextEpisodeNo, nextMrNo } from "@/lib/repo/hospital";
import { addMedicationOrder, listMedicationOrders, medicineName, sendMedicationOrdersToPharmacy } from "@/lib/repo/medication";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { staffRepo } from "@/lib/repo/staff";
import { designation } from "@/config/hospitalStaff";
import { localDate } from "@/lib/localDate";
import type { Staff } from "@/lib/types";

const H = "hosp-a", P = "pharm-p", Q = "pharm-q";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: H, name: "City Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  await staffRepo.update(staff.id, { user_id: `user-${staff.id}` } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: `user-${staff.id}`, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: designation(staff.staff_category)!.pages }, currentTenant: tenant });
}
const run = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  asOwner();
  run(`INSERT INTO clinic_pharmacy_link (id, clinic_tenant_id, pharmacy_tenant_id, is_active, created_at, updated_at) VALUES ('l1', ?, ?, 1, 'x', 'x')`, H, P);
  // The pharmacy's own product, two shared catalogue products, and one it doesn't stock.
  for (const [id, tenantId, name, company, generic] of [
    ["risek", P, "Risek 20mg Cap", "Getz", "Omeprazole"],
    ["omesec", null, "Omesec 20mg Cap", "Brookes", "Omeprazole"],
    ["omega", null, "Omega 20mg Cap", "Hilton", "omeprazole "],
    ["losec", null, "Losec 20mg Cap", "AstraZeneca", "Omeprazole"],
    ["ceftri", null, "Rocephin 1g Inj", "Roche", "Ceftriaxone"],
  ] as const) run(`INSERT INTO products (id, tenant_id, name, company_name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`, id, tenantId, name, company, generic);
  for (const [id, tenantId, pid, qty, cost] of [["b1", P, "risek", 40, 100], ["b2", P, "omesec", 25, 90], ["b3", P, "omega", 10, 80], ["b4", Q, "losec", 99, 70], ["b5", P, "ceftri", 5, 300]] as const) {
    run(`INSERT INTO product_batches (id, tenant_id, product_id, qty, purchase_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`, id, tenantId, pid, qty, cost);
  }
  run(`INSERT INTO price_list (id, tenant_id, product_id, sale_price, created_at, updated_at) VALUES ('pl1', ?, 'omesec', 150, '2026-01-01', 'x')`, P);
});

test("the doctors' generic: the generic name with the brand's strength and form", () => {
  assert.equal(genericLabelFor("Omeprazole", "Risek 20mg Cap"), "Omeprazole 20mg Cap");
  assert.equal(genericLabelFor("Ceftriaxone", "Rocephin 1 g Inj"), "Ceftriaxone 1g Inj");
  assert.equal(genericLabelFor("Paracetamol", "Calpol Syrup 120mg/5ml"), "Paracetamol 120mg/5ml Syp");
  assert.equal(genericLabelFor("Amoxicillin + Clavulanic acid", "Augmentin 625mg Tablets"), "Amoxicillin + Clavulanic acid 625mg Tab");
});

test("the linked pharmacy's stocked generics and brands, never another pharmacy's and never its costs", async () => {
  const sql = sqliteSql(db);
  const caller = { userId: "owner", role: "owner" as const, tenantId: H };
  const generics = await pharmacyCatalogue(sql, caller, { action: "generics", term: "ome" }) as PharmacyGeneric[];
  assert.deepEqual(generics, [{ generic: "Omeprazole", brands: 3 }]);
  const brands = await pharmacyCatalogue(sql, caller, { action: "brands", generic: "OMEPRAZOLE" }) as PharmacyBrand[];
  assert.deepEqual(brands.map((b) => [b.name, b.company, b.stock, b.price]), [["Omega 20mg Cap", "Hilton", 10, null], ["Omesec 20mg Cap", "Brookes", 25, 150], ["Risek 20mg Cap", "Getz", 40, null]]);
  assert.ok(brands.every((b) => !("purchase_price" in b) && !("cost" in b)));
  await assert.rejects(pharmacyCatalogue(sql, { userId: "x", role: "owner", tenantId: "other-hospital" }, { action: "generics" }), /Link the hospital pharmacy first/);
  await assert.rejects(pharmacyCatalogue(sql, caller, { action: "drop" }), /Unknown request/);
});

test("only the administrator chooses brands; one brand per generic, changed in place", async () => {
  await selectBrand({ genericLabel: " Omeprazole  20mg Cap ", genericName: "Omeprazole", product: { id: "risek", name: "Risek 20mg Cap", company: "Getz" } });
  await selectBrand({ genericLabel: "omeprazole 20mg cap", genericName: "Omeprazole", product: { id: "omesec", name: "Omesec 20mg Cap", company: "Brookes" } });
  await selectBrand({ genericLabel: "Ceftriaxone 1g Inj", product: { id: "ceftri", name: "Rocephin 1g Inj" } });
  const all = await listSelectedBrands();
  assert.deepEqual(all.map((b) => [b.generic_label, b.product_name, b.pharmacy_tenant_id, b.selected_by_name]), [
    ["Ceftriaxone 1g Inj", "Rocephin 1g Inj", P, "Admin"], ["omeprazole 20mg cap", "Omesec 20mg Cap", P, "Admin"],
  ]);
  assert.deepEqual((await listSelectedBrands("brookes")).map((b) => b.product_name), ["Omesec 20mg Cap"]);
  const doctor = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: "PMDC-1", basic_pay: 0 });
  await as(doctor);
  await assert.rejects(selectBrand({ genericLabel: "X", product: { id: "risek", name: "Risek" } }), /Only the hospital administrator/);
  await assert.rejects(removeSelectedBrand(all[0].id), /Only the hospital administrator/);
  asOwner();
  await removeSelectedBrand(all[0].id);
  assert.equal((await listSelectedBrands()).length, 1);
});

test("an admission's orders by generic go to the pharmacy with the chosen brand; the patient's own medicine does not", async () => {
  const sel = await selectBrand({ genericLabel: "Omeprazole 20mg Cap", genericName: "Omeprazole", product: { id: "omesec", name: "Omesec 20mg Cap", company: "Brookes" } });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const today = localDate();
  const ep = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("ipd", today), type: "ipd", patient_id: p.id, doctor_id: null, department: "Medicine", date: today, time: null,
    status: "open", room_ward: "Medical Ward", bed_no: "7", admission_date: today, discharge_date: null, diagnosis: null, notes: null,
  });
  await addMedicationOrder(ep.id, { product_id: sel.product_id, product_name: sel.product_name, generic_name: sel.generic_label, dose: "20 mg", route: "Oral", frequency: "OD (once a day)", duration: "5 days", qty: 5 });
  await addMedicationOrder(ep.id, { product_name: "Own inhaler", dose: "2 puffs", route: "Inhaled", frequency: "BD (twice a day)", duration: "5 days", ownSupply: true });
  const [o] = await listMedicationOrders(ep.id);
  assert.equal(medicineName(o), "Omeprazole 20mg Cap", "nurses and doctors see the generic");
  assert.equal(await sendMedicationOrdersToPharmacy(ep.id), 1);
  const sent = db.prepare(`SELECT product_id, product_name, qty FROM pharmacy_rx_items WHERE pharmacy_tenant_id = ? AND deleted_at IS NULL`).all(P) as { product_id: string; product_name: string; qty: number }[];
  assert.deepEqual(sent.map((r) => [r.product_id, r.product_name, r.qty]), [["omesec", "Omesec 20mg Cap", 5]]);
  const note = db.prepare(`SELECT patient_name, rx_notes FROM pharmacy_rx_notifications WHERE pharmacy_tenant_id = ?`).get(P) as { patient_name: string; rx_notes: string };
  assert.equal(note.patient_name, "Zahid Iqbal");
  assert.match(note.rx_notes, /Admission · IPD-.* · Ward Medical Ward · Bed 7/);
  await assert.rejects(sendMedicationOrdersToPharmacy(ep.id), /No new medication orders/);
});
