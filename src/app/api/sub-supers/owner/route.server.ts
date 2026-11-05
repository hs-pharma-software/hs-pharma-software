/** Sub Supers, platform owner side (Super Admin only). */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { actorFor } from "@/server/subSupers";
import { ownerAction, sqlForServer } from "@/server/subSupersApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (caller.role !== "super_admin") throw new HttpError(403, "Only the platform owner can do this.");
    const sql = sqlForServer();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: (await ownerAction(sql, await actorFor(sql, caller), body, new URL(req.url).origin)) ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
