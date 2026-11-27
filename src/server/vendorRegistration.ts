/** eProcurement vendor registration (schema v111), at ep.mavin.pk.
 *
 * A vendor makes their own account on the vendor portal's sign-in page
 * (signUp), then fills four steps: 1) company, owner and business type (supplier,
 * services or both, and the kinds of work); 2) address; 3) bank details;
 * 4) a review with a statement that everything is correct, and submits. The
 * registration goes to the Super Admin (Super Admin > eProcurement), who
 * approves it, rejects it, asks for changes, suspends or blacklists the vendor.
 *
 * Only approved vendors appear in the directory hospitals add vendors from,
 * and only they reach quote requests, orders and payments. Hospitals never
 * create vendor logins or set vendor passwords: the vendor changes their own
 * password in the portal, or by an emailed code (Forgot password), and the
 * Super Admin can set one as a last resort.
 *
 * Vendor accounts made by hospitals before v111 stay approved; the vendor
 * completes the missing details at the next sign-in (no new review).
 *
 * ep_* tables are server-only (never through /api/db). */
import { randomBytes, randomUUID } from "node:crypto";
import { HttpError, storedPasswordHash } from "./db";
import { normalizeEmail } from "./recovery";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import {
  allProblems, BUSINESS_KIND_LABEL, cleanProfile, emptyProfile, parseProfile, profileComplete, stepProblems, VENDOR_STATUS_LABEL,
  type BusinessKind, type EpCategory, type ProfileStep, type VendorProfile, type VendorStatus,
} from "../lib/vendorProfile";
import { PHONE } from "../lib/vendorProfile";

export {
  allProblems, BUSINESS_KIND_LABEL, cleanProfile, emptyProfile, parseProfile, profileComplete, stepProblems, VENDOR_STATUS_LABEL,
  type BusinessKind, type EpCategory, type ProfileStep, type VendorProfile, type VendorStatus,
};

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const now = () => new Date().toISOString();
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const MIN_PASSWORD = 8;
/** New accounts from one address in a day (stops a script filling the review queue). */
export const SIGNUPS_PER_IP_PER_DAY = 5;



async function nextEpCode(sql: Pick<Sql, "execute">): Promise<string> {
  const r = (await sql.execute(`SELECT MAX(CAST(substr(vendor_code, 4) AS INTEGER)) AS n FROM ep_vendors WHERE vendor_code GLOB 'EP-[0-9]*'`)).rows[0];
  return `EP-${String(num(r?.n) + 1).padStart(4, "0")}`;
}

// ── Sign-up (no sign-in) ────────────────────────────────────────────────────

/** A vendor makes their own portal account; the registration steps follow at sign-in. */
export async function signUp(sql: Sql, b: Record<string, unknown>, ip: string | null, at: Date = new Date()): Promise<{ ok: true; username: string }> {
  const companyName = text(b.companyName, 200);
  const contactName = text(b.contactName, 120);
  const phone = text(b.phone, 30);
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (companyName.length < 2) throw new HttpError(400, "Enter your company name.");
  if (contactName.length < 2) throw new HttpError(400, "Enter your name.");
  const email = normalizeEmail(b.email);
  if (!email) throw new HttpError(400, "Enter your email: the password reset code is sent there.");
  if (!PHONE.test(phone)) throw new HttpError(400, "Enter your mobile number.");
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) throw new HttpError(400, "Username: at least 3 letters or digits (. _ - @ allowed, no spaces).");
  if (password.length < MIN_PASSWORD || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new HttpError(400, `Password: at least ${MIN_PASSWORD} characters with letters and numbers.`);
  if (ip) {
    const since = new Date(at.getTime() - 86_400_000).toISOString();
    const n = num((await sql.execute(`SELECT COUNT(*) AS n FROM ep_vendors WHERE signup_ip = ? AND created_at >= ?`, [ip, since])).rows[0]?.n);
    if (n >= SIGNUPS_PER_IP_PER_DAY) throw new HttpError(429, "Too many new accounts from this connection today. Try again tomorrow or contact MAVIN.pk.");
  }
  if ((await sql.execute(`SELECT 1 FROM users WHERE username = ? AND deleted_at IS NULL`, [username])).rows[0]) throw new HttpError(409, `Username "${username}" is already taken.`);
  if ((await sql.execute(`SELECT 1 FROM ep_vendors WHERE lower(email) = ? AND deleted_at IS NULL`, [email])).rows[0]) {
    throw new HttpError(409, "A vendor account with this email already exists. Sign in, or use Forgot password.");
  }
  const userId = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const t = at.toISOString();
  const profile = emptyProfile();
  profile.company.name = companyName;
  profile.company.email = email;
  profile.company.phone = phone;
  profile.owner.name = contactName;
  profile.owner.mobile = phone;
  profile.owner.email = email;
  // A vendor login has no business (platform_role 'vendor'): the server lets it reach the vendor portal only.
  await sql.batch([
    {
      sql: `INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, email, is_active, permissions, platform_role, created_at, updated_at, deleted_at)
            VALUES (?, NULL, ?, ?, ?, 'staff', ?, ?, 1, '[]', 'vendor', ?, ?, NULL)`,
      args: [userId, username, storedPasswordHash(password, salt), salt, contactName, email, t, t],
    },
    {
      sql: `INSERT INTO ep_vendors (id, vendor_code, user_id, name, email, phone, status, profile, self_registered, signup_ip, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?)`,
      args: [randomUUID(), await nextEpCode(sql), userId, companyName, email, phone, JSON.stringify(profile), ip, t, t],
    },
  ]);
  return { ok: true, username };
}

