/** Multi-branch (Enterprise): one business (tenant) with several branches.
 *
 *  - Allowance: the plan's branch_limit (Enterprise 5, others 1), or the Super
 *    Admin's override for the business, or unlimited. The main branch counts.
 *    Every branch counts until the Super Admin releases an archived branch's
 *    place (audited), so archiving and re-creating cannot get round the limit.
 *    A lower limit never hides or deletes branches: creating more is blocked.
 *  - Creation is one conditional INSERT (the count is checked inside the same
 *    statement), so two requests at once cannot pass the limit.
 *  - Access: the owner reaches every branch; other logins the branches they
 *    are assigned to (the main branch when none). The active branch comes from
 *    the request and is checked against that list on every call; "all" is for
 *    reports and refuses writes to branch records (tenantScope.ts).
 *  - Stock transfers move batch stock between branches in one transaction:
 *    dispatch takes it off the source batch, receipt adds it at the
 *    destination; nothing is a sale or a purchase. */
import { randomUUID } from "node:crypto";
import type { Sql } from "./subSupers";
import type { Caller } from "./sqlPolicy";
import { HttpError } from "./db";
import { BRANCH_UNAVAILABLE, mainBranchId } from "@/config/branchTables";

export interface Branch {
  id: string; code: string; name: string; isMain: boolean; status: BranchStatus;
  address: string | null; phone: string | null; email: string | null; managerUserId: string | null;
  hours: string | null; onlineFulfillment: boolean; capacityReleased: boolean; createdAt: string;
}
export type BranchStatus = "active" | "inactive" | "archived";
export const BRANCH_STATUSES: BranchStatus[] = ["active", "inactive", "archived"];

/** The branch scope of one request (tenantScope.ts). active null = All Branches (reports only). */
export interface BranchScope { active: string | null; accessible: string[]; mainId: string; writable: boolean }

const WRITE_BLOCKED_GUARD = `INSERT INTO web_guard (x) SELECT 1 WHERE changes() = 0`;

const iso = (d = new Date()) => d.toISOString();
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const opt = (v: unknown, max: number) => str(v, max) || null;

function mapBranch(r: Record<string, unknown>): Branch {
  return {
    id: String(r.id), code: String(r.code), name: String(r.name), isMain: Number(r.is_main) === 1,
    status: (BRANCH_STATUSES.includes(r.status as BranchStatus) ? r.status : "active") as BranchStatus,
    address: (r.address as string | null) ?? null, phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null,
    managerUserId: (r.manager_user_id as string | null) ?? null, hours: (r.hours as string | null) ?? null,
    onlineFulfillment: Number(r.online_fulfillment) === 1, capacityReleased: Number(r.capacity_released) === 1, createdAt: String(r.created_at),
  };
}

function tenantOf(caller: Caller): string {
  if (caller.role === "super_admin" || !caller.tenantId) throw new HttpError(403, "This is for a business login.");
  return caller.tenantId;
}
function ownerOnly(caller: Caller): string {
  const t = tenantOf(caller);
  if (caller.role !== "owner") throw new HttpError(403, "Only the business owner manages branches.");
  return t;
}

/** Every business has a main branch (made by migration v79; a business created later gets it here). */
export async function ensureMainBranch(sql: Sql, tenantId: string): Promise<void> {
  const now = iso();
  await sql.execute(
    `INSERT OR IGNORE INTO branches (id, tenant_id, code, name, is_main, status, address, phone, email, online_fulfillment, created_at, updated_at)
     SELECT ?, id, 'MAIN', 'Main Branch', 1, 'active', address, phone, email, 1, ?, ? FROM tenants WHERE id = ?`,
    [mainBranchId(tenantId), now, now, tenantId],
  );
}

export async function listBranches(sql: Sql, tenantId: string): Promise<Branch[]> {
  let rows = (await sql.execute(`SELECT * FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, name`, [tenantId])).rows;
  if (!rows.length) {
    await ensureMainBranch(sql, tenantId);
    rows = (await sql.execute(`SELECT * FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, name`, [tenantId])).rows;
  }
  return rows.map(mapBranch);
}

// ── Allowance ─────────────────────────────────────────────────────────────

export interface Allowance {
  planName: string | null;
  /** The plan's own number of branches (Enterprise 5, others 1). */
  planLimit: number;
  /** The Super Admin's number for this business (null = the plan's). */
  override: number | null;
  unlimited: boolean;
  /** Super Admin turned multi-branch off: only the main branch is used (others are kept). */
  disabled: boolean;
  /** Approved total (null = unlimited). */
  limit: number | null;
  /** Branches holding a place (every branch unless its place was released). */
  used: number;
  remaining: number | null;
  overLimit: boolean;
  /** Multi-branch is on for this business. */
  entitled: boolean;
}

/** The SQL number of branches a business may have (NULL = unlimited); `t` is the tenant id expression. */
const LIMIT_SQL = (t: string) => `CASE WHEN (SELECT branch_unlimited FROM tenants WHERE id = ${t}) = 1 THEN NULL
  ELSE COALESCE((SELECT branch_limit FROM tenants WHERE id = ${t}),
                (SELECT p.branch_limit FROM tenants x JOIN subscription_plans p ON p.id = x.subscription_plan_id WHERE x.id = ${t}), 1) END`;
const USED_SQL = (t: string) => `(SELECT COUNT(*) FROM branches WHERE tenant_id = ${t} AND capacity_released = 0)`;

export async function allowance(sql: Sql, tenantId: string): Promise<Allowance> {
  const r = (await sql.execute(
    `SELECT t.branch_limit AS override, t.branch_unlimited, t.multi_branch_disabled, p.name AS plan_name, p.branch_limit AS plan_limit, ${USED_SQL("t.id")} AS used
     FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.subscription_plan_id WHERE t.id = ?`,
    [tenantId],
  )).rows[0];
  if (!r) throw new HttpError(404, "Business not found.");
  const planLimit = Math.max(1, Number(r.plan_limit) || 1);
  const override = r.override == null ? null : Math.max(1, Number(r.override));
  const unlimited = Number(r.branch_unlimited) === 1;
  const disabled = Number(r.multi_branch_disabled) === 1;
  const limit = unlimited ? null : override ?? planLimit;
  const used = Math.max(1, Number(r.used) || 0);
  return {
    planName: (r.plan_name as string | null) ?? null, planLimit, override, unlimited, disabled, limit, used,
    remaining: limit == null ? null : Math.max(0, limit - used), overLimit: limit != null && used > limit,
    entitled: !disabled && (limit == null || limit > 1),
  };
}

// ── Access and the request's branch ──────────────────────────────────────

interface AccessInfo { branches: Branch[]; accessible: string[]; managed: string[]; mainId: string; disabled: boolean }

