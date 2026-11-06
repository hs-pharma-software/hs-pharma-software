import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { SITE_PRODUCTS } from "@/config/siteProducts";
import { PageIntro, Section } from "@/components/site/chrome";
import { LeadForm } from "@/components/site/LeadForm";

export const metadata: Metadata = withSeoMeta("/demo", {
  title: "Book a Demo",
  description: "Tell us your business type and workflow, and we arrange a demo of the matching MAVIN.pk product.",
  alternates: { canonical: "/demo" },
});

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const names = SITE_PRODUCTS.map((p) => p.name);
  return (
    <>
      <PageIntro eyebrow="Book a Demo" title="See the product for your business.">
        Tell us your sector, how many branches you have and what you want to see. We reply to arrange a time.
      </PageIntro>
      <Section>
        <div className="max-w-3xl">
          <LeadForm kind="demo" businessTypes={names} defaultType={type && names.includes(type) ? type : ""} />
        </div>
      </Section>
    </>
  );
}
