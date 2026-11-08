/** Online payments management (src/server/payments.ts): the Super Admin for
 * MAVIN.pk's own account (tenantId null) and requests; a business owner for
 * its own account, transactions, refunds and the subscription payment. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import * as pay from "@/server/payments";
import { isProvider } from "@/server/paymentProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    // Whose account: the Super Admin names a business (or none = MAVIN.pk's own); a business only its own.
    const tenantId = caller.role === "super_admin" ? (typeof b.tenantId === "string" && b.tenantId ? b.tenantId : null) : caller.tenantId;
    const id = typeof b.id === "string" ? b.id : "";
    let result: unknown;
    switch (b.action) {
      case "merchants": result = await pay.listMerchants(sql, caller, tenantId); break;
      case "save": result = await pay.saveMerchant(sql, caller, tenantId, b); break;
      case "test": result = await pay.testMerchant(sql, caller, id); break;
      case "enable": result = await pay.setMerchantEnabled(sql, caller, id, b.enabled === true); break;
      case "transactions": result = await pay.listAttempts(sql, caller, tenantId); break;
      case "recheck": {
        await pay.listAttempts(sql, caller, tenantId, 1); // same access check as the list
        const own = (await sql.execute(`SELECT tenant_id FROM payment_attempts WHERE id = ?`, [id])).rows[0];
        if (!own || ((own.tenant_id as string | null) ?? null) !== tenantId) throw new HttpError(404, "Payment not found.");
        result = await pay.recheckAttempt(sql, id);
        break;
      }
      case "refund": result = await pay.requestRefund(sql, caller, id, b); break;
      case "completeRefund": result = await pay.completeManualRefund(sql, caller, id, b.providerRef); break;
      case "requestAccess": result = await pay.requestAccess(sql, caller, b.methods, b.note); break;
      case "requests": result = await pay.listRequests(sql, caller, caller.role === "super_admin" ? (typeof b.tenantId === "string" ? b.tenantId : null) : null); break;
      case "decide": result = await pay.decideRequest(sql, caller, id, b.approve === true, b.note); break;
      case "overview": result = await pay.platformOverview(sql, caller); break;
      // MAVIN.pk subscription, paid by the business owner to MAVIN.pk's own account.
      case "subscriptionOptions": {
        if (caller.role !== "owner" || !caller.tenantId) throw new HttpError(403, "The business owner pays the subscription.");
        result = (await pay.offeredMethods(sql, null)).map((o) => ({ provider: o.provider, method: o.method, label: o.label }));
        break;
      }
      case "subscriptionPay": {
        if (caller.role !== "owner" || !caller.tenantId) throw new HttpError(403, "The business owner pays the subscription.");
        if (!isProvider(b.provider) || (b.method !== "wallet" && b.method !== "card")) throw new HttpError(400, "Choose how to pay.");
        const t = (await sql.execute(`SELECT t.name, p.name AS plan, p.price FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.subscription_plan_id WHERE t.id = ?`, [caller.tenantId])).rows[0];
        const amountMinor = pay.toMinor(Number(t?.price) || 0);
        if (!amountMinor) throw new HttpError(409, "Your plan's price is set by MAVIN.pk on request. Contact us to renew.");
        result = await pay.startAttempt(sql, {
          tenantId: null, purpose: "subscription", refId: caller.tenantId, branchId: null, amountMinor, provider: b.provider, method: b.method,
          idempotencyKey: typeof b.idempotencyKey === "string" ? b.idempotencyKey.slice(0, 80) : null,
          returnUrl: pay.platformUrl("/settings/payments/"), description: `MAVIN.pk ${t?.plan ?? "subscription"}`,
        });
        break;
      }
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
