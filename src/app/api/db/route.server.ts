/** The web version's only way to the database: a logged-in user's
 * parameterized statements, checked by src/server/sqlPolicy before they run. */
import { callerOf, clientIp, jsonError, runForCaller, type ClientStatement } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json()) as { statements?: ClientStatement[]; batch?: boolean };
    // The tab's branch (X-Branch), checked against the branches this login may open.
    const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
    const results = await runForCaller(caller, body.statements ?? [], Boolean(body.batch), clientIp(req), branch);
    return Response.json({ results });
  } catch (e) {
    return jsonError(e);
  }
}
