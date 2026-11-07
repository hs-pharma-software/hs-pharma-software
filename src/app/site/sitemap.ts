import type { MetadataRoute } from "next";
import { SITE_PAGES, SITE_PUBLISHED } from "@/config/site";
import { SITE_PRODUCTS } from "@/config/siteProducts";
import { listArticles } from "@/lib/siteArticles";
import { pageUrl } from "@/config/seoMeta";

export const dynamic = "force-static";

/** The public site's pages at their clean addresses (served as /sitemap.xml on
 * the corporate domain). Empty until the site is approved for publishing. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_PUBLISHED) return [];
  const paths = [...SITE_PAGES, ...SITE_PRODUCTS.map((p) => `/products/${p.slug}`), ...listArticles().map((a) => `/resources/${a.slug}`)];
  // Exact served addresses (the site uses trailing slashes): no redirect for Google to follow.
  return paths.map((p) => ({ url: pageUrl(p), changeFrequency: "monthly", priority: p === "/" ? 1 : p.startsWith("/products/") || p === "/integrations/fbr-digital-invoicing" ? 0.9 : 0.7 }));
}
