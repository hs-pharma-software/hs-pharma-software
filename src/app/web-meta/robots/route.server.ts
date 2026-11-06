/** robots.txt of a business website (the proxy serves it at /robots.txt).
 * Cart, checkout, order pages and previews are kept out of search; an
 * unknown, unpublished or suspended website disallows everything. */
import { headers } from "next/headers";
import { sqlForServer } from "@/server/subSupersApi";
import { WEB_HOST_HEADER } from "@/lib/webRoute";
import { webContext } from "@/server/web/publicSite";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const host = (await headers()).get(WEB_HOST_HEADER);
  const ctx = host ? await webContext(sqlForServer(), host, null).catch(() => null) : null;
  const text = !ctx
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nDisallow: /order/\nDisallow: ${ctx.storeBase}/cart\nDisallow: /*?preview=\nDisallow: /api/\nAllow: /\n\nSitemap: https://${ctx.host.host}/sitemap.xml\n`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
