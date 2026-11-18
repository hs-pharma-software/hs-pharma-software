/** PRA eIMS through MAVIN's server (src/server/pra/service.ts).
 * Business logins: status, setup (owner), submit (checkout), list, reconcile (owner), process (sweep of their own bills).
 * Super Admin: accounts, setup, save_account, access, save_pos, decide_pos, live, rules, save_rule, decide_rule,
 * assign_rule, cases, save_case, list, reconcile, process (all businesses). */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { branchScopeFor } from "@/server/branches";
import * as pra from "@/server/pra/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// PRA can take ~40 s per invoice.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const caller = await callerOf(req);
    const scope = () => branchScopeFor(sql, caller, req.headers.get("x-branch"));
    let result: unknown;
    switch (b.action) {
      case "status": result = await pra.status(sql, caller, pra.isSuper(caller) ? undefined : await scope().catch(() => undefined)); break;
      case "setup": result = await pra.setup(sql, caller, b); break;
      case "submit": result = await pra.submit(sql, caller, b, await scope()); break;
      case "list": result = await pra.list(sql, caller, b, pra.isSuper(caller) ? undefined : await scope()); break;
      case "reconcile": result = await pra.reconcile(sql, caller, b); break;
      case "for_source": result = await pra.forSource(sql, caller, b); break;
      case "set_sending": result = await pra.setSending(sql, caller, b); break;
      case "process": {
        // The business's own bills (any login of it), or every business (Super Admin).
        if (!pra.isSuper(caller) && !caller.tenantId) throw new HttpError(403, "Not allowed.");
        result = await pra.sweep(sql, {}, pra.isSuper(caller) ? (typeof b.tenantId === "string" ? b.tenantId : undefined) : caller.tenantId!);
        break;
      }
      case "accounts": result = await pra.listAccounts(sql, caller, b); break;
      case "save_account": result = await pra.saveAccount(sql, caller, b); break;
      case "access": result = await pra.setAccess(sql, caller, b); break;
      case "save_pos": result = await pra.savePos(sql, caller, b); break;
      case "decide_pos": result = await pra.decidePos(sql, caller, b); break;
      case "live": result = await pra.approveLive(sql, caller, b); break;
      case "rules": result = await pra.listRules(sql, caller, b); break;
      case "save_rule": result = await pra.saveRule(sql, caller, b); break;
      case "decide_rule": result = await pra.decideRule(sql, caller, b); break;
      case "assign_rule": result = await pra.assignRule(sql, caller, b); break;
      case "cases": result = await pra.listCases(sql, caller); break;
      case "save_case": result = await pra.saveCase(sql, caller, b); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
