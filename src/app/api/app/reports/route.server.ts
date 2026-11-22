/** The website's reports for the Android app (src/server/appReports.ts): ?key=&from=&to=; no key: the list. */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { appReport, REPORTS } from "@/server/appReports";
import { requireModule, type Runner } from "@/server/appDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
    requireModule(caller, "reports");
    const u = new URL(req.url);
    const key = u.searchParams.get("key");
    if (!key) return Response.json({ reports: REPORTS });
    const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
    const ip = clientIp(req);
    const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
    const body = await appReport(run, caller.tenantId, key, u.searchParams.get("from"), u.searchParams.get("to"));
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
