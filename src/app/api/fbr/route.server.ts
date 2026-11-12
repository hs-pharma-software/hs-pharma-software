/** FBR Digital Invoicing through MAVIN's server (src/server/fbr/service.ts).
 * Business logins: config, tokens, test, reference, submit, finish, resolve, list.
 * Super Admin: overview, egress (the gateway's outbound IP), and sandbox scenario
 * testing (scn_*, src/server/fbr/scenarios.ts), go-live Clear (clear_*, goLive.ts). */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { branchScopeFor } from "@/server/branches";
import * as fbr from "@/server/fbr/service";
import * as scn from "@/server/fbr/scenarios";
import { clearPreview, clearSales } from "@/server/fbr/goLive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// FBR can take ~40 s; the gateway call is limited to 55 s.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const caller = await callerOf(req);
    let result: unknown;
    switch (b.action) {
      case "config": result = await fbr.config(sql, caller, {}, b); break;
      case "tokens": result = await fbr.saveTokens(sql, caller, b); break;
      case "test": result = await fbr.testToken(sql, caller, b); break;
      case "reference": result = await fbr.reference(sql, caller, b); break;
      case "submit": result = await fbr.submit(sql, caller, b, await branchScopeFor(sql, caller, req.headers.get("x-branch"))); break;
      case "finish": result = await fbr.finish(sql, caller, b); break;
      case "resolve": result = await fbr.resolve(sql, caller, b); break;
      case "list": result = await fbr.list(sql, caller, b); break;
      case "overview": result = await fbr.adminOverview(sql, caller); break;
      case "egress": result = await fbr.adminEgressIp(caller); break;
      case "scn_catalog": result = scn.catalog(caller); break;
      case "scn_prepare": result = await scn.prepare(sql, caller, b); break;
      case "scn_start": result = await scn.startSession(sql, caller, b); break;
      case "scn_session": result = await scn.session(sql, caller, b); break;
      case "scn_update": result = await scn.updateScenario(sql, caller, b); break;
      case "scn_add": result = await scn.addScenario(sql, caller, b); break;
      case "scn_run": result = await scn.run(sql, caller, b); break;
      case "scn_report": result = await scn.report(sql, caller, b); break;
      case "scn_resolve": result = await scn.resolve(sql, caller, b); break;
      case "scn_confirm": result = await scn.confirmPortal(sql, caller, b); break;
      case "scn_finish": result = await scn.finishSession(sql, caller, b); break;
      case "scn_demo_buyer": result = await scn.getDemoBuyer(sql, caller); break;
      case "scn_demo_buyer_set": result = await scn.setDemoBuyer(sql, caller, b); break;
      case "clear_preview": result = await clearPreview(sql, caller, b); break;
      case "clear_sales": result = await clearSales(sql, caller, b); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
