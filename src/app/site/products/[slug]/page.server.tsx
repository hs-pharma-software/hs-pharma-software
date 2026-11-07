import type { Metadata } from "next";
import { pageUrl, withSeoMeta } from "@/config/seoMeta";
import { PRODUCT_SEO } from "@/config/siteSeo";
import { SITE_URL } from "@/config/site";
import { JsonLd } from "@/components/site/JsonLd";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_PRODUCTS, productFacts, siteProduct } from "@/config/siteProducts";
import { CtaLink, PageIntro, Section, at, siteBase } from "@/components/site/chrome";

export const dynamicParams = false;
export function generateStaticParams() {
  return SITE_PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = siteProduct((await params).slug);
  if (!p) return {};
  const seo = PRODUCT_SEO[p.slug];
  return withSeoMeta(`/products/${p.slug}`, { title: seo?.title ?? p.name, description: seo?.description ?? p.intro });
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = siteProduct((await params).slug);
  if (!p) notFound();
  const base = await siteBase();
  const facts = productFacts(p);
  const pilot = p.cta === "pilot";
  const cta = (
    <>
      <CtaLink href={at(base, `/demo?type=${encodeURIComponent(p.name)}`)}>{pilot ? "Discuss a Pilot" : "Book a Demo"}</CtaLink>
      {/* Pricing opens on this business type's plans. */}
      <CtaLink variant="secondary" href={at(base, `/pricing?type=${p.typeId}`)}>See Prices</CtaLink>
    </>
  );

  const seo = PRODUCT_SEO[p.slug];
  const url = pageUrl(`/products/${p.slug}`);
  // Structured data from what the page shows: the product, its FAQs, and where it sits.
  const ld = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: `MAVIN.pk ${p.name}`, applicationCategory: "BusinessApplication", operatingSystem: "Windows, Web browser", description: seo?.description ?? p.intro, url, publisher: { "@type": "Organization", name: "MAVIN.pk", url: `${SITE_URL}/` } },
    ...(p.faqs.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Products", item: pageUrl("/products") },
      { "@type": "ListItem", position: 3, name: p.name, item: url },
    ] },
  ];

  return (
    <>
      <JsonLd data={ld} />
      <PageIntro eyebrow={`${p.group} · ${p.name}`} title={seo?.h1 ?? p.headline}>
        {seo?.h1 && <p className="text-lg font-medium text-slate-800">{p.headline}</p>}
        <p>{p.intro}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {cta}
          {pilot && <span className="text-sm text-slate-500">Offered as a supervised pilot while the remaining workflows are completed.</span>}
        </div>
      </PageIntro>

      <div className="mx-auto grid w-full max-w-6xl gap-2 lg:grid-cols-2">
        <Section title="Typical workflow">
          <ol className="space-y-2">
            {facts.workflow.map((step, i) => (
              <li key={step} className="flex gap-3 text-sm text-slate-700">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef4fc] text-xs font-semibold text-[#0b2a6b]">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Included today">
          <ul className="space-y-2 text-sm text-slate-700">
            {facts.mvp.map((f) => <li key={f} className="flex gap-2"><span aria-hidden className="text-emerald-600">✓</span>{f}</li>)}
          </ul>
          {facts.planned.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-slate-800">Not available yet</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-500">
                {facts.planned.map((f) => <li key={f}>– {f}</li>)}
              </ul>
            </>
          )}
        </Section>
      </div>

      <Section title="What you need to get started">
        <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {p.setup.map((s) => <li key={s} className="rounded-lg border border-slate-200 bg-white px-4 py-3">{s}</li>)}
        </ul>
      </Section>

      <Section title="Questions">
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {p.faqs.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-medium text-[#0b2a6b] [&::-webkit-details-marker]:hidden">
                {f.q}
              </summary>
              <p className="mt-2 text-sm text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section>
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base font-semibold text-[#0b2a6b]">{pilot ? `Planning a ${p.name} rollout?` : `See ${p.name} with your own products.`}</p>
          <div className="flex flex-wrap gap-3">{cta}</div>
        </div>
        <p className="mt-4 text-sm"><Link href={at(base, "/products")} className="text-[#1565c0] hover:underline">All products</Link></p>
      </Section>
    </>
  );
}
