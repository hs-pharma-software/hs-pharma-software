import { usersRepo, findUserByUsername, countActiveStaffLogins } from "./repo/users";
import { tenantsRepo } from "./repo/tenants";
import { subscriptionPlansRepo, parseAllowedModules } from "./repo/subscriptionPlans";
import { useAuthStore, type SessionTenant, type SessionUser } from "../store/authStore";
import { parseDeniedActions } from "./actionPermissions";
import { isTauriShell } from "./platform";
import { isTursoConfigured, pullAuthData } from "./sync/engine";
import type { SubscriptionPlan, Tenant, UserAccount, UserRole } from "./types2";
import { SERVER_DB, desktopViaServer, serverJson, ServerRequestError, setDesktopSession } from "./serverMode";
import { dbExecute } from "./db";
import { desktopBridge } from "./desktopBridge";
import { getGlobalSetting } from "./repo/settings";
import { DEFAULT_GRACE_DAYS, ENFORCE_EXPIRY_SETTING } from "./subscription";
import { localBridge, localSession, setLocalSession, unwrap } from "./edition";

/** Mavin Pharmacy Offline: passwords are checked and stored by the desktop
 * (scrypt, in its main process); the page never sees a hash. */
async function standaloneLogin(username: string, password: string): Promise<{ user: SessionUser; tenant: SessionTenant | null }> {
  const local = localBridge()!;
  let r: { userId: string; session: string };
  try {
    r = await unwrap(local.login({ username: username.trim(), password }));
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : String(e));
  }
  const record = await usersRepo.get(r.userId);
  if (!record) throw new AuthError("Incorrect username or password.");
  setLocalSession(r.session);
  return buildSession(record);
}

/** Salted SHA-256, the scheme the server also uses (src/server/db.ts). On the
 * web and on a desktop that syncs through the server, the server checks
 * passwords and never sends hashes; the desktop keeps only its own salted
 * check for signing in offline (desktopLogin). */
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
  return { user: sessionUser, tenant: await buildSessionTenant(tenant) };
}

/** Tenant session: the plan's limits plus the Super Admin's per-tenant
 * controls (accessible sections override, denied actions, FBR, templates). */
async function buildSessionTenant(tenant: Tenant): Promise<SessionTenant> {
  const plan = tenant.subscription_plan_id ? await subscriptionPlansRepo.get(tenant.subscription_plan_id) : null;
  return {
    id: tenant.id,
    name: tenant.name,
    subscriptionStatus: tenant.subscription_status,
    subscriptionExpiresAt: tenant.subscription_expires_at,
    graceDays: plan?.grace_days ?? DEFAULT_GRACE_DAYS,
    enforceExpiry: (await getGlobalSetting(ENFORCE_EXPIRY_SETTING).catch(() => null)) === "1",
    allowedModules: tenantAllowedModules(tenant, plan),
    maxStaffLogins: plan?.max_staff_logins ?? 0,
    maxInvoicesPerMonth: plan?.max_invoices_per_month ?? null,
    mrpDiscountPct: tenant.mrp_discount_pct ?? 0,
    sourceTenantId: (tenant as Tenant & { source_tenant_id?: string | null }).source_tenant_id ?? null,
    deniedActions: parseDeniedActions(tenant.denied_actions),
    businessType: tenant.business_type ?? null,
    fbrAllowed: tenant.fbr_allowed !== 0,
    printTemplatesEditable: tenant.print_templates_editable !== 0,
    medicineInvoiceAllowed: tenant.medicine_invoice_allowed === 1,
  };
}

/** The tenant's own section list when the Super Admin set one, else the plan's. */
export function tenantAllowedModules(tenant: Pick<Tenant, "allowed_modules">, plan: SubscriptionPlan | null): string[] {
  if (tenant.allowed_modules) {
    try {
      const parsed = JSON.parse(tenant.allowed_modules);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // fall through to the plan
    }
  }
  return plan ? parseAllowedModules(plan) : [];
}

/** Verifies credentials and returns the session to store. Throws
 * `AuthError` with a user-facing message on any failure. */