/** Branches a login may open, and those it manages (transfers, branch reports). */
export async function accessFor(sql: Sql, caller: Caller): Promise<AccessInfo> {
  const tenantId = tenantOf(caller);
  const branches = await listBranches(sql, tenantId);
  const mainId = branches.find((b) => b.isMain)?.id ?? mainBranchId(tenantId);
  const flags = (await sql.execute(`SELECT multi_branch_disabled FROM tenants WHERE id = ?`, [tenantId])).rows[0];
  const disabled = Number(flags?.multi_branch_disabled) === 1;
  if (disabled) return { branches: branches.filter((b) => b.id === mainId), accessible: [mainId], managed: caller.role === "owner" ? [mainId] : [], mainId, disabled };
  if (caller.role === "owner") {
    const ids = branches.map((b) => b.id);
    return { branches, accessible: ids, managed: ids, mainId, disabled };
  }
  const rows = (await sql.execute(`SELECT branch_id, is_manager FROM branch_users WHERE tenant_id = ? AND user_id = ?`, [tenantId, caller.userId])).rows;
  const known = new Set(branches.map((b) => b.id));
  const assigned = rows.map((r) => String(r.branch_id)).filter((id) => known.has(id));
  const accessible = assigned.length ? assigned : [mainId];
  return {
    branches: branches.filter((b) => accessible.includes(b.id)), accessible,
    managed: rows.filter((r) => Number(r.is_manager) === 1 && known.has(String(r.branch_id))).map((r) => String(r.branch_id)), mainId, disabled,
  };
}

const scopeCache = new Map<string, { at: number; info: AccessInfo }>();
const SCOPE_TTL_MS = 5_000;
export function clearBranchCache(): void { scopeCache.clear(); }

/** The branch scope of a business login's request. `requested` is the tab's
 * choice (an id, "all", or nothing = the default branch); it is only used when
 * this login may open it. Undefined before migration v79 (no branches table). */
export async function branchScopeFor(sql: Sql, caller: Caller, requested: string | null | undefined): Promise<BranchScope | undefined> {
  if (caller.role === "super_admin" || !caller.tenantId) return undefined;
  let info: AccessInfo;
  const hit = scopeCache.get(caller.userId);
  if (hit && Date.now() - hit.at < SCOPE_TTL_MS) info = hit.info;
  else {
    try {
      info = await accessFor(sql, caller);
    } catch (e) {
      if (/no such (table|column)/i.test(String((e as Error)?.message))) return undefined;
      throw e;
    }
    scopeCache.set(caller.userId, { at: Date.now(), info });
  }
  const want = (requested ?? "").trim();
  let active: string | null;
  if (want === "all") active = info.accessible.length > 1 ? null : info.accessible[0];
  else if (want) {
    if (!info.accessible.includes(want)) throw new HttpError(409, BRANCH_UNAVAILABLE);
    active = want;
  } else active = info.accessible.includes(info.mainId) ? info.mainId : info.accessible[0];
  const status = active ? info.branches.find((b) => b.id === active)?.status : undefined;
  return { active, accessible: info.accessible, mainId: info.mainId, writable: active != null && status === "active" };
}

