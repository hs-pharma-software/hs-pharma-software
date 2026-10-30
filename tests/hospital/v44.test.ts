/** CBC panel results, the report QR code (online copy), Radiology (Performing
 * Images, orders, report search), the visit payment receipt, and the
 * Radiology sub-tabs. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalPatientsRepo, nextMrNo, listChargesForEpisode, addPayment } from "@/lib/repo/hospital";
import { saveLabTest, orderLabTests, payOrderFee, saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { enterLabResult, verifyLabResult, getLabReport, getPublicLabReport } from "@/lib/repo/labReports";
import {
  importStandardImagingStudies, listImagingStudies, setImagingFee, saveImagingStudy, orderImaging, searchRadiologyReports, getRadiologyReport,
} from "@/lib/repo/radiology";
import { reportImaging } from "@/lib/repo/hospitalOpd";
import { getVisitReceipt } from "@/lib/repo/hospitalCare";
import { CBC_PANEL, flagFor, rangeForSex, panelFor, summarizeComponents } from "@/config/labPanels";
import { STANDARD_IMAGING_STUDIES } from "@/config/radiologyCatalog";
import { visibleNavFor } from "@/config/navFilter";
import { designation } from "@/config/hospitalStaff";
import { publicReportUrl } from "@/lib/publicUrl";
import { isPublicPath } from "@/lib/publicPaths";
import type { LabComponent } from "@/lib/types-hospital";

function login(tenantId = "hosp-a") {
  const tenant: SessionTenant = {
    id: tenantId, name: "City Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}
const patient = async (gender: "Female" | "Male" = "Female") => hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ayesha Bibi", gender, phone: "0300-5556677" });

beforeEach(() => {
  const db = fullSchemaDb();
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES ('hosp-a', 'City Hospital', 'hospital', 'x', 'x')`).run();
  setTestDb(db);
  login();
});

test("reference ranges: sex-specific ranges, between / below / above, text results", () => {
  assert.equal(rangeForSex("M 13.0-17.0; F 12.0-15.0", "Female"), "12.0-15.0");
  assert.equal(rangeForSex("M 13.0-17.0; F 12.0-15.0", null), null);
  assert.equal(rangeForSex("4.0-11.0", "Male"), "4.0-11.0");
  assert.equal(flagFor("11.2", "M 13.0-17.0; F 12.0-15.0", "Female"), "L");
  assert.equal(flagFor("13.5", "M 13.0-17.0; F 12.0-15.0", "Female"), "N");
  assert.equal(flagFor("12.6", "4.0-11.0"), "H");
  assert.equal(flagFor("250", "150-400"), "N");
  assert.equal(flagFor("6", "<5"), "H");
  assert.equal(flagFor("30", ">40"), "L");
  assert.equal(flagFor("Reactive", "Non-reactive"), null);
  assert.equal(flagFor("", "4-11"), null);
  assert.ok(panelFor("Complete Blood Count (CBC)"));
  assert.ok(panelFor("CBC"));
  assert.equal(panelFor("Haemoglobin (Hb)"), null);
  const keys = CBC_PANEL.map((p) => p.key);
  for (const k of ["hb", "rbc", "hct", "mcv", "mch", "mchc", "tlc", "neut", "lymph", "mono", "eos", "baso", "plt"]) assert.ok(keys.includes(k), k);
  assert.ok(CBC_PANEL.every((p) => p.unit && p.range));
});

test("CBC: every parameter saved, verified, on the report; the QR link opens it without a login", async () => {
  const cbc = await saveLabTest(null, { name: "Complete Blood Count (CBC)", rate: 800, sample_type: "Whole blood (EDTA)" });
  const p = await patient();
  const { request, orders } = await orderLabTests({ patientId: p.id, serviceIds: [cbc.id] });
  await payOrderFee("lab", orders[0].id, "cash");
  await assert.rejects(enterLabResult(orders[0].id, { result_value: "", unit: null, ref_range: null, flag: "N", components: [] }), /at least one parameter/);

  const values: Record<string, string> = { hb: "10.4", tlc: "12.8", plt: "250", neut: "70" };
  const components: LabComponent[] = CBC_PANEL.filter((x) => values[x.key]).map((x) => ({
    key: x.key, name: x.name, group: x.group, value: values[x.key], unit: x.unit, ref_range: x.range, flag: flagFor(values[x.key], x.range, p.gender),
  }));
  await enterLabResult(orders[0].id, { result_value: summarizeComponents(components), unit: null, ref_range: null, flag: "N", components });

  // Not verified: no report, no online copy.
  const before = await getLabReport(request.id, { checked: true });
  assert.equal(before.tests.length, 0);
  assert.equal(before.publicToken, null);

  await verifyLabResult(orders[0].id);
  const report = await getLabReport(request.id, { checked: true });
  const t = report.tests[0];
  assert.equal(t.flag, "H", "an abnormal parameter flags the test");
  assert.deepEqual(t.components.map((c) => [c.key, c.value, c.flag]), [["hb", "10.4", "L"], ["tlc", "12.8", "H"], ["neut", "70", "N"], ["plt", "250", "N"]]);
  assert.equal(t.result_value, "Hb 10.4 L, TLC 12.8 H, Neut 70, Plt 250");
  assert.match(report.publicToken ?? "", /^[0-9a-f]{32}$/);
  const again = await getLabReport(request.id, { checked: true });
  assert.equal(again.publicToken, report.publicToken, "the token stays the same");

  // A phone scanning the QR code is not logged in.
  useAuthStore.setState({ currentUser: null, currentTenant: null });
  const online = await getPublicLabReport(report.publicToken!);
  assert.equal(online.patient.name, "Ayesha Bibi");
  assert.equal(online.hospital.name, "City Hospital");
  assert.equal(online.tests[0].components.length, 4);
  assert.equal(online.verificationCode, report.verificationCode);
  await assert.rejects(getPublicLabReport("lab-no-guess"), /not valid/);
  await assert.rejects(getPublicLabReport("0".repeat(32)), /not found/);
  assert.equal(isPublicPath("/report/"), true);
  assert.equal(isPublicPath("/hospital/lab/reports/"), false);
  assert.equal(publicReportUrl(null), null);
});

test("Performing Images: standard studies without fees, a fee starts performing; orders bill the visit; reports search and print", async () => {
  const r = await importStandardImagingStudies();
  assert.equal(r.added, STANDARD_IMAGING_STUDIES.length);
  assert.deepEqual(await importStandardImagingStudies(), { added: 0, skipped: STANDARD_IMAGING_STUDIES.length });
  assert.equal((await listImagingStudies()).length, 0, "nothing orderable before a fee is set");
  const all = await listImagingStudies({ includeInactive: true });
  const codes = all.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  const chest = all.find((s) => s.name === "X-Ray Chest PA")!;
  assert.deepEqual([chest.modality, chest.rate, chest.is_active], ["X-Ray", 0, 0]);
  await assert.rejects(saveImagingStudy(null, { name: "x-ray chest pa", rate: 1 }), /already in the radiology list/);

  const p = await patient("Male");
  await assert.rejects(orderImaging({ patientId: p.id, serviceId: chest.id }), /Performing Images/);
  await setImagingFee(chest.id, 1200);
  const { episode, order } = await orderImaging({ patientId: p.id, serviceId: chest.id, bodyPart: "Chest", priority: "urgent", orderedBy: "Dr Rehan" });
  assert.deepEqual([order.modality, order.body_part, order.priority, order.fee, order.paid], ["X-Ray Chest PA", "Chest", "urgent", 1200, 0]);
  assert.equal(episode.department, "Radiology");
  assert.deepEqual((await listChargesForEpisode(episode.id)).map((c) => c.amount), [1200]);

  assert.deepEqual((await searchRadiologyReports("ayesha")).map((x) => x.order_no), [order.order_no]);
  assert.equal((await searchRadiologyReports(order.order_no.toLowerCase())).length, 1, "by invoice / order number");
  assert.equal((await searchRadiologyReports(episode.episode_no)).length, 1, "by visit number");
  assert.deepEqual(await searchRadiologyReports("zz-nobody"), []);
  await assert.rejects(getRadiologyReport(order.id), /not reported yet/);

  await payOrderFee("imaging", order.id, "cash");
  await reportImaging(order.id, { findings: "Lungs clear.", impression: "Normal chest radiograph", radiologist: "Dr Rehan" });
  const rep = await getRadiologyReport(order.id);
  assert.deepEqual([rep.order.impression, rep.patient.name, rep.episodeNo, rep.referringDoctor], ["Normal chest radiograph", "Ayesha Bibi", episode.episode_no, "Dr Rehan"]);

  // A login without radiology access cannot search.
  useAuthStore.setState((st) => ({ currentUser: { ...st.currentUser!, role: "staff", permissions: ["hospital_reception"] } }));
  await assert.rejects(searchRadiologyReports("ayesha"), /permission/);
});

test("visit receipt: charges, payments and what is due", async () => {
  const dr = await saveHospitalStaff(null, { name: "Dr Rab Nawaz", staff_category: "consultant", license_no: "PMDC-1", consultation_fee: 1500, department: "Orthopedic Department", basic_pay: 0 });
  const p = await patient("Male");
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  let r = await getVisitReceipt(episode.id);
  assert.deepEqual([r.total, r.paid, r.due, r.doctorName, r.patient?.name], [1500, 0, 1500, "Dr Rab Nawaz", "Ayesha Bibi"]);
  await addPayment({ tenant_id: "", episode_id: episode.id, type: "payment", amount: 1000, method: "cash", reference: null, notes: null, received_at: "2026-10-25 09:00" });
  r = await getVisitReceipt(episode.id);
  assert.deepEqual([r.paid, r.due, r.payments.length], [1000, 500, 1]);
  login("hosp-b");
  await assert.rejects(getVisitReceipt(episode.id), /not found/);
});

test("Radiology portal sections; receptionists and doctors get the reports, technologists and radiologists their own screens", () => {
  const rad = visibleNavFor("hospital", null, null).find((n) => n.label === "Radiology")!;
  assert.deepEqual(rad.children?.map((c) => c.label), [
    "Dashboard", "Reception", "Technologist", "Reporting", "Radiology Reports", "Modalities", "Machines", "Performing Images (Tests)", "Templates", "PACS / Orthanc",
  ]);
  for (const role of ["receptionist", "consultant"]) {
    const r = visibleNavFor("hospital", null, designation(role)!.pages).find((n) => n.label === "Radiology");
    assert.deepEqual(r?.children?.map((c) => c.label), ["Radiology Reports"], role);
  }
  const rt = visibleNavFor("hospital", null, designation("radiographer")!.pages).find((n) => n.label === "Radiology");
  assert.deepEqual(rt?.children?.map((c) => c.label), ["Technologist", "Radiology Reports"]);
  const rad2 = visibleNavFor("hospital", null, designation("radiologist")!.pages).find((n) => n.label === "Radiology");
  assert.deepEqual(rad2?.children?.map((c) => c.label), ["Reporting", "Radiology Reports"]);
  const admin = visibleNavFor("hospital", null, designation("radiology_admin")!.pages).find((n) => n.label === "Radiology");
  assert.equal(admin?.children?.length, 10);
});