export async function login(username: string, password: string): Promise<{ user: SessionUser; tenant: SessionTenant | null }> {
  if (localBridge()) return standaloneLogin(username, password);
  if (SERVER_DB) {
    // The server checks the password and sets the session cookie; the page never sees the hash.
    const desktop = desktopBridge();
    try {
      await serverJson("/api/auth/login/", { username, password });
    } catch (e) {
      // MAVIN desktop app without a connection: its own check, within its offline allowance.
      if (desktop && e instanceof ServerRequestError && e.status === 0) {
        const r = await desktop.offlineSignIn({ username, password });
        if (!r.ok) throw new AuthError(r.error);
        return r.value as { user: SessionUser; tenant: SessionTenant | null };
      }
      throw new AuthError(e instanceof ServerRequestError ? e.message : "Could not reach the server. Check the connection.");
    }
    // A Sub Super has no business: their session comes from the server, not from business tables.
    const me = await serverJson<{ userId: string; platformRole: string | null }>("/api/auth/me/");
    if (me.platformRole === "distributor") return distributorSession(me.userId, username.trim());
    const record = await findUserByUsername(username.trim());
    if (!record) throw new AuthError("Incorrect username or password.");
    const session = await buildSession(record);
    // Desktop app: this login can also sign in here offline later (password checked on this computer only).
    if (desktop) await desktop.rememberSession({ username, password, session }).catch(() => undefined);
    return session;
  }
  if (desktopViaServer()) return desktopLogin(username, password);
  let record = await checkCredentials(username, password);
  // Not matched locally: the login (or a password reset) may have been made
  // on another computer. Fetch the latest accounts from Turso and retry once.
  if (!record && isTauriShell() && isTursoConfigured()) {
    try {
      await pullAuthData();
      record = await checkCredentials(username, password);
    } catch {
      // offline: keep the local answer
    }
  }
  if (!record) throw new AuthError("Incorrect username or password.");
  if (record.platform_role === "distributor") throw new AuthError(DISTRIBUTOR_WEB_ONLY);
  if (!record.is_active) throw new AuthError("This account has been deactivated. Contact the administrator.");
  return buildSession(record);
}

function distributorSession(id: string, username: string): { user: SessionUser; tenant: null } {
  return { user: { id, username, displayName: username, role: "staff", tenantId: null, permissions: [], deniedActions: [], platformRole: "distributor" }, tenant: null };
}

const DISTRIBUTOR_WEB_ONLY = "Sub Super accounts sign in on the web version of MAVIN.pk.";

/** Desktop through the server. Online, the server checks the password and
 * returns a session; the app then downloads this business's accounts and
 * keeps its own salted check of the password, so the next sign-in also works
 * offline. Offline (server unreachable), that local check is used. */
