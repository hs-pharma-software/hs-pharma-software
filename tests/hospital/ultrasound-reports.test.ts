/** Structured ultrasound reports: the pattern found from the study, what the
 * doctor must complete (stones: one or multiple, size and location), pregnancy
 * dates, values out of range, the signed report, and its online copy (QR code). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalPatientsRepo, hospitalImagingRepo, nextMrNo } from "@/lib/repo/hospital";
import { payOrderFee } from "@/lib/repo/hospitalOpd";
import { saveImagingStudy, orderImaging, getRadiologyReport } from "@/lib/repo/radiology";
import { listForReporting, reportStudy } from "@/lib/repo/radiologyPortal";
import { getPublicRadiologyReport } from "@/lib/radiologyReportDocument";
import type { ReportDb } from "@/lib/labReportDocument";
import {
  ULTRASOUND_TEMPLATES, expectedDelivery, findingsText, gestationalAge, isUltrasoundStudy, parseStructuredReport, rangeFlag, reportSections, templateForStudy, ultrasoundTemplate, validateUltrasound, type UsValues,
} from "@/config/ultrasoundReports";

const T = "hosp-a";
let db: DatabaseSync;
const io: ReportDb = {
  select: async <R,>(sql: string, params: unknown[]) => db.prepare(sql).all(...(params as never[])) as R[],
  execute: async (sql: string, params: unknown[]) => db.prepare(sql).run(...(params as never[])),
};
const kub = ultrasoundTemplate("kub")!;
const obs = ultrasoundTemplate("obstetric")!;
const MALE = { gender: "Male", reportDate: "2026-11-18" };
const FEMALE = { gender: "Female", reportDate: "2026-11-18" };

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, 'City Hospital', 'hospital', '2026-01-01', '2026-01-01')`).run(T);
  const tenant: SessionTenant = {
    id: T, name: "City Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "owner", username: "owner", displayName: "Dr Sana", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});

async function paidOrder(study = "Ultrasound KUB") {
  const s = await saveImagingStudy(null, { name: study, modality: "Ultrasound", rate: 1500 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ali Raza", gender: "Male", age_years: 40 });
  const { order } = await orderImaging({ patientId: p.id, serviceId: s.id, orderedBy: "Dr Hamid" });
  await payOrderFee("imaging", order.id, "cash");
  return order;
}

test("the pattern comes from the study's name; other modalities and Doppler have none", () => {
  const id = (modality: string) => templateForStudy({ modality })?.id ?? null;
  assert.equal(id("Ultrasound KUB"), "kub");
  assert.equal(id("Ultrasound Obstetric"), "obstetric");
  assert.equal(id("Ultrasound Abdomen"), "abdomen");
  assert.equal(id("Ultrasound Pelvis"), "pelvis");
  assert.equal(id("Ultrasound Breast"), null);
  assert.equal(id("X-Ray KUB"), null);
  assert.equal(isUltrasoundStudy({ modality: "Doppler Ultrasound Legs", modality_code: "US" }), false);
});

test("KUB stones: Yes needs One or Multiple, then the size and location of each", () => {
  const errs = (v: UsValues) => validateUltrasound(kub, { rk_length: "10", ...v }, MALE).join(" ");
  assert.equal(errs({ rk_stone: "No" }), "");
  assert.match(errs({ rk_stone: "Yes" }), /One or Multiple/);
  assert.match(errs({ rk_stone: "Yes", rk_stone_count: "One" }), /the one stone/);
  assert.match(errs({ rk_stone: "Yes", rk_stone_count: "One", rk_stone_items: [{ size: "6" }] }), /stone 1: enter the location/);
  assert.equal(errs({ rk_stone: "Yes", rk_stone_count: "One", rk_stone_items: [{ size: "6", location: "Renal pelvis" }] }), "");
  assert.match(errs({ rk_stone: "Yes", rk_stone_count: "Multiple", rk_stone_items: [{ size: "6", location: "Renal pelvis" }] }), /at least two/);
  assert.equal(errs({ rk_stone: "Yes", rk_stone_count: "Multiple", rk_stone_items: [{ size: "6", location: "Renal pelvis" }, { size: "4", location: "Lower pole calyx" }] }), "");
  assert.match(validateUltrasound(kub, {}, MALE).join(" "), /Enter the scan's values/);
});

test("the report prints what applies: answers hide their details, the prostate only for a male patient, values out of range are marked", () => {
  const v: UsValues = { rk_length: "13.5", rk_stone: "No", rk_stone_count: "One", rk_stone_items: [{ size: "9", location: "Renal pelvis" }], lk_stone: "Yes", lk_stone_count: "One", lk_stone_items: [{ size: "7", location: "Renal pelvis" }], pr_l: "4", pr_w: "4", pr_h: "3" };
  const male = reportSections(kub, v, MALE);
  const right = male.find((s) => s.title === "Right kidney")!;
  assert.deepEqual(right.rows.find((r) => r.label === "Length"), { label: "Length", value: "13.5 cm", flag: "High" });
  assert.equal(right.tables.length, 0, "stone details of a kidney answered No are not printed");
  assert.deepEqual(male.find((s) => s.title === "Left kidney")!.tables[0].columns, ["Size (mm)", "Location"]);
  assert.equal(male.find((s) => s.title === "Prostate")!.rows.find((r) => r.label === "Volume (calculated)")!.value, "25.0 cc");
  assert.equal(reportSections(kub, v, FEMALE).some((s) => s.title === "Prostate"), false);
  assert.match(findingsText(kub, v, MALE), /Length: 13\.5 cm \(High\)/);
  assert.equal(rangeFlag("4", { min: 5, max: 24 }), "Low");
  assert.equal(rangeFlag("", { max: 5 }), null);
});

test("pregnancy: dates from the LMP, fields follow the trimester, and the fetus's sex is never a field", () => {
  assert.equal(gestationalAge("2026-06-01", "2026-11-18"), "24 weeks 2 days");
  assert.equal(gestationalAge("2026-11-10", "2026-11-18"), "1 week 1 day");
  assert.equal(expectedDelivery("2026-06-01"), "2027-03-08");
  assert.equal(gestationalAge("2026-12-01", "2026-11-18"), null);
  const later = reportSections(obs, { lmp: "2026-06-01", trimester: "Second", crl: "40", afi: "3", fetuses: [{ cardiac: "Present", fhr: "175", presentation: "Cephalic" }] }, FEMALE);
  assert.equal(later.some((s) => s.title === "Early pregnancy"), false);
  assert.equal(later[0].rows.find((r) => r.label === "Gestational age by LMP")!.value, "24 weeks 2 days");
  assert.equal(later.find((s) => s.title === "Placenta and liquor")!.rows[0].flag, "Low");
  assert.deepEqual(later.find((s) => s.title === "Fetal assessment")!.tables[0].rows[0].find((c) => c.value === "175"), { value: "175", flag: "High" });
  assert.match(validateUltrasound(obs, { trimester: "Third", fetuses: [{ fhr: "140" }] }, FEMALE).join(" "), /fetus 1: enter the cardiac activity/);
  assert.match(validateUltrasound(obs, { lmp: "2027-01-01" }, FEMALE).join(" "), /future/);
  const names = JSON.stringify(ULTRASOUND_TEMPLATES.map((t) => t.sections.flatMap((s) => s.fields.flatMap((f) => [f.key, f.label, ...(f.columns ?? []).map((c) => c.label)]))));
  assert.doesNotMatch(names, /gender|fetal sex|fetus sex|male fetus/i);
});

test("a signed ultrasound keeps its values, conclusion, recommendation and note; invalid values are refused and nothing is released", async () => {
  const order = await paidOrder();
  const structured = { template: "kub", values: { rk_length: "10.5", rk_stone: "Yes", rk_stone_count: "One", rk_stone_items: [{ size: "6", location: "Renal pelvis" }] } as UsValues, recommendation: "Urology opinion.", note: "Patient fasting." };
  await assert.rejects(reportStudy(order.id, { findings: null, impression: "", structured }), /conclusion/);
  await assert.rejects(reportStudy(order.id, { findings: null, impression: "Stone.", structured: { ...structured, values: { rk_stone: "Yes" } } }), /One or Multiple/);
  assert.equal((await hospitalImagingRepo.get(order.id))!.status, "pending");
  await reportStudy(order.id, { findings: null, impression: "Right renal calculus.", structured });
  const report = await getRadiologyReport(order.id);
  assert.equal(report.order.impression, "Right renal calculus.");
  assert.match(report.order.findings ?? "", /RIGHT KIDNEY\nLength: 10\.5 cm/);
  const saved = parseStructuredReport(report.order.structured_report)!;
  assert.deepEqual([saved.template, saved.recommendation, saved.note], ["kub", "Urology opinion.", "Patient fasting."]);
  assert.match(report.publicToken ?? "", /^[0-9a-f]{32}$/);
  assert.equal(report.referringDoctor, "Dr Hamid");
});

test("a paid ultrasound is ready to report without the technologist step; an unpaid one and other studies wait", async () => {
  const order = await paidOrder();
  const unpaid = await saveImagingStudy(null, { name: "Ultrasound Pelvis", modality: "Ultrasound", rate: 900 });
  const xray = await saveImagingStudy(null, { name: "X-Ray Chest", modality: "X-Ray", rate: 500 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Sara Khan", gender: "Female", age_years: 30 });
  await orderImaging({ patientId: p.id, serviceId: unpaid.id });
  const chest = (await orderImaging({ patientId: p.id, serviceId: xray.id })).order;
  await payOrderFee("imaging", chest.id, "cash");
  const toReport = await listForReporting("to_report");
  assert.deepEqual(toReport.map((o) => o.id), [order.id]);
  assert.equal("exam_data" in toReport[0], false, "the list stays light");
  assert.deepEqual((await listForReporting("unexamined")).map((o) => o.id), [chest.id]);
  await reportStudy(order.id, { findings: "Normal.", impression: "Normal study." });
  const done = (await hospitalImagingRepo.get(order.id))!;
  assert.deepEqual([done.status, done.performed_by_name, Boolean(done.performed_at)], ["reported", "Dr Sana", true]);
});

test("the online copy: only a released report, by its random key, without fees or internal notes", async () => {
  const order = await paidOrder();
  await reportStudy(order.id, { findings: "Normal kidneys.", impression: "Normal study." });
  const { publicToken } = await getRadiologyReport(order.id);
  const online = await getPublicRadiologyReport(publicToken!, io);
  assert.deepEqual([online.patient.name, online.order.impression, online.hospital.name], ["Ali Raza", "Normal study.", "City Hospital"]);
  const body = online.order as unknown as Record<string, unknown>;
  for (const k of ["fee", "paid", "notes", "exam_data", "patient_id", "tenant_id", "public_token"]) assert.equal(k in body, false, `${k} stays out`);
  await assert.rejects(getPublicRadiologyReport("not-a-token", io), /not valid/);
  await assert.rejects(getPublicRadiologyReport("0".repeat(32), io), /not found/);
  await hospitalImagingRepo.update(order.id, { status: "performed" });
  await assert.rejects(getPublicRadiologyReport(publicToken!, io), /not found/, "a withdrawn report is no longer online");
});

test("a report signed before online copies existed gets its key when it is opened, and keeps it", async () => {
  const order = await paidOrder();
  await hospitalImagingRepo.update(order.id, { status: "reported", impression: "Old report.", reported_at: "2026-01-01 10:00" });
  const first = await getRadiologyReport(order.id);
  assert.match(first.publicToken ?? "", /^[0-9a-f]{32}$/);
  assert.equal((await getRadiologyReport(order.id)).publicToken, first.publicToken);
});
