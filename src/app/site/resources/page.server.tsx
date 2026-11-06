import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import Link from "next/link";
import { SITE_PRODUCTS } from "@/config/siteProducts";
import { listArticles } from "@/lib/siteArticles";
import { PageIntro, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = withSeoMeta("/resources", {
  title: "Resources",
  description: "Getting started, product guides, release notes and integration setup for MAVIN.pk.",
  alternates: { canonical: "/resources" },
});

export default async function ResourcesPage() {
  const base = await siteBase();
  const articles = listArticles();
  return (
    <>
      <PageIntro eyebrow="Resources" title="Guides and updates.">
        Start here when you set up MAVIN.pk, add a new branch or switch on an integration.
      </PageIntro>
      <Section title="Getting started">
        <ol className="max-w-2xl list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Install the Windows desktop app, or open the web version, and sign in while online.</li>
          <li>Check the business profile: name, address and the registration numbers printed on invoices.</li>
          <li>Import products with the CSV sample file, then add opening stock.</li>
          <li>Add staff logins and choose a role for each.</li>
          <li>Choose the print layout (thermal, A5 or A4) and print a test invoice.</li>
        </ol>
      </Section>
      {articles.length > 0 && (
        <Section title="Articles">
          <ul className="grid gap-4 sm:grid-cols-2">
            {articles.map((a) => (
              <li key={a.slug}>
                <Link href={at(base, `/resources/${a.slug}`)} className="font-medium text-[#1565c0] hover:underline">{a.title}</Link>
                <p className="mt-1 text-sm text-slate-600">{a.description}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Product guides">
        <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {SITE_PRODUCTS.map((p) => (
            <li key={p.slug}><Link href={at(base, `/products/${p.slug}`)} className="text-[#1565c0] hover:underline">{p.name}</Link></li>
          ))}
        </ul>
      </Section>
      <Section title="More">
        <ul className="space-y-2 text-sm">
          <li><Link href={at(base, "/integrations/fbr-digital-invoicing")} className="text-[#1565c0] hover:underline">FBR Digital Invoicing setup</Link></li>
          <li><a href="https://github.com/hs-pharma-software/hs-pharma-software/releases" className="text-[#1565c0] hover:underline">Release notes and desktop downloads</a></li>
          <li><Link href={at(base, "/help")} className="text-[#1565c0] hover:underline">Help for existing customers</Link></li>
        </ul>
      </Section>
    </>
  );
}
