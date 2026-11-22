/** The money pages for the Android app (src/server/appBooks.ts):
 *  GET  ?page=balances&kind=customer|supplier[&q=][&due=1] · ?page=ledger&kind=&id= · ?page=cash[&offset=] · ?page=expenses[&from=&to=&offset=]
 *  POST {page: "adjustment", kind, ...} · {page: "cash", ...} · {page: "expense", ...}
 * Each needs the login's section (Customers, Suppliers, Cash Register, Expenses). */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { addAdjustment, addCash, addExpense, cashRegister, expenses, partyBalances, partyLedger, type PartyKind } from "@/server/appBooks";
import { requireModule, type Runner } from "@/server/appDocs";
import type { Caller } from "@/server/sqlPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(req: Request) {
  const caller = await callerOf(req);
  if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
  const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
  const ip = clientIp(req);
  const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
  return { caller, tenantId: caller.tenantId, run };
}

function kindOf(caller: Caller, v: unknown): PartyKind {
  if (v !== "customer" && v !== "supplier") throw new HttpError(400, "Customers or suppliers?");
  requireModule(caller, v === "customer" ? "customers" : "suppliers");
  return v;
}

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(req: Request): Promise<Response> {
  try {
    const { caller, tenantId, run } = await context(req);
    const u = new URL(req.url);
    const p = u.searchParams;
    switch (p.get("page")) {
      case "balances":
        return Response.json(await partyBalances(run, tenantId, kindOf(caller, p.get("kind")), p.get("q"), p.get("due") === "1"), noStore);
      case "ledger":
        return Response.json(await partyLedger(run, tenantId, kindOf(caller, p.get("kind")), p.get("id") ?? ""), noStore);
      case "cash":
        requireModule(caller, "cash_register");
        return Response.json(await cashRegister(run, tenantId, Number(p.get("offset") ?? 0)), noStore);
      case "expenses":
        requireModule(caller, "expenses");
        return Response.json(await expenses(run, tenantId, { from: p.get("from"), to: p.get("to"), offset: Number(p.get("offset") ?? 0) }), noStore);
      default:
        throw new HttpError(400, "Unknown page.");
    }
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { caller, tenantId, run } = await context(req);
    const b = (await req.json().catch(() => ({}))) as { page?: unknown; kind?: unknown };
    switch (b.page) {
      case "adjustment":
        return Response.json(await addAdjustment(run, tenantId, kindOf(caller, b.kind), b));
      case "cash":
        requireModule(caller, "cash_register");
        return Response.json(await addCash(run, tenantId, b));
      case "expense":
        requireModule(caller, "expenses");
        return Response.json(await addExpense(run, tenantId, b));
      default:
        throw new HttpError(400, "Unknown entry.");
    }
  } catch (e) {
    return jsonError(e);
  }
}
