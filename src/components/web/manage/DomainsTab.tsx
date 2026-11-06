"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Note, Pill, card, errText, inputCls, labelCls, webCall } from "./shared";
import type { SiteView } from "./WebsiteManager";

interface Domain { id: string; host: string; target: "website" | "store" | "portal"; isPrimary: boolean; status: string; error: string | null; lastCheckedAt: string | null; records: { type: string; name: string; value: string; why: string }[] }

const TARGET: Record<string, string> = { website: "Website", store: "Online store", portal: "Staff portal (POS sign-in)" };

export function DomainsTab({ site, platformDomain, hostingConnected, tenantId, onChanged }: { site: SiteView; platformDomain: string; hostingConnected: boolean; tenantId?: string; onChanged: () => void }) {
  const [sub, setSub] = useState(site.subdomain ?? "");
  const [check, setCheck] = useState<{ name: string; available: boolean; reason: string | null } | null>(null);
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [host, setHost] = useState("");
  const [target, setTarget] = useState<Domain["target"]>("website");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { webCall<Domain[]>("domains", {}, tenantId).then(setDomains).catch((e) => setMsg({ ok: false, text: errText(e) })); }, [tenantId]);
  useEffect(load, [load]);

  // Availability as you type (Mavin addresses only).
  useEffect(() => {
    const name = sub.trim().toLowerCase();
    if (!name || name === site.subdomain) { setCheck(null); return; }
    const t = setTimeout(() => { webCall<typeof check>("checkSubdomain", { subdomain: name }, tenantId).then(setCheck).catch((e) => setCheck({ name, available: false, reason: errText(e) })); }, 400);
    return () => clearTimeout(t);
  }, [sub, site.subdomain, tenantId]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); onChanged(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      {msg && <Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note>}
      <div className={`${card} space-y-2`}>
        <p className="text-sm font-semibold text-neutral-800">Free address</p>
        <p className="text-xs text-neutral-500">Your website at <code>name.{platformDomain}</code>, free. This checks names on {platformDomain} only; it does not register .com or .pk domains.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor="dm-sub" className={labelCls}>Name
            <span className="flex items-center gap-1"><input id="dm-sub" value={sub} maxLength={40} onChange={(e) => setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className={`${inputCls} w-56`} /><span className="text-sm text-neutral-500">.{platformDomain}</span></span>
          </label>
          <Button variant="primary" disabled={!check?.available || busy === "sub"} onClick={() => void act("sub", () => webCall("subdomain", { subdomain: sub }, tenantId), `Your address is now ${sub}.${platformDomain}.`)}>Use this name</Button>
        </div>
        {check && <p className={`text-xs ${check.available ? "text-emerald-700" : "text-rose-700"}`} role="status">{check.available ? `${check.name}.${platformDomain} is available.` : check.reason}</p>}
        {site.subdomain && <p className="text-xs text-neutral-600">Current: <code>{site.subdomain}.{platformDomain}</code> · store at <code>/shop</code> · <code>/admin</code> opens the MAVIN.pk sign-in.</p>}
      </div>

      <div className={`${card} space-y-3`}>
        <p className="text-sm font-semibold text-neutral-800">Your own domains</p>
        {!site.customDomainAllowed ? <Note kind="info">Custom domains are not included for this business. Ask the administrator.</Note> : (
          <>
            {!hostingConnected && <Note kind="warn">The platform&apos;s hosting connection is not set up yet, so domains can be added and ownership checked, but they cannot become active until the administrator connects it.</Note>}
            <div className="flex flex-wrap items-end gap-2">
              <label htmlFor="dm-host" className={`${labelCls} min-w-[14rem] flex-1`}>Domain<input id="dm-host" value={host} onChange={(e) => setHost(e.target.value)} className={inputCls} placeholder="www.yourshop.pk" /></label>
              <label htmlFor="dm-target" className={labelCls}>Opens
                <select id="dm-target" value={target} onChange={(e) => setTarget(e.target.value as Domain["target"])} className={`${inputCls} w-52`}>
                  <option value="website">Website</option>{site.storeEnabled && <option value="store">Online store</option>}<option value="portal">Staff portal (POS sign-in)</option>
                </select>
              </label>
              <Button variant="primary" disabled={host.trim().length < 4 || busy === "add"} onClick={() => void act("add", () => webCall("addDomain", { host, target }, tenantId).then(() => setHost("")), "Domain added. Add the DNS records shown, then press Check.")}>Add domain</Button>
            </div>
            <p className="text-[11px] text-neutral-500">Example: www.yourshop.pk → Website, shop.yourshop.pk → Online store, portal.yourshop.pk → Staff portal. Staff sign in separately on a portal domain; only your business&apos;s logins work there.</p>
          </>
        )}
        {domains && domains.length > 0 && (
          <ul className="space-y-3">
            {domains.map((d) => (
              <li key={d.id} className="rounded-xl border border-neutral-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm font-semibold">{d.host}</code>
                  <span className="text-xs text-neutral-500">→ {TARGET[d.target]}</span>
                  <Pill s={d.status} />
                  {d.isPrimary && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-800">Primary</span>}
                  <span className="ml-auto flex gap-2">
                    <Button disabled={busy === d.id} onClick={() => void act(d.id, () => webCall("checkDomain", { id: d.id }, tenantId), "Checked.")}>{busy === d.id ? "Checking…" : "Check"}</Button>
                    {!d.isPrimary && d.status === "active" && <Button onClick={() => void act(`p${d.id}`, () => webCall("primaryDomain", { id: d.id }, tenantId), "Primary domain set: search engines use it.")}>Make primary</Button>}
                    <Button variant="danger" onClick={() => { if (confirm(`Disconnect ${d.host}? It stops showing your site at once.`)) void act(`r${d.id}`, () => webCall("removeDomain", { id: d.id }, tenantId), "Domain disconnected."); }}>Disconnect</Button>
                  </span>
                </div>
                {d.error && <p className={`mt-1 text-xs ${d.status === "error" ? "text-rose-700" : "text-neutral-600"}`}>{d.error}</p>}
                {d.status !== "active" && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-neutral-500"><tr><th className="py-1 pr-2 font-medium">Type</th><th className="py-1 pr-2 font-medium">Name / host</th><th className="py-1 pr-2 font-medium">Value</th><th className="py-1 font-medium">Why</th></tr></thead>
                      <tbody className="divide-y divide-neutral-100">
                        {d.records.map((r, i) => <tr key={i}><td className="py-1 pr-2 font-mono">{r.type}</td><td className="py-1 pr-2 font-mono break-all">{r.name}</td><td className="py-1 pr-2 font-mono break-all">{r.value}</td><td className="py-1 text-neutral-500">{r.why}</td></tr>)}
                      </tbody>
                    </table>
                    <p className="mt-1 text-[11px] text-neutral-500">Add these at the company where you bought the domain. The pointing records appear after ownership is confirmed. Steps: Pending verification → DNS pending → SSL pending → Active.</p>
                  </div>
                )}
                {d.lastCheckedAt && <p className="mt-1 text-[11px] text-neutral-400">Last checked {new Date(d.lastCheckedAt).toLocaleString("en-PK")}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
