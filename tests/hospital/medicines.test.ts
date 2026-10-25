/** Medicines management (MSDS MOM): formulary, antibiotic stewardship (indication,
 * culture, reserve approval within 24 h by another senior doctor, 72 h review),
 * adverse drug reactions to DRAP, the controlled drug register with witnesses
 * and counts, and the medicine fridge log. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { admitFromVisit } from "@/lib/repo/hospitalCare";
import { addMedicationOrder, approveAntibiotic, reviewAntibiotic, recordAdministration, listMedicationOrders, type MedicationOrderInput } from "@/lib/repo/medication";
import {
  saveFormularyItem, removeFormularyItem, stewardshipList, reportAdr, assessAdr, submitAdrToDrap, listAdr, recordCdEntry, cdBalance, cdStock,
  recordFridgeReading, medicineIndicators,
} from "@/lib/repo/medicines";
import { antibioticClass } from "@/config/medicines";
import { designation } from "@/config/hospitalStaff";
import { localDate } from "@/lib/localDate";
import { dbExecute } from "@/lib/db";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  await staffRepo.update(staff.id, { user_id: `user-${staff.id}` } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: `user-${staff.id}`, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: designation(staff.staff_category)!.pages }, currentTenant: tenant });
}
let n = 0;
const lic = () => `L-${++n}`;
const today = localDate();
const GIVE = { status: "given" as const, identifiers: ["Full name", "MR number"] as [string, string], checks: { medicine: true, dose: true, route: true, time: true } };
const MERO: MedicationOrderInput = { product_name: "Meronem 1 g", generic_name: "Meropenem", dose: "1 g", route: "IV", frequency: "8 hourly", duration: "7 days", abxIndication: "Hospital-acquired pneumonia", cultureSent: true };

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function setup() {
  const mo = await saveHospitalStaff(null, { name: "Dr Hamid", staff_category: "medical_officer", license_no: lic(), consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const con = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: lic(), consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: lic(), department: "Medicine", basic_pay: 0 });
  const nurse2 = await saveHospitalStaff(null, { name: "Nasreen", staff_category: "nurse", license_no: lic(), department: "Medicine", basic_pay: 0 });
  const ph = await saveHospitalStaff(null, { name: "Usman", staff_category: "pharmacist", license_no: lic(), basic_pay: 0 });
  const clerk = await saveHospitalStaff(null, { name: "Bilal", staff_category: "receptionist", basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const { episode: visit } = await bookOpdVisit({ patientId: patient.id, doctorId: con.id });
  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Pneumonia", plan: "ipd", department: "Medicine" });
  return { mo, con, nurse, nurse2, ph, clerk, patient, admission };
}

test("antibiotic classes", () => {
  assert.equal(antibioticClass("Meronem 1 g", "Meropenem"), "reserve");
  assert.equal(antibioticClass("Rocephin", "ceftriaxone"), "watch");
  assert.equal(antibioticClass("Augmentin 625"), "access");
  assert.equal(antibioticClass("Panadol", "paracetamol"), null);
});

test("formulary: once set up, a non-formulary medicine needs a reason", async () => {
  const s = await setup();
  await as(s.mo);
  await addMedicationOrder(s.admission.id, { product_name: "Panadol 500", generic_name: "Paracetamol", dose: "1 g", route: "Oral", frequency: "QID (four times)", duration: "3 days" });
  await as(s.nurse);
  await assert.rejects(saveFormularyItem(null, { genericName: "Paracetamol" }), /pharmacist/);
  await as(s.ph);
  const para = await saveFormularyItem(null, { genericName: "Paracetamol", strengthForm: "500 mg tablet", category: "Analgesic" });
  await assert.rejects(saveFormularyItem(null, { genericName: "paracetamol", strengthForm: "500 mg tablet" }), /already on the formulary/);
  await as(s.mo);
  await addMedicationOrder(s.admission.id, { product_name: "Panadol 500", generic_name: "Paracetamol", dose: "1 g", route: "Oral", frequency: "QID (four times)", duration: "3 days" });
  await assert.rejects(addMedicationOrder(s.admission.id, { product_name: "Ponstan", generic_name: "Mefenamic acid", dose: "500 mg", route: "Oral", frequency: "TDS (three times)", duration: "3 days" }), /not on the hospital formulary/);
  await addMedicationOrder(s.admission.id, { product_name: "Ponstan", generic_name: "Mefenamic acid", dose: "500 mg", route: "Oral", frequency: "TDS (three times)", duration: "3 days", nonFormularyReason: "Patient's long-term medicine" });
  await as(s.ph);
  await removeFormularyItem(para.id, "P&T committee 12/2026");
});

test("stewardship: indication and culture required; reserve approval by another senior doctor within 24 h; 72 h review", async () => {
  const s = await setup();
  await as(s.mo);
  await assert.rejects(addMedicationOrder(s.admission.id, { ...MERO, abxIndication: "" }), /indication/);
  await assert.rejects(addMedicationOrder(s.admission.id, { ...MERO, cultureSent: null }), /culture/);
  const o = await addMedicationOrder(s.admission.id, MERO);
  assert.equal(o.abx_class, "reserve");
  assert.equal(o.high_risk, 0);

  await as(s.nurse);
  await recordAdministration(o.id, GIVE);
  // The order was written 25 hours ago and still has no approval.
  await dbExecute("UPDATE hospital_rx_items SET ordered_at = ? WHERE id = ?", [new Date(Date.now() - 25 * 3_600_000).toISOString(), o.id]);
  await assert.rejects(recordAdministration(o.id, GIVE), /not been approved/);
  const list = await stewardshipList();
  assert.equal(list[0].approval_overdue, true);

  await as(s.mo);
  await assert.rejects(approveAntibiotic(o.id), /consultant/);
  // A senior doctor who prescribed it cannot approve their own order.
  await as(s.con);
  const own = await addMedicationOrder(s.admission.id, { ...MERO, product_name: "Vancomycin 1 g", generic_name: "Vancomycin" });
  await assert.rejects(approveAntibiotic(own.id), /other than the prescriber/);
  await approveAntibiotic(o.id);
  await as(s.nurse);
  await recordAdministration(o.id, GIVE);
  assert.equal((await stewardshipList(new Date(Date.now() + 80 * 3_600_000))).find((x) => x.id === o.id)!.review_due, true);
  await as(s.con);

  await as(s.mo);
  await assert.rejects(reviewAntibiotic(o.id, "Continue (reason recorded)", ""), /culture result/);
  await reviewAntibiotic(o.id, "De-escalate to narrower antibiotic", "Culture: E. coli sensitive to ceftriaxone");
  const after = (await listMedicationOrders(s.admission.id)).find((x) => x.id === o.id)!;
  assert.equal(after.order_status, "stopped", "de-escalation stops this order; the doctor writes the new one");
  assert.match(after.stop_reason!, /Antibiotic review/);

  const ind = await medicineIndicators({ from: localDate(new Date(Date.now() - 2 * 86_400_000)), to: today });
  assert.equal(ind.reserveOrders, 2);
  assert.equal(ind.reserveApprovedInTimePct, 0, "approved after 25 hours is late; the other is not approved");
  assert.equal(ind.cultureBeforePct, 100);
});

test("ADR: reported by clinical staff, assessed, then sent to DRAP with a reference", async () => {
  const s = await setup();
  await as(s.clerk);
  await assert.rejects(reportAdr({ episodeId: s.admission.id, suspectedDrug: "Ceftriaxone", onsetAt: today, reaction: "Rash", serious: false }), /nurse, doctor or pharmacist/);
  await as(s.nurse);
  await assert.rejects(reportAdr({ episodeId: s.admission.id, suspectedDrug: "Ceftriaxone", onsetAt: today, reaction: "Anaphylaxis", serious: true }), /why the reaction is serious/);
  const r = await reportAdr({ episodeId: s.admission.id, suspectedDrug: "Ceftriaxone 1 g IV", onsetAt: today, reaction: "Anaphylaxis 10 min after dose", serious: true, seriousness: "Life-threatening", actionTaken: "Drug withdrawn" });
  assert.match(r.report_no, /^ADR-\d{2}-0001$/);
  await as(s.ph);
  await assert.rejects(submitAdrToDrap(r.id, { reportedOn: today, ref: "PV-1" }), /Assess the causality/);
  await assessAdr(r.id, { causality: "Probable / likely", assessment: "Temporal relationship, recovered on withdrawal", outcome: "Recovered" });
  await submitAdrToDrap(r.id, { reportedOn: today, ref: "DRAP-PV-2026-118" });
  const [row] = await listAdr({});
  assert.equal(row.status, "submitted");
  assert.equal(row.report_overdue, false);
});

test("controlled drugs: receipt, witnessed doses and wastage, no negative stock, counts flag discrepancies", async () => {
  const s = await setup();
  const M = { location: "Medical ward", drug: "Morphine 10 mg/mL injection" };
  await as(s.nurse);
  await assert.rejects(recordCdEntry({ ...M, type: "receipt", qty: 10 }), /requisition/);
  await recordCdEntry({ ...M, type: "receipt", qty: 10, reference: "REQ-778" });
  await assert.rejects(recordCdEntry({ ...M, type: "administered", qty: 1, episodeId: s.admission.id }), /witness/);
  await assert.rejects(recordCdEntry({ ...M, type: "administered", qty: 1, episodeId: s.admission.id, witnessStaffId: s.nurse.id }), /another person/);
  await assert.rejects(recordCdEntry({ ...M, type: "administered", qty: 1, episodeId: s.admission.id, witnessStaffId: s.clerk.id }), /nurse, doctor or pharmacist/);
  await recordCdEntry({ ...M, type: "administered", qty: 1, episodeId: s.admission.id, witnessStaffId: s.nurse2.id });
  await assert.rejects(recordCdEntry({ ...M, type: "wasted", qty: 0.5, witnessStaffId: s.nurse2.id }), /why/);
  await recordCdEntry({ ...M, type: "wasted", qty: 0.5, witnessStaffId: s.nurse2.id, note: "Half ampoule discarded" });
  assert.equal(await cdBalance(M.location, M.drug), 8.5);
  await assert.rejects(recordCdEntry({ ...M, type: "administered", qty: 20, episodeId: s.admission.id, witnessStaffId: s.nurse2.id }), /Only 8.5/);
  await assert.rejects(recordCdEntry({ ...M, type: "count", qty: 0, countedQty: 7.5, witnessStaffId: s.nurse2.id }), /does not match/);
  await recordCdEntry({ ...M, type: "count", qty: 0, countedQty: 7.5, witnessStaffId: s.nurse2.id, note: "1 ampoule missing, incident INC-26-0004" });
  const [stock] = await cdStock();
  assert.equal(stock.balance, 8.5, "the register is never corrected silently");
  assert.equal(stock.discrepancy, true);
});

test("fridge: out of range needs the action taken", async () => {
  const s = await setup();
  await as(s.nurse);
  await recordFridgeReading({ fridge: "Ward 4 medicine fridge", tempC: 5, minC: 3, maxC: 7 });
  await assert.rejects(recordFridgeReading({ fridge: "Ward 4 medicine fridge", tempC: 11 }), /Record what was done/);
  await recordFridgeReading({ fridge: "Ward 4 medicine fridge", tempC: 11, actionTaken: "Insulin moved to pharmacy fridge; engineer called" });
  const ind = await medicineIndicators({ from: today, to: today });
  assert.equal(ind.fridgeReadings, 2);
  assert.equal(ind.fridgeOutOfRange, 1);
  assert.deepEqual(ind.fridgesWithoutReading7d, []);
});
