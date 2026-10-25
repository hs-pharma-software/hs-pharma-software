/** Creating logins and changing passwords: done by the server only, so
 * password hashes are never written or read by the browser. */
import { randomBytes, randomUUID } from "node:crypto";
import { serverDb, passwordHash, HttpError } from "./db";
import type { Caller } from "./sqlPolicy";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface NewLogin {
  username: string;
  password: string;
  role: "super_admin" | "owner" | "staff";
  tenantId: string | null;
  displayName?: string | null;
  permissions?: string[] | null;
}

const MIN_PASSWORD = 4;

async function callerPermissions(userId: string): Promise<string[] | null> {
  const rs = await serverDb().execute({ sql: `SELECT permissions FROM users WHERE id = ?`, args: [userId] });
  const raw = rs.rows[0]?.permissions;
  if (raw == null) return null;
  try {
    const p = JSON.parse(String(raw));
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

/** Who may create which login. `caller` is null only during first-run setup. */
async function assertMayCreate(caller: Caller | null, l: NewLogin): Promise<void> {
  if (!caller) return;
  if (caller.role === "super_admin") return;
  if (l.role !== "staff") throw new HttpError(403, "Only the Super Admin creates owner and administrator logins.");
  if (!caller.tenantId || l.tenantId !== caller.tenantId) throw new HttpError(403, "You can create logins for your own business only.");
  if (caller.role === "staff") {
    const perms = await callerPermissions(caller.userId);
    const may = perms === null || perms.some((p) => p === "staff" || p === "hospital_hr" || p.startsWith("hospital_hr"));
    if (!may) throw new HttpError(403, "Only the owner or HR creates logins.");
  }
}

export async function createLogin(caller: Caller | null, l: NewLogin): Promise<{ id: string }> {
  const username = l.username?.trim();
  if (!username) throw new HttpError(400, "Enter a username.");
  if (!l.password || l.password.length < MIN_PASSWORD) throw new HttpError(400, `The password must be at least ${MIN_PASSWORD} characters.`);
  if (!["super_admin", "owner", "staff"].includes(l.role)) throw new HttpError(400, "Unknown role.");
  if (l.role !== "super_admin" && !l.tenantId) throw new HttpError(400, "Choose the business this login belongs to.");
  await assertMayCreate(caller, l);
  const db = serverDb();
  const taken = await db.execute({ sql: `SELECT 1 FROM users WHERE username = ? AND deleted_at IS NULL`, args: [username] });
  if (taken.rows.length) throw new HttpError(409, `Username "${username}" is already taken.`);
  if (l.role === "staff" && l.tenantId) {
    const cap = await db.execute({
      sql: `SELECT COALESCE(p.max_staff_logins, 0) AS cap,
                   (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.role = 'staff' AND u.is_active = 1 AND u.deleted_at IS NULL) AS used
            FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.subscription_plan_id WHERE t.id = ?`,
      args: [l.tenantId],
    });
    const row = cap.rows[0];
    if (!row) throw new HttpError(404, "Business not found.");
    if (Number(row.used) >= Number(row.cap)) throw new HttpError(409, `This plan allows up to ${Number(row.cap)} staff login(s); the limit has been reached.`);
  }
  const id = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, permissions, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
    args: [id, l.tenantId, username, passwordHash(l.password, salt), salt, l.role, l.displayName ?? null, l.permissions != null ? JSON.stringify(l.permissions) : null, now, now],
  });
  return { id };
}

/** A user changes their own password; an owner resets a login of their business; the Super Admin any. */
export async function setPassword(caller: Caller, userId: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < MIN_PASSWORD) throw new HttpError(400, `The password must be at least ${MIN_PASSWORD} characters.`);
  const db = serverDb();
  const rs = await db.execute({ sql: `SELECT id, tenant_id, role FROM users WHERE id = ? AND deleted_at IS NULL`, args: [userId] });
  const target = rs.rows[0];
  if (!target) throw new HttpError(404, "Login not found.");
  const self = String(target.id) === caller.userId;
  const ownersStaff = caller.role === "owner" && caller.tenantId != null && String(target.tenant_id) === caller.tenantId && String(target.role) !== "super_admin";
  if (!(self || ownersStaff || caller.role === "super_admin")) throw new HttpError(403, "You cannot change this login's password.");
  const salt = randomBytes(16).toString("hex");
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`,
    args: [passwordHash(newPassword, salt), salt, new Date().toISOString(), userId],
  });
}

export async function needsSetup(): Promise<boolean> {
  const rs = await serverDb().execute(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL`);
  return Number(rs.rows[0]?.n ?? 0) === 0;
}
