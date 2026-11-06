import type { Metadata } from "next";
import overrides from "../content/seo-meta.json";

/** Search titles and descriptions approved in the SEO Content Studio. Each
 * approved change arrives as a pull request that edits
 * src/content/seo-meta.json; a page's own title and description apply until then. */
const META = overrides as Record<string, { title?: string; description?: string }>;

export function withSeoMeta(path: string, m: Metadata): Metadata {
  const o = META[path];
  if (!o) return m;
  return { ...m, ...(o.title ? { title: o.title } : {}), ...(o.description ? { description: o.description } : {}) };
}
