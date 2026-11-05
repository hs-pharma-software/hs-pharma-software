/** Sets a password from a one-time setup link (new distributors and newly
 * activated customers). No session: the link's token is the proof. */
import { clientIp, jsonError, HttpError } from "@/server/db";
import { redeemSetupToken } from "@/server/subSupers";
import { sqlForServer } from "@/server/subSupersApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tries = new Map<string, number[]>();

export async function POST(req: Request): Promise<Response> {
  try {
    const key = clientIp(req) ?? "?";
    const recent = (tries.get(key) ?? []).filter((t) => Date.now() - t < 15 * 60_000);
    if (recent.length >= 10) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.");
    tries.set(key, [...recent, Date.now()]);
    const { token, password } = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
    const r = await redeemSetupToken(sqlForServer(), String(token ?? ""), String(password ?? ""));
    return Response.json({ ok: true, username: r.username });
  } catch (e) {
    return jsonError(e);
  }
}
