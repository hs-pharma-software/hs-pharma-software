/** A business website's look: header, sections and footer from structured
 * data. Plain components (no hooks), so the public pages (server) and the
 * builder's live preview (browser) render exactly the same thing. Every text
 * is rendered as text (escaped by React); there is no HTML input anywhere. */
import type { ReactNode } from "react";
import type { Img, Section, SiteSettings } from "@/lib/web/sections";
import { FONTS } from "@/lib/web/sections";

export interface ProductCardData {
  slug: string; name: string; price: number | null; images: Img[]; orderable: boolean; rxRequired: boolean; stock: { visibility: string; inStock: boolean; qty: number | null };
  /** Base unit name (prices and stock are per base unit) and the pack, if any. */
  unit?: string | null; pack?: { name: string; size: number } | null;
}

/** "Rs 38.85 / Capsule" and "Strip of 10: Rs 388.50". */
export function priceLines(p: ProductCardData): { main: string; pack: string | null } {
  if (p.price === null) return { main: "Ask for price", pack: null };
  return {
    main: `${rs(p.price)}${p.unit ? ` / ${p.unit}` : ""}`,
    pack: p.pack ? `${p.pack.name} of ${p.pack.size}: ${rs(Math.round(p.price * p.pack.size * 100) / 100)}` : null,
  };
}
export const stockText = (p: ProductCardData) => (p.stock.inStock ? (p.stock.qty !== null ? `${p.stock.qty} ${p.unit ?? ""} in stock`.replace("  ", " ") : "In stock") : "Out of stock");
export interface RenderData {
  featured: ProductCardData[];
  categories: string[];
  doctors: { name: string; specialty: string; qualification: string; days: string }[];
  departments: { name: string; type: string }[];
}
export interface Links {
  /** A website path (/about) with the preview kept. */
  page: (path: string) => string;
  /** A store path ("" = store home) with the preview kept. */
  store: (path: string) => string;
}

export const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

/** Cloudinary images in a size that fits (others unchanged). */
export const sized = (url: string, w: number) => url.replace(/(res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?!f_auto)/, `$1f_auto,q_auto,c_limit,w_${w}/`);

function Picture({ img, mobile, w, className, eager }: { img: Img; mobile?: Img | null; w: number; className?: string; eager?: boolean }) {
  return (
    <picture>
      {mobile && <source media="(max-width: 640px)" srcSet={sized(mobile.url, 800)} />}
      <img src={sized(img.url, w)} srcSet={`${sized(img.url, Math.round(w / 2))} ${Math.round(w / 2)}w, ${sized(img.url, w)} ${w}w`} sizes={`(max-width: 768px) 100vw, ${w}px`}
        alt={img.alt} loading={eager ? "eager" : "lazy"} decoding="async" className={className} />
    </picture>
  );
}

const Paras = ({ text, className = "" }: { text?: string; className?: string }) =>
  text ? <>{text.split(/\n{2,}/).map((p, i) => <p key={i} className={`whitespace-pre-line ${className}`}>{p}</p>)}</> : null;

const wa = (n: string) => `https://wa.me/${n.replace(/^\+/, "").replace(/^0/, "92")}`;

export function themeStyle(s: SiteSettings): React.CSSProperties {
  return { ["--wp" as string]: s.colors.primary, ["--wa" as string]: s.colors.accent, fontFamily: FONTS[s.font]?.css ?? FONTS.system.css } as React.CSSProperties;
}

