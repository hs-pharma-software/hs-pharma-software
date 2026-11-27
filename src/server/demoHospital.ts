/** Super Admin: a complete demo hospital in one step, for presentations to
 * clients. One transaction creates the business (type Hospital, on the plan
 * chosen), its main branch and profile, departments, staff with licence
 * numbers and employee ids, a login for every staff member (with exactly the
 * sections of their designation, as the Staff form gives them), this week's
 * duty roster and trainees placed in the Lab and Radiology sections.
 *
 * Every login shares one demo password chosen by the Super Admin and starts
 * with the chosen prefix ("shifa.mo1"). Nothing is created if any of those
 * usernames already exists. All names, phone and licence numbers are made up
 * and marked as demo. */
import { randomBytes, randomUUID } from "node:crypto";
import { HttpError, storedPasswordHash } from "./db";
import { pkToday } from "./appDocs";
import { businessType, defaultModulesFor } from "../config/businessTypes";
import { designation } from "../config/hospitalStaff";
import { mainBranchId } from "../config/branchTables";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface DemoHospitalInput { hospitalName?: unknown; prefix?: unknown; password?: unknown; planId?: unknown; city?: unknown }
export interface DemoLogin { group: string; name: string; designation: string; department: string; employeeId: string | null; username: string }
export interface DemoHospitalResult { tenantId: string; hospitalName: string; password: string; logins: DemoLogin[]; departments: string[]; trainees: number; rosterDays: string[] }

type Row = Record<string, unknown>;

/** The departments of the demo hospital: name, kind, head. */
export const DEMO_DEPARTMENTS: [string, string][] = [
  ["Medicine", "clinical"], ["Surgery", "clinical"], ["Gynae & Obstetrics", "clinical"], ["Paediatrics", "clinical"], ["Emergency", "clinical"],
  ["Laboratory", "diagnostic"], ["Radiology", "diagnostic"], ["Nursing", "support"], ["Pharmacy", "support"], ["Administration", "support"],
];

/** [login suffix, group shown on the logins sheet, name, designation key, department, specialization, licence?] */
export const DEMO_STAFF: [string, string, string, string, string, string | null][] = [
  ["hod1", "Heads of Department", "Dr. Imran Qureshi", "hod", "Medicine", "Internal Medicine"],
  ["hod2", "Heads of Department", "Dr. Farah Naz", "hod", "Surgery", "General Surgery"],
  ["hod3", "Heads of Department", "Dr. Khalid Mahmood", "hod", "Gynae & Obstetrics", "Obstetrics & Gynaecology"],
  ["con1", "Consultants", "Dr. Ayesha Siddiqui", "consultant", "Gynae & Obstetrics", "Gynaecology"],
  ["con2", "Consultants", "Dr. Bilal Ahmed", "consultant", "Paediatrics", "Paediatrics"],
  ["con3", "Consultants", "Dr. Saad Malik", "consultant", "Medicine", "Cardiology"],
  ["path1", "Consultants", "Dr. Rabia Anwar", "pathologist", "Laboratory", "Pathology"],
  ["rad1", "Consultants", "Dr. Naveed Akhtar", "radiologist", "Radiology", "Radiology"],
  ["mo1", "Doctors (Medical Officers)", "Dr. Usman Tariq", "medical_officer", "Emergency", null],
  ["mo2", "Doctors (Medical Officers)", "Dr. Hina Javed", "medical_officer", "Medicine", null],
  ["mo3", "Doctors (Medical Officers)", "Dr. Ali Raza", "medical_officer", "Surgery", null],
  ["mo4", "Doctors (Medical Officers)", "Dr. Sana Iqbal", "medical_officer", "Gynae & Obstetrics", null],
  ["mo5", "Doctors (Medical Officers)", "Dr. Hamza Sheikh", "medical_officer", "Paediatrics", null],
  ["hn1", "Nursing", "Nasreen Akhtar", "head_nurse", "Medicine", null],
  ["nurse1", "Nursing", "Rubina Kausar", "nurse", "Medicine", null],
  ["nurse2", "Nursing", "Shazia Parveen", "nurse", "Surgery", null],
  ["nurse3", "Nursing", "Asma Bibi", "nurse", "Gynae & Obstetrics", null],
  ["nurse4", "Nursing", "Mehwish Khan", "nurse", "Paediatrics", null],
  ["nurse5", "Nursing", "Sadia Noreen", "nurse", "Emergency", null],
  ["lt1", "Paramedical staff", "Kashif Mehmood", "lab_technician", "Laboratory", null],
  ["lt2", "Paramedical staff", "Rizwan Ali", "lab_technician", "Laboratory", null],
  ["rt1", "Paramedical staff", "Waqas Ahmed", "radiographer", "Radiology", null],
  ["rt2", "Paramedical staff", "Naveed Iqbal", "radiographer", "Radiology", null],
  ["ot1", "Paramedical staff", "Zubair Hussain", "paramedic", "Surgery", "Operation Theatre Technician"],
  ["ph1", "Paramedical staff", "Sobia Rafiq", "pharmacist", "Pharmacy", null],
  ["co1", "Computer operators", "Faisal Nadeem", "computer_operator", "Administration", null],
  ["co2", "Computer operators", "Iqra Shahid", "computer_operator", "Laboratory", null],
  ["guard1", "Security", "Muhammad Akram", "security_guard", "Administration", null],
];

