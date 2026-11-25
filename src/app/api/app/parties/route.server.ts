/** Customers (?kind=customer), suppliers (?kind=supplier) or salesmen (?kind=salesman) for the Android app's
 * pickers, by name or phone (?q=). POST {kind, name, phone}: a new customer or salesman (the invoice form's "+"). */
import { callerOf, clientIp, HttpError, jsonError, runForCaller } from "@/server/db";
import { branchScopeFor } from "@/server/branches";
import { sqlForServer } from "@/server/subSupersApi";
import { createParty, searchParties } from "@/server/appReads";
import type { Runner } from "@/server/appDocs";
import { callerCan } from "@/server/sqlPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runnerFor(req: Request) {
  const caller = await callerOf(req);
  if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
  const branch = await branchScopeFor(sqlForServer(), caller, req.headers.get("x-branch"));
  const ip = clientIp(req);
  const run: Runner = (stmts, batch) => runForCaller(caller, stmts, batch, ip, branch);
  return { caller, tenantId: caller.tenantId, run };
}

export async function GET(req: Request): Promise<Response> {
  try {
    const { tenantId, run } = await runnerFor(req);
    const u = new URL(req.url);
    const kind = u.searchParams.get("kind");
    if (kind !== "customer" && kind !== "supplier" && kind !== "salesman") throw new HttpError(400, "Ask for customers, suppliers or salesmen.");
    return Response.json({ rows: await searchParties(run, tenantId, kind, u.searchParams.get("q")) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { caller, tenantId, run } = await runnerFor(req);
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown };
    if (body.kind !== "customer" && body.kind !== "supplier" && body.kind !== "salesman") throw new HttpError(400, "Add a customer, supplier or salesman.");
    // As on the web: from the section itself, or from the invoice / purchase form's "+".
    const from = { customer: ["customers", "invoices"], supplier: ["suppliers", "purchase"], salesman: ["salesman", "invoices"] }[body.kind];
    if (caller.role === "staff" && Array.isArray(caller.permissions) && !from.some((k) => caller.permissions!.includes(k))) {
      throw new HttpError(403, `Your login cannot add a ${body.kind}. Ask the owner to allow it.`);
    }
    return Response.json({ row: await createParty(run, tenantId, body.kind, body, callerCan(caller, "customer.extra_discount")) });
  } catch (e) {
    return jsonError(e);
  }
}
