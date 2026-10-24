import { createUser } from "./auth";
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
