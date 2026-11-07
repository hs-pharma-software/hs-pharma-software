import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { PageIntro, Section } from "@/components/site/chrome";
import { LegalDraftNote } from "@/components/site/legal";

export const metadata: Metadata = withSeoMeta("/terms", { title: "Terms", alternates: { canonical: "/terms" } });

const ITEMS: [string, React.ReactNode][] = [
  ["The service", <>Access to the MAVIN.pk product for the business&apos;s sector, on the plan the business chose.</>],
  ["Subscription term and renewal", <>Each plan runs for its term and renews when paid. After the term ends, the business keeps access for the plan&apos;s grace period; after that, access may pause until renewal. The business&apos;s records are kept.</>],
  ["Fees", <>As shown on the pricing page or quoted in writing, in Pakistani rupees, paid in advance for each term. Applicable taxes are added. Refunds are as agreed in writing.</>],
  ["Your data", <>The business owns the records it enters. It can ask for an export of them at any time, and for 90 days after its subscription ends. After that, its records are deleted.</>],
  ["Tax submissions", <>The business is responsible for its tax registration, rates and the content of invoices it submits to FBR or a provincial authority.</>],
  ["Acceptable use", <>No unlawful use; no attempt to access another business&apos;s data, to break the service&apos;s security or to disrupt it; no reselling or sharing logins outside the business.</>],
  ["Governing law", <>These terms are governed by the laws of Pakistan.</>],
];

export default function TermsPage() {
  return (
    <>
      <PageIntro eyebrow="Legal" title="Terms of service" />
      <Section>
        <LegalDraftNote />
        <dl className="max-w-3xl space-y-5 text-sm leading-relaxed text-slate-700">
          {ITEMS.map(([t, d]) => (
            <div key={t}>
              <dt className="text-base font-semibold text-[#0b2a6b]">{t}</dt>
              <dd className="mt-1">{d}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
