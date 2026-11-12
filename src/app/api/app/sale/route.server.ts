/** A new sale from the Android app: one atomic, repeat-safe save (src/server/appDocs.ts). */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { createSale, requireModule, type Runner } from "@/server/appDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
    requireModule(caller, "invoices");
    const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
    const ip = clientIp(req);
    const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
    return Response.json(await createSale(run, caller.tenantId, await req.json()));
  } catch (e) {
    return jsonError(e);
  }
}
