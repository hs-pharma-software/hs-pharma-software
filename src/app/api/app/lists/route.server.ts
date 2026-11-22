/** The website's list pages for the Android app (src/server/appLists.ts): ?key=&q=&from=&to=&offset=; ?purchase=<id> for one purchase. */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { appList, purchaseDetail } from "@/server/appLists";
import type { Runner } from "@/server/appDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
    const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
    const ip = clientIp(req);
    const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
    const p = new URL(req.url).searchParams;
    const purchase = p.get("purchase");
    const body = purchase
      ? await purchaseDetail(run, caller, purchase)
      : await appList(run, caller, p.get("key") ?? "", { search: p.get("q"), from: p.get("from"), to: p.get("to"), offset: Number(p.get("offset") ?? 0) });
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
