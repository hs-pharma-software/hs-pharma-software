import { isSiteHost } from "@/config/site";

/** Pages anyone may open without logging in: the landing page, the online
 * copy of a lab report (report QR code), and the public website (under /site,
 * or any path on the corporate domain, where the browser shows the clean
 * address the proxy rewrote). */
export function isPublicPath(pathname: string | null | undefined): boolean {
  const p = (pathname ?? "").replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/report" || p === "/site" || p.startsWith("/site/")) return true;
  return typeof window !== "undefined" && isSiteHost(window.location.host);
}
