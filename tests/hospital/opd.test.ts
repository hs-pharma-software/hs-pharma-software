/** Hospital HR, logins by role, OPD reception, the doctor's desk, prescriptions
 * to the linked hospital pharmacy, and lab / radiology that wait for their fee.
 * Real repositories on the complete schema. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { localDate } from "@/lib/localDate";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, hospitalServicesRepo, hospitalLabRepo, hospitalImagingRepo, nextMrNo, listChargesForEpisode, listPaymentsForEpisode } from "@/lib/repo/hospital";
import {
  nextEmployeeId, saveHospitalStaff, listHospitalDoctors, bookOpdVisit, listOpdQueue, saveConsultationNotes, saveRx, listRx, sendRxToPharmacy,
  orderInvestigation, payOrderFee, listUnpaidOrders, reportLabResult, reportImaging, canProcess, listVisitOrders, staffForCurrentUser,
} from "@/lib/repo/hospitalOpd";
import { savePharmacyLink, searchProductsForPharmacy, listRxNotifications, getRxForInvoice } from "@/lib/repo/clinic";
import { createStaffLogin } from "@/lib/hospitalLogins";
import { visibleNavFor } from "@/config/navFilter";
import { designation } from "@/config/hospitalStaff";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
const H2 = "hosp-b";
const PH = "hosp-pharm";
const TODAY = localDate();
let sql: DatabaseSync;

function loginAs(tenantId: string, businessType = "hospital", userId = "owner-u", permissions: string[] | null = null) {
  const tenant: SessionTenant = {
    id: tenantId, name: `${tenantId} name`, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType,
  };
  useAuthStore.setState({ currentUser: { id: userId, username: "u", displayName: "U", role: permissions ? "staff" : "owner", tenantId, permissions }, currentTenant: tenant });
}

function insert(table: string, values: Record<string, unknown>) {
  const cols = sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown }[];
  const r: Record<string, unknown> = { created_at: TODAY, updated_at: TODAY, ...values };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in r)) r[c.name] = c.name.endsWith("_at") ? TODAY : 0;
  const keys = Object.keys(r).filter((k) => cols.some((c) => c.name === k));
  sql.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k]) as never[]));
}

const doctor = (over: Partial<Staff> = {}) =>
  saveHospitalStaff(null, { name: "Dr Rab Nawaz", staff_category: "consultant", license_no: `PMDC-${Math.random().toString(36).slice(2, 7)}`, consultation_fee: 1500, department: "Neuro Department", specialization: "Neurology", basic_pay: 0, ...over });
const patient = async (name = "Huzaifa Noor") => hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name, gender: "Male", phone: "0300-1234567", allergies: "Penicillin" });
const service = (name: string, category: "lab" | "imaging" | "procedure", rate: number) =>
  hospitalServicesRepo.create({ code: name.toUpperCase().replace(/\W/g, "").slice(0, 8), name, department: category === "lab" ? "Laboratory" : "Radiology", category, billing_unit: "test", rate, is_active: 1, notes: null });

beforeEach(() => {
  sql = fullSchemaDb();
  setTestDb(sql);
  insert("subscription_plans", { id: "plan", name: "Plan", max_staff_logins: 10, price: 0 });
  for (const [id, type] of [[H, "hospital"], [H2, "hospital"], [PH, "hospital_pharmacy"]]) insert("tenants", { id, name: `${id} name`, business_type: type, subscription_plan_id: "plan" });
  loginAs(H);
});

// ── HR ─────────────────────────────────────────────────────────────────────

test("employee ids follow the designation: MO-01, MO-02, CON-01; editing keeps the id, a new designation gets a new one", async () => {
  assert.equal(await nextEmployeeId("medical_officer"), "MO-01");
  const mo1 = await saveHospitalStaff(null, { name: "Dr A", staff_category: "medical_officer", license_no: "PMDC-1", basic_pay: 0 });
  const mo2 = await saveHospitalStaff(null, { name: "Dr B", staff_category: "medical_officer", license_no: "PMDC-2", basic_pay: 0 });
  const con = await saveHospitalStaff(null, { name: "Dr C", staff_category: "consultant", license_no: "PMDC-3", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Sister D", staff_category: "nurse", license_no: "PNC-9", basic_pay: 0 });
  assert.deepEqual([mo1.employee_id, mo2.employee_id, con.employee_id, nurse.employee_id], ["MO-01", "MO-02", "CON-01", "NUR-01"]);
  assert.equal(mo1.designation, "Medical Officer");
  assert.equal(nurse.license_type, "PNC");
  assert.equal(mo1.license_type, "PMDC");

  const edited = await saveHospitalStaff(mo1.id, { name: "Dr A Khan", staff_category: "medical_officer", license_no: "PMDC-1", basic_pay: 5000 });
  assert.equal(edited.employee_id, "MO-01");
  const promoted = await saveHospitalStaff(mo2.id, { name: "Dr B", staff_category: "medical_specialist", license_no: "PMDC-2", basic_pay: 0 });
  assert.equal(promoted.employee_id, "MS-01");
  assert.equal(await nextEmployeeId("medical_officer"), "MO-03", "MO-02 stays reserved");
});

test("licences: PMDC for doctors and PNC for nurses are required, paramedic licence optional, numbers unique", async () => {
  await assert.rejects(saveHospitalStaff(null, { name: "Dr X", staff_category: "consultant", license_no: "", basic_pay: 0 }), /PMDC number/);
  await assert.rejects(saveHospitalStaff(null, { name: "Nurse X", staff_category: "nurse", license_no: " ", basic_pay: 0 }), /PNC number/);
  const tech = await saveHospitalStaff(null, { name: "Tech", staff_category: "lab_technician", license_no: "", basic_pay: 0 });
  assert.equal(tech.employee_id, "LT-01");
  assert.equal(tech.license_no, null);
  const rec = await saveHospitalStaff(null, { name: "Front Desk", staff_category: "receptionist", license_no: "IGNORED", basic_pay: 0 });
  assert.equal(rec.license_no, null, "no licence for non-clinical staff");
  await saveHospitalStaff(null, { name: "Dr Y", staff_category: "consultant", license_no: "PMDC-77", basic_pay: 0 });
  await assert.rejects(saveHospitalStaff(null, { name: "Dr Z", staff_category: "medical_officer", license_no: "PMDC-77", basic_pay: 0 }), /already registered for Dr Y/);
  await assert.rejects(saveHospitalStaff(null, { name: "No role", staff_category: "", basic_pay: 0 }), /Choose a designation/);
});

test("only doctors (HoD, Consultant, Medical Specialist, Medical Officer) are bookable; fee only for doctors", async () => {
  await doctor({ name: "Dr Con" });
  await saveHospitalStaff(null, { name: "Dr HoD", staff_category: "hod", license_no: "PMDC-H", consultation_fee: 3000, basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Nurse", staff_category: "nurse", license_no: "PNC-1", consultation_fee: 999, basic_pay: 0 });
  assert.equal(nurse.consultation_fee, 0);
  assert.deepEqual((await listHospitalDoctors()).map((d) => d.name), ["Dr Con", "Dr HoD"]);
});

test("a login per role: receptionist sees Reception, a consultant the Doctor Desk, an admin everything", async () => {
  const rec = await saveHospitalStaff(null, { name: "Ayesha", staff_category: "receptionist", basic_pay: 0 });
  const con = await doctor({ name: "Dr Con" });
  const adm = await saveHospitalStaff(null, { name: "Admin", staff_category: "admin", basic_pay: 0 });
  const recUser = await createStaffLogin(rec.id, "ayesha", "pass1234");
  const conUser = await createStaffLogin(con.id, "drcon", "pass1234");
  const admUser = await createStaffLogin(adm.id, "admin1", "pass1234");
  assert.deepEqual(JSON.parse(recUser.permissions!), designation("receptionist")!.pages);
  assert.equal(admUser.permissions, null, "admin: full access");
  assert.equal((await staffRepo.get(rec.id))?.user_id, recUser.id);
  await assert.rejects(createStaffLogin(rec.id, "ayesha2", "pass1234"), /already has a login/);
  await assert.rejects(createStaffLogin(con.id, "x", "pass1234"), /already has a login/);

  const menu = (perms: string[] | null) => visibleNavFor("hospital", null, perms).map((i) => i.label);
  assert.deepEqual(menu(JSON.parse(recUser.permissions!)), ["Reception", "Hospital", "Patient", "Episodes & Billing", "Labs", "Radiology"]);
  const recLabs = visibleNavFor("hospital", null, JSON.parse(recUser.permissions!)).find((i) => i.label === "Labs")!;
  assert.deepEqual(recLabs.children!.map((c) => c.label), ["Lab Reports"], "a receptionist only searches and prints reports");
  // At the front desk "Hospital" holds only the OPD / IPD / Emergency queues, not the hospital's profile.
  const recHospital = visibleNavFor("hospital", null, JSON.parse(recUser.permissions!)).find((i) => i.label === "Hospital")!;
  assert.deepEqual(recHospital.children!.map((c) => c.label), ["OPD Queue", "Inpatients (IPD)", "Emergency", "ER Board", "MLC Register"]);
  assert.deepEqual(menu(JSON.parse(conUser.permissions!)), ["Doctor Desk", "Patient", "Labs", "Radiology"], "doctors can look up lab reports");
  assert.ok(menu(null).includes("HR Department"));

  // The doctor's own login finds their staff record (the Doctor Desk opens on their patients).
  loginAs(H, "hospital", conUser.id, JSON.parse(conUser.permissions!));
  assert.equal((await staffForCurrentUser())?.id, con.id);
});

// ── OPD ────────────────────────────────────────────────────────────────────

test("reception books a visit: token per doctor per day, fee charged and collected, slip searchable", async () => {
  const d1 = await doctor({ name: "Dr One" });
  const d2 = await doctor({ name: "Dr Two", consultation_fee: 0 });
  const p1 = await patient("Huzaifa Noor");
  const p2 = await patient("Sana");
  const v1 = await bookOpdVisit({ patientId: p1.id, doctorId: d1.id, pay: { method: "cash" } });
  const v2 = await bookOpdVisit({ patientId: p2.id, doctorId: d1.id, pay: null });
  const v3 = await bookOpdVisit({ patientId: p2.id, doctorId: d2.id, pay: { method: "cash" } });
  assert.deepEqual([v1.token, v2.token, v3.token], [1, 2, 1]);
  assert.equal(v1.fee, 1500);
  assert.equal(v1.paid, 1500);
  assert.equal(v2.paid, 0);
  assert.equal(v3.fee, 0);
  assert.equal(v1.episode.doctor_id, d1.id);
  assert.equal(v1.episode.department, "Neuro Department");
  assert.equal((await listChargesForEpisode(v1.episode.id))[0].amount, 1500);
  assert.equal((await listPaymentsForEpisode(v1.episode.id))[0].amount, 1500);

  const q = await listOpdQueue({ date: TODAY });
  assert.equal(q.length, 3);
  const row = q.find((r) => r.id === v2.episode.id)!;
  assert.equal(row.charges - row.paid, 1500, "unpaid fee shows as due");
  assert.equal((await listOpdQueue({ search: v1.episode.episode_no }))[0].id, v1.episode.id, "by slip number");
  assert.equal((await listOpdQueue({ search: "huzaifa" }))[0].id, v1.episode.id, "by name");
  assert.equal((await listOpdQueue({ doctorId: d1.id, search: "2" })).map((r) => r.id).includes(v2.episode.id), true, "by token");
  assert.equal((await listOpdQueue({ doctorId: d2.id })).length, 1);

  const nurse = await saveHospitalStaff(null, { name: "Nurse", staff_category: "nurse", license_no: "PNC-2", basic_pay: 0 });
  await assert.rejects(bookOpdVisit({ patientId: p1.id, doctorId: nurse.id }), /Choose a doctor/);
});

test("doctor's desk: notes, prescription by generic name from the linked pharmacy, sent to its Rx inbox", async () => {
  const d = await doctor();
  const p = await patient();
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: d.id, pay: { method: "cash" } });

  await saveConsultationNotes(episode.id, { complaint: "Headache", vitals: "BP 130/85", diagnosis: "Migraine", advice: "Rest", consult_status: "in_consultation" });
  assert.equal((await listOpdQueue())[0].consult_status, "in_consultation");

  // The pharmacy's medicine, found by its generic name (Description).
  insert("products", { id: "prod-1", tenant_id: PH, name: "Panadol 500mg", description: "Paracetamol", barcode: "111" });
  await assert.rejects(searchProductsForPharmacy("parac", PH), /Link this pharmacy/);
  await savePharmacyLink(PH);
  const found = await searchProductsForPharmacy("paracetamol", PH);
  assert.deepEqual(found.map((f) => f.name), ["Panadol 500mg"]);

  await assert.rejects(saveRx(episode.id, [{ product_id: "prod-1", product_name: "Panadol 500mg", generic_name: "Paracetamol", dose: "1", route: "Oral", frequency: "TDS", duration: "5", qty: 0, instructions: null }]), /Enter a quantity/);
  await saveRx(episode.id, [{ product_id: "prod-1", product_name: "Panadol 500mg", generic_name: "Paracetamol", dose: "1", route: "Oral", frequency: "TDS", duration: "5", qty: 15, instructions: "After meals" }]);
  assert.equal((await listRx(episode.id)).length, 1);
  await sendRxToPharmacy(episode.id);
  assert.ok((await listRx(episode.id))[0].sent_at);

  loginAs(PH, "hospital_pharmacy");
  const inbox = await listRxNotifications();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].patient_name, "Huzaifa Noor");
  assert.equal(inbox[0].doctor_name, "Dr Rab Nawaz");
  assert.equal(inbox[0].clinic_tenant_id, H);
  const bill = await getRxForInvoice(episode.id);
  assert.deepEqual(bill.items.map((i) => [i.product_id, i.qty]), [["prod-1", 15]]);
  assert.match(bill.notes ?? "", /Migraine/);
});

test("lab and radiology wait for their fee: ordered from the doctor's desk, paid at reception, then processed", async () => {
  const d = await doctor();
  const p = await patient();
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: d.id, pay: { method: "cash" } });
  const cbc = await service("CBC", "lab", 800);
  const xray = await service("X-Ray Chest", "imaging", 1200);
  const free = await service("Blood Group", "lab", 0);
  const proc = await service("Dressing", "procedure", 300);

  const lab = await orderInvestigation(episode.id, cbc.id, "Dr Rab Nawaz");
  const rad = await orderInvestigation(episode.id, xray.id);
  const freeOrder = await orderInvestigation(episode.id, free.id);
  await assert.rejects(orderInvestigation(episode.id, proc.id), /not a lab or radiology service/);
  assert.equal(lab.kind, "lab");
  assert.equal(rad.kind, "imaging");

  // Fees are on the bill and the orders are locked.
  const charges = await listChargesForEpisode(episode.id);
  assert.deepEqual(charges.map((c) => c.amount).sort((a, b) => a - b), [800, 1200, 1500]);
  assert.equal(canProcess(lab.order), false);
  assert.equal(canProcess(freeOrder.order), true, "a free test can start at once");
  await assert.rejects(reportLabResult(lab.order.id, { result_value: "13", unit: "g/dL", ref_range: null, flag: "N" }), /not paid yet/);
  await assert.rejects(reportImaging(rad.order.id, { findings: null, impression: "Normal", radiologist: null }), /not paid yet/);
  assert.deepEqual((await listUnpaidOrders()).map((o) => o.name).sort(), ["CBC", "X-Ray Chest"]);
  assert.deepEqual((await listVisitOrders(episode.id)).filter((o) => o.fee > 0 && !o.paid).length, 2);

  // Reception takes the fees.
  await payOrderFee("lab", lab.order.id, "cash");
  await payOrderFee("imaging", rad.order.id, "card");
  await assert.rejects(payOrderFee("lab", lab.order.id, "cash"), /already paid/);
  assert.equal((await listUnpaidOrders()).length, 0);
  const pays = await listPaymentsForEpisode(episode.id);
  assert.deepEqual(pays.map((x) => x.amount).sort((a, b) => a - b), [800, 1200, 1500]);

  await reportLabResult(lab.order.id, { result_value: "13.2", unit: "g/dL", ref_range: "12-16", flag: "N" });
  // Entered, not released: the doctor does not see it until a pathologist verifies it.
  assert.equal((await hospitalLabRepo.get(lab.order.id))?.status, "awaiting_verification");
  assert.ok(!(await listVisitOrders(episode.id)).some((o) => o.result));
  const { verifyLabResult } = await import("@/lib/repo/labReports");
  await verifyLabResult(lab.order.id);
  await reportImaging(rad.order.id, { findings: "Clear fields", impression: "Normal chest", radiologist: "Dr R" });
  assert.equal((await hospitalLabRepo.get(lab.order.id))?.status, "reported");
  assert.equal((await hospitalImagingRepo.get(rad.order.id))?.impression, "Normal chest");
  const results = await listVisitOrders(episode.id);
  assert.ok(results.some((o) => o.result === "13.2 g/dL"));
});

test("another hospital cannot book these doctors, see this queue or take these fees", async () => {
  const d = await doctor();
  const p = await patient();
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: d.id });
  const cbc = await service("CBC", "lab", 800);
  const { order } = await orderInvestigation(episode.id, cbc.id);

  loginAs(H2);
  const theirPatient = await patient("Other");
  await assert.rejects(bookOpdVisit({ patientId: theirPatient.id, doctorId: d.id }), /Choose a doctor/);
  await assert.rejects(bookOpdVisit({ patientId: p.id, doctorId: d.id }), /Patient not found/);
  assert.equal((await listOpdQueue()).length, 0);
  assert.equal((await listUnpaidOrders()).length, 0);
  assert.equal((await listHospitalDoctors()).length, 0);
  await assert.rejects(payOrderFee("lab", order.id, "cash"), /Order not found/);
  await assert.rejects(reportLabResult(order.id, { result_value: "1", unit: null, ref_range: null, flag: "N" }), /not found/);
  await assert.rejects(saveConsultationNotes(episode.id, { diagnosis: "x" }), /Visit not found/);
  await assert.rejects(sendRxToPharmacy(episode.id), /Visit not found/);
  assert.equal(await nextEmployeeId("consultant"), "CON-01", "ids are per hospital");
});

test("pharmacy: show the full prescription, convert it to an invoice once, doctor name shown once", async () => {
  const { getMailboxPrescription, markPrescriptionInvoiced } = await import("@/lib/repo/clinic");
  const { doctorLabel } = await import("@/lib/doctorName");
  const d = await doctor({ name: "Dr Rab Nawaz" });
  const p = await patient("Bilal Khalid");
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: d.id });
  await saveConsultationNotes(episode.id, { diagnosis: "Fever", advice: "Fluids" });
  await savePharmacyLink(PH);
  await saveRx(episode.id, [
    { product_id: "prod-1", product_name: "Panadol 500mg", generic_name: "Paracetamol", dose: "1", route: "Oral", frequency: "TDS (three times)", duration: "5", qty: 15, instructions: "After meals" },
    { product_id: null, product_name: "ORS", generic_name: null, dose: "1 sachet", route: "Oral", frequency: "SOS (when needed)", duration: "3", qty: 6, instructions: null },
  ]);
  await sendRxToPharmacy(episode.id);

  assert.equal(await getMailboxPrescription("missing"), null);
  loginAs(PH, "hospital_pharmacy");
  const [n] = await listRxNotifications();
  const rx = await getMailboxPrescription(n.id);
  assert.ok(rx);
  assert.equal(rx!.notification.patient_name, "Bilal Khalid");
  assert.equal(rx!.notification.clinic_name, `${H} name`);
  assert.deepEqual(rx!.lines.map((l) => [l.product_name, l.dose, l.frequency, l.duration, l.qty, l.instructions]), [
    ["Panadol 500mg", "1", "TDS (three times)", "5", 15, "After meals"],
    ["ORS", "1 sachet", "SOS (when needed)", "3", 6, null],
  ]);
  assert.match(rx!.notification.rx_notes ?? "", /Fever/);

  await markPrescriptionInvoiced(episode.id, "inv-1");
  const after = await getMailboxPrescription(n.id);
  assert.equal(after!.notification.status, "dispensed");
  assert.equal(after!.notification.invoice_id, "inv-1");

  // Nobody else can open it: not the sender, not another pharmacy.
  loginAs(H);
  assert.equal(await getMailboxPrescription(n.id), null);
  loginAs("other-pharm", "hospital_pharmacy");
  assert.equal(await getMailboxPrescription(n.id), null);

  assert.equal(doctorLabel("Dr Rab Nawaz"), "Dr Rab Nawaz");
  assert.equal(doctorLabel("dr. Ali"), "dr. Ali");
  assert.equal(doctorLabel("Rab Nawaz"), "Dr. Rab Nawaz");
  assert.equal(doctorLabel(""), "Doctor not named");
});

test("Performing Tests: the lab's own list drives doctor and lab orders, and pre-fills results", async () => {
  const { saveLabTest, listLabTests, orderLabTests, listOpenVisits } = await import("@/lib/repo/hospitalOpd");
  const cbc = await saveLabTest(null, { name: "CBC", sample_type: "Whole blood (EDTA)", unit: "g/dL", ref_range: "13-17", turnaround_hours: 4, rate: 800 });
  const bsr = await saveLabTest(null, { name: "Blood Sugar Random", sample_type: "Blood", unit: "mg/dL", ref_range: "70-140", rate: 300 });
  const old = await saveLabTest(null, { name: "ESR", rate: 200, is_active: 0 });
  assert.deepEqual([cbc.code, bsr.code, old.code], ["LAB-001", "LAB-002", "LAB-003"]);
  assert.equal(cbc.category, "lab");
  await assert.rejects(saveLabTest(null, { name: " cbc ", rate: 1 }), /already in the test list/);
  await assert.rejects(saveLabTest(null, { name: "X", rate: -1 }), /cannot be negative/);
  const edited = await saveLabTest(cbc.id, { name: "CBC", sample_type: "Whole blood (EDTA)", unit: "g/dL", ref_range: "12-17", turnaround_hours: 4, rate: 850 });
  assert.equal(edited.code, "LAB-001", "code kept on edit");
  assert.deepEqual((await listLabTests()).map((t) => t.name), ["Blood Sugar Random", "CBC"], "only tests performed");
  assert.equal((await listLabTests({ includeInactive: true })).length, 3);

  // Doctor's desk order: unit and normal range travel with the order.
  const d = await doctor();
  const p = await patient();
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: d.id });
  const fromDoctor = await orderInvestigation(episode.id, cbc.id);
  assert.equal((fromDoctor.order as { unit: string | null }).unit, "g/dL");
  assert.equal((fromDoctor.order as { ref_range: string | null }).ref_range, "12-17");
  assert.equal(Number(fromDoctor.order.fee), 850);

  // Lab's New Order: on today's open visit; a walk-in without a visit gets a lab visit.
  const onVisit = await orderLabTests({ patientId: p.id, serviceIds: [bsr.id], priority: "urgent" });
  assert.equal(onVisit.episode.id, episode.id);
  assert.equal(onVisit.orders[0].priority, "urgent");
  const walkIn = await patient("Walk-in Lab");
  const lab = await orderLabTests({ patientId: walkIn.id, serviceIds: [cbc.id, bsr.id, cbc.id] });
  assert.equal(lab.orders.length, 2, "a test chosen twice is ordered once");
  assert.equal(lab.episode.department, "Laboratory");
  assert.equal((await listOpenVisits(walkIn.id)).length, 1);
  const bill = await listChargesForEpisode(lab.episode.id);
  assert.deepEqual(bill.map((c) => c.amount).sort((a, b) => a - b), [300, 850]);
  assert.equal((await listUnpaidOrders()).filter((o) => o.episode_id === lab.episode.id).length, 2, "Reception sees both fees");

  await assert.rejects(orderLabTests({ patientId: walkIn.id, serviceIds: [old.id] }), /not in the lab's list/);
  await assert.rejects(orderLabTests({ patientId: walkIn.id, serviceIds: [] }), /at least one test/);
  await assert.rejects(orderLabTests({ patientId: walkIn.id, serviceIds: [cbc.id], episodeId: episode.id }), /open visit of this patient/);
});
