/** The public website's API (no sign-in). The business comes only from the
 * request's host matched against the allowlist of addresses (resolveHost);
 * a suspended or switched-off website answers nothing. */
import { clientIp, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { loadSite } from "@/server/web/core";
import { resolveHost } from "@/server/web/domains";
import { orderByToken, placeOrder, publicCatalog, submitRequest } from "@/server/web/store";
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
        result = { items: all.filter((p) => slugs.includes(p.slug)), store: { pickup: site.storeSettings.pickup, delivery: site.storeSettings.delivery, zones: site.storeSettings.zones, minOrder: site.storeSettings.minOrder, payment: site.storeSettings.payment, bankDetails: site.storeSettings.bankDetails, rxNotice: site.storeSettings.rxNotice } };
        break;
      }
      case "checkout": result = await placeOrder(sql, site, b, ip); break;
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
