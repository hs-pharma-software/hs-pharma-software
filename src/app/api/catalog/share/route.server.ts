/** Super Admin > Catalog Review: a pharmacy's own products shared to a shared
 * catalogue, without duplicates (src/server/catalogShare.ts). Super Admin only. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { shareToCatalog } from "@/server/catalogShare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: await shareToCatalog(sqlForServer(), caller, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
