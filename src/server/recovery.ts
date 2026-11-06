/** Password recovery and recovery contacts.
 *
 * Forgot password: the person enters their username, email or mobile number;
 * if it matches exactly one active login that has an email, a 6-digit code is
 * emailed (an email/mobile shared by several logins gets the list of
 * usernames instead). The answer is the same whether or not anything matched,
 * so the form cannot be used to find out who has an account. The code works
 * for 10 minutes and 5 tries; codes per login and requests per address are
 * limited. A completed reset ends the login's other sessions
 * (password_changed_at, checked in callerOf).
 *
 * SMS is not connected yet: a mobile number identifies the login, and the
 * code still goes to its email. */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { HttpError, passwordHash } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import { chooseLoginMail, codeMail, type SendMail } from "./mailer";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const CODE_MINUTES = 10;
export const MAX_TRIES = 5;
/** Codes per login in RATE_WINDOW_MIN minutes. */
export const CODES_PER_LOGIN = 3;
/** Requests per network address in an hour (also counted in memory). */
export const REQUESTS_PER_IP = 10;
const RATE_WINDOW_MIN = 30;
export const MIN_PASSWORD = 4;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHash = (requestId: string, code: string) => sha(`${requestId}:${code}`);

// ── Contacts ──────────────────────────────────────────────────────────────

export function normalizeEmail(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const e = String(raw).trim().toLowerCase();
  if (!e) return null;
  if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) throw new HttpError(400, "Enter a valid email address.");
  return e;
}

/** Pakistani mobiles as +923XXXXXXXXX (03XX..., 923XX..., +92 3XX...); other countries need a leading +. */
export function normalizeMobile(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const digits = s.replace(/[\s\-().]/g, "");
  let m: string | null = null;
  if (/^03\d{9}$/.test(digits)) m = `+92${digits.slice(1)}`;
  else if (/^923\d{9}$/.test(digits)) m = `+${digits}`;
  else if (/^00923\d{9}$/.test(digits)) m = `+${digits.slice(2)}`;
  else if (/^\+923\d{9}$/.test(digits)) m = digits;
  else if (/^\+(?!92)\d{8,15}$/.test(digits)) m = digits;
  if (!m) throw new HttpError(400, "Enter the mobile number like 03001234567.");
  return m;
}

