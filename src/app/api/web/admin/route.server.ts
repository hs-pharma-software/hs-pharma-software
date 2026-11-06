/** Super Admin > Tenant > Website & Domains (src/server/web). Super Admin only. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { actorOf, previewToken } from "@/server/web/core";
import * as sites from "@/server/web/sites";
import { listDomains, PLATFORM_DOMAIN } from "@/server/web/domains";
import { vercelConfig } from "@/server/seo/vercel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (caller.role !== "super_admin") throw new HttpError(403, "Only the platform owner can do this.");
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = typeof b.tenantId === "string" ? b.tenantId : "";
    if (!tenantId) throw new HttpError(400, "Choose a business.");
    const sql = sqlForServer();
    const actor = actorOf(caller);
    let result: unknown;
    switch (b.action) {
      case "get":
        result = { ...(await sites.overviewFor(sql, tenantId)), domains: await listDomains(sql, tenantId).catch(() => []), platformDomain: PLATFORM_DOMAIN, hostingConnected: Boolean(vercelConfig()) };
        break;
      case "enable": result = (await sites.enableFeatures(sql, actor, tenantId, { website: b.website, store: b.store })).provisioned; break;
      case "flags": result = await sites.setAdminFlags(sql, actor, tenantId, b); break;
      case "template": result = await sites.applyTemplate(sql, actor, tenantId, b.template); break;
      case "subdomain": result = await sites.reserveSubdomain(sql, actor, tenantId, b.subdomain); break;
      case "checkSubdomain": result = await sites.checkSubdomain(sql, b.subdomain, tenantId); break;
      case "preview": result = { token: previewToken(tenantId) }; break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
