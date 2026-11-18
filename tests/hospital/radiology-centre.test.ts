/** Radiology Centre: its own business type on the hospital's radiology screens.
 * It sees radiology only, its staff get radiology roles, the hospital keeps its
 * own access, and a patient goes from order and fee to a signed online report. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { visibleNavFor } from "@/config/navFilter";
import { bottomNavFor } from "@/config/bottomNav";
import { designation, designationsFor, usesHospitalStaff } from "@/config/hospitalStaff";
import { hasModuleAccess, moduleKeyForPath } from "@/lib/moduleAccess";
import { hospitalPatientsRepo, hospitalImagingRepo, nextMrNo } from "@/lib/repo/hospital";
import { collectVisitFees } from "@/lib/repo/receptionFees";
import { saveImagingStudy, orderImaging, getRadiologyReport } from "@/lib/repo/radiology";
import { listForReporting, reportStudy } from "@/lib/repo/radiologyPortal";
import { getPublicRadiologyReport } from "@/lib/radiologyReportDocument";

const T = "centre-a";
const TYPE = "radiology_center";
let db: DatabaseSync;

function session(type: string, role: "owner" | "staff" = "owner", permissions: string[] | null = null) {
  const tenant: SessionTenant = {
    id: T, name: "City Imaging", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: businessType(type).defaultModules, maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: type,
  };
  useAuthStore.setState({ currentUser: { id: "u1", username: "u1", displayName: "Dr Sana", role, tenantId: T, permissions }, currentTenant: tenant });
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, 'City Imaging', ?, '2026-01-01', '2026-01-01')`).run(T, TYPE);
  session(TYPE);
});

test("the sidebar is the radiology department and the centre's money, nothing else of a hospital", () => {
  assert.equal(businessType(TYPE).label, "Radiology Centre");
  const nav = visibleNavFor(TYPE, businessType(TYPE).defaultModules, null);
  assert.deepEqual(nav.map((n) => n.label), [
    "Reception", "Technologist", "Reporting", "Radiology Reports", "Patient", "Finance", "Radiology Setup", "Staff", "Cash Register", "Banks", "Expenses", "Other Revenue", "Utilities", "Settings",
  ]);
  assert.deepEqual(nav.find((n) => n.label === "Radiology Setup")?.children?.map((c) => c.label), ["Performing Images (Tests)", "Templates", "Modalities", "Machines", "PACS / Orthanc", "Centre Profile"]);
  assert.deepEqual(bottomNavFor(TYPE, nav).map((b) => b.label), ["Reception", "Scan", "Report", "Patients"]);
});

test("the centre opens the radiology screens and no other hospital section; the hospital's own access is unchanged", () => {
  const open = (path: string) => hasModuleAccess(moduleKeyForPath(path));
  for (const p of ["/hospital/radiology", "/hospital/radiology/technologist", "/hospital/radiology/reporting", "/hospital/radiology/reports", "/hospital/radiology/studies", "/hospital/patients", "/hospital/finance", "/hospital/profile", "/dashboard"]) assert.equal(open(p), true, p);
  for (const p of ["/hospital/reception", "/hospital/doctor", "/hospital/lab", "/hospital/ipd", "/hospital/surgery", "/hospital/blood-bank", "/invoices", "/products"]) assert.equal(open(p), false, p);
  session("hospital");
  for (const p of ["/hospital/radiology", "/hospital/radiology/reporting", "/hospital/radiology/studies", "/hospital/patients", "/hospital/finance", "/hospital/profile", "/hospital/reception"]) assert.equal(open(p), true, `hospital ${p}`);
  assert.equal(visibleNavFor("hospital", null, null).some((n) => n.label === "Radiology Setup"), false, "the hospital keeps it inside Radiology");
  session("lab");
  assert.equal(open("/hospital/radiology"), false, "other business types stay out");
});

test("staff get radiology roles, and each login sees only its own desk", () => {
  assert.equal(usesHospitalStaff(TYPE), true);
  assert.equal(usesHospitalStaff("lab"), false);
  assert.deepEqual(designationsFor(TYPE).map((d) => d.key).sort(), ["accountant", "admin", "radiographer", "radiologist", "radiology_admin", "radiology_receptionist"]);
  assert.ok(designationsFor("hospital").length > designationsFor(TYPE).length);
  const labels = (role: string) => visibleNavFor(TYPE, null, designation(role)!.pages).map((n) => n.label);
  assert.deepEqual(labels("radiology_receptionist"), ["Reception", "Radiology Reports", "Patient"]);
  assert.deepEqual(labels("radiographer"), ["Technologist", "Radiology Reports", "Patient"]);
  assert.deepEqual(labels("radiologist"), ["Reporting", "Radiology Reports", "Patient"]);
  session(TYPE, "staff", designation("radiology_receptionist")!.pages);
  assert.equal(hasModuleAccess(moduleKeyForPath("/hospital/radiology")), true, "a receptionist opens the counter");
  assert.equal(hasModuleAccess(moduleKeyForPath("/hospital/radiology/reporting")), false);
});

test("a patient: order, fee at the counter, report, online copy", async () => {
  const study = await saveImagingStudy(null, { name: "Ultrasound KUB", modality: "Ultrasound", rate: 1500 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ali Raza", gender: "Male", age_years: 40 });
  const { order, episode } = await orderImaging({ patientId: p.id, serviceId: study.id, orderedBy: "Dr Hamid" });
  assert.deepEqual((await listForReporting("to_report")).map((o) => o.id), [], "not before the fee is paid");
  await collectVisitFees(episode.id, "imaging", "cash");
  assert.equal(Number((await hospitalImagingRepo.get(order.id))!.paid), 1);
  assert.deepEqual((await listForReporting("to_report")).map((o) => o.id), [order.id]);
  await reportStudy(order.id, { findings: null, impression: "Normal study.", structured: { template: "kub", values: { rk_length: "10.5", rk_stone: "No" } } });
  const report = await getRadiologyReport(order.id);
  assert.equal(report.hospital.name, "City Imaging");
  const io = {
    select: async <R,>(sql: string, params: unknown[]) => db.prepare(sql).all(...(params as never[])) as R[],
    execute: async (sql: string, params: unknown[]) => db.prepare(sql).run(...(params as never[])),
  };
  assert.equal((await getPublicRadiologyReport(report.publicToken!, io)).order.impression, "Normal study.");
});