// ── The vendor's own registration (signed in, any status) ───────────────────

export interface VendorAccount {
  epVendorId: string; vendorCode: string; status: VendorStatus; statusLabel: string; reviewNote: string | null; submittedAt: string | null;
  profile: VendorProfile; complete: boolean; username: string; email: string | null; hospitals: string[];
  /** The steps are open for editing (a new or returned registration, or an earlier account completing its details). */
  editable: boolean;
}

/** The vendor's ep_vendors row; an account made before v110 gets one now (approved, from its first hospital's supplier). */
async function epRowFor(sql: Sql, userId: string): Promise<Record<string, unknown>> {
  const u = (await sql.execute(`SELECT id, username, email FROM users WHERE id = ? AND deleted_at IS NULL AND is_active = 1 AND platform_role = 'vendor'`, [userId])).rows[0];
  if (!u) throw new HttpError(403, "The vendor portal is for vendor logins.");
  const row = (await sql.execute(`SELECT * FROM ep_vendors WHERE user_id = ? AND deleted_at IS NULL`, [userId])).rows[0];
  if (row) return row;
  const s = (await sql.execute(
    `SELECT s.name, s.email, s.phone, s.address, l.tenant_id FROM vendor_portal_logins l JOIN suppliers s ON s.id = l.vendor_id AND s.tenant_id = l.tenant_id
     WHERE l.user_id = ? AND l.deleted_at IS NULL ORDER BY l.created_at LIMIT 1`, [userId])).rows[0];
  if (!s) throw new HttpError(403, "This login is not a vendor account.");
  const t = now();
  const id = randomUUID();
  await sql.execute(
    `INSERT INTO ep_vendors (id, vendor_code, user_id, name, email, phone, address, created_by_tenant, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
    [id, await nextEpCode(sql), userId, s.name, s.email ?? null, s.phone ?? null, s.address ?? null, s.tenant_id, t, t]);
  return (await sql.execute(`SELECT * FROM ep_vendors WHERE id = ?`, [id])).rows[0];
}

/** An earlier account's details, prefilled from what its hospital had. */
function profileOf(row: Record<string, unknown>): VendorProfile {
  const p = parseProfile(row.profile);
  if (!row.profile) {
    p.company.name = String(row.name ?? "");
    p.company.email = String(row.email ?? "");
    p.company.phone = String(row.phone ?? "");
    p.address.line1 = String(row.address ?? "");
  }
  return p;
}

const statusOf = (row: Record<string, unknown>) => (String(row.status ?? "approved") as VendorStatus);
// An approved account that never submitted its details (made by a hospital before v111) completes them once.
const editableFor = (status: VendorStatus, row: Record<string, unknown>) => status === "draft" || status === "changes" || status === "rejected" || (status === "approved" && !row.submitted_at);

export async function vendorAccount(sql: Sql, userId: string): Promise<VendorAccount> {
  const row = await epRowFor(sql, userId);
  const u = (await sql.execute(`SELECT username, email FROM users WHERE id = ?`, [userId])).rows[0];
  const status = statusOf(row);
  const profile = profileOf(row);
  const complete = profileComplete(profile);
  const hospitals = status === "approved" ? (await sql.execute(
    `SELECT t.name FROM vendor_portal_logins l JOIN tenants t ON t.id = l.tenant_id
     WHERE l.user_id = ? AND l.deleted_at IS NULL AND COALESCE(l.is_active, 1) = 1 AND t.eprocurement_allowed = 1 ORDER BY t.name`, [userId])).rows.map((r) => String(r.name)) : [];
  return {
    epVendorId: String(row.id), vendorCode: String(row.vendor_code), status, statusLabel: VENDOR_STATUS_LABEL[status] ?? status,
    reviewNote: status === "changes" || status === "rejected" || status === "suspended" ? str(row.review_note) : status === "blacklisted" ? str(row.blacklist_reason) : null,
    submittedAt: str(row.submitted_at), profile, complete, username: String(u?.username ?? ""), email: str(u?.email), hospitals,
    editable: editableFor(status, row),
  };
}

/** Saves one step (the vendor can stop and continue later). Returns that step's remaining problems. */
export async function saveProfileStep(sql: Sql, userId: string, b: Record<string, unknown>): Promise<{ ok: true; problems: Record<string, string> }> {
  const row = await epRowFor(sql, userId);
  const status = statusOf(row);
  const current = profileOf(row);
  if (!editableFor(status, row)) {
    throw new HttpError(409, status === "pending" ? "Your registration is with MAVIN.pk for approval: it cannot be changed now." : "Your details are approved. To change them, contact MAVIN.pk.");
  }
  const step = String(b.step) as ProfileStep;
  if (!["company", "address", "bank"].includes(step)) throw new HttpError(400, "Unknown step.");
  const sent = cleanProfile(b.profile, current);
  // Only the step being saved changes (company step = company, owner and business).
  const next: VendorProfile = { ...current };
  if (step === "company") { next.company = sent.company; next.owner = sent.owner; next.business = sent.business; }
  else if (step === "address") next.address = sent.address;
  else next.bank = sent.bank;
  const t = now();
  await sql.execute(
    `UPDATE ep_vendors SET profile = ?, name = ?, email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone), address = ?, city = ?, business_kind = ?, categories = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(next), next.company.name || String(row.name), next.company.email, next.company.phone,
      [next.address.line1, next.address.area, next.address.city].filter(Boolean).join(", ") || str(row.address), next.address.city || null,
      next.business.kind || null, JSON.stringify(next.business.categories), t, row.id]);
  return { ok: true, problems: stepProblems(next, step) };
}

