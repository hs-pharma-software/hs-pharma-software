/** Fees at the counters: the lab counter sees and collects only lab fees, the
 * radiology counter only radiology fees, the main reception everything.
 * Collecting from the receipt marks each test / scan paid, and a fee already
 * covered by an earlier lump payment is never charged twice. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, hospitalServicesRepo, hospitalLabRepo, hospitalImagingRepo, addPayment, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit, orderInvestigation } from "@/lib/repo/hospitalOpd";
import { getVisitReceipt } from "@/lib/repo/hospitalCare";
import { feeScopeForCurrentUser, opdQueueFor, listUnpaidOrdersFor, visitReceiptFor, collectVisitFees } from "@/lib/repo/receptionFees";
import { designation } from "@/config/hospitalStaff";
import { localDate, localDateTime } from "@/lib/localDate";
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
const service = (name: string, category: "lab" | "imaging", rate: number) =>
  hospitalServicesRepo.create({ code: name.toUpperCase().replace(/\W/g, "").slice(0, 8), name, department: category === "lab" ? "Laboratory" : "Radiology", category, billing_unit: "test", rate, is_active: 1, notes: null });

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function setup() {
  const doctor = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: "PMDC-1", consultation_fee: 1000, department: "Medicine", basic_pay: 0 });
  const labDesk = await saveHospitalStaff(null, { name: "Sadia", staff_category: "lab_receptionist", basic_pay: 0 });
  const radDesk = await saveHospitalStaff(null, { name: "Kashif", staff_category: "radiology_receptionist", basic_pay: 0 });
  const mainDesk = await saveHospitalStaff(null, { name: "Bilal", staff_category: "receptionist", basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Bilal Khalid", gender: "Male" });
  const { episode } = await bookOpdVisit({ patientId: patient.id, doctorId: doctor.id, pay: { method: "cash" } });
  const cbc = await service("CBC", "lab", 800);
  const lft = await service("LFT", "lab", 1200);
  const usg = await service("Ultrasound KUB", "imaging", 2500);
  const lab1 = (await orderInvestigation(episode.id, cbc.id)).order;
  const lab2 = (await orderInvestigation(episode.id, lft.id)).order;
  const scan = (await orderInvestigation(episode.id, usg.id)).order;
  return { doctor, labDesk, radDesk, mainDesk, patient, episode, lab1, lab2, scan };
}

test("each desk sees only its own fees; the main reception and owners see all and can switch", async () => {
  const s = await setup();
  assert.deepEqual(await feeScopeForCurrentUser(), { scope: "all", canChoose: true });
  await as(s.labDesk);
  assert.deepEqual(await feeScopeForCurrentUser(), { scope: "lab", canChoose: false });
  assert.deepEqual((await listUnpaidOrdersFor("lab")).map((o) => o.name).sort(), ["CBC", "LFT"]);
  assert.equal((await opdQueueFor("lab", { date: localDate() }))[0].due, 2000);
  await as(s.radDesk);
  assert.deepEqual(await feeScopeForCurrentUser(), { scope: "imaging", canChoose: false });
  assert.deepEqual((await listUnpaidOrdersFor("imaging")).map((o) => o.name), ["Ultrasound KUB"]);
  assert.equal((await opdQueueFor("imaging", { date: localDate() }))[0].due, 2500);
  await as(s.mainDesk);
  assert.equal((await feeScopeForCurrentUser()).scope, "all");
  assert.equal((await opdQueueFor("all", { date: localDate() }))[0].due, 4500, "consultation was paid at booking; tests and scan are due");

  const labReceipt = await visitReceiptFor(s.episode.id, "lab");
  assert.deepEqual(labReceipt.charges.map((c) => c.description).sort(), ["CBC", "LFT"], "the lab receipt shows only lab charges");
  assert.equal(labReceipt.due, 2000);
});

test("collecting at the lab counter marks the lab tests paid and leaves the scan for radiology", async () => {
  const s = await setup();
  await as(s.labDesk);
  assert.equal(await collectVisitFees(s.episode.id, "lab", "cash"), 2000);
  assert.equal((await hospitalLabRepo.get(s.lab1.id))!.paid, 1);
  assert.equal((await hospitalLabRepo.get(s.lab2.id))!.paid, 1);
  assert.equal((await hospitalImagingRepo.get(s.scan.id))!.paid, 0);
  assert.equal((await listUnpaidOrdersFor("lab")).length, 0, "they leave Fees to collect");
  assert.equal((await opdQueueFor("lab", { date: localDate() }))[0].due, 0);
  await assert.rejects(collectVisitFees(s.episode.id, "lab", "cash"), /No lab fee is due/);
  assert.equal((await getVisitReceipt(s.episode.id)).due, 2500, "the scan is still due on the visit");

  await as(s.radDesk);
  assert.equal(await collectVisitFees(s.episode.id, "imaging", "card"), 2500);
  assert.equal((await hospitalImagingRepo.get(s.scan.id))!.paid, 1);
  assert.equal((await getVisitReceipt(s.episode.id)).due, 0);
});

test("a fee already covered by an earlier lump payment is marked paid, not charged again", async () => {
  const s = await setup();
  // Before this change the receipt took one lump sum and left the tests unpaid.
  await addPayment({ tenant_id: "", episode_id: s.episode.id, type: "payment", amount: 2000, method: "cash", reference: s.episode.episode_no, notes: "Balance paid at reception", received_at: localDateTime() });
  assert.equal((await getVisitReceipt(s.episode.id)).due, 2500);
  await as(s.mainDesk);
  assert.equal(await collectVisitFees(s.episode.id, "all", "cash"), 2500, "only what is really due is taken");
  for (const o of [s.lab1, s.lab2]) assert.equal((await hospitalLabRepo.get(o.id))!.paid, 1);
  assert.equal((await hospitalImagingRepo.get(s.scan.id))!.paid, 1);
  assert.equal((await getVisitReceipt(s.episode.id)).due, 0, "nothing paid twice");
  assert.equal((await listUnpaidOrdersFor("all")).length, 0);
});
