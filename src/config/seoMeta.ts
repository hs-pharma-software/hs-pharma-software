import type { Metadata } from "next";
import overrides from "../content/seo-meta.json";
import { PAGE_SEO, SITE_NAME } from "./siteSeo";
import { SITE_URL } from "./site";

/** A public page's metadata: its search title and description (Content Studio
 * changes approved through src/content/seo-meta.json first, then
 * config/siteSeo.ts, then the page's own), plus the Open Graph and Twitter
 * card every share needs, with a generated preview image. */
const META = overrides as Record<string, { title?: string; description?: string }>;

/** The page address as served (the site uses trailing slashes). */
export const pageUrl = (path: string) => `${SITE_URL}${path === "/" ? "/" : `${path.replace(/\/+$/, "")}/`}`;
/** A 1200x630 share image with the page's title (src/app/site/og). */
export const ogImage = (title: string) => `${SITE_URL}/og/?t=${encodeURIComponent(title.replace(/\s*\|\s*MAVIN\.pk$/, "").slice(0, 90))}`;

const textOf = (t: Metadata["title"]): string | null => (typeof t === "string" ? t : t && typeof t === "object" && "absolute" in t ? String(t.absolute) : null);

export function withSeoMeta(path: string, m: Metadata): Metadata {
  const o = META[path];
  const seo = PAGE_SEO[path];
  const rawTitle = o?.title ?? seo?.title ?? textOf(m.title) ?? SITE_NAME;
  const description = o?.description ?? seo?.description ?? (typeof m.description === "string" ? m.description : undefined);
  // A title that already names the site is used as is; others get "| MAVIN.pk" from the layout.
  const full = rawTitle.includes(SITE_NAME) ? rawTitle : `${rawTitle} | ${SITE_NAME}`;
  const url = pageUrl(path);
  return {
    ...m,
    title: rawTitle.includes(SITE_NAME) ? { absolute: rawTitle } : rawTitle,
    ...(description ? { description } : {}),
    alternates: { ...(m.alternates ?? {}), canonical: url },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_PK", url, title: full, ...(description ? { description } : {}), images: [{ url: ogImage(full), width: 1200, height: 630, alt: full }], ...(m.openGraph ?? {}) },
    twitter: { card: "summary_large_image", title: full, ...(description ? { description } : {}), images: [ogImage(full)] },
  };
}
