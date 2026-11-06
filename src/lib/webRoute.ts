/** Which requests are business websites (src/proxy.server.ts).
 *
 * App hosts (app.mavin.pk, previews, localhost) and the corporate site keep
 * their routes. Any other host is a business website: its pages are served
 * from /web (the page itself checks the host against the allowlist of
 * addresses), robots.txt and sitemap.xml per business, the API and files as
 * they are. A business's portal domain keeps the app's routes.
 *
 * Address map on a free subdomain or website domain:
 *   /            website        /shop...      store
 *   /admin       the app's sign-in (app.mavin.pk)
 * On a store domain the store is at /. */
import { APP_URL, isSiteHost } from "@/config/site";

export const WEB_HOST_HEADER = "x-web-host";
export const PLATFORM_DOMAIN = (process.env.NEXT_PUBLIC_WEB_PLATFORM_DOMAIN || "mavin.pk").toLowerCase();
const APP_HOST = new URL(APP_URL).host.toLowerCase();

export type WebRoute =
  | { kind: "app" }
  | { kind: "block" }
  | { kind: "pass"; host: string }
  | { kind: "rewrite"; host: string; path: string }
  | { kind: "redirect"; url: string };

const bare = (host: string | null) => (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");

/** Hosts that are never a business website. */
export function isAppHost(host: string | null): boolean {
  const h = bare(host);
  return !h || h === APP_HOST || h === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.endsWith(".vercel.app") || h.endsWith(".localhost")
    || h === PLATFORM_DOMAIN || h === `www.${PLATFORM_DOMAIN}` || isSiteHost(h);
}

/** `portal`: whether this host is a business's active portal domain (looked up by the proxy). */
export function webRoute(host: string | null, pathname: string, portal = false): WebRoute {
  const h = bare(host);
  if (isAppHost(h)) {
    // The website routes exist only behind a business address.
    return pathname === "/web" || pathname.startsWith("/web/") || pathname.startsWith("/web-meta/") ? { kind: "block" } : { kind: "app" };
  }
  if (portal) return pathname === "/" ? { kind: "redirect", url: "/dashboard" } : { kind: "pass", host: h };
  if (pathname === "/robots.txt") return { kind: "rewrite", host: h, path: "/web-meta/robots" };
  if (pathname === "/sitemap.xml") return { kind: "rewrite", host: h, path: "/web-meta/sitemap" };
  if (pathname.startsWith("/api/") || /\.[a-z0-9]{2,5}$/i.test(pathname)) return { kind: "pass", host: h };
  // Lab reports (QR code and the website's report lookup) open the app's report page.
  if (pathname === "/lab-report" || pathname === "/lab-report/") return { kind: "pass", host: h };
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return { kind: "redirect", url: `${APP_URL}/` };
  if (pathname.startsWith("/web")) return { kind: "block" };
  return { kind: "rewrite", host: h, path: `/web${pathname === "/" ? "" : pathname}` };
}
