import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import Link from "next/link";
import { PageIntro, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = withSeoMeta("/integrations", {
  title: "Integrations",
  description: "FBR Digital Invoicing and Punjab Revenue Authority (PRA) integration.",
  alternates: { canonical: "/integrations" },
});

const ITEMS: { name: string; who: string; status: string; href?: string; text: string; logo: { src: string; alt: string; width: number; height: number } }[] = [
  {
    name: "FBR Digital Invoicing", who: "FBR-registered businesses, all sectors", status: "Built in; switched on per business at onboarding", href: "/integrations/fbr-digital-invoicing",
    text: "Sends sale invoices to FBR's Digital Invoicing system from the invoice screen.",
    logo: { src: "/fbr-digital-invoicing.png", alt: "FBR Digital Invoicing System logo", width: 112, height: 112 },
  },
  {
    name: "Punjab Revenue Authority (PRA)", who: "Restaurants and service businesses registered with PRA in Punjab", status: "Built in; availability confirmed at onboarding",
    text: "Reports restaurant bills and service invoices to the Punjab Revenue Authority from MAVIN.pk.",
    logo: { src: "/pra-logo.jpg", alt: "Punjab Revenue Authority logo", width: 228, height: 96 },
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
        <ul className="grid gap-5 md:grid-cols-2">
          {ITEMS.map((i) => (
            <li key={i.name} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex h-40 items-center justify-center border-b border-slate-100 bg-white px-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.logo.src} alt={i.logo.alt} width={i.logo.width} height={i.logo.height} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h2 className="text-lg font-semibold text-[#0b2a6b]">{i.name}</h2>
                <p className="mt-1 text-xs text-slate-500">For: {i.who}</p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{i.text}</p>
                <p className="mt-3 text-xs font-medium text-slate-700">Availability: {i.status}</p>
                {i.href && <Link href={at(base, i.href)} className="mt-4 text-sm font-medium text-[#1565c0] hover:underline">Setup and requirements</Link>}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-slate-500">
          The FBR and PRA names and logos belong to those authorities. They are shown to identify the systems MAVIN.pk connects to.
        </p>
      </Section>
    </>
  );
}
