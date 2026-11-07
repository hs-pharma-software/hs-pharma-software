/** A business on a free trial confirms its subscription (owner only). */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { confirmTrial } from "@/server/trial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const b = (await req.json().catch(() => ({}))) as { action?: string };
    if (b.action !== "confirm") throw new HttpError(400, "Unknown action.");
    return Response.json({ result: await confirmTrial(sqlForServer(), caller) });
  } catch (e) {
    return jsonError(e);
  }
}
