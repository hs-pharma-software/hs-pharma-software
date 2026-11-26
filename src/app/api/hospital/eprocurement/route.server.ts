/** Purchase Cell > eProcurement: the shared vendor directory and item list of
 * all hospitals (src/server/vendorPortal.ts eprocurementAction). */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { eprocurementAction } from "@/server/vendorPortal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: (await eprocurementAction(sqlForServer(), caller, body)) ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
