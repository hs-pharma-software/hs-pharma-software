/** Vendor portal: a hospital vendor's own quote requests, purchase orders and
 * payments (src/server/vendorPortal.ts). The only data route a vendor login reaches. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { vendorAction, vendorActorFor } from "@/server/vendorPortal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req, { allowVendor: true });
    const sql = sqlForServer();
    const actor = await vendorActorFor(sql, caller);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: (await vendorAction(sql, actor, body)) ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