/** What the browser shows: the branches this login may open and the allowance. */
export async function branchContext(sql: Sql, caller: Caller, requested: string | null) {
  const tenantId = tenantOf(caller);
  const info = await accessFor(sql, caller);
  const scope = await branchScopeFor(sql, caller, requested).catch((e) => {
    if (e instanceof HttpError && e.status === 409) return branchScopeFor(sql, caller, null);
    throw e;
  });
  const a = await allowance(sql, tenantId);
  const pending = (await sql.execute(`SELECT id, extra, reason, created_at FROM branch_capacity_requests WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
  return {
    branches: info.branches, mainId: info.mainId, active: scope?.active ?? null, managed: info.managed,
    isOwner: caller.role === "owner", allowance: a,
    pendingRequest: pending ? { id: String(pending.id), extra: Number(pending.extra), reason: (pending.reason as string | null) ?? null, createdAt: String(pending.created_at) } : null,
  };
}

// ── Audit ─────────────────────────────────────────────────────────────────

const auditStmt = (tenantId: string, branchId: string | null, caller: Caller, action: string, detail: unknown) => ({
  sql: `INSERT INTO branch_audit (id, tenant_id, branch_id, actor_user_id, actor_role, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [randomUUID(), tenantId, branchId, caller.userId, caller.role, action, detail == null ? null : JSON.stringify(detail), iso()],
});

export async function auditLog(sql: Sql, tenantId: string, limit = 50) {
  return (await sql.execute(
    `SELECT a.*, b.name AS branch_name, u.username FROM branch_audit a LEFT JOIN branches b ON b.id = a.branch_id LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.tenant_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    [tenantId, Math.min(200, limit)],
  )).rows.map((r) => ({
    id: String(r.id), branchId: (r.branch_id as string | null) ?? null, branchName: (r.branch_name as string | null) ?? null,
    actor: (r.username as string | null) ?? (r.actor_role === "super_admin" ? "Super Admin" : null), action: String(r.action),
    detail: r.detail ? (JSON.parse(String(r.detail)) as unknown) : null, createdAt: String(r.created_at),
  }));
}

// ── Branches (owner) ──────────────────────────────────────────────────────

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

function branchInput(input: Record<string, unknown>) {
  const name = str(input.name, 80);
  if (!name) throw new HttpError(400, "Enter the branch name.");
  return {
    name, address: opt(input.address, 300), phone: opt(input.phone, 40), email: opt(input.email, 120),
    managerUserId: opt(input.managerUserId, 64), hours: opt(input.hours, 200),
  };
}

async function checkManager(sql: Sql, tenantId: string, userId: string | null) {
  if (!userId) return;
  const u = (await sql.execute(`SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [userId, tenantId])).rows[0];
  if (!u) throw new HttpError(400, "The branch manager must be a login of this business.");
}

/** A new branch, only while the business is within its approved number of branches. */
export async function createBranch(sql: Sql, caller: Caller, input: Record<string, unknown>): Promise<Branch> {
  const tenantId = ownerOnly(caller);
  await ensureMainBranch(sql, tenantId);
  const code = str(input.code, 12).toUpperCase();
  if (!CODE_RE.test(code)) throw new HttpError(400, "Branch code: 1 to 12 letters, digits or dashes (for example LHR-2).");
  const f = branchInput(input);
  await checkManager(sql, tenantId, f.managerUserId);
  if ((await sql.execute(`SELECT 1 FROM branches WHERE tenant_id = ? AND code = ?`, [tenantId, code])).rows[0]) throw new HttpError(409, `Branch code ${code} is already used in this business.`);
  const id = randomUUID();
  const now = iso();
  try {
    await sql.batch([
      {
        // The count and the limit are read inside this one statement.
        sql: `INSERT INTO branches (id, tenant_id, code, name, is_main, status, address, phone, email, manager_user_id, hours, online_fulfillment, capacity_released, created_by, created_at, updated_at)
              SELECT ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, 0, 0, ?, ?, ?
              WHERE (SELECT multi_branch_disabled FROM tenants WHERE id = ?) = 0
                AND (${LIMIT_SQL("?")} IS NULL OR ${USED_SQL("?")} < ${LIMIT_SQL("?")})`,
        args: [id, tenantId, code, f.name, f.address, f.phone, f.email, f.managerUserId, f.hours, caller.userId, now, now, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId],
      },
      { sql: WRITE_BLOCKED_GUARD },
      ...(f.managerUserId ? [{ sql: `INSERT OR IGNORE INTO branch_users (id, tenant_id, branch_id, user_id, is_manager, created_at) VALUES (?, ?, ?, ?, 1, ?)`, args: [randomUUID(), tenantId, id, f.managerUserId, now] }] : []),
      auditStmt(tenantId, id, caller, "branch.created", { code, name: f.name }),
    ]);
  } catch (e) {
    const msg = String((e as Error)?.message);
    if (/CHECK constraint/i.test(msg)) {
      const a = await allowance(sql, tenantId);
      if (a.disabled) throw new HttpError(403, "Multi-branch is turned off for this business. Contact MAVIN.pk.");
      throw new HttpError(409, `Branch limit reached: ${a.used} of ${a.limit} branches. Request more branches; the Super Admin approves a higher limit.`);
    }
    if (/UNIQUE/i.test(msg)) throw new HttpError(409, `Branch code ${code} is already used in this business.`);
    throw e;
  }
  clearBranchCache();
  return (await listBranches(sql, tenantId)).find((b) => b.id === id)!;
}

export async function updateBranch(sql: Sql, caller: Caller, id: string, input: Record<string, unknown>): Promise<Branch> {
  const tenantId = ownerOnly(caller);
  const cur = (await listBranches(sql, tenantId)).find((b) => b.id === id);
  if (!cur) throw new HttpError(404, "Branch not found.");
  const f = branchInput({ ...cur, ...input });
  await checkManager(sql, tenantId, f.managerUserId);
  const online = input.onlineFulfillment === undefined ? cur.onlineFulfillment : Boolean(input.onlineFulfillment);
  const stmts = [
    ...(online && !cur.onlineFulfillment ? [{ sql: `UPDATE branches SET online_fulfillment = 0 WHERE tenant_id = ?`, args: [tenantId] }] : []),
    {
      sql: `UPDATE branches SET name = ?, address = ?, phone = ?, email = ?, manager_user_id = ?, hours = ?, online_fulfillment = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      args: [f.name, f.address, f.phone, f.email, f.managerUserId, f.hours, online ? 1 : 0, iso(), id, tenantId],
    },
    ...(f.managerUserId ? [{ sql: `INSERT INTO branch_users (id, tenant_id, branch_id, user_id, is_manager, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(branch_id, user_id) DO UPDATE SET is_manager = 1`, args: [randomUUID(), tenantId, id, f.managerUserId, iso()] }] : []),
    auditStmt(tenantId, id, caller, "branch.updated", { name: f.name, onlineFulfillment: online, manager: f.managerUserId }),
  ];
  // The web store always has one fulfillment branch: switching it off here hands it back to the main branch.
  if (!online && cur.onlineFulfillment) stmts.push({ sql: `UPDATE branches SET online_fulfillment = 1 WHERE tenant_id = ? AND is_main = 1 AND id != ?`, args: [tenantId, id] });
  await sql.batch(stmts);
  clearBranchCache();
  return (await listBranches(sql, tenantId)).find((b) => b.id === id)!;
}

/** Active, inactive (no new records) or archived (kept for reports and audit; still holds its place). */
export async function setBranchStatus(sql: Sql, caller: Caller, id: string, status: unknown, reason: unknown): Promise<Branch> {
  const tenantId = ownerOnly(caller);
  if (!BRANCH_STATUSES.includes(status as BranchStatus)) throw new HttpError(400, "Unknown status.");
  const cur = (await listBranches(sql, tenantId)).find((b) => b.id === id);
  if (!cur) throw new HttpError(404, "Branch not found.");
  if (cur.isMain && status !== "active") throw new HttpError(400, "The main branch stays active.");
  if (cur.status === "archived" && cur.capacityReleased && status !== "archived") throw new HttpError(400, "This branch's place was released by the Super Admin; it stays archived.");
  if (status !== "active") {
    const open = (await sql.execute(`SELECT COUNT(*) AS n FROM branch_transfers WHERE tenant_id = ? AND status = 'in_transit' AND (from_branch_id = ? OR to_branch_id = ?)`, [tenantId, id, id])).rows[0];
    if (Number(open?.n) > 0) throw new HttpError(409, "Receive or cancel this branch's stock transfers in transit first.");
  }
  await sql.batch([
    { sql: `UPDATE branches SET status = ?, online_fulfillment = CASE WHEN ? = 'active' THEN online_fulfillment ELSE 0 END, updated_at = ? WHERE id = ? AND tenant_id = ?`, args: [status, status, iso(), id, tenantId] },
    // The web store falls back to the main branch when its fulfillment branch closes.
    { sql: `UPDATE branches SET online_fulfillment = 1 WHERE tenant_id = ? AND is_main = 1 AND NOT EXISTS (SELECT 1 FROM branches WHERE tenant_id = ? AND online_fulfillment = 1 AND status = 'active')`, args: [tenantId, tenantId] },
    auditStmt(tenantId, id, caller, `branch.${status}`, { from: cur.status, reason: opt(reason, 300) }),
  ]);
  clearBranchCache();
  return (await listBranches(sql, tenantId)).find((b) => b.id === id)!;
}

/** Logins of the business with their branches (for assignment). */
export async function branchUsers(sql: Sql, caller: Caller) {
  const tenantId = ownerOnly(caller);
  const users = (await sql.execute(`SELECT id, username, display_name, role, is_active FROM users WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY role DESC, username`, [tenantId])).rows;
  const links = (await sql.execute(`SELECT branch_id, user_id, is_manager FROM branch_users WHERE tenant_id = ?`, [tenantId])).rows;
  return users.map((u) => ({
    id: String(u.id), username: String(u.username), name: (u.display_name as string | null) ?? null, role: String(u.role), active: Number(u.is_active) === 1,
    branches: links.filter((l) => l.user_id === u.id).map((l) => ({ branchId: String(l.branch_id), manager: Number(l.is_manager) === 1 })),
  }));
}

/** A login's branches (replaces its list). The owner always has every branch. */
export async function assignUser(sql: Sql, caller: Caller, userId: string, list: unknown) {
  const tenantId = ownerOnly(caller);
  const u = (await sql.execute(`SELECT role FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [userId, tenantId])).rows[0];
  if (!u) throw new HttpError(404, "Login not found.");
  if (u.role === "owner") throw new HttpError(400, "The owner has every branch.");
  const ids = new Set((await listBranches(sql, tenantId)).map((b) => b.id));
  const items = (Array.isArray(list) ? list : []).map((x) => (x ?? {}) as { branchId?: unknown; manager?: unknown })
    .filter((x) => typeof x.branchId === "string" && ids.has(x.branchId));
  const now = iso();
  await sql.batch([
    { sql: `DELETE FROM branch_users WHERE tenant_id = ? AND user_id = ?`, args: [tenantId, userId] },
    ...items.map((x) => ({ sql: `INSERT INTO branch_users (id, tenant_id, branch_id, user_id, is_manager, created_at) VALUES (?, ?, ?, ?, ?, ?)`, args: [randomUUID(), tenantId, x.branchId, userId, x.manager ? 1 : 0, now] })),
    auditStmt(tenantId, null, caller, "branch.users_assigned", { userId, branches: items.map((x) => ({ branchId: x.branchId, manager: Boolean(x.manager) })) }),
  ]);
  clearBranchCache();
  return { ok: true };
}

// ── Capacity requests ─────────────────────────────────────────────────────

export async function requestCapacity(sql: Sql, caller: Caller, extra: unknown, reason: unknown) {
  const tenantId = ownerOnly(caller);
  const n = Math.round(Number(extra));
  if (!Number.isFinite(n) || n < 1 || n > 100) throw new HttpError(400, "Ask for 1 to 100 more branches.");
  const a = await allowance(sql, tenantId);
  if (a.disabled) throw new HttpError(403, "Multi-branch is turned off for this business. Contact MAVIN.pk.");
  if (a.limit == null) throw new HttpError(400, "This business already has unlimited branches.");
  if ((await sql.execute(`SELECT 1 FROM branch_capacity_requests WHERE tenant_id = ? AND status = 'pending'`, [tenantId])).rows[0]) throw new HttpError(409, "A request is already waiting for the Super Admin.");
  const id = randomUUID();
  await sql.batch([
    { sql: `INSERT INTO branch_capacity_requests (id, tenant_id, requested_by, extra, current_limit, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, args: [id, tenantId, caller.userId, n, a.limit, opt(reason, 500), iso()] },
    auditStmt(tenantId, null, caller, "capacity.requested", { extra: n, currentLimit: a.limit }),
  ]);
  return { id };
}

export async function cancelCapacityRequest(sql: Sql, caller: Caller, id: string) {
  const tenantId = ownerOnly(caller);
  const n = await sql.execute(`UPDATE branch_capacity_requests SET status = 'cancelled', decided_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'`, [iso(), id, tenantId]);
  if (!n.rowsAffected) throw new HttpError(404, "No pending request.");
  return { ok: true };
}

// ── Super Admin ───────────────────────────────────────────────────────────

function superOnly(caller: Caller) {
  if (caller.role !== "super_admin") throw new HttpError(403, "Only the Super Admin changes branch limits.");
}

export async function adminTenantBranches(sql: Sql, caller: Caller, tenantId: string) {
  superOnly(caller);
  const branches = await listBranches(sql, tenantId);
  const requests = (await sql.execute(
    `SELECT r.*, u.username FROM branch_capacity_requests r LEFT JOIN users u ON u.id = r.requested_by WHERE r.tenant_id = ? ORDER BY r.created_at DESC LIMIT 50`, [tenantId],
  )).rows.map((r) => ({
    id: String(r.id), extra: Number(r.extra), currentLimit: r.current_limit == null ? null : Number(r.current_limit), reason: (r.reason as string | null) ?? null,
    status: String(r.status), approvedLimit: r.approved_limit == null ? null : Number(r.approved_limit), decisionNote: (r.decision_note as string | null) ?? null,
    requestedBy: (r.username as string | null) ?? null, createdAt: String(r.created_at), decidedAt: (r.decided_at as string | null) ?? null,
  }));
  return { allowance: await allowance(sql, tenantId), branches, requests, audit: await auditLog(sql, tenantId, 100) };
}

/** Limit (null = the plan's), unlimited, and multi-branch on/off. Never touches branch records. */
export async function setBranchPolicy(sql: Sql, caller: Caller, tenantId: string, input: Record<string, unknown>) {
  superOnly(caller);
  const before = await allowance(sql, tenantId);
  const limit = input.limit === null || input.limit === "" || input.limit === undefined ? null : Math.round(Number(input.limit));
  if (limit != null && (!Number.isFinite(limit) || limit < 1 || limit > 10_000)) throw new HttpError(400, "The branch limit is a number from 1.");
  const unlimited = Boolean(input.unlimited);
  const disabled = Boolean(input.disabled);
  await sql.batch([
    { sql: `UPDATE tenants SET branch_limit = ?, branch_unlimited = ?, multi_branch_disabled = ?, updated_at = ? WHERE id = ?`, args: [limit, unlimited ? 1 : 0, disabled ? 1 : 0, iso(), tenantId] },
    auditStmt(tenantId, null, caller, "capacity.policy_changed", { before: { limit: before.override, unlimited: before.unlimited, disabled: before.disabled }, after: { limit, unlimited, disabled }, note: opt(input.note, 300) }),
  ]);
  clearBranchCache();
  return adminTenantBranches(sql, caller, tenantId);
}

/** Approving raises the business's limit (it never creates a branch). */
export async function decideCapacityRequest(sql: Sql, caller: Caller, id: string, approve: boolean, input: Record<string, unknown>) {
  superOnly(caller);
  const r = (await sql.execute(`SELECT * FROM branch_capacity_requests WHERE id = ?`, [id])).rows[0];
  if (!r || r.status !== "pending") throw new HttpError(404, "No pending request.");
  const tenantId = String(r.tenant_id);
  const note = opt(input.note, 500);
  if (!approve && !note) throw new HttpError(400, "Give a reason for rejecting.");
  const a = await allowance(sql, tenantId);
  const fallback = (a.limit ?? a.used) + Number(r.extra);
  const newLimit = approve ? Math.round(Number(input.limit ?? fallback)) : null;
  if (approve && (!Number.isFinite(newLimit) || newLimit! < 1)) throw new HttpError(400, "Enter the new total number of branches.");
  const now = iso();
  await sql.batch([
    { sql: `UPDATE branch_capacity_requests SET status = ?, approved_limit = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'`, args: [approve ? "approved" : "rejected", newLimit, caller.userId, now, note, id] },
    { sql: WRITE_BLOCKED_GUARD },
    ...(approve ? [{ sql: `UPDATE tenants SET branch_limit = ?, updated_at = ? WHERE id = ?`, args: [newLimit, now, tenantId] }] : []),
    auditStmt(tenantId, null, caller, approve ? "capacity.approved" : "capacity.rejected", { requestId: id, extra: Number(r.extra), from: a.limit, to: newLimit, note }),
  ]);
  clearBranchCache();
  return adminTenantBranches(sql, caller, tenantId);
}

/** Frees an archived branch's place (its records stay). */
export async function releaseCapacity(sql: Sql, caller: Caller, branchId: string, note: unknown) {
  superOnly(caller);
  const b = (await sql.execute(`SELECT tenant_id, status, is_main, capacity_released FROM branches WHERE id = ?`, [branchId])).rows[0];
  if (!b) throw new HttpError(404, "Branch not found.");
  if (b.status !== "archived" || Number(b.is_main) === 1) throw new HttpError(400, "Only an archived branch's place can be released.");
  if (Number(b.capacity_released) === 1) throw new HttpError(409, "Already released.");
  const why = opt(note, 300);
  if (!why) throw new HttpError(400, "Give a reason for releasing the place.");
  await sql.batch([
    { sql: `UPDATE branches SET capacity_released = 1, updated_at = ? WHERE id = ?`, args: [iso(), branchId] },
    auditStmt(String(b.tenant_id), branchId, caller, "capacity.released", { note: why }),
  ]);
  clearBranchCache();
  return adminTenantBranches(sql, caller, String(b.tenant_id));
}

/** Businesses with a pending capacity request (Super Admin list badge). */
export async function pendingCapacityRequests(sql: Sql, caller: Caller) {
  superOnly(caller);
  return (await sql.execute(`SELECT r.id, r.tenant_id, t.name, r.extra, r.created_at FROM branch_capacity_requests r JOIN tenants t ON t.id = r.tenant_id WHERE r.status = 'pending' ORDER BY r.created_at`)).rows
    .map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), tenantName: String(r.name), extra: Number(r.extra), createdAt: String(r.created_at) }));
}

// ── Stock transfers ───────────────────────────────────────────────────────

async function mustManage(sql: Sql, caller: Caller, branchId: string, what: string) {
  const info = await accessFor(sql, caller);
  const b = info.branches.find((x) => x.id === branchId);
  if (!b || !info.managed.includes(branchId)) throw new HttpError(403, `You cannot ${what} for this branch. The owner or that branch's manager can.`);
  return { info, branch: b };
}

/** Batches with stock in a branch the caller manages (to pick what to send). */
export async function transferableBatches(sql: Sql, caller: Caller, branchId: string, q: unknown) {
  const tenantId = tenantOf(caller);
  const { info } = await mustManage(sql, caller, branchId, "send stock");
  const term = str(q, 60);
  const isMain = branchId === info.mainId;
  return (await sql.execute(
    `SELECT b.id, b.product_id, p.name, b.batch_no, b.expiry_date, b.qty, b.purchase_price FROM product_batches b JOIN products p ON p.id = b.product_id
     WHERE b.tenant_id = ? AND (b.branch_id = ?${isMain ? " OR b.branch_id IS NULL" : ""}) AND b.deleted_at IS NULL AND b.qty > 0
       ${term ? "AND (p.name LIKE ? OR p.barcode = ? OR b.batch_no LIKE ?)" : ""}
     ORDER BY p.name, b.expiry_date LIMIT 50`,
    [tenantId, branchId, ...(term ? [`%${term}%`, term, `%${term}%`] : [])],
  )).rows.map((r) => ({
    batchId: String(r.id), productId: String(r.product_id), name: String(r.name), batchNo: (r.batch_no as string | null) ?? null,
    expiry: (r.expiry_date as string | null) ?? null, qty: Number(r.qty), purchasePrice: Number(r.purchase_price) || 0,
  }));
}

/** Dispatch: stock leaves the source batches now and is in transit until received. */
export async function createTransfer(sql: Sql, caller: Caller, input: Record<string, unknown>) {
  const tenantId = tenantOf(caller);
  const from = str(input.fromBranchId, 64);
  const to = str(input.toBranchId, 64);
  if (!from || !to || from === to) throw new HttpError(400, "Choose two different branches.");
  const { info } = await mustManage(sql, caller, from, "send stock");
  const all = await listBranches(sql, tenantId);
  const dest = all.find((b) => b.id === to);
  const src = all.find((b) => b.id === from)!;
  if (!dest || dest.status !== "active" || src.status !== "active") throw new HttpError(400, "Both branches must be active.");
  const lines = (Array.isArray(input.items) ? input.items : []).map((x) => (x ?? {}) as { batchId?: unknown; qty?: unknown });
  if (!lines.length || lines.length > 100) throw new HttpError(400, "Add 1 to 100 lines.");
  const merged = new Map<string, number>();
  for (const l of lines) {
    const q = Number(l.qty);
    if (typeof l.batchId !== "string" || !Number.isFinite(q) || q <= 0) throw new HttpError(400, "Each line needs a batch and a quantity above 0.");
    merged.set(l.batchId, (merged.get(l.batchId) ?? 0) + q);
  }
  const key = opt(input.idempotencyKey, 80);
  if (key) {
    const prev = (await sql.execute(`SELECT id FROM branch_transfers WHERE tenant_id = ? AND idempotency_key = ?`, [tenantId, key])).rows[0];
    if (prev) return { id: String(prev.id), repeated: true };
  }
  const id = randomUUID();
  const now = iso();
  const fromIsMain = from === info.mainId;
  const inFrom = `(branch_id = ?${fromIsMain ? " OR branch_id IS NULL" : ""})`;
  const stmts: { sql: string; args?: unknown[] }[] = [{
    sql: `INSERT INTO branch_transfers (id, tenant_id, transfer_no, from_branch_id, to_branch_id, status, note, idempotency_key, created_by, dispatched_at, created_at, updated_at)
          SELECT ?, ?, COALESCE(MAX(transfer_no), 0) + 1, ?, ?, 'in_transit', ?, ?, ?, ?, ?, ? FROM branch_transfers WHERE tenant_id = ?`,
    args: [id, tenantId, from, to, opt(input.note, 500), key, caller.userId, now, now, now, tenantId],
  }];
  for (const [batchId, qty] of merged) {
    // Snapshot first, then take the stock; the guard rolls everything back if the batch had less.
    stmts.push({
      sql: `INSERT INTO branch_transfer_items (id, transfer_id, tenant_id, product_id, source_batch_id, batch_no, expiry_date, purchase_price, qty)
            SELECT ?, ?, tenant_id, product_id, id, batch_no, expiry_date, purchase_price, ? FROM product_batches
            WHERE id = ? AND tenant_id = ? AND ${inFrom} AND deleted_at IS NULL AND qty >= ?`,
      args: [randomUUID(), id, qty, batchId, tenantId, from, qty],
    }, { sql: WRITE_BLOCKED_GUARD }, {
      sql: `UPDATE product_batches SET qty = qty - ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND ${inFrom} AND deleted_at IS NULL AND qty >= ?`,
      args: [qty, now, batchId, tenantId, from, qty],
    }, { sql: WRITE_BLOCKED_GUARD });
  }
  stmts.push(auditStmt(tenantId, from, caller, "transfer.dispatched", { transferId: id, to, lines: merged.size }));
  try {
    await sql.batch(stmts);
  } catch (e) {
    const msg = String((e as Error)?.message);
    if (/UNIQUE/i.test(msg) && key) {
      const prev = (await sql.execute(`SELECT id FROM branch_transfers WHERE tenant_id = ? AND idempotency_key = ?`, [tenantId, key])).rows[0];
      if (prev) return { id: String(prev.id), repeated: true };
    }
    if (/CHECK constraint/i.test(msg)) throw new HttpError(409, "Not enough stock in a batch of the source branch (or the batch is not in that branch). Nothing was sent.");
    throw e;
  }
  return { id, repeated: false };
}

/** Receipt at the destination: received quantities join the same batch there
 * (batch number, expiry and cost kept). Less than sent is recorded as a shortage. */
export async function receiveTransfer(sql: Sql, caller: Caller, id: string, input: Record<string, unknown>) {
  const tenantId = tenantOf(caller);
  const t = (await sql.execute(`SELECT * FROM branch_transfers WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!t) throw new HttpError(404, "Transfer not found.");
  if (t.status !== "in_transit") throw new HttpError(409, "This transfer is no longer in transit.");
  const to = String(t.to_branch_id);
  await mustManage(sql, caller, to, "receive stock");
  const items = (await sql.execute(`SELECT * FROM branch_transfer_items WHERE transfer_id = ?`, [id])).rows;
  const given = new Map((Array.isArray(input.lines) ? input.lines : []).map((x) => {
    const o = (x ?? {}) as { itemId?: unknown; receivedQty?: unknown };
    return [String(o.itemId), Number(o.receivedQty)] as const;
  }));
  const now = iso();
  let short = false;
  const stmts: { sql: string; args?: unknown[] }[] = [
    // First, so a second receipt of the same transfer changes nothing.
    { sql: `UPDATE branch_transfers SET status = 'received', received_by = ?, received_at = ?, receipt_note = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'in_transit'`, args: [caller.userId, now, opt(input.note, 500), now, id, tenantId] },
    { sql: WRITE_BLOCKED_GUARD },
  ];
  for (const it of items) {
    const sent = Number(it.qty);
    const raw = given.has(String(it.id)) ? given.get(String(it.id))! : sent;
    if (!Number.isFinite(raw) || raw < 0 || raw > sent) throw new HttpError(400, "Received quantity must be between 0 and the quantity sent.");
    if (raw < sent) short = true;
    const destId = randomUUID();
    stmts.push({ sql: `UPDATE branch_transfer_items SET received_qty = ?, note = ? WHERE id = ?`, args: [raw, raw < sent ? `Short by ${sent - raw}` : null, it.id] });
    if (raw > 0) {
      const same = `tenant_id = ? AND branch_id = ? AND product_id = ? AND COALESCE(batch_no, '') = COALESCE(?, '') AND COALESCE(expiry_date, '') = COALESCE(?, '') AND deleted_at IS NULL`;
      const sameArgs = [tenantId, to, it.product_id, it.batch_no, it.expiry_date];
      stmts.push(
        { sql: `UPDATE product_batches SET qty = qty + ?, updated_at = ? WHERE id = (SELECT id FROM product_batches WHERE ${same} LIMIT 1)`, args: [raw, now, ...sameArgs] },
        {
          sql: `INSERT INTO product_batches (id, product_id, batch_no, expiry_date, qty, purchase_price, tenant_id, branch_id, created_at, updated_at)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 0`,
          args: [destId, it.product_id, it.batch_no, it.expiry_date, raw, it.purchase_price, tenantId, to, now, now],
        },
        { sql: `UPDATE branch_transfer_items SET dest_batch_id = (SELECT id FROM product_batches WHERE ${same} LIMIT 1) WHERE id = ?`, args: [...sameArgs, it.id] },
      );
    }
  }
  if (short) stmts.push({ sql: `UPDATE branch_transfers SET status = 'received_short' WHERE id = ?`, args: [id] });
  stmts.push(auditStmt(tenantId, to, caller, short ? "transfer.received_short" : "transfer.received", { transferId: id }));
  try {
    await sql.batch(stmts);
  } catch (e) {
    if (/CHECK constraint/i.test(String((e as Error)?.message))) throw new HttpError(409, "This transfer was already received or cancelled.");
    throw e;
  }
  return { ok: true, short };
}

/** Cancel before receipt: the stock goes back to its source batches. */
export async function cancelTransfer(sql: Sql, caller: Caller, id: string, reason: unknown) {
  const tenantId = tenantOf(caller);
  const t = (await sql.execute(`SELECT * FROM branch_transfers WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!t) throw new HttpError(404, "Transfer not found.");
  if (t.status !== "in_transit") throw new HttpError(409, "Only a transfer in transit can be cancelled.");
  await mustManage(sql, caller, String(t.from_branch_id), "cancel transfers");
  const why = opt(reason, 300);
  if (!why) throw new HttpError(400, "Give a reason for cancelling.");
  const now = iso();
  try {
    await sql.batch([
      { sql: `UPDATE branch_transfers SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, receipt_note = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'in_transit'`, args: [caller.userId, now, why, now, id, tenantId] },
      { sql: WRITE_BLOCKED_GUARD },
      { sql: `UPDATE product_batches SET qty = qty + (SELECT SUM(i.qty) FROM branch_transfer_items i WHERE i.transfer_id = ? AND i.source_batch_id = product_batches.id), updated_at = ?
              WHERE id IN (SELECT source_batch_id FROM branch_transfer_items WHERE transfer_id = ?)`, args: [id, now, id] },
      auditStmt(tenantId, String(t.from_branch_id), caller, "transfer.cancelled", { transferId: id, reason: why }),
    ]);
  } catch (e) {
    if (/CHECK constraint/i.test(String((e as Error)?.message))) throw new HttpError(409, "This transfer was already received or cancelled.");
    throw e;
  }
  return { ok: true };
}

/** Transfers touching the branches the caller may open. */
export async function listTransfers(sql: Sql, caller: Caller, status?: unknown) {
  const tenantId = tenantOf(caller);
  const info = await accessFor(sql, caller);
  const ids = info.accessible;
  const marks = ids.map(() => "?").join(", ");
  const st = typeof status === "string" && status ? status : null;
  const rows = (await sql.execute(
    `SELECT t.*, fb.name AS from_name, tb.name AS to_name, u.username AS created_by_name, r.username AS received_by_name,
            (SELECT COUNT(*) FROM branch_transfer_items i WHERE i.transfer_id = t.id) AS lines,
            (SELECT COALESCE(SUM(i.qty * COALESCE(i.purchase_price, 0)), 0) FROM branch_transfer_items i WHERE i.transfer_id = t.id) AS value
     FROM branch_transfers t JOIN branches fb ON fb.id = t.from_branch_id JOIN branches tb ON tb.id = t.to_branch_id
     LEFT JOIN users u ON u.id = t.created_by LEFT JOIN users r ON r.id = t.received_by
     WHERE t.tenant_id = ? AND (t.from_branch_id IN (${marks}) OR t.to_branch_id IN (${marks})) ${st ? "AND t.status = ?" : ""}
     ORDER BY t.transfer_no DESC LIMIT 200`,
    [tenantId, ...ids, ...ids, ...(st ? [st] : [])],
  )).rows;
  return rows.map((r) => ({
    id: String(r.id), no: Number(r.transfer_no), fromBranchId: String(r.from_branch_id), toBranchId: String(r.to_branch_id), fromName: String(r.from_name), toName: String(r.to_name),
    status: String(r.status), note: (r.note as string | null) ?? null, receiptNote: (r.receipt_note as string | null) ?? null, lines: Number(r.lines), value: Number(r.value),
    createdBy: (r.created_by_name as string | null) ?? null, receivedBy: (r.received_by_name as string | null) ?? null,
    dispatchedAt: String(r.dispatched_at), receivedAt: (r.received_at as string | null) ?? null,
    canReceive: r.status === "in_transit" && info.managed.includes(String(r.to_branch_id)),
    canCancel: r.status === "in_transit" && info.managed.includes(String(r.from_branch_id)),
  }));
}

export async function transferDetail(sql: Sql, caller: Caller, id: string) {
  const tenantId = tenantOf(caller);
  const info = await accessFor(sql, caller);
  const t = (await listTransfers(sql, caller)).find((x) => x.id === id);
  if (!t || !(info.accessible.includes(t.fromBranchId) || info.accessible.includes(t.toBranchId))) throw new HttpError(404, "Transfer not found.");
  const items = (await sql.execute(
    `SELECT i.*, p.name FROM branch_transfer_items i JOIN products p ON p.id = i.product_id WHERE i.transfer_id = ? AND i.tenant_id = ? ORDER BY p.name`, [id, tenantId],
  )).rows.map((r) => ({
    id: String(r.id), productId: String(r.product_id), name: String(r.name), batchNo: (r.batch_no as string | null) ?? null, expiry: (r.expiry_date as string | null) ?? null,
    qty: Number(r.qty), receivedQty: r.received_qty == null ? null : Number(r.received_qty), purchasePrice: Number(r.purchase_price) || 0, note: (r.note as string | null) ?? null,
  }));
  return { ...t, items };
}

// ── Reports and dashboard ─────────────────────────────────────────────────

/** Branches the caller may see in branch reports: the owner all, a manager theirs. */
async function reportBranches(sql: Sql, caller: Caller, wanted: unknown) {
  const info = await accessFor(sql, caller);
  if (!info.managed.length) throw new HttpError(403, "Branch reports are for the owner and branch managers.");
  const list = Array.isArray(wanted) ? wanted.map(String) : [];
  const ids = list.length ? list.filter((id) => info.managed.includes(id)) : info.managed;
  if (!ids.length) throw new HttpError(403, "None of those branches are yours to report on.");
  return { info, ids };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** An invoice's sale after its discounts (same as the Business P&L report). */
const NET = `(i.total - COALESCE(i.discount_rs, 0) - COALESCE((SELECT SUM(d.discount_rs) FROM invoice_items d WHERE d.invoice_id = i.id AND d.deleted_at IS NULL), 0))`;

export interface BranchFigures {
  branchId: string; name: string; code: string; status: BranchStatus;
  netSales: number; returns: number; discounts: number; cogs: number; grossProfit: number; received: number;
  purchases: number; purchaseReturns: number; expenses: number; otherRevenue: number; netResult: number;
  receivable: number; payable: number; stockValue: number; invoices: number;
  /** Business-type figures (only the modules this business uses). */
  extra: Record<string, number>;
}

/** Per-branch figures for a period, with the same definitions as the Business P&L.
 * Internal stock transfers are not sales or purchases, so they are not in any figure. */
export async function branchReport(sql: Sql, caller: Caller, input: Record<string, unknown>) {
  const tenantId = tenantOf(caller);
  const from = str(input.from, 10);
  const to = str(input.to, 10);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new HttpError(400, "Choose a valid date range.");
  const { info, ids } = await reportBranches(sql, caller, input.branchIds);
  const bt = String((await sql.execute(`SELECT business_type FROM tenants WHERE id = ?`, [tenantId])).rows[0]?.business_type ?? "");
  const rows: BranchFigures[] = [];
  for (const id of ids) {
    const b = info.branches.find((x) => x.id === id)!;
    const inB = (alias: string) => `(${alias}.branch_id = ?${id === info.mainId ? ` OR ${alias}.branch_id IS NULL` : ""})`;
    const d = (col: string) => `substr(${col}, 1, 10) BETWEEN ? AND ?`;
    const one = async (q: string, args: unknown[]) => Number((await sql.execute(q, args)).rows[0]?.n ?? 0) || 0;
    const invWhere = `i.tenant_id = ? AND ${inB("i")} AND i.deleted_at IS NULL AND COALESCE(i.is_memorized, 0) = 0 AND COALESCE(i.is_quotation, 0) = 0 AND ${d("i.date")}`;
    const ia = [tenantId, id, from, to];
    const [sales, returns, discounts, cogs, cogsRet, received, invoices] = await Promise.all([
      one(`SELECT COALESCE(SUM(${NET}), 0) AS n FROM invoices i WHERE ${invWhere} AND i.is_return = 0`, ia),
      one(`SELECT COALESCE(SUM(${NET}), 0) AS n FROM invoices i WHERE ${invWhere} AND i.is_return = 1`, ia),
      one(`SELECT COALESCE(SUM(COALESCE(i.discount_rs, 0) + COALESCE((SELECT SUM(x.discount_rs) FROM invoice_items x WHERE x.invoice_id = i.id AND x.deleted_at IS NULL), 0)), 0) AS n FROM invoices i WHERE ${invWhere} AND i.is_return = 0`, ia),
      one(`SELECT COALESCE(SUM(ii.purchase_price * ii.qty), 0) AS n FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ${invWhere} AND ii.deleted_at IS NULL AND i.is_return = 0`, ia),
      one(`SELECT COALESCE(SUM(ii.purchase_price * ii.qty), 0) AS n FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ${invWhere} AND ii.deleted_at IS NULL AND i.is_return = 1`, ia),
      one(`SELECT COALESCE(SUM(i.paid), 0) AS n FROM invoices i WHERE ${invWhere} AND i.is_return = 0`, ia),
      one(`SELECT COUNT(*) AS n FROM invoices i WHERE ${invWhere} AND i.is_return = 0`, ia),
    ]);
    const pWhere = `p.tenant_id = ? AND ${inB("p")} AND p.deleted_at IS NULL AND ${d("p.date")}`;
    const [purchases, purchaseReturns, expenses, otherRevenue, receivable, payable, stockValue] = await Promise.all([
      one(`SELECT COALESCE(SUM(p.payable), 0) AS n FROM purchases p WHERE ${pWhere} AND COALESCE(p.is_return, 0) = 0`, ia),
      one(`SELECT COALESCE(SUM(p.payable), 0) AS n FROM purchases p WHERE ${pWhere} AND COALESCE(p.is_return, 0) = 1`, ia),
      one(`SELECT COALESCE(SUM(e.amount), 0) AS n FROM expenses e WHERE e.tenant_id = ? AND ${inB("e")} AND e.deleted_at IS NULL AND ${d("e.date")}`, ia),
      one(`SELECT COALESCE(SUM(r.amount), 0) AS n FROM revenues r WHERE r.tenant_id = ? AND ${inB("r")} AND r.deleted_at IS NULL AND ${d("r.date")}`, ia),
      // Outstanding at the end of the period, from this branch's own bills.
      one(`SELECT COALESCE(SUM(i.balance), 0) AS n FROM invoices i WHERE i.tenant_id = ? AND ${inB("i")} AND i.deleted_at IS NULL AND COALESCE(i.is_memorized, 0) = 0 AND COALESCE(i.is_quotation, 0) = 0 AND i.is_return = 0 AND substr(i.date, 1, 10) <= ?`, [tenantId, id, to]),
      one(`SELECT COALESCE(SUM(p.balance), 0) AS n FROM purchases p WHERE p.tenant_id = ? AND ${inB("p")} AND p.deleted_at IS NULL AND COALESCE(p.is_return, 0) = 0 AND substr(p.date, 1, 10) <= ?`, [tenantId, id, to]),
      // Stock value now (purchase price), batch stock only.
      one(`SELECT COALESCE(SUM(b.qty * COALESCE(b.purchase_price, 0)), 0) AS n FROM product_batches b WHERE b.tenant_id = ? AND ${inB("b")} AND b.deleted_at IS NULL AND b.qty > 0`, [tenantId, id]),
    ]);
    const extra: Record<string, number> = {};
    const add = async (key: string, q: string, args: unknown[]) => { try { extra[key] = await one(q, args); } catch { /* module tables absent */ } };
    const fam = bt;
    if (fam === "restaurant") {
      await add("Restaurant orders", `SELECT COUNT(*) AS n FROM rest_orders o WHERE o.tenant_id = ? AND ${inB("o")} AND o.deleted_at IS NULL AND o.status != 'cancelled' AND ${d("o.created_at")}`, ia);
      await add("Restaurant sales (Rs)", `SELECT COALESCE(SUM(o.total), 0) AS n FROM rest_orders o WHERE o.tenant_id = ? AND ${inB("o")} AND o.deleted_at IS NULL AND o.invoice_no IS NOT NULL AND o.refund_of IS NULL AND ${d("o.created_at")}`, ia);
    }
    if (fam === "clinic" || fam === "hospital") {
      await add("Appointments", `SELECT COUNT(*) AS n FROM clinic_appointments a WHERE a.tenant_id = ? AND ${inB("a")} AND a.deleted_at IS NULL AND ${d("a.date")}`, ia);
    }
    if (fam === "lab" || fam === "clinic" || fam === "hospital") {
      await add("Lab visits", `SELECT COUNT(*) AS n FROM lab_visits v WHERE v.tenant_id = ? AND ${inB("v")} AND v.deleted_at IS NULL AND ${d("v.created_at")}`, ia);
      await add("Tests ordered", `SELECT COUNT(*) AS n FROM clinic_orders o WHERE o.tenant_id = ? AND ${inB("o")} AND o.deleted_at IS NULL AND o.status != 'cancelled' AND ${d("o.ordered_at")}`, ia);
    }
    if (fam === "hospital") {
      await add("Hospital visits (OPD/IPD)", `SELECT COUNT(*) AS n FROM hospital_episodes e WHERE e.tenant_id = ? AND ${inB("e")} AND e.deleted_at IS NULL AND ${d("e.date")}`, ia);
      await add("Admissions", `SELECT COUNT(*) AS n FROM hospital_episodes e WHERE e.tenant_id = ? AND ${inB("e")} AND e.deleted_at IS NULL AND e.type = 'ipd' AND ${d("e.date")}`, ia);
      await add("Hospital payments (Rs)", `SELECT COALESCE(SUM(p.amount), 0) AS n FROM hospital_payments p WHERE p.tenant_id = ? AND ${inB("p")} AND p.deleted_at IS NULL AND ${d("p.received_at")}`, ia);
    }
    if (fam === "banquet_hall") {
      await add("Bookings", `SELECT COUNT(*) AS n FROM banquet_bookings k WHERE k.tenant_id = ? AND ${inB("k")} AND k.deleted_at IS NULL AND k.status != 'cancelled' AND ${d("k.event_date")}`, ia);
      await add("Booking payments (Rs)", `SELECT COALESCE(SUM(p.amount), 0) AS n FROM banquet_payments p WHERE p.tenant_id = ? AND ${inB("p")} AND p.deleted_at IS NULL AND ${d("p.date")}`, ia);
    }
    if (fam === "electronics_solar") {
      await add("Electronics sales (Rs)", `SELECT COALESCE(SUM(x.total), 0) AS n FROM es_docs x WHERE x.tenant_id = ? AND ${inB("x")} AND x.deleted_at IS NULL AND x.doc_type = 'sale' AND ${d("x.date")}`, ia);
    }
    if (fam === "distributor") {
      await add("Distribution sales (Rs)", `SELECT COALESCE(SUM(x.total), 0) AS n FROM dist_docs x WHERE x.tenant_id = ? AND ${inB("x")} AND x.deleted_at IS NULL AND x.doc_type = 'sale' AND ${d("x.date")}`, ia);
    }
    const netSales = sales - returns;
    const gross = netSales - (cogs - cogsRet);
    rows.push({
      branchId: id, name: b.name, code: b.code, status: b.status,
      netSales, returns, discounts, cogs: cogs - cogsRet, grossProfit: gross, received, purchases, purchaseReturns, expenses, otherRevenue,
      netResult: gross - expenses + otherRevenue, receivable, payable, stockValue, invoices, extra,
    });
  }
  const keys: (keyof BranchFigures)[] = ["netSales", "returns", "discounts", "cogs", "grossProfit", "received", "purchases", "purchaseReturns", "expenses", "otherRevenue", "netResult", "receivable", "payable", "stockValue", "invoices"];
  const total = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + (r[k] as number), 0)])) as Record<string, number>;
  const extraTotal: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.extra)) extraTotal[k] = (extraTotal[k] ?? 0) + v;
  const org = (await sql.execute(`SELECT name FROM tenants WHERE id = ?`, [tenantId])).rows[0];
  return {
    organization: String(org?.name ?? ""), from, to, currency: "PKR",
    branchLabel: ids.length === info.managed.length && ids.length > 1 ? "All branches" : rows.map((r) => r.name).join(", "),
    rows, total, totalExtra: extraTotal,
  };
}

