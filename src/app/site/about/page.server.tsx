import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { PRODUCT_GROUPS } from "@/config/siteProducts";
import { CtaLink, PageIntro, ReviewMark, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = withSeoMeta("/about", {
  title: "About",
  description: "About MAVIN.pk: the sectors we serve and how we onboard a business.",
  alternates: { canonical: "/about" },
});

export default async function AboutPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="About" title="Software built around how Pakistani businesses bill.">
        MAVIN.pk makes billing, stock and operations software with a version for each sector.
      </PageIntro>
      <Section title="Company">
        <dl className="grid max-w-2xl gap-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-slate-700">Registered name</dt><dd><ReviewMark>legal name</ReviewMark></dd>
          <dt className="font-medium text-slate-700">Address</dt><dd><ReviewMark>office address</ReviewMark></dd>
          <dt className="font-medium text-slate-700">Registration</dt><dd><ReviewMark>NTN / company registration</ReviewMark></dd>
        </dl>
      </Section>
      <Section title="Sectors we serve">
        <ul className="flex flex-wrap gap-2">
          {PRODUCT_GROUPS.map((g) => <li key={g} className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200">{g}</li>)}
        </ul>
      </Section>
      <Section title="How onboarding works">
        <ol className="grid gap-4 md:grid-cols-4">
          {[
            ["Demo", "We show the product for your sector using example data."],
            ["Setup", "Business profile, products (CSV import), opening stock and print layout."],
            ["Training", "Owner and staff, with a role for each login."],
            ["Go live", "First days of billing with support; integrations switched on when ready."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold text-[#1565c0]">{i + 1}</p>
              <p className="mt-1 font-semibold text-[#0b2a6b]">{t}</p>
              <p className="mt-2 text-sm text-slate-600">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6"><CtaLink href={at(base, "/demo")}>Book a Demo</CtaLink></div>
      </Section>
    </>
  );
}
