import type { Metadata } from "next";
import { CtaLink, PageIntro, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = {
  title: "FBR Digital Invoicing",
  description: "How FBR Digital Invoicing works in MAVIN.pk: who it is for, what you need and how onboarding works.",
  alternates: { canonical: "/integrations/fbr-digital-invoicing" },
};

const STEPS = [
  ["Check eligibility", "Tell us your sector, registration and how you invoice. We confirm whether FBR Digital Invoicing applies or a provincial authority does."],
  ["Prepare your details", "Your NTN or STRN and the integration token you obtain from FBR / PRAL. Products need HS codes, sale type and unit of measure."],
  ["Test", "Invoices are first sent to the FBR sandbox to check your product and buyer details."],
  ["Go live", "FBR submission is switched on for your business. Staff can submit only when the owner allows it."],
];

export default async function FbrPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="Integrations" title="FBR Digital Invoicing">
        Send sale invoices to FBR&apos;s Digital Invoicing system from the invoice screen. Available to FBR-registered businesses and switched on per business
        during onboarding.
        <div className="mt-6"><CtaLink href={at(base, "/contact?topic=fbr")}>Check Setup Eligibility</CtaLink></div>
      </PageIntro>
      <Section title="What you need">
        <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {["An active FBR registration (NTN / STRN)", "Your FBR / PRAL integration token", "HS code, sale type and unit for each product you invoice", "Buyer details where FBR requires them (for example registered buyers)"].map((s) => (
            <li key={s} className="rounded-lg border border-slate-200 bg-white px-4 py-3">{s}</li>
          ))}
        </ul>
      </Section>
      <Section title="Onboarding">
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold text-[#1565c0]">Step {i + 1}</p>
              <p className="mt-1 font-semibold text-[#0b2a6b]">{t}</p>
              <p className="mt-2 text-sm text-slate-600">{d}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Invoice status">
        <p className="max-w-2xl text-sm text-slate-600">
          Each invoice shows whether it has been sent to FBR. When FBR accepts it, the FBR invoice number is kept with the invoice and printed on it.
          If FBR returns an error, the message is shown so the invoice can be corrected.
        </p>
      </Section>
      <Section title="Support">
        <p className="max-w-2xl text-sm text-slate-600">
          We help with the setup and with rejected invoices. Questions about your tax registration, rates or which authority applies belong with your tax
          adviser.
        </p>
      </Section>
    </>
  );
}
