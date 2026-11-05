import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** The app's own domain: business screens are private, so nothing is indexed.
 * (The corporate domain has its own robots.txt: src/app/site/robots.txt.) */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
