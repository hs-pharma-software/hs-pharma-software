import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/config/site";
import { withSeoMeta } from "@/config/seoMeta";
import { getArticle, listArticles } from "@/lib/siteArticles";
import { CtaLink, PageIntro, Section, at, siteBase } from "@/components/site/chrome";
import { Markdown } from "@/components/site/Markdown";

export const dynamicParams = false;
export function generateStaticParams() {
  return listArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = getArticle((await params).slug);
  if (!a) return {};
  const path = `/resources/${a.slug}`;
  return withSeoMeta(path, { title: a.title, description: a.description, alternates: { canonical: path }, openGraph: { type: "article", title: a.title, description: a.description } });
}

/** An article from the SEO Content Studio (merged pull request). */
export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const a = getArticle((await params).slug);
  if (!a) notFound();
  const base = await siteBase();
  const ld = {
    "@context": "https://schema.org", "@type": "Article", headline: a.title, description: a.description,
    ...(a.date ? { datePublished: a.date } : {}), mainEntityOfPage: `${SITE_URL}/resources/${a.slug}`,
    publisher: { "@type": "Organization", name: "MAVIN.pk", url: SITE_URL },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <PageIntro eyebrow="Resources" title={a.title}>
        {a.description}
      </PageIntro>
      <Section>
        <article className="max-w-3xl">
          <Markdown source={a.markdown} base={base} />
          <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-6">
            <CtaLink href={at(base, "/demo")}>Book a Demo</CtaLink>
            {a.product && <Link href={at(base, a.product)} className="text-sm text-[#1565c0] hover:underline">See the product</Link>}
            <Link href={at(base, "/resources")} className="text-sm text-slate-500 hover:underline">All resources</Link>
          </div>
        </article>
      </Section>
    </>
  );
}
