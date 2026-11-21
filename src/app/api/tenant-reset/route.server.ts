/** Super Admin: empty a business after testing (src/server/tenantReset.ts). */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { resetTenant } from "@/server/tenantReset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await resetTenant(sqlForServer(), caller, b);
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
