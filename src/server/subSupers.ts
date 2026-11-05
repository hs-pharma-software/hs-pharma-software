/** Sub Supers: software distributors who sell selected applications.
 *
 * Every rule lives here, on the server: which distributor may sell which
 * application, the customer-setup workflow
 *   draft -> submitted -> under_review -> activated   (or returned / rejected)
 * with payment tracked separately (unverified / verified), and the owner's
 * activation, which creates the tenant, the owner login and the subscription
 * exactly once. A pending customer is only an onboarding_requests row: there
 * is no tenant and no login until activation, so nothing can be used early.
 *
 * Functions take the database (Sql) so tests run them on the real schema in
 * SQLite; the API routes pass the shared database (sqlForServer). */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BUSINESS_TYPES, businessType, defaultModulesFor } from "../config/businessTypes";
import { HttpError, passwordHash } from "./db";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface Sql {
  execute(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowsAffected: number }>;
  /** All statements in one transaction; rows affected per statement. */
  batch(statements: { sql: string; args?: unknown[] }[]): Promise<number[]>;
}

/** The platform owner (Super Admin) or a distributor, as resolved from the session. */
export type Actor = { kind: "owner"; userId: string } | { kind: "distributor"; userId: string; subSuperId: string };

export const BUSINESS_TIMEZONE = "Asia/Karachi";
const SETUP_LINK_DAYS = 7;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const now = () => new Date().toISOString();
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const isApp = (id: unknown) => BUSINESS_TYPES.some((t) => t.id === id);

async function one(sql: Sql, q: string, args: unknown[] = []) {
  return (await sql.execute(q, args)).rows[0] ?? null;
}

async function event(sql: Sql, a: Actor, action: string, ids: { requestId?: string | null; subSuperId?: string | null }, reason: string | null = null) {
  await sql.execute(
    `INSERT INTO onboarding_events (id, request_id, sub_super_id, actor_user_id, actor_role, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), ids.requestId ?? null, ids.subSuperId ?? null, a.userId, a.kind, action, reason, now()],
  );
}

const requireOwner = (a: Actor) => {
  if (a.kind !== "owner") throw new HttpError(403, "Only the platform owner can do this.");
};
const requireReason = (r: unknown) => {
  const reason = clean(r, 500);
  if (reason.length < 3) throw new HttpError(400, "Give a reason.");
  return reason;
};

// ── Actors ──────────────────────────────────────────────────────────────

/** Who the caller is for this module. A distributor must have an active Sub Super record. */
export async function actorFor(sql: Sql, caller: { userId: string; role: string; platformRole?: string | null }): Promise<Actor> {
  if (caller.role === "super_admin") return { kind: "owner", userId: caller.userId };
  if (caller.platformRole === "distributor") {
    const s = await one(sql, `SELECT id FROM sub_supers WHERE user_id = ?`, [caller.userId]);
    if (s) return { kind: "distributor", userId: caller.userId, subSuperId: String(s.id) };
  }
  throw new HttpError(403, "This area is for the platform owner and Sub Supers.");
}

// ── Password-setup links (invitations) ───────────────────────────────────

/** A one-time link token for a login (only its hash is kept). Older unused links of the login stop working. */
export async function issueSetupToken(sql: Sql, userId: string, createdBy: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const t = now();
  await sql.batch([
    { sql: `UPDATE password_setup_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, args: [t, userId] },
    {
      sql: `INSERT INTO password_setup_tokens (id, user_id, token_hash, expires_at, used_at, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      args: [randomUUID(), userId, sha256(token), new Date(Date.now() + SETUP_LINK_DAYS * 86_400_000).toISOString(), createdBy, t],
    },
  ]);
  return token;
}

/** Sets the password from a valid, unused, unexpired link; the link then stops working. */
export async function redeemSetupToken(sql: Sql, token: string, password: string): Promise<{ username: string }> {
  if (!token) throw new HttpError(400, "This link is not valid.");
  if (!password || password.length < 6) throw new HttpError(400, "Choose a password of at least 6 characters.");
  const hash = sha256(token);
  const t = now();
  const salt = randomBytes(16).toString("hex");
  const live = `SELECT user_id FROM password_setup_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`;
  const row = await one(sql, `SELECT u.username FROM users u WHERE u.id = (${live}) AND u.deleted_at IS NULL`, [hash, t]);
  if (!row) throw new HttpError(400, "This link has expired or was already used. Ask for a new one.");
  const [changed] = await sql.batch([
    { sql: `UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = (${live})`, args: [passwordHash(password, salt), salt, t, hash, t] },
    { sql: `UPDATE password_setup_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`, args: [t, hash] },
  ]);
  if (!changed) throw new HttpError(400, "This link has expired or was already used. Ask for a new one.");
  return { username: String(row.username) };
}

/** A login nobody can sign in to until the setup link is used. */
const unusableLogin = () => {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: passwordHash(randomBytes(32).toString("hex"), salt) };
};

// ── Distributors (owner) ─────────────────────────────────────────────────

export interface DistributorInput {
  name?: unknown; businessName?: unknown; phone?: unknown; email?: unknown; city?: unknown; username?: unknown; appIds?: unknown;
}

async function usernameTaken(sql: Sql, username: string, exceptRequestId: string | null = null): Promise<string | null> {
  if (await one(sql, `SELECT 1 FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL`, [username])) return "This login ID is already in use.";
  const open = await one(
    sql,
    `SELECT 1 FROM onboarding_requests WHERE lower(proposed_username) = lower(?) AND status IN ('submitted','under_review','returned') AND id <> ?`,
    [username, exceptRequestId ?? ""],
  );
  return open ? "This login ID is already proposed in another pending setup." : null;
}

export async function createDistributor(sql: Sql, a: Actor, input: DistributorInput): Promise<{ id: string; setupToken: string }> {
  requireOwner(a);
  const name = clean(input.name, 100);
  const username = clean(input.username, 40);
  const email = clean(input.email, 120).toLowerCase();
  if (name.length < 2) throw new HttpError(400, "Enter the distributor's name.");
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "Login ID: 3 to 40 letters, digits, dots, dashes or underscores.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  const taken = await usernameTaken(sql, username);
  if (taken) throw new HttpError(409, taken);
  const apps = Array.isArray(input.appIds) ? [...new Set(input.appIds.filter(isApp).map(String))] : [];
  const id = randomUUID();
  const userId = randomUUID();
  const t = now();
  const login = unusableLogin();
  await sql.batch([
    {
      sql: `INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, permissions, platform_role, created_at, updated_at, deleted_at)
            VALUES (?, NULL, ?, ?, ?, 'staff', ?, 1, '[]', 'distributor', ?, ?, NULL)`,
      args: [userId, username, login.hash, login.salt, name, t, t],
    },
    {
      sql: `INSERT INTO sub_supers (id, user_id, name, business_name, phone, email, city, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      args: [id, userId, name, clean(input.businessName, 120) || null, clean(input.phone, 30) || null, email || null, clean(input.city, 60) || null, a.userId, t, t],
    },
    ...apps.map((app) => ({ sql: `INSERT INTO sub_super_apps (id, sub_super_id, app_id, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)`, args: [randomUUID(), id, app, a.userId, t] })),
  ]);
  await event(sql, a, "distributor_created", { subSuperId: id });
  return { id, setupToken: await issueSetupToken(sql, userId, a.userId) };
}

