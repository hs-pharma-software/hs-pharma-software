import type { MetadataRoute } from "next";
import { SITE_PAGES, SITE_PUBLISHED, SITE_URL } from "@/config/site";
import { SITE_PRODUCTS } from "@/config/siteProducts";

export const dynamic = "force-static";

/** The public site's pages at their clean addresses (served as /sitemap.xml on
 * the corporate domain). Empty until the site is approved for publishing. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_PUBLISHED) return [];
  const paths = [...SITE_PAGES, ...SITE_PRODUCTS.map((p) => `/products/${p.slug}`)];
  return paths.map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}`, changeFrequency: "monthly", priority: p === "/" ? 1 : 0.7 }));
}
