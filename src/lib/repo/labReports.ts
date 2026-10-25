/** Central laboratory reports: one record per patient lab order (a "request")
 * for the hospital lab counter, hospital departments and every collection
 * center of the hospital. All of them register into, and search / print from,
 * the same records, under explicit permissions.
 *
 * Identifiers (both unique per hospital, enforced by the database):
 *   Unique Lab Number   LN26-000123-7   one per request, printed on the report
 *   Lab Invoice Number  LI26-000123-4   the request's bill reference
 * The last digit is a check digit, so a mistyped number is recognised as invalid.
 *
 * Clinical gate: a result entered by the lab waits for verification; only a
 * result verified by a pathologist (or HoD / full-access login) is released
 * and printed as an official report. */
import { dbExecute, dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import { useAuthStore } from "../../store/authStore";
import { localDateTime } from "../localDate";
import { staffRepo } from "./staff";
import { hospitalLabRepo, hospitalPatientsRepo, hospitalEpisodesRepo } from "./hospital";
import { getSetting } from "./settings";
import { hasPermission } from "../moduleAccess";
import { LAB_PROCESS_ROLES, LAB_REGISTER_ROLES, LAB_VERIFY_ROLES } from "../../config/hospitalStaff";
import type { Staff } from "../types";
import { parseComponents } from "../../config/labPanels";
import type { CollectionCenter, HospitalLabOrder, HospitalPatient, LabComponent, LabRequest, RegistrationLocation } from "../types-hospital";

export const labRequestsRepo = createTenantRepo<LabRequest>("hospital_lab_requests", {
  refs: [["patient_id", "hospital_patients", "Patient"]],
});
export const collectionCentersRepo = createTenantRepo<CollectionCenter>("hospital_collection_centers");

// ── Who is acting ─────────────────────────────────────────────────────────

async function currentStaff(): Promise<Staff | null> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return null;
  return (await staffRepo.list({ where: "user_id = ?", params: [userId] }))[0] ?? null;
}

export interface LabCapabilities {
  register: boolean;
  process: boolean;
  verify: boolean;
  search: boolean;
  /** The collection center this user works at, or null for the hospital. */
  centerId: string | null;
  userName: string;
}

/** What the signed-in user may do in the lab. Owners and full-access logins
 * may do everything; staff follow their designation and page permissions. */
export async function labCapabilities(): Promise<LabCapabilities> {
  const { currentUser } = useAuthStore.getState();
  requireCurrentTenantId();
  const staff = await currentStaff();
  const userName = staff?.name ?? currentUser?.displayName ?? currentUser?.username ?? "User";
  const full = !currentUser || currentUser.role !== "staff" || currentUser.permissions === null;
  if (full) return { register: true, process: true, verify: true, search: true, centerId: staff?.collection_center_id ?? null, userName };
  const cat = staff?.staff_category ?? "";
  const perms = currentUser.permissions ?? [];
  return {
    register: LAB_REGISTER_ROLES.includes(cat),
    process: LAB_PROCESS_ROLES.includes(cat),
    verify: LAB_VERIFY_ROLES.includes(cat),
    search: hasPermission(perms, "hospital_lab_reports"),
    centerId: staff?.collection_center_id ?? null,
    userName,
  };
}

async function need(what: keyof Omit<LabCapabilities, "centerId" | "userName">, message: string): Promise<LabCapabilities> {
  const caps = await labCapabilities();
  if (!caps[what]) throw new Error(message);
  return caps;
}

// ── Numbers ───────────────────────────────────────────────────────────────

