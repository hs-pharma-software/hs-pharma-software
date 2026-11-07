import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { SITE_PRODUCTS } from "@/config/siteProducts";
import { PageIntro, Section } from "@/components/site/chrome";
import { LeadForm } from "@/components/site/LeadForm";

export const metadata: Metadata = withSeoMeta("/contact", {
  title: "Contact",
  description: "Contact MAVIN.pk about products, pricing, FBR setup or support.",
  alternates: { canonical: "/contact" },
});

const TOPICS: Record<string, string> = {
  fbr: "Checking FBR Digital Invoicing eligibility",
  pricing: "Requesting pricing",
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string; plan?: string }> }) {
  const { topic, plan } = await searchParams;
  const about = topic && TOPICS[topic] ? `${TOPICS[topic]}${plan ? ` (${plan.slice(0, 20)})` : ""}` : null;
  return (
    <>
      <PageIntro eyebrow="Contact" title="Contact MAVIN.pk">
        Questions about a product, pricing, FBR setup or an existing account.
      </PageIntro>
      <Section>
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div>
            {about && <p className="mb-3 text-sm text-slate-600">About: <b>{about}</b>. Add the details in your message.</p>}
            <LeadForm kind="contact" businessTypes={SITE_PRODUCTS.map((p) => p.name)} topic={about ?? ""} />
          </div>
          <aside className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <h2 className="font-semibold text-[#0b2a6b]">Other ways to reach us</h2>
            <p className="mt-2">Phone: <a href="tel:+923160585858" className="font-medium hover:underline">0316-0585858</a></p>
            <p className="mt-1">WhatsApp: <a href="https://wa.me/923160585858" target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 hover:underline">+92 316 0585858</a></p>
            <p className="mt-1">Email: <a href="mailto:info@mavin.pk" className="font-medium hover:underline">info@mavin.pk</a></p>
            <p className="mt-1">Hours: Monday to Saturday, 9am to 6pm</p>
          </aside>
        </div>
      </Section>
    </>
  );
}
