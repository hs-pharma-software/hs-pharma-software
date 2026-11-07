import type { Metadata } from "next";
import Link from "next/link";
import { withSeoMeta } from "@/config/seoMeta";
import { BUSINESS_TYPES, businessType } from "@/config/businessTypes";
import { CtaLink, PageIntro, Section, at, siteBase } from "@/components/site/chrome";
import { sqlForServer } from "@/server/subSupersApi";

export const metadata: Metadata = withSeoMeta("/pricing", {
  title: "Pricing",
  description: "MAVIN.pk plans for pharmacies, shops, clinics, labs and more, with add-ons such as a business website, online store and your own domain.",
  alternates: { canonical: "/pricing" },
});
export const dynamic = "force-dynamic";

/** Plans and add-ons the Super Admin marked "Show on the website's pricing page". */
interface Plan { id: string; name: string; tagline: string | null; price: number; days: number; staff: number; grace: number; features: string[]; types: string[] }
interface Addon { id: string; name: string; description: string | null; price: number; billing: string; types: string[] }

const list = (raw: unknown): string[] => { try { const v = raw ? JSON.parse(String(raw)) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
const term = (days: number) => (days === 30 || days === 31 ? "per month" : days === 365 || days === 366 ? "per year" : days === 90 ? "per 3 months" : days === 180 ? "per 6 months" : `per ${days} days`);
const BILLING: Record<string, string> = { one_time: "one time", monthly: "per month", yearly: "per year", per_term: "per plan term" };

async function load(): Promise<{ plans: Plan[]; addons: Addon[] }> {
  try {
    const sql = sqlForServer();
    const plans = (await sql.execute(
      `SELECT id, name, tagline, price, duration_days, max_staff_logins, grace_days, features, business_types FROM subscription_plans
       WHERE deleted_at IS NULL AND is_public = 1 ORDER BY sort_order, price`,
    )).rows.map((r) => ({
      id: String(r.id), name: String(r.name), tagline: (r.tagline as string | null) ?? null, price: Number(r.price) || 0, days: Number(r.duration_days) || 30,
      staff: Number(r.max_staff_logins) || 0, grace: Number(r.grace_days) || 0, features: list(r.features), types: list(r.business_types),
    }));
    const addons = (await sql.execute(`SELECT id, name, description, price, billing, business_types FROM plan_addons WHERE deleted_at IS NULL AND is_public = 1 ORDER BY sort_order, name`)).rows
      .map((r) => ({ id: String(r.id), name: String(r.name), description: (r.description as string | null) ?? null, price: Number(r.price) || 0, billing: String(r.billing), types: list(r.business_types) }));
    return { plans, addons };
  } catch {
    return { plans: [], addons: [] }; // before migration v77: the page still works, without prices
  }
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const base = await siteBase();
  const sp = await searchParams;
  const want = typeof sp.type === "string" && BUSINESS_TYPES.some((t) => t.id === sp.type) ? sp.type : "";
  const { plans, addons } = await load();
  const fits = (types: string[]) => !want || !types.length || types.includes(want);
  const shownPlans = plans.filter((p) => fits(p.types));
  const shownAddons = addons.filter((a) => fits(a.types));
  const usedTypes = new Set(plans.flatMap((p) => p.types));
  const typeChips = BUSINESS_TYPES.filter((t) => usedTypes.has(t.id) || !usedTypes.size);
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Plans for one shop up to a multi-site rollout.">
        Prices are in Pakistani rupees. Choose your business type to see the plans for it, or contact us for a quote.
      </PageIntro>
      {plans.length > 0 && (
        <Section>
          <nav aria-label="Business type" className="flex flex-wrap gap-2">
            <Link href={at(base, "/pricing")} className={`rounded-full border px-3 py-1.5 text-sm ${!want ? "border-[#0b2a6b] bg-[#0b2a6b] text-white" : "border-slate-300 text-slate-700 hover:border-[#1565c0]"}`}>All</Link>
            {typeChips.map((t) => (
              <Link key={t.id} href={at(base, `/pricing?type=${t.id}`)} className={`rounded-full border px-3 py-1.5 text-sm ${want === t.id ? "border-[#0b2a6b] bg-[#0b2a6b] text-white" : "border-slate-300 text-slate-700 hover:border-[#1565c0]"}`}>{t.label}</Link>
            ))}
          </nav>
        </Section>
      )}
      <Section>
        {shownPlans.length ? (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {shownPlans.map((p) => (
              <li key={p.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-[#0b2a6b]">{p.name}</h2>
                {p.tagline && <p className="mt-1 text-sm text-slate-600">{p.tagline}</p>}
                <p className="mt-4"><span className="text-3xl font-bold text-slate-900">{p.price ? rs(p.price) : "On quote"}</span>{p.price ? <span className="ml-1 text-sm text-slate-500">{term(p.days)}</span> : null}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
                  {p.features.map((x) => <li key={x}>• {x}</li>)}
                  {p.staff > 0 && <li>• {p.staff} staff login{p.staff === 1 ? "" : "s"}</li>}
                  {p.grace > 0 && <li>• {p.grace}-day grace period after the renewal date</li>}
                </ul>
                <p className="mt-4 text-xs text-slate-500">{p.types.length ? `For: ${p.types.map((t) => businessType(t).label).join(", ")}` : "For every business type"}</p>
                <div className="mt-5"><CtaLink href={at(base, `/contact?topic=pricing&plan=${encodeURIComponent(p.name)}`)}>Get Started</CtaLink></div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-700">
            <p>{plans.length ? "No plans listed for this business type yet." : "Plans and prices are confirmed for your sector and size."} Contact us for a quote.</p>
            <div className="mt-4"><CtaLink href={at(base, "/contact?topic=pricing")}>Request Pricing</CtaLink></div>
          </div>
        )}
      </Section>
      {shownAddons.length > 0 && (
        <Section title="Add-ons">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shownAddons.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="font-medium text-slate-900">{a.name}</p>
                {a.description && <p className="mt-1 text-sm text-slate-600">{a.description}</p>}
                <p className="mt-2 text-sm font-semibold text-[#0b2a6b]">{a.price ? `${rs(a.price)} ${BILLING[a.billing] ?? ""}` : "On quote"}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Every plan">
        <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Onboarding: product setup, CSV import and staff training</li>
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Support by phone and email, Monday to Saturday, 9am to 6pm</li>
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Renewal at the end of each term, with a reminder and the plan&apos;s grace period</li>
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">Your records stay yours: export them on request at any time</li>
        </ul>
      </Section>
    </>
  );
}
