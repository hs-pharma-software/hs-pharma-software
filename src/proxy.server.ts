/** Request routing by host (web build only; the desktop's static export has no proxy).
 *  - Corporate domain (NEXT_PUBLIC_SITE_HOSTS): the public site at clean paths
 *    (src/app/site), as src/lib/siteRoute.ts decides.
 *  - A business website (free subdomain or custom domain): its pages from
 *    src/app/web, as src/lib/webRoute.ts decides. The host is passed on in a
 *    header this proxy always sets itself, so a visitor cannot choose it.
 *  - Everything else (the app): unchanged. */
import { NextResponse, type NextRequest } from "next/server";
import { SITE_BASE_HEADER } from "@/config/site";
import { siteRoute } from "@/lib/siteRoute";
import { WEB_HOST_HEADER, isAppHost, webRoute } from "@/lib/webRoute";

/** Portal domains, looked up once a minute per host (custom domains only).
 * The proxy cannot reach the database, so it asks /api/web/host. */
const portalCache = new Map<string, { portal: boolean; until: number }>();
async function isPortalDomain(req: NextRequest, host: string): Promise<boolean> {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  const platform = (process.env.NEXT_PUBLIC_WEB_PLATFORM_DOMAIN || "mavin.pk").toLowerCase();
  if (h.endsWith(`.${platform}`)) return false;
  const hit = portalCache.get(h);
  if (hit && hit.until > Date.now()) return hit.portal;
  let portal = false;
  try {
    const res = await fetch(new URL(`/api/web/host/?h=${encodeURIComponent(h)}`, req.url), { cache: "no-store" });
    portal = res.ok && Boolean(((await res.json()) as { portal?: boolean }).portal);
  } catch {
    portal = false;
  }
  if (portalCache.size > 2000) portalCache.clear();
  portalCache.set(h, { portal, until: Date.now() + 60_000 });
  return portal;
}

export default async function proxy(req: NextRequest) {
  const host = req.headers.get("host");
  const headers = new Headers(req.headers);
  // Never trust a client-sent website host header.
  headers.delete(WEB_HOST_HEADER);

  const site = siteRoute(host, req.nextUrl.pathname);
  if (site.kind !== "pass") {
    const url = req.nextUrl.clone();
    if (site.kind === "redirect-host") {
      url.host = site.host;
      url.port = "";
      url.protocol = "https:";
      return NextResponse.redirect(url, 308);
    }
    url.pathname = site.path;
    if (site.kind === "redirect") return NextResponse.redirect(url, 308);
    headers.set(SITE_BASE_HEADER, "");
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // The lookup route itself is never looked up (no loop).
  const portal = !isAppHost(host) && !req.nextUrl.pathname.startsWith("/api/web/host") ? await isPortalDomain(req, host ?? "") : false;
  const web = webRoute(host, req.nextUrl.pathname, portal);
  if (web.kind === "block") return new NextResponse("Not found", { status: 404 });
  if (web.kind === "redirect") return NextResponse.redirect(new URL(web.url, req.url), 307);
  if (web.kind === "rewrite") {
    headers.set(WEB_HOST_HEADER, web.host);
    const url = req.nextUrl.clone();
    url.pathname = web.path;
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (web.kind === "pass") headers.set(WEB_HOST_HEADER, web.host);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/).*)"],
};
