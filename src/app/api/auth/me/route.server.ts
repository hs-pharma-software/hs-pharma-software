/** Whether the browser still has a valid session, and for whom. A session in
 * use is renewed here, so an open app (or one opened again within the
 * session's length) is not signed out. */
import { callerOf, jsonError } from "@/server/db";
import { serverConfig } from "@/server/config";
import { readCookie, renewSession, sessionCookie, verifySession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const c = await callerOf(req, { allowDistributor: true, allowVendor: true });
    const body = { userId: c.userId, role: c.role, tenantId: c.tenantId, platformRole: c.platformRole ?? null };
    // Only the cookie is renewed: a Bearer token (the offline engine) keeps its own sign-in.
    const secret = serverConfig().sessionSecret;
    const claims = verifySession(readCookie(req.headers.get("cookie")), secret);
    const fresh = claims && claims.u === c.userId ? renewSession(claims, secret) : null;
    if (!fresh) return Response.json(body);
    return Response.json(body, { headers: { "Set-Cookie": sessionCookie(fresh.token, fresh.seconds, new URL(req.url).protocol === "https:") } });
  } catch (e) {
    return jsonError(e);
  }
}
