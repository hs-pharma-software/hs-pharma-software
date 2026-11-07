"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DAYS, FONTS, type FontId, type SiteSettings, type StoreSettings } from "@/lib/web/sections";
import { Builder, type PageInfo } from "./Builder";
import { ProductsTab, OrdersTab, StoreSettingsCard } from "./StoreTabs";
import { DomainsTab } from "./DomainsTab";
import { businessType } from "@/config/businessTypes";
import { ImageField, Note, card, errText, inputCls, labelCls, useUnsavedGuard, webCall } from "./shared";

/** Settings > Website: everything a business does with its website and store.
 * `tenantId` is passed only when the Super Admin opens a business's website. */

export interface SiteView {
  websiteEnabled: boolean; storeEnabled: boolean; publicSuspended: boolean; builderAllowed: boolean; customDomainAllowed: boolean;
  template: string | null; subdomain: string | null; status: "draft" | "published"; publishedAt: string | null;
  draftSettings: SiteSettings | null; storeSettings: StoreSettings; limits: { pages: number; storageMb: number; customDomains: number };
  storageBytes: number; tenantName: string; businessType: string | null; tenantActive: boolean;
}
export interface Overview {
  site: SiteView | null; pages: PageInfo[]; unpublishedChanges: boolean;
  counts: { listed: number; openOrders: number; newRequests: number; domains: number };
  templates: Record<string, { label: string; summary: string; store: boolean }>;
  platformDomain: string; hostingConnected: boolean;
}

const TABS = [["overview", "Overview"], ["pages", "Pages & Builder"], ["branding", "Branding & contact"], ["store", "Products & Store"], ["orders", "Orders"], ["domains", "Domains"], ["seo", "SEO"], ["history", "History"]] as const;
type Tab = (typeof TABS)[number][0];

export function WebsiteManager({ tenantId }: { tenantId?: string }) {
  const [o, setO] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { webCall<Overview>("overview", {}, tenantId).then(setO).catch((e) => setError(errText(e))); }, [tenantId]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setMsg(null);
    try { await fn(); setMsg(ok); load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function preview() {
    try {
      const { token } = await webCall<{ token: string }>("preview", {}, tenantId);
      if (!o?.site?.subdomain) { setError("Choose a free address first (Domains)."); return; }
      window.open(`https://${o.site.subdomain}.${o.platformDomain}/?preview=${encodeURIComponent(token)}`, "_blank", "noopener");
    } catch (e) { setError(errText(e)); }
  }

  if (!o) return error ? <Note kind="error">{error}</Note> : <p className="text-sm text-neutral-500">Loading…</p>;
  const s = o.site;
  if (!s) return <Note kind="info">The website and online store are not switched on for this business. The administrator switches them on from the business&apos;s settings.</Note>;
  const liveUrl = s.subdomain ? `https://${s.subdomain}.${o.platformDomain}` : null;
  const shown = TABS.filter(([id]) => (id === "store" || id === "orders" ? s.storeEnabled || id === "orders" : true));

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center gap-3`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">
            {s.status === "published" ? <span className="text-emerald-700">Published</span> : <span className="text-amber-700">Draft (not public)</span>}
            {s.publicSuspended && <span className="ml-2 text-rose-700">· Public access suspended by the administrator</span>}
            {!s.tenantActive && <span className="ml-2 text-rose-700">· Subscription suspended</span>}
          </p>
          <p className="text-xs text-neutral-500">
            {o.unpublishedChanges ? "You have changes that are not live yet." : "The live website matches your draft."}
            {s.publishedAt ? ` Last published ${new Date(s.publishedAt).toLocaleString("en-PK")}.` : ""}
          </p>
        </div>
        <Button onClick={() => void preview()}>Preview draft</Button>
        {liveUrl && s.status === "published" && <a href={liveUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:underline">Open website <ExternalLink size={13} /></a>}
        <Button variant="primary" disabled={busy || !s.builderAllowed} onClick={() => void act(() => webCall("publish", { note: "" }, tenantId), "Published. The website now shows your latest changes.")}>Publish</Button>
      </div>
      {error && <Note kind="error">{error}</Note>}
      {msg && <Note kind="ok">{msg}</Note>}
      {!s.builderAllowed && <Note kind="warn">Website editing is turned off by the administrator. Orders still work.</Note>}

      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 text-xs">
        {shown.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 font-medium ${tab === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
            {label}{id === "orders" && o.counts.openOrders ? ` (${o.counts.openOrders})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab o={o} tenantId={tenantId} liveUrl={liveUrl} onChanged={load} go={setTab} />}
      {tab === "pages" && <Builder pages={o.pages} settings={s.draftSettings} tenantId={tenantId} onPagesChanged={load} storeOn={s.storeEnabled} />}
      {tab === "branding" && <BrandingTab settings={s.draftSettings} tenantId={tenantId} onSaved={load} />}
      {tab === "store" && <div className="space-y-4"><StoreSettingsCard settings={s.storeSettings} tenantId={tenantId} onSaved={load} /><ProductsTab tenantId={tenantId} pharmacy={businessType(s.businessType).family === "pharmacy"} /></div>}
      {tab === "orders" && <OrdersTab tenantId={tenantId} />}
      {tab === "domains" && <DomainsTab site={s} platformDomain={o.platformDomain} hostingConnected={o.hostingConnected} tenantId={tenantId} onChanged={load} />}
      {tab === "seo" && <SeoTab settings={s.draftSettings} tenantId={tenantId} onSaved={load} />}
      {tab === "history" && <HistoryTab tenantId={tenantId} onChanged={load} />}
    </div>
  );
}

