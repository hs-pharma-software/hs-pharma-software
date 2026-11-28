/** A new purchase from the Android app: one atomic, repeat-safe save (src/server/appDocs.ts). */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { createPurchase, pkToday, requireModule, type Runner } from "@/server/appDocs";
import { priceQuestions } from "@/server/catalogPrices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
    requireModule(caller, "purchase");
    const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
    const ip = clientIp(req);
    const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
    const body = await req.json();
    // ?preview=1: the totals exactly as saving would work them out; nothing is written.
    if (new URL(req.url).searchParams.get("preview") === "1") return Response.json(await createPurchase(run, caller.tenantId, body, pkToday(), { preview: true }));
    const { repriced, ...saved } = await createPurchase(run, caller.tenantId, body);
    // Shared products whose retail price changed: the app asks whether it changed for everyone.
    // The purchase is saved whatever happens here.
    const questions = repriced?.length ? await priceQuestions(sqlForServer(), caller, repriced).catch(() => []) : [];
    return Response.json({ ...saved, ...(questions.length ? { priceQuestions: questions } : {}) });
  } catch (e) {
    return jsonError(e);
  }
}
