import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { SITE_PRODUCTS } from "@/config/siteProducts";
import { CtaLink, PageIntro, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = withSeoMeta("/platform", {
  title: "Platform",
  description: "Billing, inventory, purchasing, reports, users and permissions, on Windows and the web.",
  alternates: { canonical: "/platform" },
});

const AREAS = [
  { title: "Billing", points: ["Sale and return invoices, quotations and draft (memorized) invoices", "Part payments and customer balances", "Thermal (80 mm), A5 and A4 print layouts"] },
  { title: "Inventory", points: ["Stock by product and, where the sector needs it, by batch and expiry, serial number or IMEI", "Pack and loose-unit selling", "Low-stock and expiry lists"] },
  { title: "Purchasing", points: ["Purchases and purchase returns", "Supplier balances and payments", "Opening stock and CSV product import"] },
  { title: "Reports", points: ["Sales and profit", "Stock and expiry", "Customer and supplier ledgers"] },
  { title: "Users and permissions", points: ["Owner and staff logins", "Role starting points: Cashier, Storekeeper, Accountant, Manager", "Refunds, exports, backups, FBR submission and financial closing are off for staff until the owner allows them"] },
];

const PLATFORMS: [string, string, string][] = [
  ["Windows desktop app", "Available", "Keeps a local copy: billing continues offline and changes sync when the connection returns. Needs internet for the first sign-in on each computer."],
  ["Web browser", "Available", "Works in a current browser with an internet connection. No offline mode."],
  ["Android app", "Not available yet", "Field and phone use is through the web browser for now."],
];

export default async function PlatformPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="Platform" title="One platform under every product.">
        Each sector product adds its own workflow on top of the same billing, stock, purchasing, reporting and permissions core.
      </PageIntro>
      <Section title="What the core covers">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {AREAS.map((a) => (
            <div key={a.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-[#0b2a6b]">{a.title}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-600">{a.points.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Where it runs">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr><th className="px-4 py-3">Platform</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PLATFORMS.map(([name, status, details]) => (
                <tr key={name}><td className="px-4 py-3 font-medium text-slate-800">{name}</td><td className="px-4 py-3 text-slate-600">{status}</td><td className="px-4 py-3 text-slate-600">{details}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          All {SITE_PRODUCTS.length} products run on the Windows desktop app and in the browser. A few online-only features, such as some hospital and
          laboratory functions, need the web connection; we confirm these for your sector during the demo.
        </p>
      </Section>
      <Section>
        <CtaLink href={at(base, "/demo")}>Book a Demo</CtaLink>
      </Section>
    </>
  );
}
