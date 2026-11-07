import type { Metadata } from "next";
import Link from "next/link";
import { withSeoMeta } from "@/config/seoMeta";
import { BUSINESS_TYPES, businessType } from "@/config/businessTypes";
import { CtaLink, PageIntro, Section, at, siteBase } from "@/components/site/chrome";
import { sqlForServer } from "@/server/subSupersApi";
import { ReadMore } from "@/components/site/ReadMore";
import { annualPrice, descriptionClasses, offersAnnual, parseDescriptionStyle, termLabel } from "@/lib/planPricing";

export const metadata: Metadata = withSeoMeta("/pricing", {
  title: "Pricing",
  description: "MAVIN.pk plans for pharmacies, shops, clinics, labs and more, with add-ons such as a business website, online store and your own domain.",
  alternates: { canonical: "/pricing" },
});
export const dynamic = "force-dynamic";

/** Plans and add-ons the Super Admin marked "Show on the website's pricing page". */
interface Plan { id: string; name: string; tagline: string | null; description: string | null; descStyle: string | null; price: number; days: number; staff: number; grace: number; features: string[]; types: string[]; annual: boolean; annualPct: number }
interface Addon { id: string; name: string; description: string | null; price: number; billing: string; types: string[] }

const list = (raw: unknown): string[] => { try { const v = raw ? JSON.parse(String(raw)) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
const BILLING: Record<string, string> = { one_time: "one time", monthly: "per month", yearly: "per year", per_term: "per plan term" };

async function load(): Promise<{ plans: Plan[]; addons: Addon[] }> {
  try {
    const sql = sqlForServer();
    const plans = (await sql.execute(
      `SELECT * FROM subscription_plans
       WHERE deleted_at IS NULL AND is_public = 1 ORDER BY sort_order, price`,
    )).rows.map((r) => ({
      id: String(r.id), name: String(r.name), tagline: (r.tagline as string | null) ?? null, description: (r.description as string | null) ?? null, descStyle: (r.description_style as string | null) ?? null,
      price: Number(r.price) || 0, days: Number(r.duration_days) || 30,
      staff: Number(r.max_staff_logins) || 0, grace: Number(r.grace_days) || 0, features: list(r.features), types: list(r.business_types),
      annual: offersAnnual({ price: Number(r.price) || 0, duration_days: Number(r.duration_days) || 30, annual_enabled: r.annual_enabled === undefined ? 1 : Number(r.annual_enabled) }),
      annualPct: r.annual_discount_pct == null ? 20 : Number(r.annual_discount_pct),
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
  const yearly = sp.billing === "yearly";
  const qs = (o: { type?: string; billing?: string }) => { const q = new URLSearchParams(); const t = o.type ?? want; const b = o.billing ?? (yearly ? "yearly" : ""); if (t) q.set("type", t); if (b) q.set("billing", b); const x = q.toString(); return x ? `?${x}` : ""; };
  const { plans, addons } = await load();
  const maxPct = Math.max(0, ...plans.filter((p) => p.annual).map((p) => p.annualPct));
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
            <Link href={at(base, `/pricing${qs({ type: "" })}`)} className={`rounded-full border px-3 py-1.5 text-sm ${!want ? "border-[#0b2a6b] bg-[#0b2a6b] text-white" : "border-slate-300 text-slate-700 hover:border-[#1565c0]"}`}>All</Link>
            {typeChips.map((t) => (
              <Link key={t.id} href={at(base, `/pricing${qs({ type: t.id })}`)} className={`rounded-full border px-3 py-1.5 text-sm ${want === t.id ? "border-[#0b2a6b] bg-[#0b2a6b] text-white" : "border-slate-300 text-slate-700 hover:border-[#1565c0]"}`}>{t.label}</Link>
            ))}
          </nav>
          {plans.some((p) => p.annual) && (
            <div className="mt-4 inline-flex rounded-full border border-slate-300 bg-white p-1 text-sm" role="group" aria-label="Billing period">
              <Link href={at(base, `/pricing${qs({ billing: "" })}`)} aria-current={!yearly ? "page" : undefined} className={`rounded-full px-4 py-1.5 ${!yearly ? "bg-[#0b2a6b] text-white" : "text-slate-700"}`}>Monthly</Link>
              <Link href={at(base, `/pricing${qs({ billing: "yearly" })}`)} aria-current={yearly ? "page" : undefined} className={`rounded-full px-4 py-1.5 ${yearly ? "bg-[#0b2a6b] text-white" : "text-slate-700"}`}>Yearly{maxPct > 0 ? <span className={`ml-1 text-xs font-semibold ${yearly ? "text-[#5ec8ff]" : "text-emerald-700"}`}>save {maxPct}%</span> : null}</Link>
            </div>
          )}
        </Section>
      )}
      <Section>
        {shownPlans.length ? (
          <ul className="grid auto-rows-fr items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
            {shownPlans.map((p) => (
              // Same width and height in each row; price and button at the same place on every card.
              <li key={p.id} className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-[#0b2a6b]">{p.name}</h2>
                <p className="mt-1 min-h-10 text-sm text-slate-600">{p.tagline ?? ""}</p>
                <div className="mt-3 min-h-[4.5rem]">
                  {!p.price ? (
                    <p className="text-2xl font-bold text-slate-900">Price on request</p>
                  ) : yearly && p.annual ? (() => { const y = annualPrice(p.price, p.days, p.annualPct); return (
                    <>
                      <p><span className="text-3xl font-bold text-slate-900">{rs(y.price)}</span><span className="ml-1 text-sm text-slate-500">per year</span></p>
                      <p className="mt-1 text-sm"><span className="text-slate-400 line-through">{rs(y.full)}</span> <span className="font-semibold text-emerald-700">Save {rs(y.saving)} ({y.pct}% off)</span></p>
                    </>
                  ); })() : (
                    <p><span className="text-3xl font-bold text-slate-900">{rs(p.price)}</span><span className="ml-1 text-sm text-slate-500">{termLabel(p.days)}</span>
                      {p.annual && !yearly && <span className="mt-1 block text-xs text-emerald-700">or {rs(annualPrice(p.price, p.days, p.annualPct).price)} per year ({p.annualPct}% off)</span>}</p>
                  )}
                </div>
                <div className="mt-4"><CtaLink href={at(base, `/contact?topic=pricing&plan=${encodeURIComponent(p.name)}${yearly && p.annual ? "&billing=yearly" : ""}`)}>{p.price ? "Get Started" : "Get a Quote"}</CtaLink></div>
                <div className="mt-5 flex-1 border-t border-slate-100 pt-4">
                  {p.description && <ReadMore text={p.description} lines={6} className={`text-slate-600 ${descriptionClasses(parseDescriptionStyle(p.descStyle))}`} />}
                  {p.features.length > 0 && <ul className="mt-3 space-y-2 text-sm text-slate-700">{p.features.map((x) => <li key={x}>• {x}</li>)}</ul>}
                </div>
                <p className="mt-4 text-xs text-slate-500">{p.types.length ? `For: ${p.types.map((t) => businessType(t).label).join(", ")}` : "For every business type"}</p>
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
                {a.price ? <p className="mt-2 text-sm font-semibold text-[#0b2a6b]">{`${rs(a.price)} ${BILLING[a.billing] ?? ""}`}</p>
                  : <Link href={at(base, `/contact?topic=pricing&addon=${encodeURIComponent(a.name)}`)} className="mt-2 inline-block rounded-full bg-[#0b2a6b] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0d3a8f]">Get a Quote</Link>}
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
