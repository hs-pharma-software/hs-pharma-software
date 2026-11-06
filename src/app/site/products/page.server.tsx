import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { PRODUCT_GROUPS, SITE_PRODUCTS } from "@/config/siteProducts";
import { PageIntro, Section, siteBase } from "@/components/site/chrome";
import { ProductDirectory } from "@/components/site/ProductDirectory";

export const metadata: Metadata = withSeoMeta("/products", {
  title: "Products",
  description: "MAVIN.pk products by sector: pharmacy, retail, distribution, healthcare, food and events, and contractor billing.",
  alternates: { canonical: "/products" },
});

export default async function ProductsPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="Products" title="A version for each kind of business.">
        Every product runs on the same platform. Choose your sector to see its workflow, what it needs to get started and what is still on the way.
      </PageIntro>
      <Section>
        <ProductDirectory
          base={base}
          groups={PRODUCT_GROUPS}
          items={SITE_PRODUCTS.map((p) => ({ slug: p.slug, name: p.name, group: p.group, headline: p.headline, pilot: p.cta === "pilot" }))}
        />
      </Section>
    </>
  );
}
