/** Sub Supers, distributor workspace: the caller's own records only. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { actorFor } from "@/server/subSupers";
import { distributorAction, sqlForServer } from "@/server/subSupersApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req, { allowDistributor: true });
    if (caller.platformRole !== "distributor") throw new HttpError(403, "This area is for Sub Supers.");
    const sql = sqlForServer();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: (await distributorAction(sql, await actorFor(sql, caller), body)) ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
