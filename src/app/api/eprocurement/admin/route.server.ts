/** Super Admin > eProcurement: vendor registrations, the approved vendors
 * directory, blacklisted vendors, business types and the organizations using
 * eProcurement (src/server/vendorRegistration.ts). Super Admin only. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { adminEprocurementAction } from "@/server/vendorRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: (await adminEprocurementAction(sqlForServer(), caller, body)) ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
