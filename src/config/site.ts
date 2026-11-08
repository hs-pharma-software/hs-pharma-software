/** The public Mavin.pk website (src/app/site). It is served at clean paths
 * (/products, /pricing, ...) on the corporate domain by src/proxy.server.ts,
 * and at /site/... on the app's own domain for preview. The app's own routes
 * (/products is the app's product list) never change. */

/** Hosts that serve the corporate site. www.mavin.pk is the official address
 * (Vercel sends mavin.pk there; the proxy does too, for any other host). The app itself is on app.mavin.pk (and the
 * vercel.app address), where nothing changes. */
export const SITE_HOSTS = (process.env.NEXT_PUBLIC_SITE_HOSTS ?? "mavin.pk,www.mavin.pk")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Canonical address of the corporate site (used for canonicals and the sitemap). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mavin.pk").replace(/\/+$/, "");

/** Where existing customers sign in: the app's own address. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.mavin.pk").replace(/\/+$/, "");

/** The sign-in link from a site page: the app's address on the corporate
 * domain (base ""), or this address's own sign-in when previewing at /site. */
export const appLoginUrl = (base: string) => (base === "" ? `${APP_URL}/` : "/");

/** Until the content and claims are approved, pages say "Draft" and ask
 * search engines not to index them. Set NEXT_PUBLIC_SITE_PUBLISHED=1 after approval. */
export const SITE_PUBLISHED = process.env.NEXT_PUBLIC_SITE_PUBLISHED === "1";

/** Request header the proxy sets on the corporate host: the path prefix of site links there (""). */
export const SITE_BASE_HEADER = "x-site-base";

export const isSiteHost = (host: string | null | undefined) => Boolean(host) && SITE_HOSTS.includes(host!.split(":")[0].toLowerCase());

/** The official host of the site (from SITE_URL): www and other site hosts redirect to it. */
export const SITE_CANONICAL_HOST = new URL(SITE_URL).host;

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
  "/resources", "/download", "/help", "/about", "/privacy", "/terms", "/security",
] as const;
