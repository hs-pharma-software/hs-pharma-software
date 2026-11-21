/** Customers (?kind=customer) or suppliers (?kind=supplier) for the Android app's pickers, by name or phone (?q=). */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { searchParties } from "@/server/appReads";
import type { Runner } from "@/server/appDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
    const u = new URL(req.url);
    const kind = u.searchParams.get("kind");
    if (kind !== "customer" && kind !== "supplier") throw new HttpError(400, "Ask for customers or suppliers.");
    const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
    const ip = clientIp(req);
    const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
    return Response.json({ rows: await searchParties(run, caller.tenantId, kind, u.searchParams.get("q")) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
