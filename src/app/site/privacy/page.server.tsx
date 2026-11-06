import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { PageIntro, ReviewMark, Section } from "@/components/site/chrome";
import { LegalDraftNote } from "@/components/site/legal";

export const metadata: Metadata = withSeoMeta("/privacy", { title: "Privacy", alternates: { canonical: "/privacy" } });

export default function PrivacyPage() {
  return (
    <>
      <PageIntro eyebrow="Legal" title="Privacy notice" />
      <Section>
        <LegalDraftNote />
        <div className="max-w-3xl space-y-6 text-sm leading-relaxed text-slate-700">
          <div>
            <h2 className="text-base font-semibold text-[#0b2a6b]">Who we are</h2>
            <p className="mt-2">MAVIN.pk <ReviewMark>legal entity name and address</ReviewMark> provides business software to businesses. Each business that uses MAVIN.pk decides what records it keeps about its own customers, patients and staff; for those records we act on the business&apos;s instructions.</p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#0b2a6b]">What this website collects</h2>
            <p className="mt-2">When you request a demo or contact us, we receive the name, business name, business type, number of branches, phone, email and message you enter. We use them only to reply and to arrange a demo. <ReviewMark>retention period for enquiries</ReviewMark></p>
            {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ? (
              <p className="mt-2">This website uses Google Analytics to count visits and see which pages people find through search. It sets cookies in your browser and sends page addresses and device information to Google; it is not used inside the MAVIN.pk application. <ReviewMark>consent and cookie wording</ReviewMark></p>
            ) : null}
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#0b2a6b]">Where business data is kept</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>In a cloud database operated by Turso, in the AWS Asia Pacific (Tokyo) region. <ReviewMark>confirm region and disclosure wording</ReviewMark></li>
              <li>The web application is hosted by Vercel.</li>
              <li>The Windows desktop app keeps a copy of the business&apos;s own data on that computer so it can work offline.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#0b2a6b]">Optional services that send data to third parties</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>FBR Digital Invoicing and provincial tax reporting: when a business switches them on, invoice details are sent to the tax authority.</li>
              <li>The in-app assistant: when switched on, the question and the data needed to answer it are sent to the AI provider the business uses (OpenAI or Google). <ReviewMark>consent and opt-in wording</ReviewMark></li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#0b2a6b]">Your choices</h2>
            <p className="mt-2">To ask about, correct or delete enquiry details you sent us, contact us. Requests about records a business keeps about you go to that business. <ReviewMark>contact channel and response time</ReviewMark></p>
          </div>
        </div>
      </Section>
    </>
  );
}
