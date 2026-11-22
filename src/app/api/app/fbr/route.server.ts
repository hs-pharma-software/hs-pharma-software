/** "Submit to FBR" for the Android app (src/server/appFbr.ts):
 *  POST {action: "submit", invoiceId} · {action: "finish", submissionId, report} · GET: whether this login may submit. */
import { callerOf, HttpError, jsonError } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { appFbrFinish, appFbrSubmit, fbrAvailable } from "@/server/appFbr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// FBR can take ~40 s through the gateway.
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    return Response.json({ available: await fbrAvailable(sqlForServer(), caller) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const sql = sqlForServer();
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action === "submit") {
      const scope = await branchScopeFor(sql, caller, req.headers.get("x-branch"));
      return Response.json(await appFbrSubmit(sql, caller, typeof b.invoiceId === "string" ? b.invoiceId : "", scope));
    }
    if (b.action === "finish") return Response.json(await appFbrFinish(sql, caller, b));
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    return jsonError(e);
  }
}
