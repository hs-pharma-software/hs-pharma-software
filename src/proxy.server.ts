/** On the corporate domain (NEXT_PUBLIC_SITE_HOSTS) the public site is served
 * at clean paths: /products shows src/app/site/products. On every other host
 * nothing changes, so the app's own /products keeps working. Web build only
 * (the desktop's static export has no proxy). */
import { NextResponse, type NextRequest } from "next/server";
import { SITE_BASE_HEADER } from "@/config/site";
import { siteRoute } from "@/lib/siteRoute";

export default function proxy(req: NextRequest) {
  const route = siteRoute(req.headers.get("host"), req.nextUrl.pathname);
  if (route.kind === "pass") return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = route.path;
  if (route.kind === "redirect") return NextResponse.redirect(url, 308);
  const headers = new Headers(req.headers);
  headers.set(SITE_BASE_HEADER, "");
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/).*)"],
};
