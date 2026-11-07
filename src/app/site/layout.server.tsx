import type { Metadata } from "next";
import { SITE_PUBLISHED, SITE_URL } from "@/config/site";
import { DraftNotice, SiteFooter, SiteHeader, siteBase } from "@/components/site/chrome";
import { SiteAnalytics } from "@/components/site/SiteAnalytics";
import { KeywordMarquee } from "@/components/site/KeywordMarquee";
import { sqlForServer } from "@/server/subSupersApi";
import { popularSearches } from "@/server/seo/popular";
import { ogImage } from "@/config/seoMeta";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "MAVIN.pk", template: "%s | MAVIN.pk" },
  description: "Business software for billing, stock and daily operations.",
  // Hidden from search engines until the content is approved (config/site.ts).
  robots: SITE_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { type: "website", siteName: "MAVIN.pk", locale: "en_PK", images: [{ url: ogImage("POS & Business Software in Pakistan"), width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image" },
};

/** The public website: its own header and footer, no app chrome. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const base = await siteBase();
  // Keywords from the weekly SEO research; refreshed automatically.
  const popular = await popularSearches(sqlForServer()).catch(() => []);
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fc] text-slate-800">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <DraftNotice />
      <SiteHeader base={base} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter base={base} />
      {/* At the very bottom, below the footer. */}
      <KeywordMarquee items={popular} base={base} />
      <SiteAnalytics />
    </div>
  );
}
