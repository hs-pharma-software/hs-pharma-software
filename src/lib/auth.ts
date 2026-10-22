import { usersRepo, findUserByUsername, countActiveStaffLogins } from "./repo/users";
import { tenantsRepo } from "./repo/tenants";
import { subscriptionPlansRepo, parseAllowedModules } from "./repo/subscriptionPlans";
import { useAuthStore, type SessionTenant, type SessionUser } from "../store/authStore";
import { parseDeniedActions } from "./actionPermissions";
import type { UserAccount, UserRole } from "./types2";

/** Client-side password hashing (SHA-256, salted). There is no backend
 * server in this app's architecture \u2014 the desktop client talks directly to
 * the shared Turso database \u2014 so this protects against casual inspection of
 * the `users` table, not against a determined attacker with access to the
 * embedded Turso credential. See the multi-tenant plan's caveat. */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

export class AuthError extends Error {}

/** Builds the trimmed-down session shapes stored in `authStore` from a full
 * `users`/`tenants`/`subscription_plans` row set. */
async function buildSession(
  user: UserAccount
): Promise<{ user: SessionUser; tenant: SessionTenant | null }> {
  let parsedPermissions: string[] | null = null;
  if (user.role === "staff" && user.permissions != null) {
    try { parsedPermissions = JSON.parse(user.permissions) as string[]; } catch { parsedPermissions = null; }
  }

  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    tenantId: user.tenant_id,
    permissions: parsedPermissions,
    deniedActions: user.role === "staff" ? parseDeniedActions(user.denied_actions) : [],
  };

  if (!user.tenant_id) {
    return { user: sessionUser, tenant: null };
  }

  const tenant = await tenantsRepo.get(user.tenant_id);
  if (!tenant) {
    throw new AuthError("Your pharmacy account could not be found. Contact the administrator.");
  }
  const plan = tenant.subscription_plan_id ? await subscriptionPlansRepo.get(tenant.subscription_plan_id) : null;

  const sessionTenant: SessionTenant = {
    id: tenant.id,
    name: tenant.name,
    subscriptionStatus: tenant.subscription_status,
    subscriptionExpiresAt: tenant.subscription_expires_at,
    allowedModules: plan ? parseAllowedModules(plan) : [],
    maxStaffLogins: plan?.max_staff_logins ?? 0,
    maxInvoicesPerMonth: plan?.max_invoices_per_month ?? null,
    mrpDiscountPct: tenant.mrp_discount_pct ?? 0,
    sourceTenantId: (tenant as any).source_tenant_id ?? null,
  };

  return { user: sessionUser, tenant: sessionTenant };
}

/** Verifies credentials and returns the session to store. Throws
 * `AuthError` with a user-facing message on any failure. */
export async function login(username: string, password: string): Promise<{ user: SessionUser; tenant: SessionTenant | null }> {
  const record = await findUserByUsername(username.trim());
  if (!record) throw new AuthError("Incorrect username or password.");
  if (!record.is_active) throw new AuthError("This account has been deactivated. Contact the administrator.");

  const hash = await hashPassword(password, record.password_salt);
  if (hash !== record.password_hash) throw new AuthError("Incorrect username or password.");

  return buildSession(record);
}

/** Creates a new login account. Used by: first-run Setup (Super Admin +
 * default tenant owner), the Super Admin's Tenants screen (first owner login
 * for a new tenant), and a tenant owner's own "Manage Logins" screen
 * (additional staff logins, capped by their plan's `max_staff_logins`). */
export async function createUser(params: {
  username: string;
  password: string;
  role: UserRole;
  tenantId: string | null;
  displayName?: string | null;
  permissions?: string[] | null;
}): Promise<UserAccount> {
  const existing = await findUserByUsername(params.username.trim());
  if (existing) throw new AuthError(`Username "${params.username}" is already taken.`);

  if (params.role === "staff" && params.tenantId) {
    const tenant = await tenantsRepo.get(params.tenantId);
    const plan = tenant?.subscription_plan_id ? await subscriptionPlansRepo.get(tenant.subscription_plan_id) : null;
    const cap = plan?.max_staff_logins ?? 0;
    const current = await countActiveStaffLogins(params.tenantId);
    if (current >= cap) {
      throw new AuthError(`This plan allows up to ${cap} staff login(s) \u2014 the limit has been reached.`);
    }
  }

  const salt = randomSalt();
  const hash = await hashPassword(params.password, salt);
  return usersRepo.create({
    tenant_id: params.tenantId,
    username: params.username.trim(),
    password_hash: hash,
    password_salt: salt,
    role: params.role,
    display_name: params.displayName ?? null,
    is_active: 1,
    permissions: params.permissions != null ? JSON.stringify(params.permissions) : null,
  });
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  const salt = randomSalt();
  const hash = await hashPassword(newPassword, salt);
  await usersRepo.update(userId, { password_hash: hash, password_salt: salt });
}

/** Saves a staff user's module permission list. Pass null to restore full
 * access (removes all restrictions). */
export async function updateUserPermissions(
  userId: string,
  permissions: string[] | null,
  deniedActions?: string[]
): Promise<void> {
  await usersRepo.update(userId, {
    permissions: permissions != null ? JSON.stringify(permissions) : null,
    ...(deniedActions ? { denied_actions: deniedActions.length ? JSON.stringify(deniedActions) : null } : {}),
  });
}

/** Re-reads the logged-in user's module and action permissions so changes an
 * owner makes take effect without the staff member logging out. A
 * deactivated account is logged out. */
export async function refreshSessionAccess(): Promise<void> {
  const { currentUser, updateCurrentUserAccess, logout } = useAuthStore.getState();
  if (!currentUser || currentUser.role !== "staff") return;
  const row = await usersRepo.get(currentUser.id);
  if (!row) return;
  if (!row.is_active) {
    logout();
    return;
  }
  let permissions: string[] | null = null;
  if (row.permissions != null) {
    try { permissions = JSON.parse(row.permissions) as string[]; } catch { permissions = null; }
  }
  updateCurrentUserAccess({ permissions, deniedActions: parseDeniedActions(row.denied_actions) });
}
