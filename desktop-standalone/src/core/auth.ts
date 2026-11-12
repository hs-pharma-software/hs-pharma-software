/** Mavin Pharmacy Offline: logins, the local Super Admin and the recovery key.
 *
 * - Passwords: scrypt (N=2^15), stored as "scrypt$..." in users.password_hash;
 *   the page never reads or writes them.
 * - Sessions: random tokens kept in memory, so every start of the app needs a
 *   sign-in; an admin recovery also ends every open session.
 * - The local Super Admin is the pharmacy's owner login created at setup.
 * - Recovery key: 30 random base32 characters, shown once; only its scrypt
 *   hash is kept. It resets the local Super Admin's password only, then is
 *   replaced by a new key. Wrong keys are slowed down (and remembered across
 *   restarts). It has nothing to do with the license. */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { LocalDb } from "./localdb";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const MIN_PASSWORD = 10;
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

export class AuthFailure extends Error {}

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(secret, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${h.toString("base64")}`;
}
export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  const p = String(stored ?? "").split("$");
  if (p.length !== 6 || p[0] !== "scrypt") return false;
  const [N, r, pp] = [Number(p[1]), Number(p[2]), Number(p[3])];
  const want = Buffer.from(p[5], "base64");
  const got = scryptSync(secret, Buffer.from(p[4], "base64"), want.length, { N, r, p: pp, maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX (150 random bits). */
export function newRecoveryKey(): string {
  const bytes = randomBytes(30);
  const chars = [...bytes].map((b) => B32[b % 32]).join("");
  return chars.match(/.{5}/g)!.join("-");
}
export const normalizeKey = (k: string) => String(k ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function checkPassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw new AuthFailure(`Use a password of at least ${MIN_PASSWORD} characters.`);
  if (pw.length > 200) throw new AuthFailure("The password is too long.");
  if (/^(.)\1+$/.test(pw) || /^(1234567890|0123456789|password12|qwertyuiop)/i.test(pw)) throw new AuthFailure("Choose a less obvious password.");
  return pw;
}

/** The one pharmacy of this installation. MAVIN's schema already creates this
 * row ("My Pharmacy"); setup makes it this pharmacy. */
export const TENANT_ID = "tenant-default";
export const PLAN_ID = "plan-standalone";
/** The Pharmacy module's sections (src/config/businessTypes.ts retail_pharmacy defaults). */
export const PHARMACY_MODULES = ["dashboard", "invoices", "products", "customers", "cash_register", "banks", "expenses", "reports", "utilities", "settings",
  "quotation", "order", "purchase", "stock", "suppliers", "staff", "other_revenue", "tasks", "salesman"];

interface Session { userId: string; epoch: number; at: number }

export class LocalAuth {
  private sessions = new Map<string, Session>();
  private failures = new Map<string, { n: number; until: number }>();
  private db: LocalDb;
  private now: () => Date;
  constructor(db: LocalDb, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  get setupDone(): boolean { return !!this.db.meta("super_admin_user_id"); }
  get superAdminId(): string | null { return this.db.meta("super_admin_user_id"); }
  private epoch(): number { return Number(this.db.meta("session_epoch") ?? "0"); }

  /** First setup: the pharmacy, its plan and the local Super Admin. Returns the recovery key (shown once). */
  setup(input: { pharmacyName?: unknown; ownerName?: unknown; username?: unknown; password?: unknown; phone?: unknown; address?: unknown }): { recoveryKey: string; userId: string } {
    if (this.setupDone) throw new AuthFailure("This installation is already set up.");
    const name = String(input.pharmacyName ?? "").trim().slice(0, 120);
    const owner = String(input.ownerName ?? "").trim().slice(0, 120);
    const username = String(input.username ?? "").trim();
    if (name.length < 2) throw new AuthFailure("Enter the pharmacy's name.");
    if (owner.length < 2) throw new AuthFailure("Enter the owner's name.");
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new AuthFailure("Username: 3 to 40 letters, digits, dot, dash or underscore.");
    const password = checkPassword(input.password);
    const t = this.now().toISOString();
    const userId = randomUUID();
    const key = newRecoveryKey();
    const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
    this.db.tx(() => {
      const d = this.db.db;
      d.prepare(`INSERT OR IGNORE INTO subscription_plans (id, name, description, price, duration_days, allowed_modules, max_staff_logins, max_invoices_per_month, created_at, updated_at)
                 VALUES (?, 'Mavin Pharmacy Offline', 'Standalone desktop edition', 0, 36500, ?, 100, NULL, ?, ?)`).run(PLAN_ID, JSON.stringify(PHARMACY_MODULES), t, t);
      d.prepare(`INSERT INTO tenants (id, name, owner_name, phone, address, subscription_plan_id, subscription_status, subscription_started_at, subscription_expires_at, is_active,
                   business_type, allowed_modules, fbr_allowed, print_templates_editable, medicine_invoice_allowed, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '2126-01-01T00:00:00.000Z', 1, 'retail_pharmacy', ?, 0, 1, 0, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, owner_name = excluded.owner_name, phone = excluded.phone, address = excluded.address,
                   subscription_plan_id = excluded.subscription_plan_id, subscription_status = 'active', subscription_started_at = excluded.subscription_started_at,
                   subscription_expires_at = excluded.subscription_expires_at, is_active = 1, business_type = 'retail_pharmacy', allowed_modules = excluded.allowed_modules,
                   fbr_allowed = 0, print_templates_editable = 1, medicine_invoice_allowed = 0, updated_at = excluded.updated_at`)
        .run(TENANT_ID, name, owner, opt(input.phone), opt(input.address), PLAN_ID, t, JSON.stringify(PHARMACY_MODULES), t, t);
      d.prepare(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'scrypt', 'owner', ?, 1, ?, ?)`).run(userId, TENANT_ID, username, hashSecret(password), owner, t, t);
      this.db.setMeta("super_admin_user_id", userId);
      this.db.setMeta("recovery_hash", hashSecret(normalizeKey(key)));
      this.db.setMeta("trial_started_at", t);
      this.db.audit(username, "setup", { pharmacy: name });
    });
    return { recoveryKey: key, userId };
  }

  private user(where: string, arg: string) {
    return this.db.db.prepare(`SELECT id, username, password_hash, is_active, deleted_at, tenant_id FROM users WHERE ${where} AND deleted_at IS NULL`).get(arg) as
      { id: string; username: string; password_hash: string; is_active: number; tenant_id: string | null } | undefined;
  }

  login(username: unknown, password: unknown): { userId: string; session: string } {
    const u = String(username ?? "").trim();
    const key = u.toLowerCase();
    const f = this.failures.get(key);
    const nowMs = this.now().getTime();
    if (f && f.until > nowMs) throw new AuthFailure(`Too many wrong tries. Wait ${Math.ceil((f.until - nowMs) / 1000)} seconds.`);
    const row = u ? this.user("username = ?", u) : undefined;
    const ok = !!row && typeof password === "string" && verifySecret(password, row.password_hash);
    if (!ok) {
      const n = (f?.n ?? 0) + 1;
      // 5 free tries, then 30 s, 60 s, 120 s ... up to 15 minutes.
      this.failures.set(key, { n, until: n >= 5 ? nowMs + Math.min(15 * 60_000, 30_000 * 2 ** (n - 5)) : 0 });
      throw new AuthFailure("Incorrect username or password.");
    }
    if (!Number(row!.is_active)) throw new AuthFailure("This login has been deactivated. Ask the pharmacy's Super Admin.");
    this.failures.delete(key);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { userId: row!.id, epoch: this.epoch(), at: nowMs });
    this.db.audit(row!.username, "login");
    return { userId: row!.id, session: token };
  }

  sessionUser(token: unknown): string | null {
    const s = typeof token === "string" ? this.sessions.get(token) : undefined;
    if (!s || s.epoch !== this.epoch()) return null;
    const u = this.user("id = ?", s.userId);
    return u && Number(u.is_active) ? s.userId : null;
  }
  logout(token: unknown) { if (typeof token === "string") this.sessions.delete(token); }

  requireSuperAdmin(token: unknown): string {
    const id = this.sessionUser(token);
    if (!id || id !== this.superAdminId) throw new AuthFailure("Only the local Super Admin can do this. Sign in again as the Super Admin.");
    return id;
  }

  /** Own password, or (local Super Admin) any login of this pharmacy. */
  setPassword(token: unknown, userId: unknown, password: unknown) {
    const caller = this.sessionUser(token);
    if (!caller) throw new AuthFailure("Your session has ended. Sign in again.");
    const target = this.user("id = ?", String(userId ?? ""));
    if (!target) throw new AuthFailure("Login not found.");
    if (caller !== target.id && caller !== this.superAdminId) throw new AuthFailure("Only the local Super Admin changes other logins' passwords.");
    const pw = checkPassword(password);
    this.db.db.prepare(`UPDATE users SET password_hash = ?, password_salt = 'scrypt', updated_at = ? WHERE id = ?`).run(hashSecret(pw), this.now().toISOString(), target.id);
    this.db.audit(this.user("id = ?", caller)?.username ?? caller, "password_set", { login: target.username });
  }

  /** Forgotten Super Admin password: the recovery key sets a new one, every
   * session ends, and a new key replaces the used one. */
  recover(recoveryKey: unknown, newPassword: unknown): { username: string; recoveryKey: string } {
    if (!this.setupDone) throw new AuthFailure("This installation is not set up yet.");
    const nowMs = this.now().getTime();
    const lock = Number(this.db.meta("recovery_locked_until") ?? "0");
    if (lock > nowMs) throw new AuthFailure(`Too many wrong recovery keys. Try again after ${new Date(lock).toLocaleTimeString()}.`);
    const pw = checkPassword(newPassword);
    if (!verifySecret(normalizeKey(String(recoveryKey ?? "")), this.db.meta("recovery_hash"))) {
      const n = Number(this.db.meta("recovery_failures") ?? "0") + 1;
      this.db.setMeta("recovery_failures", String(n));
      if (n >= 5) this.db.setMeta("recovery_locked_until", String(nowMs + Math.min(24 * 3600_000, 5 * 60_000 * 2 ** (n - 5))));
      this.db.audit(null, "recovery_failed", { attempt: n });
      throw new AuthFailure("This recovery key is not valid for this installation.");
    }
    const admin = this.user("id = ?", this.superAdminId!);
    if (!admin) throw new AuthFailure("The local Super Admin login is missing.");
    const next = newRecoveryKey();
    this.db.tx(() => {
      this.db.db.prepare(`UPDATE users SET password_hash = ?, password_salt = 'scrypt', is_active = 1, updated_at = ? WHERE id = ?`).run(hashSecret(pw), this.now().toISOString(), admin.id);
      this.db.setMeta("recovery_hash", hashSecret(normalizeKey(next)));
      this.db.setMeta("recovery_failures", "0");
      this.db.setMeta("recovery_locked_until", null);
      this.db.setMeta("session_epoch", String(this.epoch() + 1));
      this.db.audit(admin.username, "admin_password_recovered", { previousKeyRetired: true, sessionsEnded: true });
    });
    this.sessions.clear();
    return { username: admin.username, recoveryKey: next };
  }

  /** A new recovery key on request (the Super Admin, with their password); the old one stops working. */
  rotateRecoveryKey(token: unknown, password: unknown): { recoveryKey: string } {
    const id = this.requireSuperAdmin(token);
    const admin = this.user("id = ?", id)!;
    if (typeof password !== "string" || !verifySecret(password, admin.password_hash)) throw new AuthFailure("Your password is not correct.");
    const next = newRecoveryKey();
    this.db.setMeta("recovery_hash", hashSecret(normalizeKey(next)));
    this.db.audit(admin.username, "recovery_key_replaced");
    return { recoveryKey: next };
  }
}
