/** The Android app's Home: the web Dashboard's figures (src/server/appReads.ts). */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { appDashboard } from "@/server/appReads";
import { pkToday, type Runner } from "@/server/appDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
    const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
    const ip = clientIp(req);
    const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
    return Response.json(await appDashboard(run, caller, pkToday()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
