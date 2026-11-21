/** Signed session tokens, carried in an httpOnly cookie the page's scripts
 * cannot read. The token only says who logged in and when it expires; the
 * user's current role, tenant and active status are re-read from the
 * database on every request, so a deactivated login stops working at once. */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "hs_session";
export const SESSION_HOURS = 12;
/** The MAVIN Windows app: stays signed in while it is opened at least once a month. */
export const DESKTOP_SESSION_DAYS = 30;
/** A session in use is renewed (a fresh cookie) at most once an hour. */
const RENEW_AFTER_MS = 3600_000;

export interface SessionClaims {
  /** user id */
  u: string;
  /** expiry, ms since epoch */
  exp: number;
  /** issued at, ms since epoch (absent on sessions from before it was added) */
  iat?: number;
  /** 1: the MAVIN Windows app's session (long, renewed while in use) */
  d?: 1;
}

/** How long a new session lasts, in seconds. */
export const sessionSeconds = (desktop: boolean) => (desktop ? DESKTOP_SESSION_DAYS * 24 : SESSION_HOURS) * 3600;

/** When the session was started: its own record, or worked out from a 12-hour expiry. */
export const sessionIssuedAt = (c: SessionClaims) => c.iat ?? c.exp - SESSION_HOURS * 3600_000;

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function issueSession(userId: string, secret: string, now = Date.now(), opts: { desktop?: boolean } = {}): { token: string; claims: SessionClaims } {
  const claims: SessionClaims = { u: userId, exp: now + sessionSeconds(Boolean(opts.desktop)) * 1000, iat: now, ...(opts.desktop ? { d: 1 as const } : {}) };
  const body = b64(JSON.stringify(claims));
  return { token: `${body}.${sign(body, secret)}`, claims };
}

/** The claims of a valid, unexpired token; null otherwise. */
export function verifySession(token: string | undefined | null, secret: string, now = Date.now()): SessionClaims | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.u !== "string" || typeof claims.exp !== "number" || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

/** A fresh session for one in use (same kind, full length again), once it is
 * an hour old; null while it is newer. The caller has already checked it. */
export function renewSession(claims: SessionClaims, secret: string, now = Date.now()): { token: string; seconds: number } | null {
  if (now - sessionIssuedAt(claims) < RENEW_AFTER_MS) return null;
  const desktop = claims.d === 1;
  return { token: issueSession(claims.u, secret, now, { desktop }).token, seconds: sessionSeconds(desktop) };
}

/** Set-Cookie value. Secure everywhere except plain-http localhost development. */
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

/** The session token of a request: the web page's cookie, or the desktop
 * app's "Authorization: Bearer" header (its pages are not served from this
 * site, so they cannot carry the cookie). */
export function requestToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  const bearer = auth && /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return bearer ? bearer[1] : readCookie(req.headers.get("cookie"));
}

export function readCookie(header: string | null, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