async function desktopLogin(username: string, password: string): Promise<{ user: SessionUser; tenant: SessionTenant | null }> {
  let online = true;
  try {
    const r = await serverJson<{ token: string; expiresInHours?: number }>("/api/auth/login/", { username, password, client: "desktop" });
    setDesktopSession(r.token, r.expiresInHours);
    const me = await serverJson<{ platformRole: string | null }>("/api/auth/me/");
    if (me.platformRole === "distributor") {
      setDesktopSession(null);
      throw new AuthError(DISTRIBUTOR_WEB_ONLY);
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    // The server answered with a refusal (wrong password, deactivated, too many tries).
    if (e instanceof ServerRequestError && e.status < 500) throw new AuthError(e.message);
    online = false;
  }
  if (online) {
    await pullAuthData();
    const record = await findUserByUsername(username.trim());
    if (!record) throw new AuthError("Your login could not be downloaded to this computer. Try again.");
    await storeLocalCheck(record.id, password);
    return buildSession(record);
  }
  const record = await checkCredentials(username, password);
  if (!record) throw new AuthError("Could not reach the server. Sign in once while online on this computer, then you can sign in offline.");
  if (record.platform_role === "distributor") throw new AuthError(DISTRIBUTOR_WEB_ONLY);
  if (!record.is_active) throw new AuthError("This account has been deactivated. Contact the administrator.");
  return buildSession(record);
}

/** The desktop's own offline password check. Local only: never synced. */
async function storeLocalCheck(userId: string, password: string): Promise<void> {
  const salt = randomSalt();
  await dbExecute(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`, [await hashPassword(password, salt), salt, userId]);
}

async function checkCredentials(username: string, password: string): Promise<UserAccount | null> {
  const record = await findUserByUsername(username.trim());
  if (!record) return null;
  const hash = await hashPassword(password, record.password_salt);
  return hash === record.password_hash ? record : null;
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
  deniedActions?: string[];
  /** Recovery contacts (server mode). */
  email?: string | null;
  mobile?: string | null;
}): Promise<UserAccount> {
  if (SERVER_DB || desktopViaServer()) {
    try {
      const { id } = await serverJson<{ id: string }>("/api/auth/users/", { ...params, tenantId: params.tenantId });
      if (desktopViaServer()) await pullAuthData(); // the new login reaches this computer
      const created = await usersRepo.get(id);
      if (!created) throw new AuthError("The login was created but could not be read back. Refresh the page.");
      return created;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError(e instanceof Error ? e.message : String(e));
    }
  }
  const existing = await findUserByUsername(params.username.trim());
  if (existing) throw new AuthError(`Username "${params.username}" is already taken.`);
  const local = localBridge();

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
  // Standalone: no usable hash here; the desktop stores the real one just after.
  const hash = local ? "!" : await hashPassword(params.password, salt);
  const created = await usersRepo.create({
    tenant_id: params.tenantId,
    username: params.username.trim(),
    password_hash: hash,
    password_salt: salt,
    role: params.role,
    display_name: params.displayName ?? null,
    is_active: 1,
    permissions: params.permissions != null ? JSON.stringify(params.permissions) : null,
    denied_actions: params.role === "staff" && params.deniedActions?.length ? JSON.stringify(params.deniedActions) : null,
  });
  if (local) {
    try {
      await unwrap(local.setPassword({ session: localSession(), userId: created.id, password: params.password }));
    } catch (e) {
      await usersRepo.remove(created.id).catch(() => undefined);
      throw new AuthError(e instanceof Error ? e.message : String(e));
    }
  }
  return created;
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  const local = localBridge();
  if (local) {
    try {
      await unwrap(local.setPassword({ session: localSession(), userId, password: newPassword }));
    } catch (e) {
      throw new AuthError(e instanceof Error ? e.message : String(e));
    }
    return;
  }
  if (SERVER_DB || desktopViaServer()) {
    try {
      await serverJson("/api/auth/password/", { userId, newPassword });
    } catch (e) {
      throw new AuthError(e instanceof Error ? e.message : String(e));
    }
    // Own password changed on the desktop: the offline check follows it.
    if (desktopViaServer() && userId === useAuthStore.getState().currentUser?.id) await storeLocalCheck(userId, newPassword);
    return;
  }
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

/** Re-reads the logged-in user's module and action permissions, and the
 * tenant's Super Admin controls, so changes take effect without logging out.
 * A deactivated account is logged out. */
export async function refreshSessionAccess(): Promise<void> {
  const { currentUser, currentTenant, updateCurrentUserAccess, updateCurrentTenant, logout } = useAuthStore.getState();
  if (!currentUser || currentUser.role === "super_admin") return;
  // Super Admin controls on the tenant apply to the owner and staff alike.
  if (currentTenant) {
    const tenant = await tenantsRepo.get(currentTenant.id);
    if (tenant) updateCurrentTenant(await buildSessionTenant(tenant));
  }
  if (currentUser.role !== "staff") return;
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

/** First-run setup: the Super Admin and the first business owner. Through the
 * server on the web (allowed only while no login exists), locally otherwise. */
export async function setupFirstLogins(
  admin: { username: string; password: string },
  owner: { username: string; password: string; displayName?: string | null; tenantId?: string }
): Promise<void> {
  if (SERVER_DB || desktopViaServer()) {
    try {
      await serverJson("/api/auth/setup/", { admin, owner });
    } catch (e) {
      throw new AuthError(e instanceof Error ? e.message : String(e));
    }
    return;
  }
  await createUser({ username: admin.username, password: admin.password, role: "super_admin", tenantId: null });
  await createUser({ username: owner.username, password: owner.password, role: "owner", tenantId: owner.tenantId ?? "tenant-default", displayName: owner.displayName ?? null });
}

/** Ends the server session too (web version, or the desktop through the server). */
export async function serverLogout(): Promise<void> {
  const local = localBridge();
  if (local) {
    await local.logout({ session: localSession() }).catch(() => undefined);
    setLocalSession(null);
    return;
  }
  if (desktopViaServer()) {
    setDesktopSession(null);
    return;
  }
  if (!SERVER_DB) return;
  await serverJson("/api/auth/logout/", {}).catch(() => undefined);
}

/** The signed-in user's own display name (Account > Profile). Through the
 * server it changes only the caller's own login; the session shows it at once. */
export async function updateOwnDisplayName(name: string): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 60) throw new AuthError("Enter a name of 2 to 60 characters.");
  const user = useAuthStore.getState().currentUser;
  if (!user) throw new AuthError("Sign in first.");
  if (SERVER_DB || desktopViaServer()) {
    try {
      await serverJson("/api/auth/profile/", { displayName: clean });
    } catch (e) {
      throw new AuthError(e instanceof Error ? e.message : String(e));
    }
  } else {
    await usersRepo.update(user.id, { display_name: clean });
  }
  useAuthStore.setState((s) => (s.currentUser ? { currentUser: { ...s.currentUser, displayName: clean } } : {}));
  return clean;
}
