/** Super Admin > Tenant > Branches & Limits (src/server/branches.ts). */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import * as br from "@/server/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (caller.role !== "super_admin") throw new HttpError(403, "Only the Super Admin changes branch limits.");
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const tenantId = typeof b.tenantId === "string" ? b.tenantId : "";
    let result: unknown;
    switch (b.action) {
      case "get": result = await br.adminTenantBranches(sql, caller, tenantId); break;
      case "policy": result = await br.setBranchPolicy(sql, caller, tenantId, b); break;
      case "decide": result = await br.decideCapacityRequest(sql, caller, String(b.id ?? ""), b.approve === true, b); break;
      case "release": result = await br.releaseCapacity(sql, caller, String(b.branchId ?? ""), b.note); break;
      case "pending": result = await br.pendingCapacityRequests(sql, caller); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
