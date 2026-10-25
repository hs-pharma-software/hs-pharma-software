/** Pages anyone may open without logging in: the landing page and the online
 * copy of a lab report (report QR code). */
export function isPublicPath(pathname: string | null | undefined): boolean {
  const p = (pathname ?? "").replace(/\/+$/, "") || "/";
  return p === "/" || p === "/report";
}