/** Shift pattern for a staff member's week (Monday first). Cyclic M,M,E,E,N,O,O so a night is never followed by a morning. */
const CYCLE = ["M", "M", "E", "E", "N", "O", "O"];
function weekShifts(category: string, i: number): string[] {
  if (["hod", "consultant", "pathologist", "radiologist", "head_nurse", "pharmacist"].includes(category)) return ["M", "M", "M", "M", "M", "M", "O"];
  if (category === "security_guard") return ["N", "N", "N", "N", "N", "O", "O"];
  if (["computer_operator", "lab_technician", "radiographer"].includes(category)) return i % 2 ? ["E", "E", "E", "E", "E", "E", "O"] : ["M", "M", "M", "M", "M", "M", "O"];
  return Array.from({ length: 7 }, (_, d) => CYCLE[(d + i * 2) % 7]);
}

/** Trainees: name, programme, institute, department, section, supervisor's login suffix, days since start, a previous section (rotation) or null. */
export const DEMO_TRAINEES: [string, string, string, string, string, string, number, string | null][] = [
  ["Hira Batool", "MLT (Medical Lab Technology)", "Demo College of Allied Health Sciences", "Laboratory", "Haematology", "path1", 20, null],
  ["Adeel Anwar", "MLT (Medical Lab Technology)", "Demo College of Allied Health Sciences", "Laboratory", "Clinical Chemistry", "path1", 20, "Sample Collection"],
  ["Mariam Yousaf", "MLT (Medical Lab Technology)", "Demo College of Allied Health Sciences", "Laboratory", "Microbiology", "path1", 45, "Haematology"],
  ["Ahmed Nawaz", "Radiography / Medical Imaging Technology", "Demo Institute of Medical Imaging", "Radiology", "Ultrasound", "rad1", 30, null],
  ["Zainab Fatima", "Radiography / Medical Imaging Technology", "Demo Institute of Medical Imaging", "Radiology", "X-Ray", "rad1", 40, "Ultrasound"],
  ["Talha Rasheed", "Radiography / Medical Imaging Technology", "Demo Institute of Medical Imaging", "Radiology", "CT Scan", "rad1", 25, null],
  ["Noor ul Ain", "Radiography / Medical Imaging Technology", "Demo Institute of Medical Imaging", "Radiology", "MRI", "rad1", 25, "X-Ray"],
  ["Khadija Noor", "Nursing (BSN)", "Demo College of Nursing", "Nursing", "Medical Ward", "hn1", 15, null],
  ["Dr. Abdullah Khan", "House Officer (MBBS)", "Demo Medical College", "Medicine", "Ward", "hod1", 60, "OPD"],
];

const PREFIX = /^[a-z][a-z0-9]{1,11}$/;
const iso = () => new Date().toISOString();
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const pad = (n: number) => String(n).padStart(2, "0");

