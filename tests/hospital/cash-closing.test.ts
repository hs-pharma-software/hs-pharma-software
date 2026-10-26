/** Receptionist day closings: every payment records who took it; each
 * receptionist closes only their own collections; a shortage needs a note;
 * closed payments are never counted again; the accountant verifies (not
 * their own); the finance overview totals by receiver, day and method. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, hospitalServicesRepo, addPayment, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit, orderInvestigation, payOrderFee } from "@/lib/repo/hospitalOpd";
import { myOpenCollections, closeMyDay, closingPayments, verifyClosing, financeOverview, listCollections } from "@/lib/repo/cashClosing";
import { designation } from "@/config/hospitalStaff";
import { localDate, localDateTime } from "@/lib/localDate";
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
const today = localDate();

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function setup() {
  const doctor = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: "PMDC-1", consultation_fee: 1000, department: "Medicine", basic_pay: 0 });
  const rec = await saveHospitalStaff(null, { name: "Bilal", staff_category: "receptionist", basic_pay: 0 });
  const lab = await saveHospitalStaff(null, { name: "Sadia", staff_category: "lab_receptionist", basic_pay: 0 });
  const acc = await saveHospitalStaff(null, { name: "Imran", staff_category: "accountant", basic_pay: 0 });
  const p1 = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const p2 = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Aqsa Bibi", gender: "Female" });
  const cbc = await hospitalServicesRepo.create({ code: "CBC", name: "CBC", department: "Laboratory", category: "lab", billing_unit: "test", rate: 800, is_active: 1, notes: null });
  return { doctor, rec, lab, acc, p1, p2, cbc };
}

test("each receptionist sees and closes only what they took; closed payments are not counted again", async () => {
  const s = await setup();
  // A payment from before day closings existed has no receiver.
  const { episode: old } = await bookOpdVisit({ patientId: s.p2.id, doctorId: s.doctor.id });
  const legacy = await addPayment({ tenant_id: "", episode_id: old.id, type: "payment", amount: 1000, method: "cash", reference: null, notes: null, received_at: localDateTime() });
  await dbExecute("UPDATE hospital_payments SET received_by = NULL, received_by_name = NULL WHERE id = ?", [legacy.id]);

  await as(s.rec);
  const { episode } = await bookOpdVisit({ patientId: s.p1.id, doctorId: s.doctor.id, pay: { method: "cash" } });
  const { episode: e2 } = await bookOpdVisit({ patientId: s.p2.id, doctorId: s.doctor.id, pay: { method: "card" } });
  const order = (await orderInvestigation(episode.id, s.cbc.id)).order;
  await as(s.lab);
  await payOrderFee("lab", order.id, "cash");
  assert.equal((await myOpenCollections()).totals.net, 800, "the lab desk sees only its own collection");

  await as(s.rec);
  let mine = await myOpenCollections();
  assert.deepEqual([mine.totals.count, mine.totals.cash, mine.totals.card, mine.expectedCash], [2, 1000, 1000, 1000]);
  await addPayment({ tenant_id: "", episode_id: e2.id, type: "refund", amount: 200, method: "cash", reference: null, notes: "Overcharged", received_at: localDateTime() });
  mine = await myOpenCollections();
  assert.equal(mine.expectedCash, 800, "a cash refund leaves the drawer");

  await assert.rejects(closeMyDay({ countedCash: 700 }), /less than expected by Rs 100/);
  const c = await closeMyDay({ countedCash: 700, handedTo: "Imran (accountant)", note: "Rs 100 short, change given wrongly" });
  assert.match(c.closing_no, /^CL-\d{2}-0001$/);
  assert.deepEqual([c.cash, c.card, c.refunds, c.net_total, c.counted_cash, c.difference], [1000, 1000, 200, 1800, 700, -100]);
  assert.equal((await closingPayments(c.id)).length, 3);
  assert.equal((await myOpenCollections()).rows.length, 0, "closed payments are not counted again");
  await assert.rejects(closeMyDay({ countedCash: 0 }), /Nothing has been collected/);

  await assert.rejects(verifyClosing(c.id), /accountant or the owner/);
  await as(s.acc);
  await verifyClosing(c.id, "Cash received");
  await assert.rejects(verifyClosing(c.id), /Already verified/);

  asOwner();
  const ov = await financeOverview({ from: today, to: today });
  assert.equal(ov.totals.net, 3600, "1000 old + 1000 cash + 1000 card + 800 lab − 200 refund");
  const byName = Object.fromEntries(ov.byReceiver.map((r) => [r.name, r]));
  assert.equal(byName.Bilal.totals.net, 1800);
  assert.equal(byName.Bilal.openCash, 0);
  assert.equal(byName.Sadia.openCash, 800, "the lab desk has not closed yet");
  assert.ok(byName["Not recorded (before day closings)"], "older payments without a receiver are shown, not hidden");
  assert.equal(ov.closingsPending, 0);
  assert.equal((await listCollections({ from: today, to: today }, { receiver: `user-${s.lab.id}` })).length, 1);
});

test("an accountant's own closing is verified by someone else", async () => {
  const s = await setup();
  await as(s.acc);
  const { episode } = await bookOpdVisit({ patientId: s.p1.id, doctorId: s.doctor.id, pay: { method: "cash" } });
  assert.ok(episode);
  const c = await closeMyDay({ countedCash: 1000 });
  assert.equal(c.difference, 0);
  await assert.rejects(verifyClosing(c.id), /verified by someone else/);
  asOwner();
  await verifyClosing(c.id);
});
