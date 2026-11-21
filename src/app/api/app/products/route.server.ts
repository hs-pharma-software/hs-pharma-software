/** Products for the Android app (src/server/appReads.ts): ?q=&offset= for a page of the list, ?id= for one product with its batches. */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { listProducts, productDetail } from "@/server/appReads";
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
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    const body = id
      ? await productDetail(run, caller.tenantId, id)
      : await listProducts(run, caller.tenantId, { search: u.searchParams.get("q"), offset: Number(u.searchParams.get("offset") ?? 0) });
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
