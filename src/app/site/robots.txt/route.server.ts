/** robots.txt of the corporate domain (the proxy serves /robots.txt from here).
 * Everything is closed until the site is approved for publishing. */
import { SITE_PUBLISHED, SITE_URL } from "@/config/site";

export const dynamic = "force-static";

export function GET(): Response {
  const body = SITE_PUBLISHED
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE_URL}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
