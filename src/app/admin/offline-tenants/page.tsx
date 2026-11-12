"use client";

/** Super Admin › Offline Tenants: businesses using a standalone desktop
 * edition (Mavin Pharmacy Offline) and their licenses. Enter the tenant's
 * category and details and the request code the business sends; MAVIN
 * generates the license key to give them (src/server/standalone/licenses.ts). */
import { Fragment, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";

interface Category { id: string; label: string; available: boolean }
interface OfflineTenant {
  id: string; installation_id: string; category: string; name: string; owner_name: string | null; phone: string | null; email: string | null;
  city: string | null; address: string | null; notes: string | null; app_version: string | null; licenses: number; expires_at: string | null; last_issued_at: string | null;
}
interface ListResult { categories: Category[]; tenants: OfflineTenant[]; signingReady: boolean }
interface Issued { licenseText: string; fileName: string; kind: string; licenseId: string; expiresAt: string; installationId: string }
interface HistoryRow { id: string; license_id: string; kind: string; licensee: string; issued_at: string; expires_at: string; license_text: string }

const API = "/api/offline-licenses/";
const call = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<T>(API, { action, ...body });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" }) : "—");
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
const plus = (months: number) => { const d = new Date(); d.setMonth(d.getMonth() + months); return ymd(d); };
const input = "w-full rounded-lg px-3 py-2 text-sm ring-1 ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-sky-300";
const empty = { category: "retail_pharmacy", name: "", ownerName: "", phone: "", email: "", city: "", address: "", notes: "", requestCode: "", expires: plus(12) };

export default function OfflineTenantsPage() {
  const [data, setData] = useState<ListResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState(empty);
  const [renewing, setRenewing] = useState<OfflineTenant | null>(null);
  const [req, setReq] = useState<{ installationId: string; pharmacy: string | null; appVersion: string | null } | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [hist, setHist] = useState<HistoryRow[]>([]);
  const [q, setQ] = useState("");
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try { setData(await call<ListResult>("list")); setMsg(null); } catch (e) { setMsg(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function readCode(code: string) {
    setReq(null);
    setReqError(null);
    if (!code.trim()) return;
    try {
      const r = await call<{ installationId: string; pharmacy: string | null; appVersion: string | null }>("preview", { requestCode: code });
      setReq(r);
      const known = data?.tenants.find((t) => t.installation_id === r.installationId);
      if (known) setF((x) => ({ ...x, category: known.category, name: known.name, ownerName: known.owner_name ?? "", phone: known.phone ?? "", email: known.email ?? "", city: known.city ?? "", address: known.address ?? "", notes: known.notes ?? "" }));
      else if (r.pharmacy) setF((x) => (x.name ? x : { ...x, name: r.pharmacy! }));
    } catch (e) { setReqError(errText(e)); }
  }

  function renew(t: OfflineTenant) {
    setRenewing(t);
    setIssued(null);
    setReq(null);
    setReqError(null);
    const base = t.expires_at && Date.parse(t.expires_at) > Date.now() ? new Date(t.expires_at) : new Date();
    base.setFullYear(base.getFullYear() + 1);
    setF({ category: t.category, name: t.name, ownerName: t.owner_name ?? "", phone: t.phone ?? "", email: t.email ?? "", city: t.city ?? "", address: t.address ?? "", notes: t.notes ?? "", requestCode: "", expires: ymd(base) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function generate() {
    setBusy(true);
    setMsg(null);
    setCopied(false);
    try {
      const r = await call<Issued>("issue", { ...f, ...(renewing && !f.requestCode.trim() ? { tenantId: renewing.id } : {}) });
      setIssued(r);
      void load();
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  function download(text: string, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text + "\r\n"], { type: "text/plain" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setMsg("Copy did not work here: select the key and copy it."); }
  }
  async function toggleHistory(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    try { setHist(await call<HistoryRow[]>("history", { tenantId: id })); } catch (e) { setMsg(errText(e)); }
  }

  const cats = data?.categories ?? [];
  const catLabel = (id: string) => cats.find((c) => c.id === id)?.label ?? id;
  const canGenerate = !!data?.signingReady && f.name.trim().length >= 2 && !!f.expires && (renewing ? true : !!req);
  const tenants = (data?.tenants ?? []).filter((t) => `${t.name} ${t.owner_name ?? ""} ${t.phone ?? ""} ${t.city ?? ""} ${t.installation_id}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <PageHeader title="Offline Tenants" />
      <p className="-mt-2 text-sm text-neutral-500">Businesses using a desktop edition without the internet (Mavin Pharmacy Offline). The business sends its request code; you generate the license key it enters in Settings › Mavin Pharmacy Offline › License.</p>
      {msg && <p className="whitespace-pre-line rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{msg}</p>}
      {data && !data.signingReady && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">License signing is not set up on the server yet: add OFFLINE_LICENSE_PRIVATE_KEY in Vercel (Production) and redeploy. Until then no license can be generated here.</p>
      )}

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-neutral-900">{renewing ? `Renew: ${renewing.name}` : "Issue a license"}</h2>
          {renewing && <Button className="ml-auto" onClick={() => { setRenewing(null); setF(empty); setIssued(null); }}>New tenant instead</Button>}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-neutral-500">Category
            <select value={f.category} onChange={set("category")} className={`mt-1 ${input}`}>
              {cats.map((c) => <option key={c.id} value={c.id} disabled={!c.available}>{c.label}{c.available ? "" : " (no offline edition yet)"}</option>)}
            </select>
          </label>
          <label className="text-xs text-neutral-500 md:col-span-2">Tenant (business) name *
            <input value={f.name} onChange={set("name")} className={`mt-1 ${input}`} placeholder="As it should appear on the license" />
          </label>
          <label className="text-xs text-neutral-500">Owner name<input value={f.ownerName} onChange={set("ownerName")} className={`mt-1 ${input}`} /></label>
          <label className="text-xs text-neutral-500">Phone<input value={f.phone} onChange={set("phone")} className={`mt-1 ${input}`} placeholder="03XXXXXXXXX" /></label>
          <label className="text-xs text-neutral-500">Email<input value={f.email} onChange={set("email")} className={`mt-1 ${input}`} /></label>
          <label className="text-xs text-neutral-500">City<input value={f.city} onChange={set("city")} className={`mt-1 ${input}`} /></label>
          <label className="text-xs text-neutral-500 md:col-span-2">Address<input value={f.address} onChange={set("address")} className={`mt-1 ${input}`} /></label>
          <label className="text-xs text-neutral-500 md:col-span-3">Notes (payment, invoice no., anything to remember)
            <input value={f.notes} onChange={set("notes")} className={`mt-1 ${input}`} />
          </label>
          <label className="text-xs text-neutral-500 md:col-span-3">Request code {renewing ? "(optional for a renewal: the installation is on record)" : "*"}
            <textarea value={f.requestCode} onChange={set("requestCode")} onBlur={() => void readCode(f.requestCode)} rows={3} placeholder="MAVIN-REQUEST-1.… (the business copies it from Settings › Mavin Pharmacy Offline › Show request code)" className={`mt-1 font-mono text-xs ${input}`} />
          </label>
          {(req || reqError) && (
            <p className={`text-sm md:col-span-3 ${reqError ? "text-rose-700" : "text-emerald-800"}`}>
              {reqError ?? `Installation ${req!.installationId}${req!.pharmacy ? ` · "${req!.pharmacy}"` : ""}${req!.appVersion ? ` · app ${req!.appVersion}` : ""}${data?.tenants.some((t) => t.installation_id === req!.installationId) ? " · already registered: this will be a renewal" : " · new: this will be its activation"}`}
            </p>
          )}
          <div className="text-xs text-neutral-500">Valid until *
            <input type="date" value={f.expires} min={ymd(new Date())} onChange={set("expires")} className={`mt-1 ${input}`} />
            <span className="mt-1 flex gap-1">
              {[["1 month", 1], ["6 months", 6], ["1 year", 12], ["2 years", 24]].map(([l, m]) => (
                <button key={String(l)} type="button" onClick={() => setF({ ...f, expires: plus(Number(m)) })} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-200">{l}</button>
              ))}
            </span>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" disabled={busy || !canGenerate} onClick={() => void generate()}>{busy ? "Generating…" : "Generate license key"}</Button>
        </div>

        {issued && (
          <div className="mt-4 space-y-2 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
            <p className="text-sm font-semibold text-emerald-900">License key generated ({issued.kind}) · valid until {day(issued.expiresAt)}</p>
            <p className="select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-neutral-900 ring-1 ring-emerald-200">{issued.licenseText}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void copy(issued.licenseText)}>{copied ? "Copied" : "Copy license key"}</Button>
              <Button onClick={() => download(issued.licenseText, issued.fileName)}>Download {issued.fileName}</Button>
            </div>
            <p className="text-xs text-emerald-900">Send the key (WhatsApp / email) or the file. At the business: Settings › Mavin Pharmacy Offline › License › paste it and click &quot;Import pasted license&quot;, or &quot;Import license file…&quot;. It works only on the computer whose request code was used.</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-neutral-900">Offline tenants ({data?.tenants.length ?? 0})</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, city, installation" className="ml-auto w-64 rounded-lg px-3 py-1.5 text-sm ring-1 ring-neutral-200" />
          <Button onClick={() => void load()}>Refresh</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-neutral-400">
              <tr><th className="py-1.5 pr-3">Tenant</th><th className="pr-3">Category</th><th className="pr-3">Contact</th><th className="pr-3">Installation</th><th className="pr-3">License</th><th className="pr-3">Licenses</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {tenants.map((t) => {
                const active = t.expires_at ? Date.parse(t.expires_at) > now : false;
                const days = t.expires_at ? Math.ceil((Date.parse(t.expires_at) - now) / 86_400_000) : null;
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td className="py-2 pr-3"><p className="font-medium text-neutral-900">{t.name}</p>{t.owner_name && <p className="text-xs text-neutral-500">{t.owner_name}</p>}</td>
                      <td className="pr-3">{catLabel(t.category)}</td>
                      <td className="pr-3 text-xs text-neutral-600">{[t.phone, t.email, t.city].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="pr-3 font-mono text-xs text-neutral-600" title={t.installation_id}>{t.installation_id.slice(0, 8)}…{t.app_version ? ` · v${t.app_version}` : ""}</td>
                      <td className="pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${active ? (days !== null && days <= 30 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200") : "bg-rose-50 text-rose-800 ring-rose-200"}`}>
                          {active ? `until ${day(t.expires_at)}` : `expired ${day(t.expires_at)}`}
                        </span>
                      </td>
                      <td className="pr-3"><button className="text-sky-700 hover:underline" onClick={() => void toggleHistory(t.id)}>{t.licenses} {open === t.id ? "▲" : "▼"}</button></td>
                      <td className="text-right"><Button onClick={() => renew(t)}>Renew</Button></td>
                    </tr>
                    {open === t.id && (
                      <tr><td colSpan={7} className="bg-neutral-50 px-3 py-2">
                        <ul className="space-y-1 text-xs">
                          {hist.map((h) => (
                            <li key={h.id} className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{h.kind}</span><span>issued {day(h.issued_at)}</span><span>valid until {day(h.expires_at)}</span>
                              <button className="text-sky-700 hover:underline" onClick={() => void copy(h.license_text)}>copy key</button>
                              <button className="text-sky-700 hover:underline" onClick={() => download(h.license_text, `${t.name.replace(/[^A-Za-z0-9]+/g, "-")}-${h.expires_at.slice(0, 10)}.lic`)}>download</button>
                            </li>
                          ))}
                          {t.notes && <li className="text-neutral-500">Notes: {t.notes}</li>}
                          {t.address && <li className="text-neutral-500">Address: {t.address}</li>}
                        </ul>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {tenants.length === 0 && <tr><td colSpan={7} className="py-4 text-neutral-400">{data ? "No offline tenants yet." : "Loading…"}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
