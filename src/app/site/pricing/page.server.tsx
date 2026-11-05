import type { Metadata } from "next";
import { CtaLink, PageIntro, ReviewMark, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Starter, Professional and Enterprise plans for MAVIN.pk.",
  alternates: { canonical: "/pricing" },
};

/** Commercial terms are not approved: no prices, limits are marked for review. */
const PLANS = [
  { name: "Starter", for: "A single location getting started with billing and stock.", points: ["One business location", "Core billing, stock, purchasing and reports", "Sector product of your choice"], limits: "staff logins and branches" },
  { name: "Professional", for: "Businesses with staff and broader sector modules.", points: ["Staff logins with roles and permissions", "More sector modules", "FBR Digital Invoicing setup (where eligible)"], limits: "staff logins, branches and modules" },
  { name: "Enterprise", for: "Multi-site or complex rollouts, quoted per project.", points: ["Several branches or departments", "Rollout plan and pilot", "Hospital and multi-department setups"], limits: "scope, support and onboarding" },
];

export default async function PricingPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Plans for one shop up to a multi-site rollout.">
        Ask for a quote for your sector and size. We confirm the price, currency, billing period and renewal terms in writing before you sign up.
      </PageIntro>
      <Section>
        <ul className="grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <li key={p.name} className="flex flex-col rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-[#0b2a6b]">{p.name}</h2>
              <p className="mt-1 text-sm text-slate-600">{p.for}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">{p.points.map((x) => <li key={x}>• {x}</li>)}</ul>
              <p className="mt-4 text-xs text-slate-500">Limits: <ReviewMark>{p.limits} to be approved</ReviewMark></p>
              <div className="mt-5"><CtaLink href={at(base, `/contact?topic=pricing&plan=${p.name}`)}>Request Pricing</CtaLink></div>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Every plan">
        <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Onboarding: product setup, CSV import and staff training <ReviewMark>scope</ReviewMark></li>
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Support by phone and WhatsApp <ReviewMark>hours and channels</ReviewMark></li>
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Renewal at the end of each term <ReviewMark>reminders and grace period</ReviewMark></li>
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Optional add-ons: extra staff logins, FBR setup, data migration <ReviewMark>add-on list</ReviewMark></li>
        </ul>
      </Section>
    </>
  );
}
