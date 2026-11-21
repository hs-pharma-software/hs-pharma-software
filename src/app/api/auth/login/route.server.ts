/** Checks the username and password on the server and starts a session
 * (httpOnly cookie). Repeated failures from one address are slowed down. */
import { serverConfig } from "@/server/config";
import { clientIp, jsonError, passwordHash, serverDb, HttpError } from "@/server/db";
import { issueSession, sessionCookie, sessionSeconds } from "@/server/session";
import { sqlForServer } from "@/server/subSupersApi";
import { portalTenantFor } from "@/server/web/domains";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failures = new Map<string, { n: number; until: number }>();
const LIMIT = 8;
const MAX_FAILURE_KEYS = 5000;
let failedAttemptsSinceSweep = 0;
const WINDOW_MS = 15 * 60_000;

export async function POST(req: Request): Promise<Response> {
  try {
    const { username, password, client } = (await req.json()) as { username?: string; password?: string; client?: string };
    if (!username?.trim() || !password) throw new HttpError(400, "Enter the username and password.");
    const key = `${clientIp(req) ?? "?"}|${username.trim().toLowerCase()}`;
    const f = failures.get(key);
    if (f && f.n >= LIMIT && f.until > Date.now()) throw new HttpError(429, "Too many failed attempts. Wait 15 minutes and try again.");

    const rs = await serverDb().execute({
      sql: `SELECT id, tenant_id, password_hash, password_salt, is_active FROM users WHERE username = ? AND deleted_at IS NULL`,
      args: [username.trim()],
    });
    const u = rs.rows[0];
    const ok = u ? safeEqual(passwordHash(password, String(u.password_salt)), String(u.password_hash)) : false;
    if (!u || !ok) {
      const now = Date.now();
      if ((++failedAttemptsSinceSweep % 128 === 0) || failures.size >= MAX_FAILURE_KEYS) {
        for (const [k, value] of failures) if (value.until <= now) failures.delete(k);
      }
      const cur = failures.get(key);
      if (!cur && failures.size >= MAX_FAILURE_KEYS) {
        const oldest = failures.keys().next().value;
        if (oldest !== undefined) failures.delete(oldest);
      }
      failures.set(key, { n: (cur && cur.until > now ? cur.n : 0) + 1, until: now + WINDOW_MS });
      throw new HttpError(401, "Incorrect username or password.");
    }
    if (!Number(u.is_active)) throw new HttpError(403, "This account has been deactivated. Contact the administrator.");
    // A business's own portal domain signs in that business's logins only.
    const portalTenant = await portalTenantFor(sqlForServer(), req.headers.get("host"));
    if (portalTenant && String(u.tenant_id ?? "") !== portalTenant) throw new HttpError(401, "Incorrect username or password.");
    failures.delete(key);
    // The MAVIN Windows app's pages stay signed in between openings (renewed while in use).
    const desktopApp = req.headers.get("x-mavin-client") === "desktop";
    const { token } = issueSession(String(u.id), serverConfig().sessionSecret, Date.now(), { desktop: desktopApp });
    const seconds = sessionSeconds(desktopApp);
    const secure = new URL(req.url).protocol === "https:";
    // The desktop app keeps the token itself and sends it as a Bearer header.
    const body = client === "desktop" ? { userId: String(u.id), token, expiresInHours: seconds / 3600 } : { userId: String(u.id) };
    return Response.json(body, { headers: { "Set-Cookie": sessionCookie(token, seconds, secure) } });
  } catch (e) {
    return jsonError(e);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
