/** Super Admin > Duplicate Products: pairs of products whose names match by
 * more than half, merging and "not duplicates" (src/server/productDuplicates.ts).
 * Super Admin only. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { duplicatesAction } from "@/server/productDuplicates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Moving a much-used product's records can take a while.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: (await duplicatesAction(sqlForServer(), caller, body)) ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
