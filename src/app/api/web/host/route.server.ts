/** Whether a host is a business's active portal domain. Asked by the proxy
 * (which cannot reach the database itself); answers only true or false. */
import { sqlForServer } from "@/server/subSupersApi";
import { portalTenantFor } from "@/server/web/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const host = new URL(req.url).searchParams.get("h");
  const portal = host ? (await portalTenantFor(sqlForServer(), host).catch(() => null)) !== null : false;
  return Response.json({ portal }, { headers: { "Cache-Control": "no-store" } });
}
