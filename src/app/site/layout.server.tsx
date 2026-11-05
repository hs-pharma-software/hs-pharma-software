import type { Metadata } from "next";
import { SITE_PUBLISHED, SITE_URL } from "@/config/site";
import { DraftNotice, SiteFooter, SiteHeader, siteBase } from "@/components/site/chrome";
import { SiteAnalytics } from "@/components/site/SiteAnalytics";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "MAVIN.pk", template: "%s | MAVIN.pk" },
  description: "Business software for billing, stock and daily operations.",
  // Hidden from search engines until the content is approved (config/site.ts).
  robots: SITE_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false },
};

/** The public website: its own header and footer, no app chrome. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const base = await siteBase();
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fc] text-slate-800">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <DraftNotice />
      <SiteHeader base={base} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter base={base} />
      <SiteAnalytics />
    </div>
  );
}
