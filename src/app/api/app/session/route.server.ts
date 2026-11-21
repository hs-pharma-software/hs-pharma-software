/** The Android app keeps its sign-in: a session in use gets a fresh token (at
 * most hourly, full length again). The login must still be active and its
 * password unchanged (callerOf), or the app is signed out. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { serverConfig } from "@/server/config";
import { renewSession, requestToken, verifySession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const secret = serverConfig().sessionSecret;
    const claims = verifySession(requestToken(req), secret);
    if (!claims || claims.u !== caller.userId) throw new HttpError(401, "Your session has ended. Log in again.");
    const fresh = renewSession(claims, secret);
    return Response.json({ token: fresh?.token ?? null, expiresAt: fresh ? Date.now() + fresh.seconds * 1000 : claims.exp }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