/** Organisation overview: branch figures for today and this month, expiry alerts, recent activity. */
export async function enterpriseDashboard(sql: Sql, caller: Caller, today: string) {
  const tenantId = tenantOf(caller);
  if (!DATE_RE.test(today)) throw new HttpError(400, "Bad date.");
  const { info, ids } = await reportBranches(sql, caller, null);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [day, month] = await Promise.all([
    branchReport(sql, caller, { from: today, to: today, branchIds: ids }),
    branchReport(sql, caller, { from: monthStart, to: today, branchIds: ids }),
  ]);
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 90);
  const soonDay = soon.toISOString().slice(0, 10);
  const alerts: { branchId: string; expired: number; expiring: number }[] = [];
  for (const id of ids) {
    const inB = `(b.branch_id = ?${id === info.mainId ? " OR b.branch_id IS NULL" : ""})`;
    const r = (await sql.execute(
      `SELECT SUM(CASE WHEN substr(b.expiry_date, 1, 10) < ? THEN 1 ELSE 0 END) AS expired,
              SUM(CASE WHEN substr(b.expiry_date, 1, 10) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS expiring
       FROM product_batches b WHERE b.tenant_id = ? AND ${inB} AND b.deleted_at IS NULL AND b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date != ''`,
      [today, today, soonDay, tenantId, id],
    )).rows[0];
    alerts.push({ branchId: id, expired: Number(r?.expired ?? 0), expiring: Number(r?.expiring ?? 0) });
  }
  const transfersInTransit = Number((await sql.execute(`SELECT COUNT(*) AS n FROM branch_transfers WHERE tenant_id = ? AND status = 'in_transit'`, [tenantId])).rows[0]?.n ?? 0);
  return {
    today, monthStart, branches: info.branches.filter((b) => ids.includes(b.id)),
    totals: { branches: info.branches.length, active: info.branches.filter((b) => b.status === "active").length },
    day, month, alerts, transfersInTransit,
    activity: caller.role === "owner" ? await auditLog(sql, tenantId, 15) : [],
    allowance: await allowance(sql, tenantId),
  };
}
