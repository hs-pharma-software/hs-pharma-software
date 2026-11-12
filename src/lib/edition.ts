/** Which MAVIN this bundle is.
 *
 * "standalone": Mavin Pharmacy Offline, the Windows desktop edition with its
 * own local database (desktop-standalone/). Every query goes to that database
 * through the desktop's bridge (window.mavinLocal); there is no server, no
 * online login and no FBR/PRAL. Set at build time (NEXT_PUBLIC_EDITION), so
 * the hosted app never contains these paths' effects. */
export const STANDALONE = process.env.NEXT_PUBLIC_EDITION === "standalone";

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type Row = Record<string, unknown>;

export interface LicenseInfo {
  installationId: string;
  status: "trial" | "active" | "expired" | "invalid";
  expiresAt: string | null;
  daysLeft: number | null;
  licensee: string | null;
  licenseId: string | null;
  kind: "trial" | "activation" | "renewal" | null;
  message: string;
}

export interface CatalogueStatus {
  version: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  pending: boolean;
  running: boolean;
  products: number;
  source: string;
}

export interface StandaloneInfo {
  setupDone: boolean;
  installationId: string;
  appVersion: string;
  license: LicenseInfo;
  superAdminUserId: string | null;
  dataFolder: string;
}

/** The calls the standalone desktop offers the page (desktop-standalone/src/preload.ts). */
export interface LocalBridge {
  info(): Promise<BridgeResult<StandaloneInfo>>;
  select(a: { sql: string; params: unknown[] }): Promise<BridgeResult<Row[]>>;
  execute(a: { sql: string; params: unknown[] }): Promise<BridgeResult<{ rowsAffected: number; lastInsertId?: number }>>;
  batch(a: { statements: { sql: string; params?: unknown[] }[] }): Promise<BridgeResult<null>>;
  setup(a: { pharmacyName: string; ownerName: string; username: string; password: string; phone?: string; address?: string }): Promise<BridgeResult<{ recoveryKey: string; userId: string }>>;
  login(a: { username: string; password: string }): Promise<BridgeResult<{ userId: string; session: string }>>;
  checkSession(a: { session: string | null }): Promise<BridgeResult<{ valid: boolean }>>;
  logout(a: { session: string | null }): Promise<BridgeResult<null>>;
  setPassword(a: { session: string | null; userId: string; password: string; currentPassword?: string }): Promise<BridgeResult<null>>;
  recover(a: { recoveryKey: string; newPassword: string }): Promise<BridgeResult<{ username: string; recoveryKey: string }>>;
  newRecoveryKey(a: { session: string | null; password: string }): Promise<BridgeResult<{ recoveryKey: string }>>;
  saveText(a: { suggestedName: string; text: string }): Promise<BridgeResult<{ path: string } | null>>;
  license(): Promise<BridgeResult<LicenseInfo>>;
  importLicense(a: { session: string | null; text?: string; fromFile?: boolean }): Promise<BridgeResult<LicenseInfo>>;
  requestCode(): Promise<BridgeResult<{ code: string }>>;
  backup(a: { session: string | null }): Promise<BridgeResult<{ path: string } | null>>;
  restore(a: { session: string | null }): Promise<BridgeResult<{ path: string } | null>>;
  print(a: { widthMm: number; heightMm: number; marginMm: number; silent: boolean }): Promise<BridgeResult<null>>;
  catalogueStatus(): Promise<BridgeResult<CatalogueStatus>>;
  catalogueSync(): Promise<BridgeResult<CatalogueStatus>>;
  audit(a: { session: string | null; limit?: number }): Promise<BridgeResult<Row[]>>;
}

export function localBridge(): LocalBridge | null {
  if (!STANDALONE || typeof window === "undefined") return null;
  return ((window as unknown as { mavinLocal?: LocalBridge }).mavinLocal) ?? null;
}

/** Unwraps a bridge result, throwing its message as an error. */
export async function unwrap<T>(p: Promise<BridgeResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Fired after a license import, so the license banner refreshes at once. */
export const LICENSE_CHANGED = "mavin-license-changed";

/** The local session token (kept with the signed-in user; ended by logout or an admin recovery). */
const SESSION_KEY = "mavin-local-session";
export function localSession(): string | null {
  try { return window.localStorage.getItem(SESSION_KEY); } catch { return null; }
}
export function setLocalSession(token: string | null) {
  try {
    if (token) window.localStorage.setItem(SESSION_KEY, token);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
}