/** Step 4: the vendor states the details are correct and submits them to the Super Admin. */
export async function submitRegistration(sql: Sql, userId: string, b: Record<string, unknown>): Promise<{ ok: true; status: VendorStatus }> {
  const row = await epRowFor(sql, userId);
  const status = statusOf(row);
  const profile = profileOf(row);
  if (!editableFor(status, row)) throw new HttpError(409, status === "pending" ? "Your registration was already submitted." : "Nothing to submit.");
  if (b.confirmed !== true) throw new HttpError(400, "Tick the statement that the details are correct.");
  const problems = allProblems(profile);
  const first = Object.values(problems)[0];
  if (first) throw new HttpError(400, `Some details are missing: ${first}.`);
  const t = now();
  // An account made by a hospital before v111 is already approved: completing its details needs no new review.
  const next: VendorStatus = status === "approved" ? "approved" : "pending";
  await sql.execute(`UPDATE ep_vendors SET status = ?, submitted_at = ?, updated_at = ? WHERE id = ?`, [next, t, t, row.id]);
  if (next === "pending") {
    // The Super Admin's Queries inbox shows it too.
    await sql.execute(
      `INSERT INTO site_queries (id, submission_key, kind, name, business_name, phone, email, message, topic, status, created_at)
       VALUES (?, ?, 'contact', ?, ?, ?, ?, ?, 'eprocurement-vendor', 'unread', ?)`,
      [randomUUID(), `ep-vendor-${row.id}-${t}`, profile.owner.name || profile.company.name, profile.company.name, profile.company.phone || null, profile.company.email || null,
        `New eProcurement vendor registration: ${profile.company.name} (${BUSINESS_KIND_LABEL[profile.business.kind as BusinessKind] ?? ""}, ${profile.address.city}). Review it in Super Admin > eProcurement > Vendor registrations.`, t],
    ).catch(() => undefined);
  }
  return { ok: true, status: next };
}

