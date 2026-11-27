/** Vendor portal: a vendor's own registration (vendorRegistration.ts) and, once
 * approved, their quote requests, purchase orders and payments
 * (vendorPortal.ts). The only data route a vendor login reaches. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { vendorAction, vendorActorFor } from "@/server/vendorPortal";
import { ACCOUNT_ACTIONS, accountAction } from "@/server/vendorRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req, { allowVendor: true });
    const sql = sqlForServer();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The account and registration steps work before approval; the rest needs an approved vendor.
    const result = ACCOUNT_ACTIONS.has(String(body.action))
      ? await accountAction(sql, caller, body)
      : await vendorAction(sql, await vendorActorFor(sql, caller), body);
    return Response.json({ result: result ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
