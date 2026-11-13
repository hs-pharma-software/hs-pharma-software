import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import Link from "next/link";
import { PRODUCT_GROUPS, SITE_PRODUCTS } from "@/config/siteProducts";
import { CtaLink, Section, at, siteBase, siteContainer } from "@/components/site/chrome";
import { WINDOWS_RELEASE, windowsSizeLabel } from "@/config/windowsRelease";

export const metadata: Metadata = withSeoMeta("/", {
  title: { absolute: "MAVIN.pk — Business software for billing, stock and daily operations" },
  alternates: { canonical: "/" },
});

const PLATFORM = [
  { title: "Billing", text: "Invoices, returns, part payments and printing on thermal, A5 or A4 paper." },
  { title: "Stock", text: "Purchases, stock levels and, where the sector needs it, batches, expiry, serials or IMEIs." },
  { title: "Reports", text: "Sales, purchases, stock and customer and supplier balances." },
  { title: "Users and permissions", text: "Staff logins with roles; refunds, exports and other sensitive actions stay off until the owner allows them." },
  { title: "Works offline", text: "The Windows desktop app keeps billing without internet and syncs when the connection returns." },
  { title: "FBR Digital Invoicing", text: "Built-in submission for FBR-registered businesses, switched on per business during onboarding." },
];

export default async function SiteHome() {
  const base = await siteBase();
  return (
    <>
      <section className="border-b border-slate-200 bg-gradient-to-b from-[#eef4fc] to-white">
        <div className={`${siteContainer} grid gap-8 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center`}>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-[#0b2a6b] [text-wrap:balance] sm:text-5xl">
              Business software for billing, stock and daily operations.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              One platform with a version for each sector: pharmacies, retail and distribution, healthcare, food and events, and contractor billing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <CtaLink href={at(base, "/demo")}>Book a Demo</CtaLink>
              <CtaLink href={at(base, "/products")} variant="secondary">See the products</CtaLink>
              <a
                href={WINDOWS_RELEASE.url}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#0b2a6b] bg-white px-4 py-2.5 text-sm font-semibold text-[#0b2a6b] transition hover:bg-[#eef4fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current"><path d="M0 2.2 6.5 1.3v6.2H0zm7.3-1L16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.8zm7.3 0H16V16l-8.7-1.2z" /></svg>
                Download for Windows
              </a>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Windows app {WINDOWS_RELEASE.versionName}, {windowsSizeLabel()}: billing keeps working without internet.{" "}
              <Link href={at(base, "/download#windows")} className="text-[#1565c0] hover:underline">Install help</Link>
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-3" aria-label="Product families">
            {PRODUCT_GROUPS.map((g) => (
              <li key={g} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-semibold text-[#0b2a6b]">{g}</p>
                <p className="mt-1 text-xs text-slate-500">{SITE_PRODUCTS.filter((p) => p.group === g).length} product{SITE_PRODUCTS.filter((p) => p.group === g).length === 1 ? "" : "s"}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Section title="Product families">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PRODUCT_GROUPS.map((g) => (
            <div key={g}>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">{g}</h3>
              <ul className="mt-2 space-y-1.5">
                {SITE_PRODUCTS.filter((p) => p.group === g).map((p) => (
                  <li key={p.slug}>
                    <Link href={at(base, `/products/${p.slug}`)} className="text-[15px] font-medium text-[#0b2a6b] hover:text-[#1565c0] hover:underline">{p.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="What every product includes">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM.map((f) => (
            <li key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="font-semibold text-[#0b2a6b]">{f.title}</p>
              <p className="mt-1.5 text-sm text-slate-600">{f.text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm"><Link href={at(base, "/platform")} className="font-medium text-[#1565c0] hover:underline">How the platform works</Link></p>
      </Section>

      <Section>
        <div className="flex flex-col items-start gap-4 rounded-2xl bg-[#0b2a6b] p-8 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xl font-semibold">See it with your own workflow.</p>
            <p className="mt-1 text-sm text-blue-100">Tell us your sector and how you bill today; we show the matching product.</p>
          </div>
          <Link href={at(base, "/demo")} className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#0b2a6b] hover:bg-blue-50">Book a Demo</Link>
        </div>
      </Section>
    </>
  );
}
