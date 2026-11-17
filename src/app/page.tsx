import type { Metadata } from "next";
import { LandingPage } from "@/components/site/LandingPage";
import { JsonLd, ORGANIZATION_LD, WEBSITE_LD } from "@/components/site/JsonLd";
import { withSeoMeta } from "@/config/seoMeta";
import { SITE_PUBLISHED, SITE_URL } from "@/config/site";

/** The home page (www.mavin.pk; also the app's front page) and its search metadata. */
export const metadata: Metadata = withSeoMeta("/", {
  robots: SITE_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false },
});

export default function HomePage() {
  return (
    <>
      <JsonLd data={[ORGANIZATION_LD(SITE_URL), WEBSITE_LD(SITE_URL)]} />
      <LandingPage />
    </>
  );
}
