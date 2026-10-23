import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = "super_admin" | "owner" | "staff";

/** Trimmed-down session shapes \u2014 just what the UI/repo layer needs on every
 * screen, not the full DB rows (which live in `users`/`tenants` tables and
 * are fetched in full by the admin screens that manage them). */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  tenantId: string | null;
  /** null = full access (owner / super_admin, or staff with no explicit restrictions).
   * A string array restricts the staff user to only those module keys. */
  permissions: string[] | null;
  /** Action keys this staff login may not perform (see lib/actionPermissions).
   * Optional so sessions saved before this field existed still load. */
  deniedActions?: string[];
}

export interface SessionTenant {
  id: string;
  name: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: string | null;
  allowedModules: string[];
  maxStaffLogins: number;
  maxInvoicesPerMonth: number | null;
  /** 0 means no discount; e.g. 14.5 means show prices at MRP * 0.855 */
  mrpDiscountPct: number;
  /** When set, stock is read from this tenant instead of the dealer's own */
  sourceTenantId: string | null;
  /** Super Admin controls. Optional so sessions saved before they existed
   * still load (missing = allowed). */
  deniedActions?: string[];
  /** Business type id (config/businessTypes.ts), e.g. "contractor". */
  businessType?: string | null;
  fbrAllowed?: boolean;
  printTemplatesEditable?: boolean;
}

interface AuthState {
  currentUser: SessionUser | null;
  currentTenant: SessionTenant | null;
  /** Set once after a successful login (or first-run setup). `tenant` is
   * null for the Super Admin, who doesn't belong to any pharmacy. */
  setSession: (user: SessionUser, tenant: SessionTenant | null) => void;
  /** Called after a tenant's subscription plan is edited/renewed so the
   * logged-in session reflects it immediately without a re-login. */
  updateCurrentTenant: (tenant: SessionTenant) => void;
  /** Re-applies permissions edited while this user was logged in. */
  updateCurrentUserAccess: (access: Pick<SessionUser, "permissions" | "deniedActions">) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      currentTenant: null,
      setSession: (currentUser, currentTenant) => set({ currentUser, currentTenant }),
      updateCurrentTenant: (currentTenant) => set({ currentTenant }),
      updateCurrentUserAccess: (access) =>
        set((s) => (s.currentUser ? { currentUser: { ...s.currentUser, ...access } } : {})),
      logout: () => set({ currentUser: null, currentTenant: null }),
    }),
    { name: "pharmacy-auth-session" }
  )
);
