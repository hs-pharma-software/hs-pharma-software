/** The public Mavin.pk website (src/app/site). It is served at clean paths
 * (/products, /pricing, ...) on the corporate domain by src/proxy.server.ts,
 * and at /site/... on the app's own domain for preview. The app's own routes
 * (/products is the app's product list) never change. */

/** Hosts that serve the corporate site, e.g. "mavin.pk,www.mavin.pk". */
export const SITE_HOSTS = (process.env.NEXT_PUBLIC_SITE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Canonical address of the corporate site (used for canonicals and the sitemap). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mavin.pk").replace(/\/+$/, "");

/** Where existing customers sign in (the app). */
export const APP_LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/";

/** Until the content and claims are approved, pages say "Draft" and ask
 * search engines not to index them. Set NEXT_PUBLIC_SITE_PUBLISHED=1 after approval. */
export const SITE_PUBLISHED = process.env.NEXT_PUBLIC_SITE_PUBLISHED === "1";

/** Request header the proxy sets on the corporate host: the path prefix of site links there (""). */
export const SITE_BASE_HEADER = "x-site-base";

export const isSiteHost = (host: string | null | undefined) => Boolean(host) && SITE_HOSTS.includes(host!.split(":")[0].toLowerCase());

export const SITE_NAV = [
  { label: "Products", href: "/products" },
  { label: "Platform", href: "/platform" },
  { label: "Integrations", href: "/integrations" },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
] as const;

/** Every public page, for the sitemap (product pages are added from the registry). */
export const SITE_PAGES = [
  "/", "/products", "/platform", "/integrations", "/integrations/fbr-digital-invoicing", "/pricing", "/demo", "/contact",
  "/resources", "/help", "/about", "/privacy", "/terms", "/security",
] as const;
