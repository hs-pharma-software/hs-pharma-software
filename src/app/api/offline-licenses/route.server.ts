/** Super Admin › Offline Tenants: licenses for the standalone desktop editions
 * (src/server/standalone/licenses.ts). Super Admin only. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import * as lic from "@/server/standalone/licenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const caller = await callerOf(req);
    let result: unknown;
    switch (b.action) {
      case "list": result = await lic.list(sql, caller); break;
      case "preview": result = lic.preview(caller, b); break;
      case "issue": result = await lic.issue(sql, caller, b); break;
      case "history": result = await lic.history(sql, caller, b); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
