/** Purchase Cell > Vendor Logins: the vendor portal logins of the hospital's
 * suppliers and vendors (src/server/vendorPortal.ts). Passwords are set by the server only. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { vendorLoginAction } from "@/server/vendorPortal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: (await vendorLoginAction(sqlForServer(), caller, body)) ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
