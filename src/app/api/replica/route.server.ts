/** The desktop app's local copy (src/server/replica.ts): the tables a login
 * may copy, one page of the first copy, and the rows changed since. Read as
 * the signed-in login, through the same rules as /api/db. */
import { callerOf, jsonError, schemaInfo, HttpError } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { replicaChanges, replicaPage, replicaTables } from "@/server/replica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json()) as { action?: unknown; table?: unknown; after?: unknown; since?: unknown };
    const sql = sqlForServer();
    const branch = await branchScopeFor(sql, caller, req.headers.get("x-branch"));
    const info = await schemaInfo();
    switch (body.action) {
      case "tables": return Response.json({ result: await replicaTables(sql, caller, info, branch) });
      case "page": return Response.json({ result: await replicaPage(sql, caller, info, branch, body.table, body.after) });
      case "changes": {
        const { tables } = await replicaTables(sql, caller, info, branch);
        return Response.json({ result: await replicaChanges(sql, caller, info, branch, body.since, new Set(tables)) });
      }
      default: throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    return jsonError(e);
  }
}
