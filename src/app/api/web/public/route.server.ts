/** The public website's API (no sign-in). The business comes only from the
 * request's host matched against the allowlist of addresses (resolveHost);
 * a suspended or switched-off website answers nothing. */
import { clientIp, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { loadSite, rateLimited } from "@/server/web/core";
import { resolveHost } from "@/server/web/domains";
import { orderByToken, orderForPayment, placeOrder, publicCatalog, submitRequest } from "@/server/web/store";
import { offeredMethods, startAttempt, toMinor } from "@/server/payments";
import { findLabReport } from "@/server/web/labLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 14 * 1024 * 1024) throw new HttpError(413, "The request is too large.");
    const sql = sqlForServer();
    const host = await resolveHost(sql, req.headers.get("host"));
    if (!host || host.target === "portal") throw new HttpError(404, "Not found.");
    const site = await loadSite(sql, host.tenantId);
    if (!site || site.publicSuspended || !site.tenantActive || (!site.websiteEnabled && !site.storeEnabled)) throw new HttpError(404, "This website is not available.");
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ip = clientIp(req);
    let result: unknown;
    switch (b.action) {
      case "cart": {
        // The cart's current prices and stock, from the server.
        if (!site.storeEnabled) throw new HttpError(404, "The store is closed.");
        const slugs = Array.isArray(b.slugs) ? b.slugs.filter((s): s is string => typeof s === "string").slice(0, 40) : [];
        const all = await publicCatalog(sql, site);
        // Online methods: only those active and approved for this very website address.
        const online = (await offeredMethods(sql, site.tenantId, host.host)).map((o) => ({ provider: o.provider, method: o.method, label: o.label }));
        result = { items: all.filter((p) => slugs.includes(p.slug)), store: { pickup: site.storeSettings.pickup, delivery: site.storeSettings.delivery, zones: site.storeSettings.zones, minOrder: site.storeSettings.minOrder, payment: site.storeSettings.payment, bankDetails: site.storeSettings.bankDetails, rxNotice: site.storeSettings.rxNotice, online } };
        break;
      }
      case "suggest": {
        // Search suggestions as the visitor types.
        if (!site.storeEnabled) throw new HttpError(404, "The store is closed.");
        if (rateLimited(`suggest:${site.tenantId}:${ip ?? "?"}`, 120, 60_000)) throw new HttpError(429, "Slow down a little.");
        const q = typeof b.q === "string" ? b.q.trim().slice(0, 60) : "";
        result = q.length < 2 ? [] : (await publicCatalog(sql, site, { q, limit: 8 })).map((p) => ({ slug: p.slug, name: p.name, price: p.price, unit: p.unit }));
        break;
      }
      case "checkout": result = await placeOrder(sql, site, b, ip, new Date(), host.host); break;
      case "payOnline": {
        // Starts (or repeats) a payment for a placed online order; the customer goes to the provider's page.
        if (rateLimited(`pay:${site.tenantId}:${ip ?? "?"}`, 20, 60_000)) throw new HttpError(429, "Slow down a little.");
        const o = await orderForPayment(sql, site.tenantId, String(b.token ?? ""));
        if (!o || o.payment_method !== "online") throw new HttpError(404, "Order not found.");
        if (o.payment_status === "paid") throw new HttpError(409, "This order is already paid.");
        if (o.status === "cancelled") throw new HttpError(409, "This order was cancelled.");
        const provider = b.provider === "jazzcash" || b.provider === "easypaisa" ? b.provider : null;
        const method = b.method === "wallet" || b.method === "card" ? b.method : null;
        if (!provider || !method) throw new HttpError(400, "Choose how to pay.");
        const path = typeof b.returnPath === "string" && /^\/[\w\-/]{0,120}$/.test(b.returnPath) ? b.returnPath : "/";
        result = await startAttempt(sql, {
          tenantId: site.tenantId, purpose: "web_order", refId: String(o.id), branchId: (o.branch_id as string | null) ?? null,
          amountMinor: toMinor(Number(o.total)), provider, method, host: host.host,
          idempotencyKey: typeof b.idempotencyKey === "string" ? b.idempotencyKey.slice(0, 80) : null,
          returnUrl: `https://${host.host}${path.replace(/\/$/, "")}/${b.token}/`, description: `Order ${o.order_no}`,
          customerPhone: (o.phone as string | null) ?? null, customerEmail: (o.email as string | null) ?? null,
        });
        break;
      }
      case "request": result = await submitRequest(sql, site, b, ip); break;
      case "labReport":
        if (!site.websiteEnabled) throw new HttpError(404, "Not available.");
        result = await findLabReport(sql, site.tenantId, b.number, b.phone, ip);
        break;
      case "order": {
        const o = await orderByToken(sql, site.tenantId, String(b.token ?? ""));
        if (!o) throw new HttpError(404, "Order not found.");
        result = o;
        break;
      }
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
