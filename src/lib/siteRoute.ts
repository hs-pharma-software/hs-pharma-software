import { isSiteHost } from "@/config/site";

export type SiteRoute = { kind: "pass" } | { kind: "rewrite" | "redirect"; path: string };

/** What the proxy does with a request (src/proxy.server.ts). On the corporate
 * domain: clean paths are served from /site, an old /site/... link redirects
 * to its clean address, and the API and files are served as they are. Any
 * other host: nothing changes. */
export function siteRoute(host: string | null, pathname: string): SiteRoute {
  if (!isSiteHost(host)) return { kind: "pass" };
  if (pathname === "/site" || pathname.startsWith("/site/")) return { kind: "redirect", path: pathname.slice(5) || "/" };
  const special = pathname === "/robots.txt" || pathname === "/sitemap.xml";
  if (!special && (pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(pathname))) return { kind: "pass" };
  return { kind: "rewrite", path: pathname === "/" ? "/site" : `/site${pathname}` };
}
