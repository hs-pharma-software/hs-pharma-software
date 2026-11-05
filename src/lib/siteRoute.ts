import { SITE_CANONICAL_HOST, isSiteHost } from "@/config/site";

/** App pages people open from paper or messages: served as they are on every host. */
const APP_PUBLIC_PAGES = ["/lab-report", "/report", "/set-password"];

export type SiteRoute = { kind: "pass" } | { kind: "rewrite" | "redirect"; path: string } | { kind: "redirect-host"; host: string };

/** What the proxy does with a request (src/proxy.server.ts). On the corporate
 * domain: clean paths are served from /site, an old /site/... link redirects
 * to its clean address, and the API and files are served as they are. Any
 * other host: nothing changes. */
export function siteRoute(host: string | null, pathname: string): SiteRoute {
  if (!isSiteHost(host)) return { kind: "pass" };
  // Links printed on paper or sent to people (report QR codes, password setup)
  // work on every address, the website's included.
  if (APP_PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return { kind: "pass" };
  // mavin.pk (any non-official site host): the official address www.mavin.pk, same path.
  if (host!.split(":")[0].toLowerCase() !== SITE_CANONICAL_HOST) return { kind: "redirect-host", host: SITE_CANONICAL_HOST };
  if (pathname === "/site" || pathname.startsWith("/site/")) return { kind: "redirect", path: pathname.slice(5) || "/" };
  const special = pathname === "/robots.txt" || pathname === "/sitemap.xml";
  if (!special && (pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(pathname))) return { kind: "pass" };
  // The home page is the main landing page (src/app/page.tsx), the same on every address.
  if (pathname === "/") return { kind: "pass" };
  return { kind: "rewrite", path: `/site${pathname}` };
}