export function SiteHeader({ s, nav, links, storeOn, cartSlot }: { s: SiteSettings; nav: { title: string; href: string }[]; links: Links; storeOn: boolean; cartSlot?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <a href={links.page("/")} className="flex min-w-0 items-center gap-2">
          {s.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sized(s.logo.url, 240)} alt={s.logo.alt || s.name} className="h-10 w-auto max-w-[180px] object-contain" />
          ) : <span className="truncate text-lg font-bold" style={{ color: "var(--wp)" }}>{s.name}</span>}
        </a>
        <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {nav.map((n) => <a key={n.href} href={n.href} className="text-neutral-700 hover:text-[var(--wp)]">{n.title}</a>)}
          {storeOn && <a href={links.store("")} className="text-neutral-700 hover:text-[var(--wp)]">Shop</a>}
        </nav>
        <div className="flex items-center gap-2">
          {s.contact.whatsapp && <a href={wa(s.contact.whatsapp)} className="rounded-full bg-[#25d366] px-3 py-1.5 text-xs font-semibold text-white" rel="noopener">WhatsApp</a>}
          {s.contact.phone && <a href={`tel:${s.contact.phone.replace(/[^\d+]/g, "")}`} className="hidden rounded-full border px-3 py-1.5 text-xs font-semibold sm:inline-block" style={{ borderColor: "var(--wp)", color: "var(--wp)" }}>{s.contact.phone}</a>}
          {cartSlot}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ s, links }: { s: SiteSettings; links: Links }) {
  const socials = Object.entries(s.social).filter(([, v]) => v);
  return (
    <footer className="mt-16 border-t border-black/5 bg-neutral-50">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-neutral-600 sm:grid-cols-3">
        <div>
          <p className="font-semibold text-neutral-900">{s.name}</p>
          {s.tagline && <p className="mt-1">{s.tagline}</p>}
          {s.footerText && <p className="mt-2 whitespace-pre-line">{s.footerText}</p>}
        </div>
        <div className="space-y-1">
          {s.contact.address && <p className="whitespace-pre-line">{s.contact.address}</p>}
          {s.contact.phone && <p><a href={`tel:${s.contact.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{s.contact.phone}</a></p>}
          {s.contact.email && <p><a href={`mailto:${s.contact.email}`} className="hover:underline">{s.contact.email}</a></p>}
          {s.contact.mapUrl && <p><a href={s.contact.mapUrl} rel="noopener" className="hover:underline">Open in Google Maps</a></p>}
        </div>
        <div className="space-y-1">
          {socials.map(([k, v]) => <p key={k}><a href={v} rel="noopener" className="capitalize hover:underline">{k === "x" ? "X" : k}</a></p>)}
          <p className="pt-2 text-xs text-neutral-400"><a href={links.page("/")} className="hover:underline">{s.name}</a> · Website by MAVIN.pk</p>
        </div>
      </div>
    </footer>
  );
}

export function ProductCard({ p, links, action }: { p: ProductCardData; links: Links; action?: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-black/5 bg-white">
      <a href={links.store(`/item/${p.slug}`)} className="block aspect-square bg-neutral-100">
        {p.images[0] ? <Picture img={p.images[0]} w={480} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs text-neutral-400">No photo</span>}
      </a>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <a href={links.store(`/item/${p.slug}`)} className="line-clamp-2 text-sm font-medium text-neutral-900 hover:underline">{p.name}</a>
        <p className="text-sm font-semibold" style={{ color: "var(--wp)" }}>{priceLines(p).main}</p>
        {priceLines(p).pack && <p className="text-xs text-neutral-500">{priceLines(p).pack}</p>}
        <div className="flex flex-wrap gap-1 text-[11px]">
          {p.rxRequired && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Prescription needed</span>}
          {(p.stock.visibility !== "hide" || !p.stock.inStock) && <span className={`rounded px-1.5 py-0.5 ${p.stock.inStock ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{stockText(p)}</span>}
        </div>
        {action && <div className="mt-auto pt-2">{action}</div>}
      </div>
    </div>
  );
}

function Hours({ s }: { s: SiteSettings }) {
  const rows = s.hours.filter((h) => h.closed || h.open || h.close);
  if (!rows.length) return <p className="text-sm text-neutral-500">Opening hours have not been added yet.</p>;
  return (
    <dl className="grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      {rows.map((h) => <div key={h.day} className="contents"><dt className="text-neutral-600">{h.day}</dt><dd className="tabular-nums text-neutral-900">{h.closed ? "Closed" : `${h.open || "?"} – ${h.close || "?"}`}</dd></div>)}
    </dl>
  );
}

function H({ children }: { children: ReactNode }) {
  return children ? <h2 className="mb-6 text-2xl font-bold tracking-tight text-neutral-900" style={{ textWrap: "balance" } as React.CSSProperties}>{children}</h2> : null;
}

export function SectionView({ sec, s, data, links, formSlot, productAction, reportSlot }: {
  sec: Section; s: SiteSettings; data: RenderData; links: Links;
  /** The contact form (a client component on the live site; a placeholder in the editor). */
  formSlot?: (kind: NonNullable<Section["form"]>) => ReactNode;
  productAction?: (p: ProductCardData) => ReactNode;
  /** The report lookup form (diagnostic labs). */
  reportSlot?: ReactNode;
}) {
  const wrap = (children: ReactNode, tone: "plain" | "soft" = "plain") => (
    <section id={sec.id} className={tone === "soft" ? "bg-neutral-50" : ""}><div className="mx-auto max-w-6xl px-4 py-12">{children}</div></section>
  );
  switch (sec.type) {
    case "hero": {
      const btns = (sec.buttons ?? []).map((b, i) => (
        <a key={i} href={b.href.startsWith("/") ? links.page(b.href) : b.href} className={`inline-block rounded-full px-5 py-2.5 text-sm font-semibold ${i === 0 ? "text-white" : "border"}`}
          style={i === 0 ? { background: "var(--wa)" } : { borderColor: "var(--wa)", color: "var(--wa)" }}>{b.label}</a>
      ));
      if (sec.variant === "split" && sec.image) {
        return (
          <section id={sec.id} style={{ background: "color-mix(in srgb, var(--wp) 7%, white)" }}>
            <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 md:grid-cols-2">
              <div><h1 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl" style={{ textWrap: "balance" } as React.CSSProperties}>{sec.heading}</h1><div className="mt-3 space-y-2 text-neutral-700"><Paras text={sec.text} /></div><div className="mt-6 flex flex-wrap gap-3">{btns}</div></div>
              <Picture img={sec.image} mobile={sec.mobileImage} w={960} eager className="w-full rounded-2xl object-cover" />
            </div>
          </section>
        );
      }
      return (
        <section id={sec.id} className="relative overflow-hidden text-white" style={{ background: "var(--wp)" }}>
          {sec.image && <div className="absolute inset-0 opacity-30"><Picture img={sec.image} mobile={sec.mobileImage} w={1600} eager className="h-full w-full object-cover" /></div>}
          <div className="relative mx-auto max-w-4xl px-4 py-20 text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl" style={{ textWrap: "balance" } as React.CSSProperties}>{sec.heading}</h1>
            <div className="mx-auto mt-4 max-w-2xl space-y-2 text-white/90"><Paras text={sec.text} /></div>
            {btns.length > 0 && <div className="mt-8 flex flex-wrap justify-center gap-3">{btns}</div>}
          </div>
        </section>
      );
    }
    case "about":
      return wrap(
        <div className={`grid items-center gap-8 ${sec.image ? "md:grid-cols-2" : ""}`}>
          <div><H>{sec.heading}</H><div className="max-w-prose space-y-3 text-neutral-700"><Paras text={sec.text} /></div></div>
          {sec.image && <Picture img={sec.image} w={800} className="w-full rounded-2xl object-cover" />}
        </div>,
      );
    case "services":
      return wrap(<><H>{sec.heading}</H><Paras text={sec.text} className="mb-6 max-w-prose text-neutral-700" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{(sec.items ?? []).map((it, i) => <div key={i} className="rounded-xl border border-black/5 bg-white p-5"><h3 className="font-semibold text-neutral-900">{it.title}</h3><div className="mt-2 space-y-2 text-sm text-neutral-600"><Paras text={it.text} /></div></div>)}</div></>, "soft");
    case "categories":
      return data.categories.length ? wrap(<><H>{sec.heading}</H>
        <div className="flex flex-wrap gap-2">{data.categories.map((c) => <a key={c} href={links.store(`?c=${encodeURIComponent(c)}`)} className="rounded-full border px-4 py-2 text-sm hover:text-white" style={{ borderColor: "var(--wp)", color: "var(--wp)" }}>{c}</a>)}</div></>) : null;
    case "featured":
      return data.featured.length ? wrap(<><div className="flex items-baseline justify-between"><H>{sec.heading}</H><a href={links.store("")} className="text-sm font-medium" style={{ color: "var(--wa)" }}>See all</a></div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{data.featured.slice(0, sec.limit ?? 8).map((p) => <ProductCard key={p.slug} p={p} links={links} action={productAction?.(p)} />)}</div></>) : null;
    case "gallery":
      return (sec.images ?? []).length ? wrap(<><H>{sec.heading}</H><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{sec.images!.map((im, i) => <Picture key={i} img={im} w={640} className="aspect-[4/3] w-full rounded-xl object-cover" />)}</div></>) : null;
    case "testimonials":
      return (sec.items ?? []).length ? wrap(<><H>{sec.heading}</H><div className="grid gap-4 md:grid-cols-2">{sec.items!.map((it, i) => <figure key={i} className="rounded-xl bg-white p-5 ring-1 ring-black/5"><blockquote className="whitespace-pre-line text-neutral-700">“{it.text}”</blockquote>{it.title && <figcaption className="mt-3 text-sm font-semibold text-neutral-900">{it.title}</figcaption>}</figure>)}</div></>, "soft") : null;
    case "faq":
      return wrap(<><H>{sec.heading}</H><div className="max-w-3xl divide-y divide-black/5 rounded-xl border border-black/5 bg-white">{(sec.items ?? []).map((it, i) => <details key={i} className="group p-4"><summary className="cursor-pointer font-medium text-neutral-900">{it.title}</summary><div className="mt-2 space-y-2 text-sm text-neutral-600"><Paras text={it.text} /></div></details>)}</div></>);
    case "cta":
      return (
        <section id={sec.id} style={{ background: "color-mix(in srgb, var(--wa) 10%, white)" }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-10">
            <div><h2 className="text-xl font-bold text-neutral-900">{sec.heading}</h2><Paras text={sec.text} className="mt-1 text-neutral-700" /></div>
            {(sec.buttons ?? [])[0] && <a href={sec.buttons![0].href.startsWith("/") ? links.page(sec.buttons![0].href) : sec.buttons![0].href} className="rounded-full px-5 py-2.5 text-sm font-semibold text-white" style={{ background: "var(--wa)" }}>{sec.buttons![0].label}</a>}
          </div>
        </section>
      );
    case "doctors":
      return wrap(<><H>{sec.heading}</H>{data.doctors.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.doctors.map((d, i) => <div key={i} className="rounded-xl border border-black/5 bg-white p-5"><p className="font-semibold text-neutral-900">{d.name}</p>{d.qualification && <p className="text-sm text-neutral-600">{d.qualification}</p>}{d.specialty && <p className="mt-1 text-sm" style={{ color: "var(--wp)" }}>{d.specialty}</p>}{d.days && <p className="mt-2 text-xs text-neutral-500">Days: {d.days}</p>}</div>)}</div> : <p className="text-sm text-neutral-500">Doctors appear here from your clinic records.</p>}</>, "soft");
    case "departments":
      return wrap(<><H>{sec.heading}</H>{data.departments.length ? <div className="flex flex-wrap gap-2">{data.departments.map((d, i) => <span key={i} className="rounded-lg bg-white px-4 py-2 text-sm ring-1 ring-black/5">{d.name}</span>)}</div> : <p className="text-sm text-neutral-500">Departments appear here from your hospital records.</p>}</>);
    case "hours":
      return wrap(<><H>{sec.heading}</H><Hours s={s} /></>);
    case "reportLookup":
      return wrap(
        <div className="mx-auto max-w-xl">
          <H>{sec.heading}</H>
          <Paras text={sec.text} className="mb-4 text-neutral-700" />
          {reportSlot ?? <div className="rounded-xl bg-white p-6 text-sm text-neutral-500 ring-1 ring-black/5">Receipt number and mobile number form</div>}
        </div>,
        "soft",
      );
    case "contact":
      return wrap(
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <H>{sec.heading}</H>
            <Paras text={sec.text} className="mb-4 text-neutral-700" />
            <div className="space-y-2 text-sm text-neutral-700">
              {s.contact.address && <p className="whitespace-pre-line">{s.contact.address}</p>}
              {s.contact.phone && <p>Phone: <a href={`tel:${s.contact.phone.replace(/[^\d+]/g, "")}`} className="font-medium hover:underline">{s.contact.phone}</a></p>}
              {s.contact.whatsapp && <p>WhatsApp: <a href={wa(s.contact.whatsapp)} rel="noopener" className="font-medium hover:underline">{s.contact.whatsapp}</a></p>}
              {s.contact.email && <p>Email: <a href={`mailto:${s.contact.email}`} className="font-medium hover:underline">{s.contact.email}</a></p>}
              {s.contact.mapUrl && <p><a href={s.contact.mapUrl} rel="noopener" className="font-medium hover:underline" style={{ color: "var(--wa)" }}>Open in Google Maps</a></p>}
            </div>
          </div>
          {sec.form && sec.form !== "none" && <div>{formSlot?.(sec.form)}</div>}
        </div>,
        "soft",
      );
    default:
      return null;
  }
}
