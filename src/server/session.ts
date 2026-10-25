/** Signed session tokens, carried in an httpOnly cookie the page's scripts
 * cannot read. The token only says who logged in and when it expires; the
 * user's current role, tenant and active status are re-read from the
 * database on every request, so a deactivated login stops working at once. */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "hs_session";
export const SESSION_HOURS = 12;

export interface SessionClaims {
  /** user id */
  u: string;
  /** expiry, ms since epoch */
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function issueSession(userId: string, secret: string, now = Date.now()): { token: string; claims: SessionClaims } {
  const claims: SessionClaims = { u: userId, exp: now + SESSION_HOURS * 3600_000 };
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

/** Set-Cookie value. Secure everywhere except plain-http localhost development. */
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function readCookie(header: string | null, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
