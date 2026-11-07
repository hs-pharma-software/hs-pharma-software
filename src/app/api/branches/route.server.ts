/** Branches of a business (src/server/branches.ts): the tab's branch list,
 * branch management (owner), capacity requests, stock transfers and branch reports. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import * as br from "@/server/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const id = typeof b.id === "string" ? b.id : "";
    let result: unknown;
    switch (b.action) {
      case "context": result = await br.branchContext(sql, caller, req.headers.get("x-branch")); break;
      case "create": result = await br.createBranch(sql, caller, (b.branch ?? {}) as Record<string, unknown>); break;
      case "update": result = await br.updateBranch(sql, caller, id, (b.branch ?? {}) as Record<string, unknown>); break;
      case "status": result = await br.setBranchStatus(sql, caller, id, b.status, b.reason); break;
      case "users": result = await br.branchUsers(sql, caller); break;
      case "assign": result = await br.assignUser(sql, caller, String(b.userId ?? ""), b.branches); break;
      case "requestCapacity": result = await br.requestCapacity(sql, caller, b.extra, b.reason); break;
      case "cancelRequest": result = await br.cancelCapacityRequest(sql, caller, id); break;
      case "audit":
        if (caller.role !== "owner" || !caller.tenantId) throw new HttpError(403, "Only the business owner sees the branch history.");
        result = await br.auditLog(sql, caller.tenantId, 100);
        break;
      case "batches": result = await br.transferableBatches(sql, caller, String(b.branchId ?? ""), b.q); break;
      case "transfers": result = await br.listTransfers(sql, caller, b.status); break;
      case "transfer": result = await br.transferDetail(sql, caller, id); break;
      case "createTransfer": result = await br.createTransfer(sql, caller, (b.transfer ?? {}) as Record<string, unknown>); break;
      case "receiveTransfer": result = await br.receiveTransfer(sql, caller, id, b); break;
      case "cancelTransfer": result = await br.cancelTransfer(sql, caller, id, b.reason); break;
      case "report": result = await br.branchReport(sql, caller, b); break;
      case "dashboard": result = await br.enterpriseDashboard(sql, caller, String(b.today ?? "")); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