/** Creates the demo hospital; the result is the logins sheet. */
export async function createDemoHospital(sql: Sql, caller: Caller, input: DemoHospitalInput, today: string = pkToday()): Promise<DemoHospitalResult> {
  if (caller.role !== "super_admin" || caller.platformRole) throw new HttpError(403, "Only the Super Admin can create a demo hospital.");
  const hospitalName = typeof input.hospitalName === "string" ? input.hospitalName.trim().slice(0, 80) : "";
  if (hospitalName.length < 3) throw new HttpError(400, "Enter the demo hospital's name.");
  const prefix = typeof input.prefix === "string" ? input.prefix.trim().toLowerCase() : "";
  if (!PREFIX.test(prefix)) throw new HttpError(400, "The username prefix is 2 to 12 small letters or digits, starting with a letter (for example shifa).");
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < 6 || password.length > 64) throw new HttpError(400, "The demo password must be 6 to 64 characters.");
  const city = typeof input.city === "string" && input.city.trim() ? input.city.trim().slice(0, 40) : "Lahore";
  const planId = typeof input.planId === "string" ? input.planId : "";
  const plan = (await sql.execute(`SELECT id, allowed_modules, duration_days FROM subscription_plans WHERE id = ? AND deleted_at IS NULL`, [planId])).rows[0] as Row | undefined;
  if (!plan) throw new HttpError(400, "Choose the plan for the demo hospital.");

  const usernames = [`${prefix}.admin`, ...DEMO_STAFF.map(([s]) => `${prefix}.${s}`)];
  const taken = (await sql.execute(`SELECT username FROM users WHERE username IN (${usernames.map(() => "?").join(", ")})`, usernames)).rows as Row[];
  if (taken.length) throw new HttpError(409, `These usernames are already taken: ${taken.map((r) => String(r.username)).join(", ")}. Choose another prefix.`);

  const now = iso();
  const T = randomUUID();
  const stmts: { sql: string; args: unknown[] }[] = [];
  const push = (q: string, args: unknown[]) => stmts.push({ sql: q, args });

  // The business, on the chosen plan, with the Hospital type's sections.
  let planModules: string[] = [];
  try { const v = JSON.parse(String(plan.allowed_modules ?? "[]")); if (Array.isArray(v)) planModules = v.map(String); } catch { planModules = []; }
  const modules = defaultModulesFor(businessType("hospital"), planModules);
  const expires = new Date(Date.now() + Math.max(30, Number(plan.duration_days) || 30) * 86_400_000).toISOString();
  push(
    `INSERT INTO tenants (id, name, owner_name, phone, email, address, subscription_plan_id, subscription_status, subscription_started_at, subscription_expires_at, is_active, business_type, allowed_modules, fbr_allowed, print_templates_editable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'hospital', ?, 1, 1, ?, ?)`,
    [T, hospitalName, "Demo Administrator", "042-0000000", null, `Demo Road, ${city}`, String(plan.id), now, expires, JSON.stringify(modules), now, now],
  );
  push(
    `INSERT OR IGNORE INTO branches (id, tenant_id, code, name, is_main, status, address, phone, email, online_fulfillment, created_at, updated_at)
     SELECT ?, id, 'MAIN', 'Main Branch', 1, 'active', address, phone, email, 1, ?, ? FROM tenants WHERE id = ?`,
    [mainBranchId(T), now, now, T],
  );
  const setting = (key: string, value: string) => push(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`, [`${T}::${key}`, value, now]);
  setting("hospital.profile", JSON.stringify({ name: hospitalName, address: "Demo Road", city, phone: "042-0000000", registration_no: "DEMO-PHC-0001" }));

  // Departments.
  for (const [name, type] of DEMO_DEPARTMENTS) {
    const head = DEMO_STAFF.find(([, , , cat, dept]) => cat === "hod" && dept === name)?.[2] ?? null;
    push(`INSERT INTO hospital_departments (id, tenant_id, name, type, head, phone, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 'Demo department', 1, ?, ?)`,
      [randomUUID(), T, name, type, head, now, now]);
  }

  // The administrator (owner) login.
  const salt = () => randomBytes(16).toString("hex");
  const addUser = (username: string, role: "owner" | "staff", displayName: string, permissions: string[] | null) => {
    const id = randomUUID();
    const s = salt();
    push(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, permissions, denied_actions, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, NULL)`,
      [id, T, username, storedPasswordHash(password, s), s, role, displayName, permissions ? JSON.stringify(permissions) : null, now, now]);
    return id;
  };
  addUser(`${prefix}.admin`, "owner", "Demo Administrator", null);
  const logins: DemoLogin[] = [{ group: "Administrator", name: "Demo Administrator", designation: "Owner (full access)", department: "Administration", employeeId: null, username: `${prefix}.admin` }];

  // Staff, each with a login that opens exactly their designation's sections.
  const seq = new Map<string, number>();
  const staffIds = new Map<string, string>();
  const staffNames = new Map<string, string>();
  let licence = 1000;
  const joined = addDays(today, -365);
  DEMO_STAFF.forEach(([suffix, group, name, cat, dept, spec], i) => {
    const d = designation(cat);
    if (!d) throw new HttpError(500, `Unknown designation ${cat}.`);
    const n = (seq.get(d.prefix) ?? 0) + 1;
    seq.set(d.prefix, n);
    const employeeId = `${d.prefix}-${pad(n)}`;
    const username = `${prefix}.${suffix}`;
    const userId = addUser(username, "staff", name, d.pages);
    const staffId = randomUUID();
    staffIds.set(suffix, staffId);
    staffNames.set(suffix, name);
    const lic = d.license ? `DEMO-${d.license === "LICENSE" ? "LIC" : d.license}-${++licence}` : null;
    push(
      `INSERT INTO staff (id, tenant_id, name, designation, phone, cnic, address, opening_balance, balance_type, basic_pay, date_of_joining, employee_id, staff_category, license_type, license_no, department, specialization, consultation_fee, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 'payable', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [staffId, T, name, d.label, `0300-00000${pad(i + 1)}`, joined, employeeId, d.key, lic ? d.license : null, lic, dept, d.doctor ? spec : null, d.doctor ? (cat === "hod" ? 2500 : cat === "consultant" ? 2000 : 1000) : 0, userId, now, now],
    );
    logins.push({ group, name, designation: d.label, department: dept, employeeId, username });
  });
  for (const [p, n] of seq) setting(`hr.employee_seq.${p}`, String(n));

  // This week's duty roster (Monday to Sunday).
  const monday = mondayOf(today);
  const rosterDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  DEMO_STAFF.forEach(([suffix, , , cat, dept], i) => {
    weekShifts(cat, i).forEach((shift, d) => {
      push(`INSERT INTO hospital_duty_roster (id, tenant_id, staff_id, duty_date, shift, department, notes, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'Demo setup', ?, ?)`,
        [randomUUID(), T, staffIds.get(suffix), rosterDays[d], shift, dept, now, now]);
    });
  });

  // Trainees and interns, some with an earlier rotation.
  DEMO_TRAINEES.forEach(([name, program, institute, dept, section, sup, daysIn, earlier], i) => {
    const start = addDays(today, -daysIn);
    const placements = earlier
      ? [{ department: dept, section: earlier, supervisorId: staffIds.get(sup) ?? null, supervisorName: staffNames.get(sup) ?? null, from: start, to: addDays(start, Math.floor(daysIn / 2) - 1) },
        { department: dept, section, supervisorId: staffIds.get(sup) ?? null, supervisorName: staffNames.get(sup) ?? null, from: addDays(start, Math.floor(daysIn / 2)), to: null }]
      : [{ department: dept, section, supervisorId: staffIds.get(sup) ?? null, supervisorName: staffNames.get(sup) ?? null, from: start, to: null }];
    const data = {
      name, gender: /^(Hira|Mariam|Zainab|Noor|Khadija)/.test(name) ? "Female" : "Male", cnic: null, mobile: `0311-00000${pad(i + 1)}`,
      institute, program, rollNo: `DEMO-${pad(i + 1)}`, startDate: start, endDate: addDays(start, 180), notes: "Demo trainee", placements,
    };
    push(`INSERT INTO hospital_form_records (id, tenant_id, form_key, form_version, scope, department, status, data, summary, created_by, created_by_name, revision_no, created_at, updated_at)
          VALUES (?, ?, 'hr_trainee', 1, 'staff', ?, 'active', ?, ?, NULL, 'Demo setup', 0, ?, ?)`,
      [randomUUID(), T, dept, JSON.stringify(data), `${name} · ${program}`, now, now]);
  });

  // Everything in one transaction: the whole demo hospital, or nothing.
  await sql.batch(stmts);
  return { tenantId: T, hospitalName, password, logins, departments: DEMO_DEPARTMENTS.map(([n]) => n), trainees: DEMO_TRAINEES.length, rosterDays };
}