export async function activeCategories(sql: Sql): Promise<EpCategory[]> {
  return (await sql.execute(`SELECT id, kind, name, is_active, sort FROM ep_categories WHERE deleted_at IS NULL AND is_active = 1 ORDER BY kind, sort, name`)).rows.map(categoryRow);
}
const categoryRow = (r: Record<string, unknown>): EpCategory => ({ id: String(r.id), kind: String(r.kind) === "services" ? "services" : "supplier", name: String(r.name), active: num(r.is_active) === 1, sort: num(r.sort) });

/** The portal's account actions: they work before approval (the rest of the portal needs it). */
export const ACCOUNT_ACTIONS = new Set(["account", "categories", "saveProfile", "submitRegistration"]);
export async function accountAction(sql: Sql, caller: Pick<Caller, "userId" | "platformRole">, b: Record<string, unknown>): Promise<unknown> {
  if (caller.platformRole !== "vendor") throw new HttpError(403, "The vendor portal is for vendor logins.");
  switch (b.action) {
    case "account": return vendorAccount(sql, caller.userId);
    case "categories": return activeCategories(sql);
    case "saveProfile": return saveProfileStep(sql, caller.userId, b);
    case "submitRegistration": return submitRegistration(sql, caller.userId, b);
    default: throw new HttpError(400, "Unknown action.");
  }
}

/** Why an account that is not approved cannot use quote requests, orders and payments. */
export function notApprovedMessage(status: VendorStatus): string {
  switch (status) {
    case "draft": return "Complete and submit your registration first.";
    case "pending": return "Your registration is waiting for approval by MAVIN.pk.";
    case "changes": return "MAVIN.pk asked for changes to your registration: correct them and submit again.";
    case "rejected": return "Your registration was not approved.";
    case "suspended": return "Your vendor account is suspended. Contact MAVIN.pk.";
    case "blacklisted": return "Your vendor account is blacklisted. Contact MAVIN.pk.";
    default: return "Your vendor account is not active.";
  }
}

// ── Super Admin > eProcurement ──────────────────────────────────────────────

export interface AdminVendorRow {
  id: string; code: string; name: string; status: VendorStatus; statusLabel: string; kind: string | null; categories: string[]; city: string | null;
  email: string | null; phone: string | null; ownerName: string | null; username: string | null; submittedAt: string | null; reviewedAt: string | null;
  createdAt: string; selfRegistered: boolean; hospitals: number; note: string | null;
}
export interface AdminVendorDetail extends AdminVendorRow {
  profile: VendorProfile; problems: Record<string, string>; reviewedBy: string | null; blacklistedAt: string | null; blacklistReason: string | null;
  hospitalNames: string[]; orders: number; ordersValue: number;
}
export interface OrganizationRow {
  tenantId: string; name: string; address: string | null; allowed: boolean; vendors: number; rfqs: number; orders: number; ordersValue: number; lastOrderAt: string | null;
}

const LIST_STATUSES: Record<string, VendorStatus[]> = {
  pending: ["pending"], changes: ["changes"], rejected: ["rejected"], draft: ["draft"],
  approved: ["approved"], suspended: ["suspended"], blacklisted: ["blacklisted"], directory: ["approved", "suspended"],
};

