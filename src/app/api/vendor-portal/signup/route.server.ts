/** Vendor portal sign-up (no sign-in): a vendor makes their own account at
 * ep.mavin.pk; the registration steps follow when they sign in
 * (src/server/vendorRegistration.ts). */
import { clientIp, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { signUp } from "@/server/vendorRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json(await signUp(sqlForServer(), body, clientIp(req)), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
