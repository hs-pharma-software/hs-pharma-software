import type { Metadata } from "next";
import { PageIntro, ReviewMark, Section } from "@/components/site/chrome";
import { LegalDraftNote } from "@/components/site/legal";

export const metadata: Metadata = { title: "Terms", alternates: { canonical: "/terms" } };

const ITEMS: [string, React.ReactNode][] = [
  ["The service", <>Access to the MAVIN.pk product for the business&apos;s sector, on the plan agreed in writing. <ReviewMark>agreement reference</ReviewMark></>],
  ["Subscription term and renewal", <>Each plan runs for the term stated in the quote and renews when paid. <ReviewMark>renewal, grace period and what happens to access after expiry</ReviewMark></>],
  ["Fees", <>As quoted in writing, in the currency stated on the quote. <ReviewMark>payment terms, taxes, refunds</ReviewMark></>],
  ["Your data", <>The business owns the records it enters. <ReviewMark>export on request and after termination; deletion timeline</ReviewMark></>],
  ["Tax submissions", <>The business is responsible for its tax registration, rates and the content of invoices it submits to FBR or a provincial authority.</>],
  ["Acceptable use", <>No attempt to access another business&apos;s data or to disrupt the service. <ReviewMark>full list</ReviewMark></>],
  ["Liability", <ReviewMark key="l">limitation of liability (lawyer to draft)</ReviewMark>],
  ["Governing law", <ReviewMark key="g">jurisdiction</ReviewMark>],
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
