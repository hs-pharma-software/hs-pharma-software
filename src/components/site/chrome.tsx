/** Header, footer and building blocks of the public site (server components). */
import Link from "next/link";
import { headers } from "next/headers";
import { SITE_BASE_HEADER, SITE_NAV, SITE_PUBLISHED, appLoginUrl } from "@/config/site";

/** "" on the corporate domain (clean paths), "/site" on the app's domain. */
export async function siteBase(): Promise<string> {
  return (await headers()).get(SITE_BASE_HEADER) ?? "/site";
}

/** A site path under the current base. */
export const at = (base: string, path: string) => (path === "/" ? base || "/" : `${base}${path}`);

const container = "mx-auto w-full max-w-6xl px-4 sm:px-6";

export function SiteHeader({ base }: { base: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className={`${container} flex h-16 items-center justify-between gap-4`}>
        <Link href={at(base, "/")} className="shrink-0" aria-label="MAVIN.pk home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mavin-header.png" alt="MAVIN.pk" className="h-9 w-auto" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm font-medium text-slate-700 lg:flex">
          {SITE_NAV.map((n) => (
            <Link key={n.href} href={at(base, n.href)} className="hover:text-[#1565c0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1565c0]">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <a href={appLoginUrl(base)} className="text-sm font-medium text-slate-700 hover:text-[#1565c0]">Client Login</a>
          <CtaLink href={at(base, "/demo")}>Book a Demo</CtaLink>
        </div>
        {/* Phone and tablet: a disclosure menu that works without JavaScript. */}
        <details className="group relative lg:hidden">
          <summary className="flex cursor-pointer list-none items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <nav aria-label="Main" className="absolute right-0 mt-2 flex w-60 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 text-sm shadow-lg">
            {SITE_NAV.map((n) => (
              <Link key={n.href} href={at(base, n.href)} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-50">{n.label}</Link>
            ))}
            <a href={appLoginUrl(base)} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-50">Client Login</a>
            <Link href={at(base, "/demo")} className="rounded-lg bg-[#0b2a6b] px-3 py-2 text-center font-semibold text-white">Book a Demo</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

export function SiteFooter({ base }: { base: string }) {
  const cols: { title: string; links: [string, string][] }[] = [
    { title: "Products", links: [["All products", "/products"], ["Platform", "/platform"], ["Integrations", "/integrations"], ["Pricing", "/pricing"]] },
    { title: "Support", links: [["Help", "/help"], ["Resources", "/resources"], ["Contact", "/contact"], ["Book a Demo", "/demo"]] },
    { title: "Company", links: [["About", "/about"], ["Privacy", "/privacy"], ["Terms", "/terms"], ["Security", "/security"]] },
  ];
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className={`${container} grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mavin-header.png" alt="MAVIN.pk" className="h-8 w-auto" />
          <p className="mt-3 max-w-xs text-sm text-slate-500">Billing, stock and daily operations software for businesses in Pakistan.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{c.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {c.links.map(([label, href]) => (
                <li key={href}><Link href={at(base, href)} className="text-slate-600 hover:text-[#1565c0]">{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className={`${container} border-t border-slate-100 py-5 text-xs text-slate-400`}>© {new Date().getFullYear()} MAVIN.pk</div>
    </footer>
  );
}

/** Shown on every page until the content is approved (config/site.ts). */
export function DraftNotice() {
  if (SITE_PUBLISHED) return null;
  return (
    <div role="note" className="bg-amber-50 text-center text-xs text-amber-900">
      <p className="mx-auto max-w-6xl px-4 py-2">Draft for review. Product claims, prices and legal text are not yet approved; this site is hidden from search engines.</p>
    </div>
  );
}

export function CtaLink({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const cls = variant === "primary"
    ? "bg-[#0b2a6b] text-white hover:bg-[#0d3a8f]"
    : "border border-slate-300 bg-white text-slate-800 hover:border-[#1565c0] hover:text-[#1565c0]";
  return (
    <Link href={href} className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0] ${cls}`}>
      {children}
    </Link>
  );
}

export function PageIntro({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <section className="border-b border-slate-200 bg-gradient-to-b from-[#eef4fc] to-white">
      <div className={`${container} py-12 sm:py-16`}>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-[#1565c0]">{eyebrow}</p>}
        <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight text-[#0b2a6b] [text-wrap:balance] sm:text-4xl">{title}</h1>
        {children && <div className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">{children}</div>}
      </div>
    </section>
  );
}

export function Section({ title, children, id }: { title?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={`${container} py-10`}>
      {title && <h2 className="text-xl font-semibold tracking-tight text-[#0b2a6b]">{title}</h2>}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/** Text that must be checked by the business before publishing. */
export function ReviewMark({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-amber-100 px-1 text-amber-900">[Review: {children}]</span>;
}

export const siteContainer = container;
