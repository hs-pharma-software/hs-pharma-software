import { createUser, updateUserPermissions } from "./auth";
import { dbSelect } from "./db";
import { requireCurrentTenantId } from "./repo/base";
import { staffRepo } from "./repo/staff";
import { designation } from "../config/hospitalStaff";
import type { UserAccount } from "./types2";

/** Gives a hospital staff member a login whose pages follow their designation
 * (a receptionist gets Reception, a consultant the Doctor Desk...). Uses the
 * normal user accounts, so the plan's staff-login limit applies. */
export async function createStaffLogin(staffId: string, username: string, password: string): Promise<UserAccount> {
  const tenantId = requireCurrentTenantId();
  const staff = await staffRepo.get(staffId);
  if (!staff) throw new Error("Staff member not found.");
  if (staff.user_id) throw new Error(`${staff.name} already has a login.`);
  const d = designation(staff.staff_category);
  if (!d) throw new Error("Set this staff member's designation first.");
  if (username.trim().length < 3) throw new Error("The username must have at least 3 characters.");
  if (password.length < 4) throw new Error("The password must have at least 4 characters.");
  const user = await createUser({ username, password, role: "staff", tenantId, displayName: staff.name, permissions: d.pages });
  await staffRepo.update(staff.id, { user_id: user.id });
  return user;
}

/** Staff logins of this business not yet linked to a staff member. */
export async function listLinkableLogins(): Promise<{ id: string; username: string; display_name: string | null }[]> {
  const t = requireCurrentTenantId();
  return dbSelect(
    `SELECT id, username, display_name FROM users WHERE tenant_id = ? AND role = 'staff' AND deleted_at IS NULL AND is_active = 1
       AND id NOT IN (SELECT user_id FROM staff WHERE tenant_id = ? AND user_id IS NOT NULL AND deleted_at IS NULL) ORDER BY username`,
    [t, t]
  );
}

/** Links an existing login to a staff member: the login then opens what the
 * staff member's designation needs, and its work carries their name and role. */
export async function linkStaffLogin(staffId: string, userId: string): Promise<void> {
  const staff = await staffRepo.get(staffId);
  if (!staff) throw new Error("Staff member not found.");
  if (staff.user_id) throw new Error(`${staff.name} already has a login.`);
  const d = designation(staff.staff_category);
  if (!d) throw new Error("Set this staff member's designation first.");
  if (!(await listLinkableLogins()).some((u) => u.id === userId)) throw new Error("Choose a staff login that is not linked to anyone yet.");
  await staffRepo.update(staff.id, { user_id: userId });
  await updateUserPermissions(userId, d.pages);
}
