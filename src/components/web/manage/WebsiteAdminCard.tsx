"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { serverJson } from "@/lib/serverMode";
import { WebsiteManager, type Overview } from "./WebsiteManager";
import { Note, Pill, Toggle, errText, inputCls, labelCls } from "./shared";

/** Super Admin > Tenant > Website & Domains: switch the website and/or store
 * on in one action (safe to repeat), suspend public access without touching
 * the POS, permissions, limits, template, free address and domain status. */
const adminCall = async <T,>(action: string, body: Record<string, unknown>) => (await serverJson<{ result: T }>("/api/web/admin/", { action, ...body })).result;

interface AdminView extends Overview { domains: { id: string; host: string; target: string; status: string }[] }

export function WebsiteAdminCard({ tenantId }: { tenantId: string }) {
  const [v, setV] = useState<AdminView | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState({ maxPages: "", maxStorageMb: "", maxCustomDomains: "" });
  const [sub, setSub] = useState("");
  const [manage, setManage] = useState(false);
  const load = useCallback(() => { adminCall<AdminView>("get", { tenantId }).then((x) => { setV(x); setSub(x.site?.subdomain ?? ""); }).catch((e) => setMsg({ ok: false, text: errText(e) })); }, [tenantId]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  if (!v) return <p className="text-sm text-neutral-500">{msg?.text ?? "Loading…"}</p>;
  const s = v.site;
  const enable = (website: boolean | undefined, store: boolean | undefined, label: string) =>
    act(() => adminCall("enable", { tenantId, website, store }), `${label}. A draft was prepared from the business's details; nothing is published until they (or you) publish it.`);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void enable(true, undefined, "Website switched on")}>Enable Website</Button>
        <Button disabled={busy} onClick={() => void enable(undefined, true, "Online store switched on")}>Enable Online Store</Button>
        <Button variant="primary" disabled={busy} onClick={() => void enable(true, true, "Website and store switched on")}>Enable Both</Button>
        {s && (s.websiteEnabled || s.storeEnabled) && <Button variant="danger" disabled={busy} onClick={() => { if (confirm("Switch the website and store off? Pages and orders are kept; the POS is not affected.")) void act(() => adminCall("enable", { tenantId, website: false, store: false }), "Website and store switched off."); }}>Switch off</Button>}
      </div>
      {msg && <Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note>}
      {!s ? <p className="text-neutral-500">Not switched on. Enabling prepares a draft website from the business&apos;s name, phone, email and address, with a template for its type.</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-medium ${s.websiteEnabled ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}>Website {s.websiteEnabled ? "on" : "off"}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${s.storeEnabled ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}>Store {s.storeEnabled ? "on" : "off"}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${s.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{s.status === "published" ? "Published" : "Draft"}</span>
            {s.subdomain && s.status === "published" && <a href={`https://${s.subdomain}.${v.platformDomain}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline">Open public website <ExternalLink size={12} /></a>}
            <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={() => setManage(true)}>Open website manager</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle id={`wa-susp-${tenantId}`} checked={s.publicSuspended} onChange={(x) => void act(() => adminCall("flags", { tenantId, publicSuspended: x }), x ? "Public website and ordering suspended (the POS keeps working)." : "Public access restored.")} label="Suspend public website and ordering" hint="The POS and staff logins keep working." />
            <Toggle id={`wa-build-${tenantId}`} checked={s.builderAllowed} onChange={(x) => void act(() => adminCall("flags", { tenantId, builderAllowed: x }), "Saved.")} label="Business may edit its website" />
            <Toggle id={`wa-dom-${tenantId}`} checked={s.customDomainAllowed} onChange={(x) => void act(() => adminCall("flags", { tenantId, customDomainAllowed: x }), "Saved.")} label="Business may connect its own domains" />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label htmlFor={`wa-tpl-${tenantId}`} className={labelCls}>Template
              <select id={`wa-tpl-${tenantId}`} value={s.template ?? ""} onChange={(e) => void act(() => adminCall("flags", { tenantId, template: e.target.value }), "Template set. Use Apply in the website manager to rebuild the draft home page.")} className={`${inputCls} w-52`}>
                {Object.entries(v.templates).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </label>
            <label htmlFor={`wa-sub-${tenantId}`} className={labelCls}>Free address
              <span className="flex items-center gap-1"><input id={`wa-sub-${tenantId}`} value={sub} onChange={(e) => setSub(e.target.value.toLowerCase())} className={`${inputCls} w-44`} /><span className="text-xs text-neutral-500">.{v.platformDomain}</span></span>
            </label>
            <Button disabled={busy || !sub || sub === s.subdomain} onClick={() => void act(() => adminCall("subdomain", { tenantId, subdomain: sub }), "Address assigned.")}>Assign</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {([["maxPages", `Pages (now ${s.limits.pages})`], ["maxStorageMb", `Image MB (now ${s.limits.storageMb})`], ["maxCustomDomains", `Domains (now ${s.limits.customDomains})`]] as const).map(([k, l]) => (
              <label key={k} htmlFor={`wa-${k}-${tenantId}`} className={labelCls}>{l}<input id={`wa-${k}-${tenantId}`} type="number" min={0} value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} placeholder="plan" className={`${inputCls} w-28`} /></label>
            ))}
            <Button disabled={busy} onClick={() => void act(() => adminCall("flags", { tenantId, maxPages: limits.maxPages || null, maxStorageMb: limits.maxStorageMb || null, maxCustomDomains: limits.maxCustomDomains || null }), "Limits saved (empty = the plan's limit).")}>Save limits</Button>
          </div>
          {v.domains.length > 0 && (
            <ul className="space-y-1 text-xs">{v.domains.map((d) => <li key={d.id} className="flex items-center gap-2"><code>{d.host}</code> → {d.target} <Pill s={d.status} /></li>)}</ul>
          )}
          {!v.hostingConnected && <p className="text-xs text-amber-700">Hosting (Vercel) is not connected: custom domains cannot become active. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID.</p>}
        </>
      )}
      {manage && (
        <Modal title="Website manager" onClose={() => { setManage(false); load(); }} width="max-w-7xl">
          <WebsiteManager tenantId={tenantId} />
        </Modal>
      )}
    </div>
  );
}