function adminRow(r: Record<string, unknown>): AdminVendorRow {
  const status = statusOf(r);
  const p = profileOf(r);
  let cats: string[] = [];
  try { cats = Array.isArray(JSON.parse(String(r.categories ?? "[]"))) ? JSON.parse(String(r.categories)) : []; } catch { cats = []; }
  return {
    id: String(r.id), code: String(r.vendor_code), name: String(r.name), status, statusLabel: VENDOR_STATUS_LABEL[status] ?? status,
    kind: str(r.business_kind), categories: cats.map(String), city: str(r.city) ?? (p.address.city || null), email: str(r.email), phone: str(r.phone),
    ownerName: p.owner.name || null, username: str(r.username), submittedAt: str(r.submitted_at), reviewedAt: str(r.reviewed_at), createdAt: String(r.created_at),
    selfRegistered: num(r.self_registered) === 1, hospitals: num(r.hospitals), note: status === "blacklisted" ? str(r.blacklist_reason) : str(r.review_note),
  };
}

const ADMIN_SELECT = `SELECT e.*, u.username,
  (SELECT COUNT(*) FROM vendor_portal_logins l WHERE l.user_id = e.user_id AND l.deleted_at IS NULL) AS hospitals
  FROM ep_vendors e LEFT JOIN users u ON u.id = e.user_id`;

async function listVendors(sql: Sql, b: Record<string, unknown>): Promise<AdminVendorRow[]> {
  const statuses = LIST_STATUSES[String(b.status)] ?? ["pending"];
  const q = text(b.q, 80);
  const L = like(q);
  const rows = (await sql.execute(
    `${ADMIN_SELECT} WHERE e.deleted_at IS NULL AND COALESCE(e.status, 'approved') IN (${statuses.map(() => "?").join(",")})
       ${q ? "AND (e.name LIKE ? ESCAPE '\\' OR e.vendor_code LIKE ? ESCAPE '\\' OR e.email LIKE ? ESCAPE '\\' OR e.phone LIKE ? ESCAPE '\\' OR e.city LIKE ? ESCAPE '\\' OR e.categories LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')" : ""}
     ORDER BY ${statuses.includes("pending") ? "e.submitted_at" : "e.name"} LIMIT 500`,
    [...statuses, ...(q ? [L, L, L, L, L, L, L] : [])])).rows;
  return rows.map(adminRow);
}

