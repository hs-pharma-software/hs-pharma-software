import { createTenantRepo } from "./base";
import type { Staff } from "../types";

export const staffRepo = createTenantRepo<Staff>("staff");

/** Saves a staff member with the login they use (null = none). A login
 * belongs to one staff member only. */
export async function saveStaffWithLogin(id: string | null, data: Partial<Staff>, userId: string | null): Promise<Staff> {
  if (userId) {
    const other = (await staffRepo.list({ where: "user_id = ?", params: [userId] })).find((s) => s.id !== id);
    if (other) throw new Error(`That login is already linked to ${other.name}.`);
  }
  const payload = { ...data, user_id: userId };
  if (id) {
    const saved = await staffRepo.update(id, payload);
    if (!saved) throw new Error("Staff member not found.");
    return saved;
  }
  return staffRepo.create(payload);
}