export async function updateDistributor(sql: Sql, a: Actor, id: string, input: DistributorInput): Promise<void> {
  requireOwner(a);
  const name = clean(input.name, 100);
  if (name.length < 2) throw new HttpError(400, "Enter the distributor's name.");
  const email = clean(input.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  const r = await sql.execute(`UPDATE sub_supers SET name = ?, business_name = ?, phone = ?, email = ?, city = ?, updated_at = ? WHERE id = ?`, [
    name, clean(input.businessName, 120) || null, clean(input.phone, 30) || null, email || null, clean(input.city, 60) || null, now(), id,
  ]);
  if (!r.rowsAffected) throw new HttpError(404, "Distributor not found.");
  await event(sql, a, "distributor_updated", { subSuperId: id });
}

/** Suspending blocks the login and new submissions; pending setups are flagged for review. History stays. */
export async function setDistributorStatus(sql: Sql, a: Actor, id: string, status: "active" | "suspended", reasonIn: unknown): Promise<void> {
  requireOwner(a);
  const reason = status === "suspended" ? requireReason(reasonIn) : clean(reasonIn, 500) || null;
  const s = await one(sql, `SELECT user_id FROM sub_supers WHERE id = ?`, [id]);
  if (!s) throw new HttpError(404, "Distributor not found.");
  const t = now();
  await sql.batch([
    { sql: `UPDATE sub_supers SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?`, args: [status, reason, t, id] },
    { sql: `UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?`, args: [status === "active" ? 1 : 0, t, s.user_id] },
    ...(status === "suspended"
      ? [{
          sql: `UPDATE onboarding_requests SET needs_owner_review = 1, owner_review_reason = ?, updated_at = ? WHERE sub_super_id = ? AND status IN ('submitted','under_review','returned')`,
          args: [`Distributor suspended: ${reason}`, t, id],
        }]
      : []),
  ]);
  await event(sql, a, status === "suspended" ? "distributor_suspended" : "distributor_enabled", { subSuperId: id }, reason);
}

/** Sets the applications a distributor may sell. Removed ones are revoked (kept as history) and their pending setups flagged. */
export async function setDistributorApps(sql: Sql, a: Actor, id: string, appIds: unknown): Promise<void> {
  requireOwner(a);
  if (!(await one(sql, `SELECT 1 FROM sub_supers WHERE id = ?`, [id]))) throw new HttpError(404, "Distributor not found.");
  const want = new Set(Array.isArray(appIds) ? appIds.filter(isApp).map(String) : []);
  const active = (await sql.execute(`SELECT app_id FROM sub_super_apps WHERE sub_super_id = ? AND revoked_at IS NULL`, [id])).rows.map((r) => String(r.app_id));
  const t = now();
  const add = [...want].filter((x) => !active.includes(x));
  const remove = active.filter((x) => !want.has(x));
  if (!add.length && !remove.length) return;
  await sql.batch([
    ...add.map((app) => ({ sql: `INSERT INTO sub_super_apps (id, sub_super_id, app_id, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)`, args: [randomUUID(), id, app, a.userId, t] })),
    ...remove.flatMap((app) => [
      { sql: `UPDATE sub_super_apps SET revoked_at = ?, revoked_by = ? WHERE sub_super_id = ? AND app_id = ? AND revoked_at IS NULL`, args: [t, a.userId, id, app] },
      {
        sql: `UPDATE onboarding_requests SET needs_owner_review = 1, owner_review_reason = ?, updated_at = ? WHERE sub_super_id = ? AND app_id = ? AND status IN ('submitted','under_review','returned')`,
        args: [`Authorization for ${businessType(app).label} was removed.`, t, id, app],
      },
    ]),
  ]);
  await event(sql, a, "apps_changed", { subSuperId: id }, `added: ${add.join(", ") || "none"}; removed: ${remove.join(", ") || "none"}`);
}

export async function issueDistributorSetupLink(sql: Sql, a: Actor, id: string): Promise<string> {
  requireOwner(a);
  const s = await one(sql, `SELECT user_id FROM sub_supers WHERE id = ?`, [id]);
  if (!s) throw new HttpError(404, "Distributor not found.");
  const token = await issueSetupToken(sql, String(s.user_id), a.userId);
  await event(sql, a, "distributor_link_issued", { subSuperId: id });
  return token;
}

export async function listDistributors(sql: Sql, a: Actor) {
  requireOwner(a);
  const rows = (await sql.execute(
    `SELECT s.*, u.username,
            (SELECT group_concat(app_id) FROM sub_super_apps g WHERE g.sub_super_id = s.id AND g.revoked_at IS NULL) AS apps,
            (SELECT COUNT(*) FROM onboarding_requests r WHERE r.sub_super_id = s.id AND r.status IN ('submitted','under_review')) AS pending,
            (SELECT COUNT(*) FROM onboarding_requests r WHERE r.sub_super_id = s.id AND r.status = 'activated') AS activated
     FROM sub_supers s JOIN users u ON u.id = s.user_id ORDER BY s.name`,
  )).rows;
  return rows.map((r) => ({ ...r, apps: r.apps ? String(r.apps).split(",") : [], pending: Number(r.pending), activated: Number(r.activated) }));
}

export async function getDistributor(sql: Sql, a: Actor, id: string) {
  requireOwner(a);
  const s = await one(sql, `SELECT s.*, u.username FROM sub_supers s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [id]);
  if (!s) throw new HttpError(404, "Distributor not found.");
  const grants = (await sql.execute(`SELECT app_id, granted_at, revoked_at FROM sub_super_apps WHERE sub_super_id = ? ORDER BY granted_at`, [id])).rows;
  const requests = (await sql.execute(`SELECT * FROM onboarding_requests WHERE sub_super_id = ? AND status <> 'draft' ORDER BY updated_at DESC`, [id])).rows;
  const events = (await sql.execute(`SELECT * FROM onboarding_events WHERE sub_super_id = ? OR request_id IN (SELECT id FROM onboarding_requests WHERE sub_super_id = ?) ORDER BY created_at DESC LIMIT 200`, [id, id])).rows;
  return { distributor: s, grants, requests, events };
}

// ── Customer setups (distributor) ─────────────────────────────────────────

export interface SetupInput {
  appId?: unknown; planId?: unknown; businessName?: unknown; ownerName?: unknown; phone?: unknown; email?: unknown; city?: unknown;
  address?: unknown; ntn?: unknown; proposedUsername?: unknown; notes?: unknown; claimedAmount?: unknown; paymentReference?: unknown; paymentDate?: unknown;
}

const requireDistributor = (a: Actor) => {
  if (a.kind !== "distributor") throw new HttpError(403, "Only a Sub Super prepares customer setups.");
  return a;
};

async function activeDistributor(sql: Sql, a: Actor) {
  const d = requireDistributor(a);
  const s = await one(sql, `SELECT status FROM sub_supers WHERE id = ?`, [d.subSuperId]);
  if (!s || s.status !== "active") throw new HttpError(403, "Your Sub Super access is suspended. Contact the platform owner.");
  return d;
}

async function authorizedApps(sql: Sql, subSuperId: string): Promise<string[]> {
  return (await sql.execute(`SELECT app_id FROM sub_super_apps WHERE sub_super_id = ? AND revoked_at IS NULL`, [subSuperId])).rows.map((r) => String(r.app_id));
}

/** The distributor's authorized applications and the plans they can offer. */
export async function myProfile(sql: Sql, a: Actor) {
  const d = requireDistributor(a);
  const s = await one(sql, `SELECT id, name, business_name, phone, email, city, status FROM sub_supers WHERE id = ?`, [d.subSuperId]);
  const apps = (await authorizedApps(sql, d.subSuperId)).map((id) => ({ id, label: businessType(id).label }));
  // No application-to-plan mapping exists, so every current plan can be offered with any application.
  const plans = (await sql.execute(`SELECT id, name, price, duration_days, max_staff_logins FROM subscription_plans WHERE deleted_at IS NULL ORDER BY price`)).rows;
  return { distributor: s, apps, plans };
}

/** Creates or updates the distributor's own draft (or a setup returned for correction). */
export async function saveDraft(sql: Sql, a: Actor, id: string | null, input: SetupInput): Promise<{ id: string }> {
  const d = await activeDistributor(sql, a);
  const appId = clean(input.appId, 40) || null;
  if (appId && !(await authorizedApps(sql, d.subSuperId)).includes(appId)) throw new HttpError(403, "You are not authorized to sell this application.");
  const claimed = num(input.claimedAmount);
  if (claimed != null && (!Number.isFinite(claimed) || claimed < 0)) throw new HttpError(400, "Enter the amount received as a number.");
  const paymentDate = clean(input.paymentDate, 10);
  if (paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new HttpError(400, "Enter the payment date as YYYY-MM-DD.");
  const fields = {
    app_id: appId,
    plan_id: clean(input.planId, 60) || null,
    business_name: clean(input.businessName, 120) || null,
    owner_name: clean(input.ownerName, 100) || null,
    phone: clean(input.phone, 30) || null,
    email: clean(input.email, 120).toLowerCase() || null,
    city: clean(input.city, 60) || null,
    address: clean(input.address, 200) || null,
    ntn: clean(input.ntn, 30) || null,
    proposed_username: clean(input.proposedUsername, 40) || null,
    notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) || null : null,
    claimed_amount: claimed,
    payment_reference: clean(input.paymentReference, 80) || null,
    payment_date: paymentDate || null,
  };
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  const t = now();
  if (!id) {
    const newId = randomUUID();
    await sql.execute(
      `INSERT INTO onboarding_requests (id, sub_super_id, status, ${keys.join(", ")}, created_at, updated_at) VALUES (?, ?, 'draft', ${keys.map(() => "?").join(", ")}, ?, ?)`,
      [newId, d.subSuperId, ...keys.map((k) => fields[k]), t, t],
    );
    await event(sql, a, "draft_created", { requestId: newId, subSuperId: d.subSuperId });
    return { id: newId };
  }
  // A changed payment report needs verifying again.
  const r = await sql.execute(
    `UPDATE onboarding_requests SET ${keys.map((k) => `${k} = ?`).join(", ")}, payment_status = 'unverified', verified_amount = NULL, updated_at = ?
     WHERE id = ? AND sub_super_id = ? AND status IN ('draft','returned')`,
    [...keys.map((k) => fields[k]), t, id, d.subSuperId],
  );
  if (!r.rowsAffected) throw new HttpError(404, "Only your own drafts and setups returned for correction can be edited.");
  return { id };
}

/** Problems that stop a setup from being submitted (empty = complete). */
export async function setupProblems(sql: Sql, req: Record<string, unknown>, subSuperId: string): Promise<string[]> {
  const p: string[] = [];
  if (!req.business_name) p.push("Business name is required.");
  if (!req.owner_name) p.push("Owner name is required.");
  if (!req.phone) p.push("Owner phone is required.");
  else if (!/^\+?[0-9][0-9 -]{6,18}$/.test(String(req.phone))) p.push("Enter the phone with digits only, for example 0300 1234567.");
  if (req.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(req.email))) p.push("Enter a valid email address.");
  if (!req.app_id || !isApp(req.app_id)) p.push("Choose the application.");
  else if (!(await authorizedApps(sql, subSuperId)).includes(String(req.app_id))) p.push("You are not authorized to sell this application.");
  if (!req.plan_id || !(await one(sql, `SELECT 1 FROM subscription_plans WHERE id = ? AND deleted_at IS NULL`, [req.plan_id]))) p.push("Choose a current subscription plan.");
  const username = String(req.proposed_username ?? "");
  if (!USERNAME_RE.test(username)) p.push("Login ID: 3 to 40 letters, digits, dots, dashes or underscores.");
  else {
    const taken = await usernameTaken(sql, username, String(req.id));
    if (taken) p.push(taken);
  }
  if (req.business_name) {
    const dup = await one(
      sql,
      `SELECT name FROM tenants WHERE deleted_at IS NULL AND (lower(trim(name)) = lower(trim(?)) OR (phone IS NOT NULL AND phone <> '' AND phone = ?))`,
      [req.business_name, req.phone ?? ""],
    );
    if (dup) p.push("A customer with this business name or phone already exists.");
  }
  return p;
}

export async function submitSetup(sql: Sql, a: Actor, id: string): Promise<void> {
  const d = await activeDistributor(sql, a);
  const req = await one(sql, `SELECT * FROM onboarding_requests WHERE id = ? AND sub_super_id = ?`, [id, d.subSuperId]);
  if (!req) throw new HttpError(404, "Setup not found.");
  if (!["draft", "returned"].includes(String(req.status))) throw new HttpError(409, "This setup was already submitted.");
  const problems = await setupProblems(sql, req, d.subSuperId);
  if (problems.length) throw new HttpError(400, problems.join(" "));
  const plan = await one(sql, `SELECT price FROM subscription_plans WHERE id = ?`, [req.plan_id]);
  const t = now();
  const r = await sql.execute(
    `UPDATE onboarding_requests SET status = 'submitted', expected_amount = ?, submitted_at = ?, return_reason = NULL, needs_owner_review = 0, owner_review_reason = NULL, updated_at = ?
     WHERE id = ? AND sub_super_id = ? AND status IN ('draft','returned')`,
    [Number(plan?.price ?? 0), t, t, id, d.subSuperId],
  );
  if (!r.rowsAffected) throw new HttpError(409, "This setup was already submitted.");
  await event(sql, a, "submitted", { requestId: id, subSuperId: d.subSuperId });
}

/** The distributor's own setups, or one of them with its history. */
export async function myRequests(sql: Sql, a: Actor) {
  const d = requireDistributor(a);
  return (await sql.execute(`SELECT * FROM onboarding_requests WHERE sub_super_id = ? ORDER BY updated_at DESC`, [d.subSuperId])).rows.map(forDistributor);
}

export async function myRequest(sql: Sql, a: Actor, id: string) {
  const d = requireDistributor(a);
  const req = await one(sql, `SELECT * FROM onboarding_requests WHERE id = ? AND sub_super_id = ?`, [id, d.subSuperId]);
  if (!req) throw new HttpError(404, "Setup not found.");
  const events = (await sql.execute(`SELECT action, reason, actor_role, created_at FROM onboarding_events WHERE request_id = ? ORDER BY created_at`, [id])).rows;
  return { request: forDistributor(req), events };
}

/** What a distributor sees of a request: no internal ids of the provisioned business or who on the owner side acted. */
function forDistributor(r: Record<string, unknown>) {
  const { activation_key: _k, owner_user_id: _o, payment_verified_by: _p, review_started_by: _rs, returned_by: _rb, rejected_by: _rj, activated_by: _a, ...rest } = r;
  void _k; void _o; void _p; void _rs; void _rb; void _rj; void _a;
  return rest;
}

// ── Owner review, payment and activation ─────────────────────────────────

export async function pendingApprovals(sql: Sql, a: Actor) {
  requireOwner(a);
  return (await sql.execute(
    `SELECT r.*, s.name AS distributor_name, s.status AS distributor_status, p.name AS plan_name
     FROM onboarding_requests r JOIN sub_supers s ON s.id = r.sub_super_id LEFT JOIN subscription_plans p ON p.id = r.plan_id
     WHERE r.status IN ('submitted','under_review') ORDER BY r.submitted_at`,
  )).rows;
}

export async function getRequest(sql: Sql, a: Actor, id: string) {
  requireOwner(a);
  const req = await one(
    sql,
    `SELECT r.*, s.name AS distributor_name, s.status AS distributor_status, p.name AS plan_name, p.price AS plan_price
     FROM onboarding_requests r JOIN sub_supers s ON s.id = r.sub_super_id LEFT JOIN subscription_plans p ON p.id = r.plan_id WHERE r.id = ?`,
    [id],
  );
  if (!req) throw new HttpError(404, "Setup not found.");
  const events = (await sql.execute(`SELECT * FROM onboarding_events WHERE request_id = ? ORDER BY created_at`, [id])).rows;
  return { request: req, events, problems: req.status === "activated" || req.status === "rejected" ? [] : await activationProblems(sql, req) };
}

async function ownerTransition(sql: Sql, a: Actor, id: string, from: string[], set: string, args: unknown[], action: string, reason: string | null) {
  requireOwner(a);
  const r = await sql.execute(
    `UPDATE onboarding_requests SET ${set}, updated_at = ? WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`,
    [...args, now(), id, ...from],
  );
  if (!r.rowsAffected) throw new HttpError(409, "This setup is no longer in a state that allows this. Refresh and try again.");
  const req = await one(sql, `SELECT sub_super_id FROM onboarding_requests WHERE id = ?`, [id]);
  await event(sql, a, action, { requestId: id, subSuperId: str(req?.sub_super_id) }, reason);
}

export const startReview = (sql: Sql, a: Actor, id: string) =>
  ownerTransition(sql, a, id, ["submitted"], `status = 'under_review', review_started_by = ?, review_started_at = ?`, [a.userId, now()], "review_started", null);

/** Back to the distributor for correction; payment must then be verified again. */
export async function returnForCorrection(sql: Sql, a: Actor, id: string, reasonIn: unknown) {
  const reason = requireReason(reasonIn);
  await ownerTransition(sql, a, id, ["submitted", "under_review"],
    `status = 'returned', return_reason = ?, returned_by = ?, returned_at = ?, payment_status = 'unverified', verified_amount = NULL, payment_verified_by = NULL, payment_verified_at = NULL`,
    [reason, a.userId, now()], "returned", reason);
}

export async function rejectSetup(sql: Sql, a: Actor, id: string, reasonIn: unknown) {
  const reason = requireReason(reasonIn);
  await ownerTransition(sql, a, id, ["submitted", "under_review", "returned"], `status = 'rejected', reject_reason = ?, rejected_by = ?, rejected_at = ?`, [reason, a.userId, now()], "rejected", reason);
}

/** The owner confirms the money arrived: the amount received and the reference must match what was reported. */
export async function verifyPayment(sql: Sql, a: Actor, id: string, input: { amount?: unknown; reference?: unknown; note?: unknown }) {
  requireOwner(a);
  const req = await one(sql, `SELECT * FROM onboarding_requests WHERE id = ?`, [id]);
  if (!req) throw new HttpError(404, "Setup not found.");
  if (!["submitted", "under_review"].includes(String(req.status))) throw new HttpError(409, "Payment can be verified only on a submitted setup.");
  const amount = num(input.amount);
  if (amount == null || !Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter the amount you received.");
  const reference = clean(input.reference, 80);
  if (!req.payment_reference) throw new HttpError(400, "The distributor has not reported a payment reference yet. Return the setup for correction.");
  if (reference.toLowerCase() !== String(req.payment_reference).trim().toLowerCase()) throw new HttpError(400, "The reference does not match the one the distributor reported.");
  const note = clean(input.note, 500);
  if (amount !== Number(req.expected_amount ?? 0) && note.length < 3) {
    throw new HttpError(400, `The amount differs from the plan price (${Number(req.expected_amount ?? 0)}). Add a note explaining why.`);
  }
  const t = now();
  const r = await sql.execute(
    `UPDATE onboarding_requests SET payment_status = 'verified', verified_amount = ?, payment_verified_by = ?, payment_verified_at = ?,
            status = 'under_review', review_started_by = COALESCE(review_started_by, ?), review_started_at = COALESCE(review_started_at, ?), updated_at = ?
     WHERE id = ? AND status IN ('submitted','under_review')`,
    [amount, a.userId, t, a.userId, t, t, id],
  );
  if (!r.rowsAffected) throw new HttpError(409, "This setup changed. Refresh and try again.");
  await event(sql, a, "payment_verified", { requestId: id, subSuperId: str(req.sub_super_id) }, note || `Received ${amount}, reference ${reference}`);
}

/** Why a setup cannot be activated right now (empty = it can). Rechecked at activation. */
export async function activationProblems(sql: Sql, req: Record<string, unknown>): Promise<string[]> {
  const p: string[] = [];
  if (req.status !== "under_review") p.push("Start the review first (or verify the payment).");
  if (req.payment_status !== "verified") p.push("Verify the payment first.");
  const s = await one(sql, `SELECT status FROM sub_supers WHERE id = ?`, [req.sub_super_id]);
  if (!s || s.status !== "active") p.push("The distributor is suspended.");
  if (!(await authorizedApps(sql, String(req.sub_super_id))).includes(String(req.app_id))) p.push("The distributor is no longer authorized to sell this application.");
  if (!(await one(sql, `SELECT 1 FROM subscription_plans WHERE id = ? AND deleted_at IS NULL`, [req.plan_id]))) p.push("The plan no longer exists.");
  if (await one(sql, `SELECT 1 FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL`, [req.proposed_username])) p.push("The login ID is now in use by another account.");
  return p;
}

const tenantIdFor = (requestId: string) => `t-${requestId}`;
const ownerIdFor = (requestId: string) => `u-${requestId}`;

/** Final approval: creates the tenant, its owner login (set up by a one-time link) and the subscription,
 * and records the sale for the distributor, exactly once. A repeat, a double-click or a concurrent
 * approval finds the setup already activated and creates nothing. */
export async function activate(sql: Sql, a: Actor, id: string): Promise<{ tenantId: string; setupToken: string | null; alreadyActivated: boolean }> {
  requireOwner(a);
  const req = await one(sql, `SELECT * FROM onboarding_requests WHERE id = ?`, [id]);
  if (!req) throw new HttpError(404, "Setup not found.");
  if (req.status === "activated") return { tenantId: String(req.tenant_id), setupToken: null, alreadyActivated: true };
  const problems = await activationProblems(sql, req);
  if (problems.length) throw new HttpError(409, problems.join(" "));

  const plan = (await one(sql, `SELECT * FROM subscription_plans WHERE id = ?`, [req.plan_id]))!;
  let planModules: string[] = [];
  try {
    const parsed = JSON.parse(String(plan.allowed_modules ?? "[]"));
    if (Array.isArray(parsed)) planModules = parsed.map(String);
  } catch {
    // a plan without a section list: the type's defaults
  }
  const key = randomUUID();
  const t = now();
  const expires = new Date(Date.now() + Number(plan.duration_days ?? 30) * 86_400_000).toISOString();
  const tenantId = tenantIdFor(id);
  const userId = ownerIdFor(id);
  const login = unusableLogin();
  const token = randomBytes(24).toString("base64url");
  // Every write after the first only happens if this attempt won the status change (its key is stored).
  const won = `EXISTS (SELECT 1 FROM onboarding_requests WHERE id = ? AND activation_key = ?)`;
  const [changed] = await sql.batch([
    {
      sql: `UPDATE onboarding_requests SET status = 'activated', activation_key = ?, activated_by = ?, activated_at = ?, tenant_id = ?, owner_user_id = ?,
                   sale_amount = verified_amount, invite_status = 'link_issued', invite_issued_at = ?, updated_at = ?
            WHERE id = ? AND status = 'under_review' AND payment_status = 'verified'
              AND EXISTS (SELECT 1 FROM sub_supers s WHERE s.id = onboarding_requests.sub_super_id AND s.status = 'active')
              AND EXISTS (SELECT 1 FROM sub_super_apps g WHERE g.sub_super_id = onboarding_requests.sub_super_id AND g.app_id = onboarding_requests.app_id AND g.revoked_at IS NULL)
              AND EXISTS (SELECT 1 FROM subscription_plans p WHERE p.id = onboarding_requests.plan_id AND p.deleted_at IS NULL)
              AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.username) = lower(onboarding_requests.proposed_username) AND u.deleted_at IS NULL)
              AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = ?)`,
      args: [key, a.userId, t, tenantId, userId, t, t, id, tenantId],
    },
    {
      sql: `INSERT INTO tenants (id, name, owner_name, phone, email, address, subscription_plan_id, subscription_status, subscription_started_at, subscription_expires_at,
                                 is_active, created_at, updated_at, mrp_discount_pct, business_type, allowed_modules, fbr_allowed, print_templates_editable)
            SELECT ?, business_name, owner_name, phone, email, address, plan_id, 'active', ?, ?, 1, ?, ?, 0, app_id, ?, 1, 1
            FROM onboarding_requests WHERE id = ? AND activation_key = ?`,
      args: [tenantId, t, expires, t, t, JSON.stringify(defaultModulesFor(businessType(String(req.app_id)), planModules)), id, key],
    },
    {
      sql: `INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, created_at, updated_at, deleted_at)
            SELECT ?, ?, proposed_username, ?, ?, 'owner', owner_name, 1, ?, ?, NULL FROM onboarding_requests WHERE id = ? AND activation_key = ?`,
      args: [userId, tenantId, login.hash, login.salt, t, t, id, key],
    },
    {
      sql: `INSERT INTO password_setup_tokens (id, user_id, token_hash, expires_at, used_at, created_by, created_at)
            SELECT ?, ?, ?, ?, NULL, ?, ? WHERE ${won}`,
      args: [randomUUID(), userId, sha256(token), new Date(Date.now() + SETUP_LINK_DAYS * 86_400_000).toISOString(), a.userId, t, id, key],
    },
    {
      sql: `INSERT INTO onboarding_events (id, request_id, sub_super_id, actor_user_id, actor_role, action, reason, created_at)
            SELECT ?, ?, sub_super_id, ?, 'owner', 'activated', NULL, ? FROM onboarding_requests WHERE id = ? AND activation_key = ?`,
      args: [randomUUID(), id, a.userId, t, id, key],
    },
  ]);
  if (changed) return { tenantId, setupToken: token, alreadyActivated: false };
  const after = await one(sql, `SELECT status, tenant_id FROM onboarding_requests WHERE id = ?`, [id]);
  if (after?.status === "activated") return { tenantId: String(after.tenant_id), setupToken: null, alreadyActivated: true };
  const again = after ? await activationProblems(sql, { ...req, ...after }) : ["Setup not found."];
  throw new HttpError(409, again.join(" ") || "This setup changed. Refresh and try again.");
}

/** A new one-time sign-in setup link for an activated customer (the previous one stops working). */
export async function reissueCustomerLink(sql: Sql, a: Actor, id: string): Promise<string> {
  requireOwner(a);
  const req = await one(sql, `SELECT status, owner_user_id, sub_super_id FROM onboarding_requests WHERE id = ?`, [id]);
  if (!req || req.status !== "activated" || !req.owner_user_id) throw new HttpError(409, "Only an activated customer has a sign-in link.");
  const token = await issueSetupToken(sql, String(req.owner_user_id), a.userId);
  await sql.execute(`UPDATE onboarding_requests SET invite_status = 'link_issued', invite_issued_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id]);
  await event(sql, a, "customer_link_issued", { requestId: id, subSuperId: str(req.sub_super_id) });
  return token;
}

