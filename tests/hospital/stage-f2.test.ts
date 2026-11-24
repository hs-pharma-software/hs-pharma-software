/** Hospital F2: print template settings (lab A4 / A5, prescription options),
 * the prescription's QR text and date with day, and the doctor's qualification. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { DEFAULT_PRINT, dateWithDay, loadHospitalPrint, loadHospitalProfile, prescriptionQrText, saveHospitalPrint } from "@/lib/hospitalPrint";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { setSetting } from "@/lib/repo/settings";
import type { HospitalEpisode } from "@/lib/types-hospital";
import type { HospitalPatient } from "@/lib/repo/hospital";

const tenant: SessionTenant = {
  id: "hosp-a", name: "City Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: "hosp-a", permissions: null }, currentTenant: tenant });
});

test("print templates: defaults, then the hospital's own choice", async () => {
  assert.deepEqual(await loadHospitalPrint(), DEFAULT_PRINT);
  await saveHospitalPrint({ ...DEFAULT_PRINT, labPaper: "a5", rxShowQualification: false, rxFooterNote: "  Bring this slip  ", otherRegistrations: "Drug Licence 567" });
  const s = await loadHospitalPrint();
  assert.deepEqual([s.labPaper, s.rxShowQualification, s.rxShowDesignation, s.rxFooterNote], ["a5", false, true, "Bring this slip"]);
  await setSetting("hospital.profile", JSON.stringify({ name: "Shifa Hospital", registration_no: "PHC-R-123", ntn: "1234567-8" }));
  const p = await loadHospitalProfile("fallback");
  assert.deepEqual([p.name, p.registration_no, p.ntn], ["Shifa Hospital", "PHC-R-123", "1234567-8"]);
});

test("the prescription: date with the day, and a QR text to check it against the hospital's record", async () => {
  assert.equal(dateWithDay("2026-11-24"), "Tuesday, 24 November 2026");
  const doctor = await saveHospitalStaff(null, { name: "Dr. Saima Khan", staff_category: "consultant", license_no: "PMDC-1", basic_pay: 0, qualification: "MBBS, FCPS (Gynae)" });
  assert.equal(doctor.qualification, "MBBS, FCPS (Gynae)");
  const text = prescriptionQrText({
    ep: { episode_no: "OPD-20261124-001", date: "2026-11-24" } as HospitalEpisode,
    patient: { name: "Ayesha", mr_no: "MR-0001-24112026-2026" } as HospitalPatient,
    doctor, profile: { name: "Shifa Hospital" },
  });
  assert.equal(text, "Rx OPD-20261124-001 | Shifa Hospital | Ayesha MR-0001-24112026-2026 | 2026-11-24 | Dr Saima Khan");
});
