/** A prescription attached to a web order: only signed-in staff of that
 * business (owner, Settings or web_orders access) can open it. Never cached. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { managedTenant } from "@/server/web/core";
import { prescriptionFile } from "@/server/web/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const url = new URL(req.url);
    const tenantId = managedTenant(caller, url.searchParams.get("tenantId") ?? undefined);
    const f = await prescriptionFile(sqlForServer(), tenantId, url.searchParams.get("id") ?? "");
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `inline; filename="${f.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