/** Luhn check digit over the digits of `body`. */
export function checkDigit(body: string): number {
  const digits = body.replace(/\D/g, "").split("").map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[digits.length - 1 - i];
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function formatLabNumber(prefix: "LN" | "LI", year: number, seq: number): string {
  const body = `${String(year % 100).padStart(2, "0")}-${String(seq).padStart(6, "0")}`;
  return `${prefix}${body}-${checkDigit(body)}`;
}

/** Whether `value` is a well-formed number of this kind (right shape and check digit). */
export function isValidLabNumber(prefix: "LN" | "LI", value: string): boolean {
  const m = new RegExp(`^${prefix}(\\d{2}-\\d{6})-(\\d)$`).exec(value.trim().toUpperCase());
  return Boolean(m) && checkDigit(m![1]) === Number(m![2]);
}

async function nextNumber(prefix: "LN" | "LI", column: "lab_no" | "invoice_no"): Promise<string> {
  const year = new Date().getFullYear();
  const like = `${prefix}${String(year % 100).padStart(2, "0")}-%`;
  const rows = await dbSelect<{ v: string }>(
    `SELECT ${column} AS v FROM hospital_lab_requests WHERE tenant_id = ? AND ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`,
    [requireCurrentTenantId(), like]
  );
  const last = rows[0]?.v ? Number(rows[0].v.slice(5, 11)) : 0;
  return formatLabNumber(prefix, year, last + 1);
}

// ── Collection centers ────────────────────────────────────────────────────

export async function listCollectionCenters(opts: { includeInactive?: boolean } = {}): Promise<CollectionCenter[]> {
  const all = await collectionCentersRepo.list({ orderBy: "name ASC" });
  return opts.includeInactive ? all : all.filter((c) => c.is_active);
}

export async function saveCollectionCenter(id: string | null, c: { code: string; name: string; address?: string | null; phone?: string | null; is_active?: number }): Promise<CollectionCenter> {
  const name = c.name?.trim();
  const code = c.code?.trim().toUpperCase();
  if (!name) throw new Error("Enter the collection center's name.");
  if (!code) throw new Error("Enter a short code, e.g. CC-A.");
  const payload = { code, name, address: c.address?.trim() || null, phone: c.phone?.trim() || null, is_active: c.is_active ?? 1 };
  const saved = id ? await collectionCentersRepo.update(id, payload) : await collectionCentersRepo.create(payload);
  if (!saved) throw new Error("Collection center not found.");
  return saved;
}

// ── Registration ──────────────────────────────────────────────────────────

/** Opens a lab request with a new Unique Lab Number and Lab Invoice Number.
 * Where it was registered follows the user's workplace unless given. The
 * numbers are unique in the database; a clash (two counters at once) retries. */
export async function createLabRequest(input: {
  patientId: string;
  episodeId: string | null;
  referringDoctor?: string | null;
  location?: RegistrationLocation;
  collectionCenterId?: string | null;
  externalRef?: string | null;
  sampleCollected?: boolean;
}): Promise<LabRequest> {
  const caps = await labCapabilities();
  const patient = await hospitalPatientsRepo.get(input.patientId);
  if (!patient) throw new Error("Patient not found in this hospital.");
  const centerId = input.collectionCenterId ?? (input.location === undefined ? caps.centerId : null);
  if (centerId) {
    const center = await collectionCentersRepo.get(centerId);
    if (!center || !center.is_active) throw new Error("That collection center is not active.");
  }
  const location: RegistrationLocation = input.location ?? (centerId ? "collection_center" : "hospital_lab");
  const userId = useAuthStore.getState().currentUser?.id ?? null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await labRequestsRepo.create({
        lab_no: await nextNumber("LN", "lab_no"),
        invoice_no: await nextNumber("LI", "invoice_no"),
        episode_id: input.episodeId,
        patient_id: patient.id,
        referring_doctor: input.referringDoctor?.trim() || null,
        registration_location: location,
        collection_center_id: location === "collection_center" ? centerId : null,
        external_ref: input.externalRef?.trim() || null,
        registered_by: userId,
        sample_collected_at: input.sampleCollected ? localDateTime() : null,
        sample_received_at: null,
        print_count: 0,
        last_printed_at: null,
        notes: null,
      });
    } catch (e) {
      lastError = e;
      if (!/already in use|UNIQUE/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  throw lastError;
}

// ── Lab workflow (permission-checked) ─────────────────────────────────────

async function labOrder(orderId: string): Promise<HospitalLabOrder> {
  const o = await hospitalLabRepo.get(orderId);
  if (!o) throw new Error("Test not found in this hospital.");
  return o;
}

/** The lab receives the samples of a request: its tests move to "Sample Received". */
export async function receiveSample(requestId: string): Promise<void> {
  await need("process", "Only lab staff can receive samples.");
  const req = await labRequestsRepo.get(requestId);
  if (!req) throw new Error("Lab order not found.");
  const tests = await hospitalLabRepo.list({ where: "request_id = ? AND status = 'pending'", params: [requestId] });
  for (const t of tests) await hospitalLabRepo.update(t.id, { status: "collected" });
  const now = localDateTime();
  await labRequestsRepo.update(requestId, { sample_received_at: now, sample_collected_at: req.sample_collected_at ?? now });
}

/** Lab staff enter a result. It is not released: it waits for verification. */
export interface LabResultInput {
  result_value: string;
  unit: string | null;
  ref_range: string | null;
  flag: "N" | "H" | "L";
  /** A panel test (CBC): one entry per parameter. The overall flag is worked
   * out from them. */
  components?: LabComponent[] | null;
}

export async function enterLabResult(orderId: string, r: LabResultInput): Promise<void> {
  await need("process", "Only lab staff can enter results.");
  const o = await labOrder(orderId);
  if (Number(o.fee) > 0 && Number(o.paid) !== 1) throw new Error("The fee for this test is not paid yet. Reception must take the fee first.");
  if (o.status === "reported") throw new Error("This result is already verified and released. Ask a pathologist to return it for correction.");
  if (o.status === "cancelled" || o.status === "superseded") throw new Error("This test is cancelled.");
  const parts = r.components ? r.components.filter((c) => String(c.value ?? "").trim()) : null;
  if (parts && !parts.length) throw new Error("Enter at least one parameter.");
  if (!parts && !r.result_value?.trim()) throw new Error("Enter the result.");
  const result = parts
    ? {
        components: JSON.stringify(parts.map((c) => ({ ...c, value: String(c.value).trim() }))),
        result_value: r.result_value?.trim() || `${parts.length} parameters`,
        unit: null,
        ref_range: null,
        flag: (parts.some((c) => c.flag === "H") ? "H" : parts.some((c) => c.flag === "L") ? "L" : "N") as "N" | "H" | "L",
      }
    : { components: null, result_value: r.result_value.trim(), unit: r.unit, ref_range: r.ref_range, flag: r.flag };
  await hospitalLabRepo.update(orderId, {
    ...result,
    status: "awaiting_verification", result_entered_by: useAuthStore.getState().currentUser?.id ?? null, result_entered_at: localDateTime(),
  });
  if (o.request_id) {
    const req = await labRequestsRepo.get(o.request_id);
    if (req && !req.sample_received_at) await labRequestsRepo.update(req.id, { sample_received_at: localDateTime() });
  }
}

/** A pathologist (or HoD / full-access login) verifies and releases a result. */
export async function verifyLabResult(orderId: string): Promise<void> {
  const caps = await need("verify", "Only a pathologist can verify and release results.");
  const o = await labOrder(orderId);
  if (o.status !== "awaiting_verification") throw new Error("There is no entered result waiting for verification on this test.");
  const staff = await currentStaff();
  const license = staff?.license_no ? `${staff.license_type ?? ""} ${staff.license_no}`.trim() : null;
  const now = localDateTime();
  await hospitalLabRepo.update(orderId, {
    status: "reported", reported_at: now, verified_at: now,
    verified_by: useAuthStore.getState().currentUser?.id ?? null, verified_by_name: staff?.name ?? caps.userName, verified_by_license: license,
  });
}

/** A verifier sends a result back to the lab to be corrected (not released). */
export async function returnLabResult(orderId: string, reason: string): Promise<void> {
  await need("verify", "Only a pathologist can return a result for correction.");
  const o = await labOrder(orderId);
  if (o.status !== "awaiting_verification" && o.status !== "reported") throw new Error("This test has no result to return.");
  if (!reason.trim()) throw new Error("Say why the result is returned.");
  await hospitalLabRepo.update(orderId, {
    status: "collected", verified_at: null, verified_by: null, verified_by_name: null, verified_by_license: null,
    notes: [o.notes, `Returned for correction: ${reason.trim()} (${localDateTime()})`].filter(Boolean).join("\n"),
  });
}

export async function cancelLabTest(orderId: string, reason: string): Promise<void> {
  await need("process", "Only lab staff can cancel a test.");
  const o = await labOrder(orderId);
  if (o.status === "reported") throw new Error("A released result cannot be cancelled.");
  if (!reason.trim()) throw new Error("Say why the test is cancelled.");
  await hospitalLabRepo.update(orderId, { status: "cancelled", notes: [o.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") });
}

// ── Statuses ──────────────────────────────────────────────────────────────

export function testStatusLabel(t: Pick<HospitalLabOrder, "status" | "fee" | "paid">): string {
  switch (t.status) {
    case "pending":
      return Number(t.fee) > 0 && Number(t.paid) !== 1 ? "Registered (fee unpaid)" : "Sample Awaited";
    case "collected": return "Sample Received";
    case "processing": return "Processing";
    case "awaiting_verification": return "Awaiting Verification";
    case "reported": return "Authorized";
    case "cancelled": return "Cancelled";
    case "superseded": return "Superseded";
    default: return t.status;
  }
}

const STAGE: Record<string, number> = { pending: 0, collected: 1, processing: 2, awaiting_verification: 3, reported: 4 };

/** Status of the whole order from its tests. */
export function requestStatusLabel(tests: Pick<HospitalLabOrder, "status" | "fee" | "paid">[], printCount = 0): string {
  const live = tests.filter((t) => t.status !== "cancelled" && t.status !== "superseded");
  if (!tests.length) return "Registered";
  if (!live.length) return tests.some((t) => t.status === "superseded") ? "Superseded" : "Cancelled";
  const done = live.filter((t) => t.status === "reported").length;
  if (done === live.length) return printCount > 1 ? "Reprinted" : printCount === 1 ? "Printed" : "Authorized";
  if (done > 0) return `Partially Authorized (${done} of ${live.length})`;
  const least = live.reduce((m, t) => Math.min(m, STAGE[t.status] ?? 0), 9);
  const lowest = live.find((t) => (STAGE[t.status] ?? 0) === least)!;
  return testStatusLabel(lowest);
}

export function locationLabel(r: Pick<LabRequest, "registration_location">, centerName: string | null, department: string | null): string {
  switch (r.registration_location) {
    case "collection_center": return centerName ? `Collection center: ${centerName}` : "Collection center";
    case "department": return department ? `Hospital department: ${department}` : "Hospital department";
    case "referral": return "Referring facility";
    default: return "Hospital lab counter";
  }
}

// ── Search ────────────────────────────────────────────────────────────────

export type SearchMode = "auto" | "invoice" | "lab_no" | "order_no" | "mrn" | "name_phone" | "external_ref";

export interface ReportSearchRow {
  request: LabRequest;
  patientName: string;
  mrNo: string;
  phone: string | null;
  centerName: string | null;
  location: string;
  tests: { id: string; order_no: string; test_name: string; status: string; label: string; verified_at: string | null }[];
  status: string;
  authorized: number;
  pending: number;
  reportDate: string | null;
  printable: boolean;
}

export interface SearchResult {
  rows: ReportSearchRow[];
  /** A clear message when nothing was found or the input is not a valid number. */
  message: string | null;
}

function detectMode(q: string): Exclude<SearchMode, "auto"> {
  const u = q.toUpperCase();
  if (u.startsWith("LI")) return "invoice";
  if (u.startsWith("LN")) return "lab_no";
  if (u.startsWith("LAB-")) return "order_no";
  if (u.startsWith("MR-")) return "mrn";
  return "name_phone";
}

/** Finds lab orders by Lab Invoice Number, Unique Lab Number, order number,
 * MRN, external reference or (partially) patient name / phone. Identifiers must
 * match exactly. Results do not depend on where the order was registered. */
export async function searchLabReports(query: string, mode: SearchMode = "auto"): Promise<SearchResult> {
  await need("search", "You do not have permission to search lab reports.");
  const tenantId = requireCurrentTenantId();
  const q = query.trim();
  if (!q) return { rows: [], message: "Enter a Lab Invoice Number, Unique Lab Number, order number, MRN or the patient's name / phone." };
  const m = mode === "auto" ? detectMode(q) : mode;
  const U = q.toUpperCase();

  let where = "";
  let params: unknown[] = [];
  switch (m) {
    case "invoice":
      where = "UPPER(r.invoice_no) = ?";
      params = [U];
      break;
    case "lab_no":
      where = "UPPER(r.lab_no) = ?";
      params = [U];
      break;
    case "order_no":
      where = "r.id IN (SELECT request_id FROM hospital_lab_orders WHERE tenant_id = ? AND UPPER(order_no) = ?)";
      params = [tenantId, U];
      break;
    case "mrn":
      where = "UPPER(p.mr_no) = ?";
      params = [U];
      break;
    case "external_ref":
      where = "UPPER(r.external_ref) = ?";
      params = [U];
      break;
    case "name_phone": {
      if (q.replace(/\s/g, "").length < 3) return { rows: [], message: "Type at least 3 letters or digits of the patient's name or phone." };
      where = "(p.name LIKE ? OR p.phone LIKE ?)";
      params = [`%${q}%`, `%${q}%`];
      break;
    }
  }

  const requests = await dbSelect<LabRequest & { patient_name: string; mr_no: string; phone: string | null; center_name: string | null; department: string | null }>(
    `SELECT r.*, p.name AS patient_name, p.mr_no, p.phone, c.name AS center_name, e.department
     FROM hospital_lab_requests r
     JOIN hospital_patients p ON p.id = r.patient_id
     LEFT JOIN hospital_collection_centers c ON c.id = r.collection_center_id
     LEFT JOIN hospital_episodes e ON e.id = r.episode_id
     WHERE r.tenant_id = ? AND r.deleted_at IS NULL AND ${where}
     ORDER BY r.created_at DESC LIMIT 25`,
    [tenantId, ...params]
  );

  if (!requests.length) {
    if (m === "invoice" && !isValidLabNumber("LI", q) && !q.toUpperCase().startsWith("LI-")) return { rows: [], message: `"${q}" is not a valid Lab Invoice Number (they look like LI26-000123-4).` };
    if (m === "lab_no" && !isValidLabNumber("LN", q) && !q.toUpperCase().startsWith("LN-")) return { rows: [], message: `"${q}" is not a valid Unique Lab Number (they look like LN26-000123-7).` };
    return { rows: [], message: "No lab order found. Check the number and try again." };
  }

  const rows: ReportSearchRow[] = [];
  for (const r of requests) {
    const tests = await hospitalLabRepo.list({ where: "request_id = ?", params: [r.id], orderBy: "created_at ASC" });
    const live = tests.filter((t) => t.status !== "cancelled" && t.status !== "superseded");
    const authorized = live.filter((t) => t.status === "reported");
    const { patient_name, mr_no, phone, center_name, department, ...request } = r;
    rows.push({
      request: request as LabRequest,
      patientName: patient_name,
      mrNo: mr_no,
      phone,
      centerName: center_name,
      location: locationLabel(r, center_name, department),
      tests: tests.map((t) => ({ id: t.id, order_no: t.order_no, test_name: t.test_name, status: t.status, label: testStatusLabel(t), verified_at: t.verified_at ?? null })),
      status: requestStatusLabel(tests, r.print_count),
      authorized: authorized.length,
      pending: live.length - authorized.length,
      reportDate: authorized.map((t) => t.verified_at ?? t.reported_at ?? "").sort().pop() || null,
      printable: authorized.length > 0,
    });
  }
  return { rows, message: null };
}

// ── The report ────────────────────────────────────────────────────────────

export interface LabReport {
  request: LabRequest;
  hospital: { name: string; address: string | null; phone: string | null; registration: string | null };
  patient: { name: string; mrNo: string; gender: string | null; age: string | null; phone: string | null };
  referringDoctor: string | null;
  centerName: string | null;
  location: string;
  tests: {
    id: string; order_no: string; test_name: string; sample_type: string | null; result_value: string | null; unit: string | null;
    ref_range: string | null; flag: string | null; verified_by_name: string | null; verified_by_license: string | null; verified_at: string | null;
    /** Parameters of a panel test (CBC); empty for a single-value test. */
    components: LabComponent[];
  }[];
  pendingTests: { order_no: string; test_name: string; label: string }[];
  reportDate: string | null;
  verificationCode: string;
  status: string;
  /** Token of the online copy (QR code); null while nothing is verified. */
  publicToken: string | null;
}

function hashCode(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

async function logAction(requestId: string, action: "view" | "print" | "reprint", details: string | null): Promise<void> {
  const caps = await labCapabilities();
  const ts = nowIso();
  await dbExecute(
    `INSERT INTO hospital_lab_report_log (id, tenant_id, request_id, action, user_id, user_name, location_id, details, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), requireCurrentTenantId(), requestId, action, useAuthStore.getState().currentUser?.id ?? null, caps.userName, caps.centerId, details, ts, ts]
  );
}

/** Opens a report for viewing / printing. Requires the search permission and a
 * confirmed patient identity check; the view is logged. Only verified results
 * are included; tests still in progress are listed as pending, without values.
 * The first time a report has a verified result it gets the token of its
 * online copy (QR code). */
export async function getLabReport(requestId: string, identity: { checked: boolean; method?: string }): Promise<LabReport> {
  await need("search", "You do not have permission to open lab reports.");
  if (!identity.checked) throw new Error("Confirm the patient's identity (CNIC, phone or MR number) before opening the report.");
  const req = await labRequestsRepo.get(requestId);
  if (!req) throw new Error("Lab order not found.");
  const report = await assembleReport(requireCurrentTenantId(), req, useAuthStore.getState().currentTenant?.name ?? "Hospital");
  if (report.tests.length && !req.public_token) {
    const token = newReportToken();
    await labRequestsRepo.update(req.id, { public_token: token });
    report.publicToken = token;
    report.request = { ...report.request, public_token: token };
  }
  await logAction(requestId, "view", identity.method ? `Identity checked by ${identity.method}` : "Identity checked");
  return report;
}

/** 128 random bits as hex: the QR link cannot be worked out from the lab number. */
export function newReportToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The online copy behind the report QR code. Needs no login: the random token
 * is the key. Shows the verified results only, as on the printed report, and
 * logs the view. */
export async function getPublicLabReport(token: string): Promise<LabReport> {
  const t = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(t)) throw new Error("This report link is not valid.");
  const req = (await dbSelect<LabRequest>(`SELECT * FROM hospital_lab_requests WHERE public_token = ? AND deleted_at IS NULL`, [t]))[0];
  if (!req) throw new Error("Report not found. It may have been withdrawn by the laboratory.");
  const tenant = (await dbSelect<{ name: string }>(`SELECT name FROM tenants WHERE id = ?`, [req.tenant_id]))[0];
  const report = await assembleReport(req.tenant_id, req, tenant?.name ?? "Hospital");
  if (!report.tests.length) throw new Error("No verified result on this report yet.");
  const ts = nowIso();
  await dbExecute(
    `INSERT INTO hospital_lab_report_log (id, tenant_id, request_id, action, user_id, user_name, location_id, details, created_at, updated_at)
     VALUES (?, ?, ?, 'view', NULL, 'Online (QR code)', NULL, 'Opened from the report QR code', ?, ?)`,
    [newId(), req.tenant_id, req.id, ts, ts]
  );
  return report;
}

/** Builds the report of a request of hospital `tenantId` with plain queries,
 * so the online copy works without a signed-in user. */
async function assembleReport(tenantId: string, req: LabRequest, tenantName: string): Promise<LabReport> {
  const one = async <T>(sql: string, params: unknown[]): Promise<T | null> => (await dbSelect<T>(sql, params))[0] ?? null;
  const patient = await one<HospitalPatient>(`SELECT * FROM hospital_patients WHERE id = ? AND tenant_id = ?`, [req.patient_id, tenantId]);
  const center = req.collection_center_id
    ? await one<CollectionCenter>(`SELECT * FROM hospital_collection_centers WHERE id = ? AND tenant_id = ?`, [req.collection_center_id, tenantId])
    : null;
  const ep = req.episode_id
    ? await one<{ department: string | null; doctor_id: string | null }>(`SELECT department, doctor_id FROM hospital_episodes WHERE id = ? AND tenant_id = ?`, [req.episode_id, tenantId])
    : null;
  const doctorName = req.referring_doctor
    ?? (ep?.doctor_id ? (await one<{ name: string }>(`SELECT name FROM staff WHERE id = ? AND tenant_id = ?`, [ep.doctor_id, tenantId]))?.name ?? null : null);
  const tests = await dbSelect<HospitalLabOrder>(
    `SELECT * FROM hospital_lab_orders WHERE tenant_id = ? AND request_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
    [tenantId, req.id]
  );
  const released = tests.filter((t) => t.status === "reported");
  const pending = tests.filter((t) => t.status !== "reported" && t.status !== "cancelled" && t.status !== "superseded");

  let profile: { name?: string; address?: string; phone?: string; registration_no?: string; city?: string } = {};
  try {
    profile = JSON.parse((await getSetting("hospital.profile", tenantId)) ?? "{}");
  } catch {
    profile = {};
  }
  const reportDate = released.map((t) => t.verified_at ?? t.reported_at ?? "").sort().pop() || null;

  return {
    request: req,
    hospital: {
      name: profile.name || tenantName,
      address: [profile.address, profile.city].filter(Boolean).join(", ") || null,
      phone: profile.phone || null,
      registration: profile.registration_no || null,
    },
    patient: {
      name: patient?.name ?? "—",
      mrNo: patient?.mr_no ?? "—",
      gender: patient?.gender ?? null,
      age: patient?.age_years != null ? `${patient.age_years} y` : patient?.dob ?? null,
      phone: patient?.phone ?? null,
    },
    referringDoctor: doctorName,
    centerName: center?.name ?? null,
    location: locationLabel(req, center?.name ?? null, ep?.department ?? null),
    tests: released.map((t) => ({
      id: t.id, order_no: t.order_no, test_name: t.test_name, sample_type: t.sample_type ?? null, result_value: t.result_value, unit: t.unit,
      ref_range: t.ref_range, flag: t.flag, verified_by_name: t.verified_by_name ?? null, verified_by_license: t.verified_by_license ?? null, verified_at: t.verified_at ?? null,
      components: parseComponents(t.components),
    })),
    pendingTests: pending.map((t) => ({ order_no: t.order_no, test_name: t.test_name, label: testStatusLabel(t) })),
    reportDate,
    verificationCode: `${req.lab_no}/${hashCode(`${req.lab_no}|${released.map((t) => `${t.id}:${t.verified_at}`).join(",")}`)}`,
    status: requestStatusLabel(tests, req.print_count),
    publicToken: released.length ? req.public_token ?? null : null,
  };
}

/** Records that the report was printed (or reprinted). Refused when no result
 * of the order is verified: an unverified report is never an official copy. */
export async function recordReportPrint(requestId: string): Promise<{ printCount: number; reprint: boolean }> {
  await need("search", "You do not have permission to print lab reports.");
  const req = await labRequestsRepo.get(requestId);
  if (!req) throw new Error("Lab order not found.");
  const released = await hospitalLabRepo.list({ where: "request_id = ? AND status = 'reported'", params: [requestId] });
  if (!released.length) throw new Error("No result of this order is verified yet, so it cannot be printed as a report.");
  const reprint = req.print_count > 0;
  const count = req.print_count + 1;
  await labRequestsRepo.update(requestId, { print_count: count, last_printed_at: localDateTime() });
  await logAction(requestId, reprint ? "reprint" : "print", `Copy ${count}; ${released.length} verified test(s)`);
  return { printCount: count, reprint };
}

export interface ReportLogRow {
  action: string;
  user_name: string | null;
  location_id: string | null;
  details: string | null;
  created_at: string;
}

/** Who viewed / printed a report, newest first. */
export async function listReportLog(requestId: string): Promise<ReportLogRow[]> {
  await need("search", "You do not have permission to see this.");
  return dbSelect<ReportLogRow>(
    `SELECT action, user_name, location_id, details, created_at FROM hospital_lab_report_log
     WHERE tenant_id = ? AND request_id = ? ORDER BY created_at DESC`,
    [requireCurrentTenantId(), requestId]
  );
}

// ── Lab worklist (lab staff) ──────────────────────────────────────────────

export type WorklistView = "active" | "verify" | "done" | "all";

export interface WorklistRow {
  request: LabRequest;
  patientName: string;
  mrNo: string;
  location: string;
  status: string;
  tests: HospitalLabOrder[];
}

/** Lab orders for the lab's own screen, newest first. Lab staff see entered
 * results here; the report search shows receptionists statuses only. */
export async function listLabWorklist(view: WorklistView = "active", limit = 100): Promise<WorklistRow[]> {
  const caps = await labCapabilities();
  if (!caps.register && !caps.process && !caps.verify) throw new Error("You do not have permission to open the lab orders.");
  const t = requireCurrentTenantId();
  const filter =
    view === "verify" ? "AND EXISTS (SELECT 1 FROM hospital_lab_orders o WHERE o.request_id = r.id AND o.status = 'awaiting_verification')"
    : view === "active" ? "AND EXISTS (SELECT 1 FROM hospital_lab_orders o WHERE o.request_id = r.id AND o.status IN ('pending', 'collected', 'processing', 'awaiting_verification'))"
    : view === "done" ? "AND NOT EXISTS (SELECT 1 FROM hospital_lab_orders o WHERE o.request_id = r.id AND o.status IN ('pending', 'collected', 'processing', 'awaiting_verification'))"
    : "";
  const reqs = await dbSelect<LabRequest & { patient_name: string; mr_no: string; center_name: string | null; department: string | null }>(
    `SELECT r.*, p.name AS patient_name, p.mr_no, c.name AS center_name, e.department
     FROM hospital_lab_requests r
     JOIN hospital_patients p ON p.id = r.patient_id
     LEFT JOIN hospital_collection_centers c ON c.id = r.collection_center_id
     LEFT JOIN hospital_episodes e ON e.id = r.episode_id
     WHERE r.tenant_id = ? AND r.deleted_at IS NULL ${filter}
     ORDER BY r.created_at DESC LIMIT ?`,
    [t, limit]
  );
  const out: WorklistRow[] = [];
  for (const r of reqs) {
    const tests = await hospitalLabRepo.list({ where: "request_id = ?", params: [r.id], orderBy: "created_at ASC" });
    const { patient_name, mr_no, center_name, department, ...request } = r;
    out.push({ request: request as LabRequest, patientName: patient_name, mrNo: mr_no, location: locationLabel(r, center_name, department), status: requestStatusLabel(tests, r.print_count), tests });
  }
  return out;
}
