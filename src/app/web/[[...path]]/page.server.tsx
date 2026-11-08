import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sqlForServer } from "@/server/subSupersApi";
import { WEB_HOST_HEADER } from "@/lib/webRoute";
import { webContext, sectionData, type WebContext } from "@/server/web/publicSite";
import { orderByToken, publicCatalog, publicCategories } from "@/server/web/store";
import { FONTS } from "@/lib/web/sections";
import { ProductCard, SectionView, SiteFooter, SiteHeader, priceLines, rs, sized, stockText, themeStyle, type Links } from "@/components/web/Render";
import { AddToCart, CartButton, Checkout, PayNow, ReportLookup, RequestForm, ShopSearch } from "@/components/web/Client";

/** A business's public website and store (served for its own addresses only:
 * see src/proxy.server.ts and resolveHost). Address map:
 *   /, /<page>            website pages        /shop, /shop/item/<x>, /shop/cart   store
 *   /order/<token>        an order's status (private link, not indexed)
 * On a store domain the store is at /. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function load(p: Params) {
  const [{ path = [] }, sp, h] = await Promise.all([p.params, p.searchParams, headers()]);
  const ctx = await webContext(sqlForServer(), h.get(WEB_HOST_HEADER), one(sp.preview) || null);
  return { ctx, path: path.map((x) => decodeURIComponent(x)), sp };
}

type Where = { kind: "page"; slug: string } | { kind: "store"; rest: string[] } | { kind: "order"; token: string } | { kind: "none" };
function where(ctx: WebContext, path: string[]): Where {
  if (path[0] === "order" && path[1] && path.length === 2) return { kind: "order", token: path[1] };
  if (ctx.storeBase === "") return { kind: "store", rest: path };
  if (path[0] === "shop") return { kind: "store", rest: path.slice(1) };
  if (path.length <= 1) return { kind: "page", slug: path[0] ?? "home" };
  return { kind: "none" };
}

function linksFor(ctx: WebContext): Links {
  const q = ctx.preview ? `preview=${encodeURIComponent(ctx.preview)}` : "";
  const add = (url: string) => (q ? `${url}${url.includes("?") ? "&" : "?"}${q}` : url);
  const webBase = ctx.storeBase === "" ? (ctx.canonicalWebsite ?? "") : "";
  return {
    page: (p) => add(`${webBase}${p}`),
    store: (p) => add(p.startsWith("?") ? `${ctx.storeBase || "/"}${p}` : `${ctx.storeBase}${p}` || "/"),
  };
}

export async function generateMetadata(p: Params): Promise<Metadata> {
  const { ctx, path } = await load(p);
  if (!ctx) return { robots: { index: false, follow: false } };
  const s = ctx.settings;
  const w = where(ctx, path);
  let title = s.seo.title || s.name;
  let description = s.seo.description || s.tagline || undefined;
  let canonical: string | undefined;
  let index = !ctx.preview;
  if (w.kind === "page") {
    const pg = ctx.pages.find((x) => x.slug === w.slug);
    if (pg && pg.kind !== "home") title = pg.seoTitle || `${pg.title} | ${s.name}`;
    else if (pg?.seoTitle) title = pg.seoTitle;
    if (pg?.seoDescription) description = pg.seoDescription;
    canonical = ctx.canonicalWebsite ? `${ctx.canonicalWebsite}${w.slug === "home" ? "/" : `/${w.slug}`}` : undefined;
  } else if (w.kind === "store") {
    if (w.rest[0] === "item" && w.rest[1]) {
      const [prod] = await publicCatalog(sqlForServer(), ctx.site, { slug: w.rest[1] });
      if (prod) { title = `${prod.name} | ${s.name}`; description = prod.description.slice(0, 160) || description; }
    } else title = `Shop | ${s.name}`;
    canonical = ctx.canonicalStore ? `${ctx.canonicalStore}${w.rest.length ? `/${w.rest.join("/")}` : ""}` : undefined;
    if (w.rest[0] === "cart") index = false;
  } else index = false;
  const image = s.seo.image ? sized(s.seo.image.url, 1200) : undefined;
  return {
    title: { absolute: title }, description, alternates: canonical ? { canonical } : undefined,
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title, description, siteName: s.name, ...(image ? { images: [image] } : {}) },
    icons: s.favicon ? { icon: sized(s.favicon.url, 64) } : undefined,
  };
}

export default async function WebPage(p: Params) {
  const { ctx, path, sp } = await load(p);
  if (!ctx) notFound();
  const sql = sqlForServer();
  const s = ctx.settings;
  const links = linksFor(ctx);
  const w = where(ctx, path);
  const font = FONTS[s.font]?.google;
  const nav = ctx.websiteOn ? ctx.pages.filter((x) => x.inNav).map((x) => ({ title: x.title, href: links.page(x.kind === "home" ? "/" : `/${x.slug}`) })) : [];
  const preview = Boolean(ctx.preview);
  const cart = ctx.storeOn ? <CartButton href={links.store("/cart")} /> : null;

  let body: React.ReactNode;
  let jsonLd: Record<string, unknown> | null = null;
  if (w.kind === "page") {
    if (!ctx.websiteOn) { if (ctx.storeOn) redirect(links.store("")); notFound(); }
    const pg = ctx.pages.find((x) => x.slug === w.slug);
    if (!pg) notFound();
    const data = await sectionData(sql, ctx, pg.sections);
    body = pg.sections.map((sec) => (
      <SectionView key={sec.id} sec={sec} s={s} data={data} links={links}
        formSlot={(kind) => (kind === "none" ? null : <RequestForm kind={kind} preview={preview} />)}
        productAction={(prod) => <AddToCart p={prod} preview={preview} />}
        reportSlot={<ReportLookup preview={preview} />} />
    ));
    if (pg.kind === "home") {
      jsonLd = { "@context": "https://schema.org", "@type": "LocalBusiness", name: s.name, ...(s.contact.phone ? { telephone: s.contact.phone } : {}), ...(s.contact.address ? { address: s.contact.address } : {}), ...(ctx.canonicalWebsite ? { url: ctx.canonicalWebsite } : {}) };
    }
  } else if (w.kind === "store") {
    if (!ctx.storeOn) notFound();
    const [a, b] = w.rest;
    if (!a) {
      const q = one(sp.q).slice(0, 60);
      const c = one(sp.c).slice(0, 60);
      const [items, cats] = await Promise.all([publicCatalog(sql, ctx.site, { q: q || undefined, category: c || undefined }), publicCategories(sql, ctx.site)]);
      body = (
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h1 className="text-2xl font-bold text-neutral-900">Shop</h1>
          {ctx.site.storeSettings.notice && <p className="mt-2 whitespace-pre-line text-sm text-neutral-600">{ctx.site.storeSettings.notice}</p>}
          <ShopSearch action={ctx.storeBase || "/"} initialQ={q} initialC={c} categories={cats} preview={ctx.preview} itemBase={`${ctx.storeBase}/item`} />
          {items.length ? (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{items.map((x) => <ProductCard key={x.slug} p={x} links={links} action={<AddToCart p={x} preview={preview} />} />)}</div>
          ) : <p className="mt-8 text-neutral-600">{q || c ? "No products match. Try another search." : "Products will appear here soon."}</p>}
        </div>
      );
    } else if (a === "item" && b) {
      const [prod] = await publicCatalog(sql, ctx.site, { slug: b });
      if (!prod) notFound();
      jsonLd = {
        "@context": "https://schema.org", "@type": "Product", name: prod.name, ...(prod.description ? { description: prod.description } : {}),
        ...(prod.images[0] ? { image: sized(prod.images[0].url, 800) } : {}),
        ...(prod.price !== null ? { offers: { "@type": "Offer", priceCurrency: "PKR", price: prod.price, availability: prod.stock.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } } : {}),
      };
      body = (
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-2">
          <div className="space-y-3">
            {prod.images.length ? prod.images.map((im, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={sized(im.url, 900)} alt={im.alt || prod.name} className="w-full rounded-2xl bg-neutral-100 object-contain" loading={i ? "lazy" : "eager"} />
            )) : <div className="flex aspect-square items-center justify-center rounded-2xl bg-neutral-100 text-sm text-neutral-400">No photo</div>}
          </div>
          <div>
            <a href={links.store("")} className="text-sm text-neutral-500 hover:underline">← Shop</a>
            <h1 className="mt-2 text-2xl font-bold text-neutral-900">{prod.name}</h1>
            {prod.category && <p className="mt-1 text-sm text-neutral-500">{prod.category}</p>}
            <p className="mt-4 text-2xl font-semibold" style={{ color: "var(--wp)" }}>{priceLines(prod).main}</p>
            {priceLines(prod).pack && <p className="mt-1 text-sm text-neutral-600">{priceLines(prod).pack}</p>}
            {prod.rxRequired && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">A valid prescription is needed. You can attach it at checkout; the pharmacist checks it before confirming.</p>}
            {(prod.stock.visibility !== "hide" || !prod.stock.inStock) && <p className={`mt-3 text-sm ${prod.stock.inStock ? "text-neutral-600" : "font-medium text-rose-700"}`}>{stockText(prod)}</p>}
            <div className="mt-5 max-w-xs"><AddToCart p={prod} preview={preview} /></div>
            {prod.description && <div className="mt-6 space-y-2 whitespace-pre-line text-neutral-700">{prod.description}</div>}
          </div>
        </div>
      );
    } else if (a === "cart" && !b) {
      body = <div className="mx-auto max-w-6xl px-4 py-10"><h1 className="mb-6 text-2xl font-bold text-neutral-900">Your cart</h1><Checkout orderBase="/order" preview={preview} /></div>;
    } else notFound();
  } else if (w.kind === "order") {
    const o = await orderByToken(sql, ctx.site.tenantId, w.token);
    if (!o) notFound();
    const STEP: Record<string, string> = { pending: "Received: the shop will confirm it soon", confirmed: "Confirmed", preparing: "Being prepared", ready: "Ready", dispatched: "On the way", completed: "Completed", cancelled: "Cancelled", rejected: "Not accepted" };
    body = (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold text-neutral-900">Order #{o.orderNo}</h1>
        <p className="mt-2 text-neutral-700">Status: <b>{STEP[o.status] ?? o.status}</b></p>
        {o.rxStatus === "pending_review" && <p className="mt-2 text-sm text-amber-800">The pharmacist is checking your prescription.</p>}
        {o.rxStatus === "clarification" && <p className="mt-2 text-sm text-amber-800">The pharmacy needs more information about your prescription and will contact you.</p>}
        {o.paymentMethod === "online" && (o.paymentStatus === "paid"
          ? <p className="mt-2 text-sm font-medium text-emerald-700">Paid online.</p>
          : o.status !== "cancelled" && o.status !== "rejected" && (
            <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p>Payment not confirmed yet. If you have just paid, it shows here once the payment provider confirms it.</p>
              <PayNow token={w.token} orderBase="/order" />
            </div>
          ))}
        {o.paymentMethod === "bank" && o.paymentStatus !== "paid" && <p className="mt-2 whitespace-pre-line rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">Pay by bank transfer to:{"\n"}{ctx.site.storeSettings.bankDetails}{"\n"}Mention order #{o.orderNo}. The shop confirms your payment.</p>}
        <ul className="mt-6 divide-y divide-black/5 rounded-xl border border-black/5 bg-white text-sm">
          {o.items.map((i, k) => <li key={k} className="flex justify-between gap-3 p-3"><span>{i.name} × {i.qty}</span><span className="tabular-nums">{rs(i.total)}</span></li>)}
          {o.delivery > 0 && <li className="flex justify-between p-3"><span>Delivery{o.zone ? ` (${o.zone})` : ""}</span><span className="tabular-nums">{rs(o.delivery)}</span></li>}
          <li className="flex justify-between p-3 font-semibold"><span>Total</span><span className="tabular-nums">{rs(o.total)}</span></li>
        </ul>
        <p className="mt-4 text-xs text-neutral-500">Keep this page&apos;s address to check your order. {s.contact.phone ? `Questions? Call ${s.contact.phone}.` : ""}</p>
      </div>
    );
  } else notFound();

  return (
    <div style={themeStyle(s)} className="min-h-screen bg-white text-neutral-800">
      {font && <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${font}&display=swap`} precedence="default" />}
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      {preview && <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">Preview of unpublished changes. Visitors do not see this.</div>}
      <SiteHeader s={s} nav={nav} links={links} storeOn={ctx.storeOn} cartSlot={cart} />
      <main id="main">{body}</main>
      <SiteFooter s={s} links={links} />
    </div>
  );
}