export const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"*".repeat(Math.min(Math.max(b.length, 2), 6))}${c}`);
export const maskMobile = (m: string) => `${m.slice(0, 4)}******${m.slice(-3)}`;

/** Who may change a login's recovery contacts: the login itself (with its
 * current password), the owner for logins of their business, the Super Admin. */
async function mayManage(sql: Sql, caller: Caller, userId: string) {
  const t = (await sql.execute(`SELECT id, tenant_id, role, password_hash, password_salt FROM users WHERE id = ? AND deleted_at IS NULL`, [userId])).rows[0];
  if (!t) throw new HttpError(404, "Login not found.");
  const self = String(t.id) === caller.userId;
  const owner = caller.role === "owner" && caller.tenantId != null && String(t.tenant_id ?? "") === caller.tenantId && String(t.role) !== "super_admin";
  if (!(self || owner || caller.role === "super_admin")) throw new HttpError(403, "You cannot change this login's recovery details.");
  return { self, row: t };
}

export async function getContact(sql: Sql, caller: Caller, userId: string) {
  await mayManage(sql, caller, userId);
  const r = (await sql.execute(`SELECT email, mobile FROM users WHERE id = ?`, [userId])).rows[0];
  return { email: (r?.email as string | null) ?? null, mobile: (r?.mobile as string | null) ?? null };
}

export async function setContact(sql: Sql, caller: Caller, userId: string, p: { email?: unknown; mobile?: unknown; currentPassword?: unknown }) {
  const { self, row } = await mayManage(sql, caller, userId);
  // Changing your own recovery email needs your password, so a borrowed open session cannot take over the login.
  if (self && caller.role !== "super_admin") {
    const pw = typeof p.currentPassword === "string" ? p.currentPassword : "";
    if (!pw || !sameHash(passwordHash(pw, String(row.password_salt)), String(row.password_hash))) throw new HttpError(403, "Your current password is not correct.");
  }
  const email = normalizeEmail(p.email);
  const mobile = normalizeMobile(p.mobile);
  await sql.execute(`UPDATE users SET email = ?, mobile = ?, updated_at = ? WHERE id = ?`, [email, mobile, new Date().toISOString(), userId]);
  return { email, mobile };
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── Forgot password ───────────────────────────────────────────────────────

const ipHits = new Map<string, number[]>();
function ipLimited(ip: string | null, now: number): boolean {
  const key = ip ?? "?";
  const hits = (ipHits.get(key) ?? []).filter((t) => now - t < 3600_000);
  hits.push(now);
  ipHits.set(key, hits);
  return hits.length > REQUESTS_PER_IP;
}
/** Clears the in-memory request counter (tests). */
export const resetRateLimits = () => ipHits.clear();

export const RECOVERY_MESSAGE = "If this matches a login with an email on file, we have sent a 6-digit code to it. It works for 10 minutes. No email on your login? Ask your business owner to reset your password.";

export interface RecoveryDeps { send: SendMail | null; now?: Date }

/** Step 1. Always answers the same; `requestId` is needed for step 2. */
export async function requestReset(sql: Sql, identifier: unknown, ip: string | null, deps: RecoveryDeps): Promise<{ requestId: string; message: string }> {
  const now = deps.now ?? new Date();
  const requestId = randomBytes(16).toString("hex");
  const answer = { requestId, message: RECOVERY_MESSAGE };
  const raw = typeof identifier === "string" ? identifier.trim() : "";
  if (raw.length < 3 || raw.length > 120) throw new HttpError(400, "Enter your username, email or mobile number.");
  if (ipLimited(ip, now.getTime())) throw new HttpError(429, "Too many requests. Wait an hour and try again.");
  if (!deps.send) throw new HttpError(503, "Password recovery by email is not set up yet. Ask your business owner or the administrator to reset your password.");

  // Which logins: by username, else by email, else by mobile.
  let rows = (await sql.execute(`SELECT id, username, email FROM users WHERE username = ? AND deleted_at IS NULL AND is_active = 1`, [raw])).rows;
  if (!rows.length) {
    let email: string | null = null;
    let mobile: string | null = null;
    try { email = raw.includes("@") ? normalizeEmail(raw) : null; } catch { email = null; }
    try { mobile = raw.includes("@") ? null : normalizeMobile(raw); } catch { mobile = null; }
    if (email) rows = (await sql.execute(`SELECT id, username, email FROM users WHERE email = ? AND deleted_at IS NULL AND is_active = 1`, [email])).rows;
    else if (mobile) rows = (await sql.execute(`SELECT id, username, email FROM users WHERE mobile = ? AND deleted_at IS NULL AND is_active = 1`, [mobile])).rows;
  }
  if (!rows.length) return answer;

  if (rows.length > 1) {
    // Several logins share it: list their usernames to each email on file, no code.
    const emails = Array.from(new Set(rows.map((r) => r.email).filter(Boolean).map(String)));
    for (const e of emails) await deps.send(chooseLoginMail(e, rows.filter((r) => r.email === e).map((r) => String(r.username))));
    return answer;
  }
  const u = rows[0];
  if (!u.email) return answer;
  const since = new Date(now.getTime() - RATE_WINDOW_MIN * 60_000).toISOString();
  const recent = Number((await sql.execute(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at >= ?`, [u.id, since])).rows[0]?.n ?? 0);
  if (recent >= CODES_PER_LOGIN) return answer;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const t = now.toISOString();
  await sql.batch([
    // Only the newest code works.
    { sql: `UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, args: [t, u.id] },
    {
      sql: `INSERT INTO password_resets (id, user_id, channel, code_hash, attempts, ip, created_at, expires_at) VALUES (?, ?, 'email', ?, 0, ?, ?, ?)`,
      args: [requestId, u.id, codeHash(requestId, code), ip, t, new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString()],
    },
  ]);
  try {
    await deps.send(codeMail(String(u.email), { code, username: String(u.username), minutes: CODE_MINUTES }));
  } catch {
    // The code was never delivered: retire it, and say so (it does not reveal anything the person did not type).
    await sql.execute(`UPDATE password_resets SET used_at = ? WHERE id = ?`, [t, requestId]);
    throw new HttpError(502, "The code could not be emailed. Try again in a few minutes.");
  }
  return answer;
}

/** Step 2: the code and the new password. */
export async function completeReset(sql: Sql, requestId: unknown, code: unknown, newPassword: unknown, deps: { now?: Date } = {}): Promise<{ username: string }> {
  const now = deps.now ?? new Date();
  const id = typeof requestId === "string" && /^[0-9a-f]{32}$/.test(requestId) ? requestId : "";
  const c = typeof code === "string" ? code.replace(/\s/g, "") : "";
  const pw = typeof newPassword === "string" ? newPassword : "";
  if (!/^\d{6}$/.test(c)) throw new HttpError(400, "Enter the 6-digit code from the email.");
  if (pw.length < MIN_PASSWORD) throw new HttpError(400, `The new password must be at least ${MIN_PASSWORD} characters.`);
  const wrong = new HttpError(400, "The code is wrong or has expired. Check the email, or ask for a new code.");
  if (!id) throw wrong;
  const r = (await sql.execute(`SELECT * FROM password_resets WHERE id = ?`, [id])).rows[0];
  if (!r || r.used_at || String(r.expires_at) <= now.toISOString() || Number(r.attempts) >= MAX_TRIES) throw wrong;
  if (!sameHash(codeHash(id, c), String(r.code_hash))) {
    const tries = Number(r.attempts) + 1;
    await sql.execute(`UPDATE password_resets SET attempts = ?${tries >= MAX_TRIES ? ", used_at = ?" : ""} WHERE id = ?`, tries >= MAX_TRIES ? [tries, now.toISOString(), id] : [tries, id]);
    throw tries >= MAX_TRIES ? new HttpError(400, "Too many wrong codes. Ask for a new code.") : wrong;
  }
  const u = (await sql.execute(`SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL AND is_active = 1`, [r.user_id])).rows[0];
  if (!u) throw wrong;
  const salt = randomBytes(16).toString("hex");
  const t = now.toISOString();
  // Claim the code first so a second request with it cannot also succeed.
  const claimed = await sql.execute(`UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL`, [t, id]);
  if (!claimed.rowsAffected) throw wrong;
  await sql.execute(`UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = ?, updated_at = ? WHERE id = ?`, [passwordHash(pw, salt), salt, t, t, u.id]);
  return { username: String(u.username) };
}