function OverviewTab({ o, tenantId, liveUrl, onChanged, go }: { o: Overview; tenantId?: string; liveUrl: string | null; onChanged: () => void; go: (t: Tab) => void }) {
  const s = o.site!;
  const [tpl, setTpl] = useState(s.template ?? "general");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tiles: [string, string, Tab][] = [
    ["Pages", `${o.pages.length} of ${s.limits.pages}`, "pages"],
    ["Products online", String(o.counts.listed), "store"],
    ["Open orders", String(o.counts.openOrders), "orders"],
    ["New requests", String(o.counts.newRequests), "orders"],
    ["Custom domains", `${o.counts.domains} of ${s.customDomainAllowed ? s.limits.customDomains : 0}`, "domains"],
    ["Image storage", `${(s.storageBytes / 1048576).toFixed(1)} of ${s.limits.storageMb} MB`, "pages"],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([l, v, t]) => (
          <button key={l} type="button" onClick={() => go(t)} className={`${card} text-left transition hover:ring-[var(--accent)]`}>
            <p className="text-xs text-neutral-500">{l}</p><p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{v}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold text-neutral-800">Addresses</p>
          <ul className="mt-2 space-y-1 text-sm text-neutral-700">
            <li>Website: {liveUrl ? <code>{liveUrl.replace("https://", "")}</code> : <span className="text-amber-700">no free address yet</span>}</li>
            {s.storeEnabled && <li>Store: {liveUrl ? <code>{liveUrl.replace("https://", "")}/shop</code> : "–"}</li>}
            <li>Staff sign-in: <code>{liveUrl ? `${liveUrl.replace("https://", "")}/admin` : "app.mavin.pk"}</code> (opens the MAVIN.pk sign-in)</li>
          </ul>
          <button type="button" onClick={() => go("domains")} className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline">Manage addresses and custom domains</button>
        </div>
        <div className={card}>
          <p className="text-sm font-semibold text-neutral-800">Template</p>
          <p className="mt-1 text-xs text-neutral-500">Applying a template replaces the draft home page only. Other pages and the live website are not changed until you publish.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label htmlFor="ov-tpl" className={labelCls}>Template
              <select id="ov-tpl" value={tpl} onChange={(e) => setTpl(e.target.value)} className={`${inputCls} w-56`}>
                {Object.entries(o.templates).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </label>
            <Button disabled={!s.builderAllowed} onClick={async () => {
              if (!confirm("Replace the draft home page with this template?")) return;
              try { await webCall("applyTemplate", { template: tpl }, tenantId); setMsg({ ok: true, text: "Template applied to the draft home page." }); onChanged(); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
            }}>Apply to home page</Button>
          </div>
          <p className="mt-2 text-xs text-neutral-500">{o.templates[tpl]?.summary}</p>
          {msg && <div className="mt-2"><Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note></div>}
        </div>
      </div>
    </div>
  );
}

function BrandingTab({ settings, tenantId, onSaved }: { settings: SiteSettings | null; tenantId?: string; onSaved: () => void }) {
  const [s, setS] = useState<SiteSettings | null>(settings);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedGuard(dirty);
  if (!s) return <Note kind="info">No settings yet.</Note>;
  const up = (patch: Partial<SiteSettings>) => { setS({ ...s, ...patch }); setDirty(true); };
  const contact = (k: keyof SiteSettings["contact"], v: string) => up({ contact: { ...s.contact, [k]: v } });
  const social = (k: keyof SiteSettings["social"], v: string) => up({ social: { ...s.social, [k]: v } });
  const hours = DAYS.map((d, i) => s.hours[i] ?? { day: d, open: "", close: "", closed: false });
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      try { const r = await webCall<SiteSettings>("settings", { settings: s }, tenantId); setS(r); setDirty(false); setMsg({ ok: true, text: "Saved to the draft. Publish to make it live." }); onSaved(); }
      catch (err) { setMsg({ ok: false, text: errText(err) }); } finally { setBusy(false); }
    }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} space-y-3`}>
          <p className="text-sm font-semibold text-neutral-800">Business</p>
          <label htmlFor="br-name" className={labelCls}>Public business name<input id="br-name" value={s.name} maxLength={120} onChange={(e) => up({ name: e.target.value })} className={inputCls} /></label>
          <label htmlFor="br-tag" className={labelCls}>Tagline (optional)<input id="br-tag" value={s.tagline} maxLength={160} onChange={(e) => up({ tagline: e.target.value })} className={inputCls} /></label>
          <ImageField id="br-logo" label="Logo" value={s.logo} onChange={(v) => up({ logo: v })} tenantId={tenantId} hint="A wide logo with a transparent background works best." />
          <ImageField id="br-fav" label="Favicon (browser tab icon)" value={s.favicon} onChange={(v) => up({ favicon: v })} tenantId={tenantId} hint="Square, at least 64 × 64." />
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="br-p" className={labelCls}>Main colour<input id="br-p" type="color" value={s.colors.primary} onChange={(e) => up({ colors: { ...s.colors, primary: e.target.value } })} className="h-9 w-full rounded border border-neutral-300" /></label>
            <label htmlFor="br-a" className={labelCls}>Button colour<input id="br-a" type="color" value={s.colors.accent} onChange={(e) => up({ colors: { ...s.colors, accent: e.target.value } })} className="h-9 w-full rounded border border-neutral-300" /></label>
          </div>
          <label htmlFor="br-font" className={labelCls}>Font
            <select id="br-font" value={s.font} onChange={(e) => up({ font: e.target.value as FontId })} className={inputCls}>{(Object.keys(FONTS) as FontId[]).map((f) => <option key={f} value={f}>{FONTS[f].label}</option>)}</select>
          </label>
          <label htmlFor="br-foot" className={labelCls}>Footer text (optional)<textarea id="br-foot" value={s.footerText} maxLength={300} rows={2} onChange={(e) => up({ footerText: e.target.value })} className={inputCls} /></label>
        </div>
        <div className={`${card} space-y-3`}>
          <p className="text-sm font-semibold text-neutral-800">Public contact details</p>
          <p className="text-xs text-neutral-500">Only what you enter here is shown. Your internal business records stay private.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="br-ph" className={labelCls}>Phone<input id="br-ph" value={s.contact.phone} maxLength={40} onChange={(e) => contact("phone", e.target.value)} className={inputCls} /></label>
            <label htmlFor="br-wa" className={labelCls}>WhatsApp<input id="br-wa" value={s.contact.whatsapp} maxLength={20} onChange={(e) => contact("whatsapp", e.target.value)} className={inputCls} placeholder="923001234567" /></label>
          </div>
          <label htmlFor="br-em" className={labelCls}>Email<input id="br-em" type="email" value={s.contact.email} maxLength={120} onChange={(e) => contact("email", e.target.value)} className={inputCls} /></label>
          <label htmlFor="br-ad" className={labelCls}>Address<textarea id="br-ad" value={s.contact.address} maxLength={300} rows={2} onChange={(e) => contact("address", e.target.value)} className={inputCls} /></label>
          <label htmlFor="br-map" className={labelCls}>Google Maps link (optional)<input id="br-map" value={s.contact.mapUrl} maxLength={500} onChange={(e) => contact("mapUrl", e.target.value)} className={inputCls} placeholder="https://maps.app.goo.gl/…" /></label>
          <fieldset>
            <legend className="text-xs font-medium text-neutral-600">Business hours</legend>
            <div className="mt-1 space-y-1">
              {hours.map((h, i) => (
                <div key={h.day} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-24 text-neutral-700">{h.day}</span>
                  <input type="time" aria-label={`${h.day} opens`} value={h.open} disabled={h.closed} onChange={(e) => up({ hours: hours.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)) })} className={`${inputCls} w-28`} />
                  <input type="time" aria-label={`${h.day} closes`} value={h.close} disabled={h.closed} onChange={(e) => up({ hours: hours.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)) })} className={`${inputCls} w-28`} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={h.closed} onChange={(e) => up({ hours: hours.map((x, j) => (j === i ? { ...x, closed: e.target.checked } : x)) })} /> Closed</label>
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-medium text-neutral-600">Social pages (full https:// address)</legend>
            {(["facebook", "instagram", "youtube", "tiktok", "x", "linkedin"] as const).map((k) => (
              <input key={k} aria-label={k} value={s.social[k]} maxLength={300} placeholder={k === "x" ? "X (Twitter)" : k[0].toUpperCase() + k.slice(1)} onChange={(e) => social(k, e.target.value)} className={inputCls} />
            ))}
          </fieldset>
        </div>
      </div>
      {msg && <Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note>}
      <Button type="submit" variant="primary" disabled={busy || !dirty}>{busy ? "Saving…" : "Save draft"}</Button>
    </form>
  );
}

function SeoTab({ settings, tenantId, onSaved }: { settings: SiteSettings | null; tenantId?: string; onSaved: () => void }) {
  const [s, setS] = useState<SiteSettings | null>(settings);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!s) return null;
  return (
    <div className={`${card} space-y-3`}>
      <p className="text-sm font-semibold text-neutral-800">How the website appears in search and when shared</p>
      <label htmlFor="seo-t" className={labelCls}>Search title (home page) <span className="font-normal text-neutral-400">{s.seo.title.length}/70</span><input id="seo-t" value={s.seo.title} maxLength={70} onChange={(e) => setS({ ...s, seo: { ...s.seo, title: e.target.value } })} className={inputCls} placeholder={s.name} /></label>
      <label htmlFor="seo-d" className={labelCls}>Search description <span className="font-normal text-neutral-400">{s.seo.description.length}/170</span><textarea id="seo-d" value={s.seo.description} maxLength={170} rows={2} onChange={(e) => setS({ ...s, seo: { ...s.seo, description: e.target.value } })} className={inputCls} /></label>
      <ImageField id="seo-img" label="Sharing image" value={s.seo.image} onChange={(v) => setS({ ...s, seo: { ...s.seo, image: v } })} tenantId={tenantId} hint="Shown when the link is shared (1200 × 630 works best)." />
      <p className="text-xs text-neutral-500">Each page&apos;s own title and description are set under Pages & Builder. Drafts, previews, the cart and order pages are never shown to search engines. Search engines use your primary domain once one is active.</p>
      {msg && <Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note>}
      <Button variant="primary" onClick={async () => { try { await webCall("settings", { settings: s }, tenantId); setMsg({ ok: true, text: "Saved to the draft. Publish to make it live." }); onSaved(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } }}>Save draft</Button>
    </div>
  );
}

function HistoryTab({ tenantId, onChanged }: { tenantId?: string; onChanged: () => void }) {
  const [rows, setRows] = useState<{ id: string; note: string | null; by: string; at: string }[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => { webCall<typeof rows>("revisions", {}, tenantId).then(setRows).catch((e) => setMsg({ ok: false, text: errText(e) })); }, [tenantId]);
  useEffect(load, [load]);
  return (
    <div className={card}>
      <p className="mb-2 text-sm font-semibold text-neutral-800">Published versions</p>
      {msg && <div className="mb-2"><Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note></div>}
      {!rows ? <p className="text-sm text-neutral-500">Loading…</p> : !rows.length ? <p className="text-sm text-neutral-500">Nothing published yet.</p> : (
        <ul className="divide-y divide-neutral-100 text-sm">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{new Date(r.at).toLocaleString("en-PK")}{i === 0 && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">Live</span>}{r.note && <span className="ml-2 text-xs text-neutral-500">{r.note}</span>}</span>
              {i > 0 && <Button onClick={async () => {
                if (!confirm("Put this version live again? Your current draft is replaced by it.")) return;
                try { await webCall("rollback", { id: r.id }, tenantId); setMsg({ ok: true, text: "That version is live again." }); load(); onChanged(); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
              }}>Restore</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
