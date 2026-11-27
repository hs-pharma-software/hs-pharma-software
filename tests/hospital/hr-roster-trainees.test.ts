/** HR Department: the Duty Roster and Trainees tabs, and the Super Admin's
 * demo hospital (departments, staff, a login per staff member, this week's
 * roster and trainees, all in one transaction). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { createDemoHospital, DEMO_STAFF, DEMO_TRAINEES, DEMO_DEPARTMENTS } from "@/server/demoHospital";
import { checkPassword } from "@/server/db";
import { listTrainees, saveTrainee, moveTrainee, endTraining, traineeCounts, currentPlacement } from "@/lib/repo/trainees";
import { rosterRange, setRosterShift, hospitalStaffList } from "@/lib/repo/hrRecords";
import { listForms } from "@/lib/repo/medicalRecord";
import { designation, staffGroup } from "@/config/hospitalStaff";
import { visibleNavFor } from "@/config/navFilter";
import { hasPermission } from "@/lib/moduleAccess";
import type { Caller } from "@/server/sqlPolicy";

const SA: Caller = { userId: "sa", role: "super_admin", tenantId: null };
const TODAY = "2026-11-23"; // a Monday
let db: DatabaseSync;
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const all = (q: string, ...a: unknown[]) => db.prepare(q).all(...(a as never[])) as Record<string, unknown>[];

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  db.prepare(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('pro', 'Pro', 0, 365, '[]', 50, '2026-01-01', '2026-01-01')`).run();
});

async function demo(prefix = "shifa") {
  return createDemoHospital(sqliteSql(db), SA, { hospitalName: "Shifa Demo Hospital", prefix, password: "Demo@2026", planId: "pro" }, TODAY);
}

function signIn(tenantId: string, username: string) {
  const u = one(`SELECT id, role, permissions, display_name FROM users WHERE username = ?`, username);
  const tenant: SessionTenant = {
    id: tenantId, name: "Shifa Demo Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 50,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({
    currentUser: { id: String(u.id), username, displayName: String(u.display_name ?? username), role: u.role as "owner" | "staff", tenantId, permissions: u.permissions ? JSON.parse(String(u.permissions)) : null },
    currentTenant: tenant,
  });
}

test("demo hospital: the business, 10 departments, 28 staff with a login each, the roster week and 9 trainees, in one go", async () => {
  const r = await demo();
  const T = r.tenantId;
  assert.equal(one(`SELECT business_type FROM tenants WHERE id = ?`, T).business_type, "hospital");
  assert.equal(one(`SELECT COUNT(*) AS n FROM branches WHERE tenant_id = ? AND is_main = 1`, T).n, 1);
  assert.equal(one(`SELECT COUNT(*) AS n FROM hospital_departments WHERE tenant_id = ?`, T).n, DEMO_DEPARTMENTS.length);
  assert.equal(one(`SELECT COUNT(*) AS n FROM staff WHERE tenant_id = ?`, T).n, DEMO_STAFF.length);
  assert.equal(r.logins.length, DEMO_STAFF.length + 1);
  assert.equal(one(`SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?`, T).n, DEMO_STAFF.length + 1);
  assert.equal(one(`SELECT COUNT(*) AS n FROM hospital_duty_roster WHERE tenant_id = ?`, T).n, DEMO_STAFF.length * 7);
  assert.equal(one(`SELECT COUNT(*) AS n FROM hospital_form_records WHERE tenant_id = ? AND form_key = 'hr_trainee'`, T).n, DEMO_TRAINEES.length);

  // What the client was promised: HODs, consultants, 5 doctors, 5 nurses, 1 head nurse, paramedical staff, computer operators, a security guard.
  const cats = all(`SELECT staff_category AS c FROM staff WHERE tenant_id = ?`, T).map((x) => String(x.c));
  const count = (c: string) => cats.filter((x) => x === c).length;
  assert.ok(count("hod") >= 2 && count("consultant") >= 2);
  assert.equal(count("medical_officer"), 5);
  assert.equal(count("nurse"), 5);
  assert.equal(count("head_nurse"), 1);
  assert.ok(count("lab_technician") + count("radiographer") + count("paramedic") >= 3);
  assert.ok(count("computer_operator") >= 1);
  assert.equal(count("security_guard"), 1);

  // Every login works with the demo password, and opens exactly its designation's sections.
  for (const l of r.logins) {
    const u = one(`SELECT password_hash, password_salt, permissions, role, is_active FROM users WHERE username = ?`, l.username);
    assert.ok(checkPassword("Demo@2026", String(u.password_salt), String(u.password_hash)).ok, l.username);
    assert.equal(u.is_active, 1);
    const s = one(`SELECT staff_category, user_id, employee_id, license_no FROM staff s JOIN users u ON u.id = s.user_id WHERE u.username = ?`, l.username);
    if (u.role === "owner") { assert.equal(s, undefined); continue; }
    const d = designation(String(s.staff_category))!;
    assert.deepEqual(JSON.parse(String(u.permissions)), d.pages, l.username);
    assert.equal(s.employee_id, l.employeeId);
    if (d.licenseRequired) assert.ok(String(s.license_no).startsWith("DEMO-"), `${l.username} has a licence number`);
  }
  assert.equal(one(`SELECT COUNT(DISTINCT employee_id) AS n FROM staff WHERE tenant_id = ?`, T).n, DEMO_STAFF.length, "employee ids are unique");

  // The roster never puts a morning after a night.
  const rows = all(`SELECT staff_id, duty_date, shift FROM hospital_duty_roster WHERE tenant_id = ? ORDER BY staff_id, duty_date`, T);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].staff_id === rows[i - 1].staff_id && rows[i - 1].shift === "N") assert.ok(!["M", "L"].includes(String(rows[i].shift)), "rest after a night");
  }
  assert.deepEqual(r.rosterDays, ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
});

test("demo hospital: usernames already taken, a bad prefix or not the Super Admin: nothing is created", async () => {
  await demo("shifa");
  const before = one(`SELECT COUNT(*) AS n FROM tenants`).n;
  await assert.rejects(demo("shifa"), /already taken/);
  await assert.rejects(createDemoHospital(sqliteSql(db), SA, { hospitalName: "X Hospital", prefix: "Bad Prefix", password: "Demo@2026", planId: "pro" }, TODAY), /prefix/);
  await assert.rejects(createDemoHospital(sqliteSql(db), SA, { hospitalName: "X Hospital", prefix: "abc", password: "123", planId: "pro" }, TODAY), /password/);
  await assert.rejects(createDemoHospital(sqliteSql(db), { userId: "o", role: "owner", tenantId: "t" }, { hospitalName: "X Hospital", prefix: "abc", password: "Demo@2026", planId: "pro" }, TODAY), /Only the Super Admin/);
  assert.equal(one(`SELECT COUNT(*) AS n FROM tenants`).n, before);
});

test("duty roster: the demo week reads back through the app; staff are grouped; a guard sees the roster but cannot change it", async () => {
  const r = await demo();
  signIn(r.tenantId, "shifa.admin");
  const staff = await hospitalStaffList();
  assert.equal(staff.length, DEMO_STAFF.length);
  const groups = new Set(staff.map((s) => staffGroup(s.staff_category)));
  for (const g of ["doctors", "nurses", "paramedical", "technical", "support"]) assert.ok(groups.has(g as never), g);
  assert.equal((await rosterRange(r.rosterDays[0], r.rosterDays[6])).length, DEMO_STAFF.length * 7);

  // The guard's login: the HR group shows only Duty Roster.
  signIn(r.tenantId, "shifa.guard1");
  const perms = useAuthStore.getState().currentUser!.permissions!;
  assert.deepEqual(perms, ["hospital_hr_roster"]);
  assert.ok(hasPermission(perms, "hospital_hr_roster"));
  assert.ok(!hasPermission(perms, "hospital_hr_trainees"));
  const hr = visibleNavFor("hospital", [], perms).find((n) => n.moduleKey === "hospital_hr");
  assert.deepEqual(hr?.children?.map((c) => c.label), ["Duty Roster"]);
  const guard = staff.find((s) => s.staff_category === "security_guard")!;
  await assert.rejects(setRosterShift(guard.id, r.rosterDays[0], "M"), /roster is made by/);

  // The head nurse may change it; the rest rule still applies.
  signIn(r.tenantId, "shifa.hn1");
  const nurse = staff.find((s) => s.staff_category === "nurse")!;
  const week = await rosterRange(r.rosterDays[0], r.rosterDays[6]);
  const night = week.find((e) => e.staff_id === nurse.id && e.shift === "N");
  if (night) {
    const next = r.rosterDays[r.rosterDays.indexOf(night.duty_date) + 1];
    if (next) await assert.rejects(setRosterShift(nurse.id, next, "M"), /night duty/);
  }
  const saved = await setRosterShift(nurse.id, r.rosterDays[6], "LV");
  assert.equal(saved?.shift, "LV");
});

test("trainees: listed by section, moved to the next section with the rotation kept, ended; never in a patient's records", async () => {
  const r = await demo();
  signIn(r.tenantId, "shifa.admin");
  const list = await listTrainees({ status: "active" });
  assert.equal(list.length, DEMO_TRAINEES.length);
  const counts = traineeCounts(list);
  assert.deepEqual(counts.filter((c) => c.department === "Radiology").map((c) => c.section).sort(), ["CT Scan", "MRI", "Ultrasound", "X-Ray"]);
  assert.equal(counts.filter((c) => c.department === "Laboratory").reduce((a, c) => a + c.n, 0), 3);

  const staff = await hospitalStaffList();
  const rad = staff.find((s) => s.staff_category === "radiologist")!;
  const t = await saveTrainee(null, {
    name: "Ayesha Tariq", institute: "Demo Institute of Medical Imaging", program: "Radiography / Medical Imaging Technology",
    startDate: "2026-11-01", department: "Radiology", section: "X-Ray", supervisorId: rad.id,
  });
  assert.equal(currentPlacement(t)?.supervisorName, rad.name);
  await assert.rejects(saveTrainee(null, { name: "X", institute: "Y", program: "Z", startDate: "2026-11-01", department: "Radiology", section: "Haematology" }), /not a section of Radiology/);
  await assert.rejects(moveTrainee(t.id, { department: "Radiology", section: "CT Scan", from: "2026-10-01" }), /must start after/);

  const moved = await moveTrainee(t.id, { department: "Radiology", section: "CT Scan", supervisorId: rad.id, from: "2026-11-20" });
  assert.deepEqual(moved.placements.map((p) => [p.section, p.from, p.to]), [["X-Ray", "2026-11-01", "2026-11-19"], ["CT Scan", "2026-11-20", null]]);
  const done = await endTraining(t.id, "completed", "2026-12-31");
  assert.equal(done.status, "completed");
  assert.equal(done.placements.at(-1)?.to, "2026-12-31");
  assert.equal((await listTrainees({ status: "completed" })).length, 1);

  // A computer operator (no HR role) cannot place trainees.
  signIn(r.tenantId, "shifa.co1");
  await assert.rejects(saveTrainee(null, { name: "X", institute: "Y", program: "Z", startDate: "2026-11-01", department: "Laboratory", section: "Haematology" }), /placed by HR/);

  // Trainee records never show among a patient's forms.
  signIn(r.tenantId, "shifa.admin");
  assert.equal((await listForms({ patientId: "anyone" })).length, 0);
});
