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

/** The eProcurement vendor portal's own address (ep.mavin.pk, or NEXT_PUBLIC_EP_HOST). */
export const EP_HOST = (process.env.NEXT_PUBLIC_EP_HOST || `ep.${PLATFORM_DOMAIN}`).toLowerCase();
export function isEprocurementHost(host: string | null): boolean {
  return bare(host) === EP_HOST;
}

/** On the vendor portal's address: the portal (/vendor) with its sign-in, the API and files;
 * any other app page belongs to the app's own address. */
export function eprocurementRoute(pathname: string): { kind: "app" } | { kind: "redirect"; url: string } {
  if (pathname === "/" || pathname === "") return { kind: "redirect", url: "/vendor/" };
  if (pathname === "/vendor" || pathname.startsWith("/vendor/") || pathname.startsWith("/api/") || /\.[a-z0-9]{2,5}$/i.test(pathname)) return { kind: "app" };
  return { kind: "redirect", url: `${APP_URL}${pathname}` };
}

/** Hosts that are never a business website. */
export function isAppHost(host: string | null): boolean {
  const h = bare(host);
  return !h || h === APP_HOST || h === EP_HOST || h === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.endsWith(".vercel.app") || h.endsWith(".localhost")
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