async function vendorDetail(sql: Sql, id: unknown): Promise<AdminVendorDetail> {
  const r = typeof id === "string" ? (await sql.execute(`${ADMIN_SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`, [id])).rows[0] : undefined;
  if (!r) throw new HttpError(404, "Vendor not found.");
  const profile = profileOf(r);
  const links = (await sql.execute(
    `SELECT t.name, l.tenant_id, l.vendor_id FROM vendor_portal_logins l JOIN tenants t ON t.id = l.tenant_id WHERE l.user_id = ? AND l.deleted_at IS NULL ORDER BY t.name`, [r.user_id])).rows;
  let orders = 0, value = 0;
  for (const l of links) {
    const o = (await sql.execute(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM hospital_purchase_orders WHERE tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL AND status != 'cancelled'`,
      [l.tenant_id, l.vendor_id])).rows[0];
    orders += num(o?.n);
    value += num(o?.v);
  }
  return {
    ...adminRow(r), profile, problems: allProblems(profile), reviewedBy: str(r.reviewed_by), blacklistedAt: str(r.blacklisted_at), blacklistReason: str(r.blacklist_reason),
    hospitalNames: links.map((l) => String(l.name)), orders, ordersValue: Math.round(value * 100) / 100,
  };
}

/** A status change by the Super Admin, allowed only from the given statuses. */
async function review(sql: Sql, caller: Caller, id: unknown, from: VendorStatus[], to: VendorStatus, note: string | null, extra: { blacklist?: boolean; clearBlacklist?: boolean } = {}) {
  const r = typeof id === "string" ? (await sql.execute(`SELECT id, status FROM ep_vendors WHERE id = ? AND deleted_at IS NULL`, [id])).rows[0] : undefined;
  if (!r) throw new HttpError(404, "Vendor not found.");
  const status = statusOf(r);
  if (!from.includes(status)) throw new HttpError(409, `This vendor is ${VENDOR_STATUS_LABEL[status]?.toLowerCase() ?? status}: that cannot be done now.`);
  const t = now();
  const sets = [`status = ?`, `reviewed_at = ?`, `reviewed_by = ?`, `updated_at = ?`];
  const args: unknown[] = [to, t, caller.userId, t];
  if (extra.blacklist) { sets.push(`blacklisted_at = ?`, `blacklist_reason = ?`); args.push(t, note); }
  else { sets.push(`review_note = ?`); args.push(note); }
  if (extra.clearBlacklist) sets.push(`blacklisted_at = NULL`, `blacklist_reason = NULL`);
  // Guarded by the status read above (two clicks at once change it once).
  const res = await sql.execute(`UPDATE ep_vendors SET ${sets.join(", ")} WHERE id = ? AND COALESCE(status, 'approved') = ?`, [...args, id, status]);
  if (!res.rowsAffected) throw new HttpError(409, "The vendor was changed meanwhile. Open it again.");
  return { ok: true as const, status: to };
}

const required = (v: unknown, what: string) => {
  const s = typeof v === "string" ? v.trim().slice(0, 1000) : "";
  if (s.length < 3) throw new HttpError(400, `Write ${what}.`);
  return s;
};

async function organizations(sql: Sql): Promise<OrganizationRow[]> {
  const rows = (await sql.execute(
    `SELECT t.id, t.name, t.address, COALESCE(t.eprocurement_allowed, 0) AS allowed,
            (SELECT COUNT(*) FROM vendor_portal_logins l WHERE l.tenant_id = t.id AND l.deleted_at IS NULL) AS vendors,
            (SELECT COUNT(*) FROM hospital_rfqs r WHERE r.tenant_id = t.id AND r.deleted_at IS NULL) AS rfqs,
            (SELECT COUNT(*) FROM hospital_purchase_orders p WHERE p.tenant_id = t.id AND p.deleted_at IS NULL AND p.status != 'cancelled') AS orders,
            (SELECT COALESCE(SUM(p.total), 0) FROM hospital_purchase_orders p WHERE p.tenant_id = t.id AND p.deleted_at IS NULL AND p.status != 'cancelled') AS orders_value,
            (SELECT MAX(p.created_at) FROM hospital_purchase_orders p WHERE p.tenant_id = t.id AND p.deleted_at IS NULL) AS last_order
     FROM tenants t WHERE t.business_type = 'hospital' AND t.deleted_at IS NULL ORDER BY allowed DESC, t.name`)).rows;
  return rows.map((r) => ({
    tenantId: String(r.id), name: String(r.name), address: str(r.address), allowed: num(r.allowed) === 1, vendors: num(r.vendors), rfqs: num(r.rfqs),
    orders: num(r.orders), ordersValue: Math.round(num(r.orders_value) * 100) / 100, lastOrderAt: str(r.last_order),
  }));
}

async function saveCategory(sql: Sql, b: Record<string, unknown>): Promise<{ ok: true; id: string }> {
  const kind = String(b.kind) === "services" ? "services" : String(b.kind) === "supplier" ? "supplier" : "";
  if (!kind) throw new HttpError(400, "Choose supplier or services.");
  const name = text(b.name, 80);
  if (name.length < 2) throw new HttpError(400, "Enter the name of the kind of work.");
  const id = typeof b.id === "string" && b.id ? b.id : null;
  const clash = (await sql.execute(`SELECT id FROM ep_categories WHERE kind = ? AND lower(name) = lower(?) AND deleted_at IS NULL ${id ? "AND id != ?" : ""}`, id ? [kind, name, id] : [kind, name])).rows[0];
  if (clash) throw new HttpError(409, `"${name}" is already in the list.`);
  const t = now();
  const sort = Math.max(0, Math.min(999, Math.round(Number(b.sort) || 0)));
  if (id) {
    const r = await sql.execute(`UPDATE ep_categories SET kind = ?, name = ?, sort = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [kind, name, sort, t, id]);
    if (!r.rowsAffected) throw new HttpError(404, "Not found.");
    return { ok: true, id };
  }
  const nid = randomUUID();
  const last = num((await sql.execute(`SELECT MAX(sort) AS n FROM ep_categories WHERE kind = ? AND deleted_at IS NULL`, [kind])).rows[0]?.n);
  await sql.execute(`INSERT INTO ep_categories (id, kind, name, is_active, sort, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)`, [nid, kind, name, sort || last + 1, t, t]);
  return { ok: true, id: nid };
}

/** Super Admin > eProcurement (registrations, vendors, blacklist, business types, organizations). */
export async function adminEprocurementAction(sql: Sql, caller: Caller, b: Record<string, unknown>): Promise<unknown> {
  if (caller.role !== "super_admin" || caller.platformRole) throw new HttpError(403, "Only the platform owner manages eProcurement.");
  const t = now();
  switch (b.action) {
    case "counts": {
      const rows = (await sql.execute(`SELECT COALESCE(status, 'approved') AS s, COUNT(*) AS n FROM ep_vendors WHERE deleted_at IS NULL GROUP BY s`)).rows;
      return Object.fromEntries(rows.map((r) => [String(r.s), num(r.n)]));
    }
    case "vendors": return listVendors(sql, b);
    case "vendor": return vendorDetail(sql, b.id);
    case "approve": return review(sql, caller, b.id, ["pending", "changes", "rejected"], "approved", typeof b.note === "string" ? b.note.trim().slice(0, 1000) || null : null);
    case "requestChanges": return review(sql, caller, b.id, ["pending"], "changes", required(b.note, "what the vendor should correct"));
    case "reject": return review(sql, caller, b.id, ["pending", "changes"], "rejected", required(b.note, "the reason"));
    case "suspend": return review(sql, caller, b.id, ["approved"], "suspended", required(b.note, "the reason"));
    case "reactivate": return review(sql, caller, b.id, ["suspended"], "approved", null);
    case "blacklist": return review(sql, caller, b.id, ["approved", "suspended", "pending", "changes", "rejected", "draft"], "blacklisted", required(b.note, "the reason for blacklisting"), { blacklist: true });
    case "unblacklist": return review(sql, caller, b.id, ["blacklisted"], "approved", null, { clearBlacklist: true });
    case "setPassword": {
      // Last resort when the vendor has no email access (they normally use Forgot password).
      const r = typeof b.id === "string" ? (await sql.execute(`SELECT user_id FROM ep_vendors WHERE id = ? AND deleted_at IS NULL`, [b.id])).rows[0] : undefined;
      if (!r) throw new HttpError(404, "Vendor not found.");
      const password = typeof b.password === "string" ? b.password : "";
      if (password.length < MIN_PASSWORD) throw new HttpError(400, `The password must be at least ${MIN_PASSWORD} characters.`);
      const salt = randomBytes(16).toString("hex");
      await sql.execute(`UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = ?, updated_at = ? WHERE id = ? AND platform_role = 'vendor'`,
        [storedPasswordHash(password, salt), salt, t, t, r.user_id]);
      return { ok: true };
    }
    case "categories":
      return (await sql.execute(`SELECT id, kind, name, is_active, sort FROM ep_categories WHERE deleted_at IS NULL ORDER BY kind, sort, name`)).rows.map(categoryRow);
    case "saveCategory": return saveCategory(sql, b);
    case "categoryActive": {
      const r = await sql.execute(`UPDATE ep_categories SET is_active = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [b.active ? 1 : 0, t, String(b.id ?? "")]);
      if (!r.rowsAffected) throw new HttpError(404, "Not found.");
      return { ok: true };
    }
    case "deleteCategory": {
      const r = await sql.execute(`UPDATE ep_categories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [t, t, String(b.id ?? "")]);
      if (!r.rowsAffected) throw new HttpError(404, "Not found.");
      return { ok: true };
    }
    case "organizations": return organizations(sql);
    case "setAllowed": {
      const r = await sql.execute(`UPDATE tenants SET eprocurement_allowed = ?, updated_at = ? WHERE id = ? AND business_type = 'hospital'`, [b.allowed ? 1 : 0, t, String(b.tenantId ?? "")]);
      if (!r.rowsAffected) throw new HttpError(404, "Hospital not found.");
      return { ok: true };
    }
    default: throw new HttpError(400, "Unknown action.");
  }
}
