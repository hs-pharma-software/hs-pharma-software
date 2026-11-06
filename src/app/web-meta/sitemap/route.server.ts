/** sitemap.xml of a business website: its published pages and listed
 * products at the primary (canonical) website and store addresses. */
import { headers } from "next/headers";
import { sqlForServer } from "@/server/subSupersApi";
import { WEB_HOST_HEADER } from "@/lib/webRoute";
import { webContext } from "@/server/web/publicSite";
import { publicCatalog } from "@/server/web/store";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(): Promise<Response> {
  const host = (await headers()).get(WEB_HOST_HEADER);
  const sql = sqlForServer();
  const ctx = host ? await webContext(sql, host, null).catch(() => null) : null;
  const urls: string[] = [];
  if (ctx) {
    const web = ctx.canonicalWebsite ?? `https://${ctx.host.host}`;
    const store = ctx.canonicalStore ?? `${web}/shop`;
    if (ctx.websiteOn || ctx.site.websiteEnabled) for (const p of ctx.pages) urls.push(`${web}${p.kind === "home" ? "/" : `/${p.slug}`}`);
    if (ctx.storeOn) {
      urls.push(store);
      for (const p of await publicCatalog(sql, ctx.site)) urls.push(`${store}/item/${p.slug}`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