// ── Sales performance ────────────────────────────────────────────────────

/** UTC instant of local midnight on the 1st of month (0-11) in a time zone. */
export function zonedMonthStart(year: number, month: number, tz = BUSINESS_TIMEZONE): Date {
  const guess = Date.UTC(year, month, 1);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(guess)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]),
  );
  const asLocal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess - (asLocal - guess));
}

/** Month (0-11) of an instant in a time zone. */
const zonedMonth = (iso: string, tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(new Date(iso))) - 1;

export interface SalesFilter { year: number; appId?: string | null; subSuperId?: string | null; rankBy?: "amount" | "count"; tz?: string }

/** Yearly sales by distributor. A sale = an activated setup, counted once, in the month of its activation
 * (business time zone), for the distributor it was activated under, at the verified amount. Pending and
 * rejected setups are counted separately and never as sales. There are no refunds or reversals in the
 * system yet, so revenue is the verified amount of activated setups. */
export async function salesReport(sql: Sql, a: Actor, f: SalesFilter) {
  const tz = f.tz ?? BUSINESS_TIMEZONE;
  const year = Math.trunc(Number(f.year));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) throw new HttpError(400, "Choose a year.");
  const only = a.kind === "distributor" ? a.subSuperId : f.subSuperId ?? null;
  const from = zonedMonthStart(year, 0, tz).toISOString();
  const to = zonedMonthStart(year + 1, 0, tz).toISOString();
  const app = f.appId && isApp(f.appId) ? f.appId : null;
  const where = (col: string) => `${col} >= ? AND ${col} < ?${app ? " AND app_id = ?" : ""}${only ? " AND sub_super_id = ?" : ""}`;
  const args = [from, to, ...(app ? [app] : []), ...(only ? [only] : [])];

  const supers = (await sql.execute(`SELECT id, name, status FROM sub_supers${only ? " WHERE id = ?" : ""} ORDER BY name`, only ? [only] : [])).rows;
  const sales = (await sql.execute(
    `SELECT id, sub_super_id, app_id, business_name, activated_at, sale_amount FROM onboarding_requests WHERE status = 'activated' AND ${where("activated_at")} ORDER BY activated_at`, args,
  )).rows;
  const counts = async (col: string, extra = "") =>
    new Map((await sql.execute(`SELECT sub_super_id, COUNT(*) AS n FROM onboarding_requests WHERE ${where(col)}${extra} GROUP BY sub_super_id`, args)).rows.map((r) => [String(r.sub_super_id), Number(r.n)]));
  const submitted = await counts("submitted_at");
  const rejected = await counts("rejected_at", " AND status = 'rejected'");
  const pending = new Map((await sql.execute(
    `SELECT sub_super_id, COUNT(*) AS n FROM onboarding_requests WHERE status IN ('submitted','under_review')${app ? " AND app_id = ?" : ""}${only ? " AND sub_super_id = ?" : ""} GROUP BY sub_super_id`,
    [...(app ? [app] : []), ...(only ? [only] : [])],
  )).rows.map((r) => [String(r.sub_super_id), Number(r.n)]));

  const rows = supers.map((s) => {
    const mine = sales.filter((x) => x.sub_super_id === s.id);
    const months = Array.from({ length: 12 }, () => ({ count: 0, amount: 0 }));
    const byApp: Record<string, { count: number; amount: number }> = {};
    for (const x of mine) {
      const m = months[zonedMonth(String(x.activated_at), tz)];
      const amt = Number(x.sale_amount ?? 0);
      m.count++;
      m.amount += amt;
      const k = String(x.app_id);
      byApp[k] = { count: (byApp[k]?.count ?? 0) + 1, amount: (byApp[k]?.amount ?? 0) + amt };
    }
    return {
      id: String(s.id), name: String(s.name), status: String(s.status),
      submitted: submitted.get(String(s.id)) ?? 0, pending: pending.get(String(s.id)) ?? 0, rejected: rejected.get(String(s.id)) ?? 0,
      salesCount: mine.length, salesAmount: mine.reduce((t, x) => t + Number(x.sale_amount ?? 0), 0),
      byApp: Object.entries(byApp).map(([appId, v]) => ({ appId, label: businessType(appId).label, ...v })),
      months,
      records: mine.map((x) => ({ id: String(x.id), businessName: str(x.business_name), appId: String(x.app_id), activatedAt: String(x.activated_at), amount: Number(x.sale_amount ?? 0) })),
    };
  });
  const by = f.rankBy === "count" ? "salesCount" : "salesAmount";
  const other = by === "salesCount" ? "salesAmount" : "salesCount";
  const ranked = [...rows].sort((x, y) => y[by] - x[by] || y[other] - x[other] || x.name.localeCompare(y.name));
  return { year, timezone: tz, rankBy: f.rankBy === "count" ? "count" : "amount", top: ranked[0] && ranked[0][by] > 0 ? ranked[0] : null, leaderboard: ranked };
}
