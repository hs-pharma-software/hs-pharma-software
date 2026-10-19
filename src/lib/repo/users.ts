import { dbSelect } from "../db";
import { createRepo } from "./base";
import type { UserAccount } from "../types2";

/** Login accounts (Super Admin + tenant owner/staff) — global/system table,
 * not itself scoped by tenant_id (tenant_id is a plain column here, nullable
 * for the Super Admin). */
export const usersRepo = createRepo<UserAccount>("users");

export async function findUserByUsername(username: string): Promise<UserAccount | null> {
  const rows = await dbSelect<UserAccount>(
    `SELECT * FROM users WHERE username = ? AND deleted_at IS NULL`,
    [username]
  );
  return rows[0] ?? null;
}

export async function anyUserExists(): Promise<boolean> {
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL`);
  return (rows[0]?.n ?? 0) > 0;
}

export async function countActiveStaffLogins(tenantId: string): Promise<number> {
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) as n FROM users WHERE tenant_id = ? AND role = 'staff' AND is_active = 1 AND deleted_at IS NULL`,
    [tenantId]
  );
  return rows[0]?.n ?? 0;
}

export async function listUsersForTenant(tenantId: string | null): Promise<UserAccount[]> {
  if (tenantId === null) {
    return dbSelect<UserAccount>(
      `SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
  }
  return dbSelect<UserAccount>(
    `SELECT * FROM users WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    [tenantId]
  );
}
