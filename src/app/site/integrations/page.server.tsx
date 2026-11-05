import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = {
  title: "Integrations",
  description: "FBR Digital Invoicing, provincial restaurant tax and DRAP product data.",
  alternates: { canonical: "/integrations" },
};

const ITEMS: { name: string; who: string; status: string; href?: string; text: string }[] = [
  {
    name: "FBR Digital Invoicing", who: "FBR-registered businesses, all sectors", status: "Built in; switched on per business at onboarding", href: "/integrations/fbr-digital-invoicing",
    text: "Sends sale invoices to FBR's Digital Invoicing system from the invoice screen.",
  },
  {
    name: "Provincial restaurant tax (Punjab)", who: "Restaurants", status: "Built in for restaurants; availability confirmed at onboarding",
    text: "Restaurant invoices can be reported to the provincial authority where the restaurant is registered.",
  },
  {
    name: "DRAP product data", who: "Pharmacies and medical stores", status: "Available",
    text: "Product details can be brought in from DRAP registration data when setting up the medicine list.",
  },
];

export default async function IntegrationsPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="Integrations" title="Connections to tax and regulatory systems.">
        Each integration lists who it is for and its availability. We confirm the details for your business before go-live.
      </PageIntro>
      <Section>
        <ul className="grid gap-4 md:grid-cols-2">
          {ITEMS.map((i) => (
            <li key={i.name} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-[#0b2a6b]">{i.name}</h2>
              <p className="mt-1 text-xs text-slate-500">For: {i.who}</p>
              <p className="mt-3 text-sm text-slate-600">{i.text}</p>
              <p className="mt-3 text-xs font-medium text-slate-700">Availability: {i.status}</p>
              {i.href && <Link href={at(base, i.href)} className="mt-4 text-sm font-medium text-[#1565c0] hover:underline">Setup and requirements</Link>}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
