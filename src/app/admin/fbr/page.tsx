"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";
import { FbrScenarioWizard } from "@/components/admin/FbrScenarioWizard";

interface Overview {
  route: "gateway" | "direct";
  storageReady: boolean;
  gateway: { configured: boolean; ok: boolean | null; version?: string; uptimeSec?: number; ms?: number; error?: string };
  tenants: { id: string; name: string; fbr_allowed: number | null; enabled: string | null; environment: string | null; has_sandbox: number | null; has_production: number | null; accepted_30d: number; rejected_30d: number; open_uncertain: number; last_accepted: string | null }[];
  problems: { id: string; tenant_id: string; tenant_name: string | null; doc_type: string; doc_id: string; environment: string; route: string; status: string; http_status: number | null; error: string | null; created_at: string }[];
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "—");
const dot = (ok: boolean | null) => (ok === null ? "bg-neutral-300" : ok ? "bg-emerald-500" : "bg-rose-500");
const STATUS: Record<string, string> = { uncertain: "Unclear", pending: "Sending / stalled", rejected: "Rejected", not_received: "Not received", accepted: "Accepted" };

/** Super Admin > FBR Integration: the gateway's health, each business's FBR
 * set-up and recent submissions needing attention. Tokens are never shown.
 * Switching FBR off for a business: Tenants > (business) > FBR.
 * Scenario Testing: FBR sandbox scenarios for one business (FbrScenarioWizard). */
export default function AdminFbrPage() {
  const [o, setO] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [checkingIp, setCheckingIp] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setO(await serverJson<Overview>("/api/fbr/", { action: "overview" })); setMsg(null); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function checkIp() {
    setCheckingIp(true);
    try { setIp((await serverJson<{ ip: string }>("/api/fbr/", { action: "egress" })).ip); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setCheckingIp(false);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="FBR Integration" />
      {msg && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{msg}</p>}
      {testing && <FbrScenarioWizard tenantId={testing} onClose={() => { setTesting(null); void load(); }} />}
      {o && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Route</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900">{o.route === "gateway" ? "MAVIN FBR gateway (static IP)" : "Direct from each shop (no gateway set)"}</p>
              <p className="mt-1 text-xs text-neutral-500">{o.route === "gateway" ? "Every business's invoices reach FBR from the gateway's IP." : "Set FBR_GATEWAY_URL and FBR_GATEWAY_SECRET on the server to use the gateway."}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Gateway</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                <span className={`h-2 w-2 rounded-full ${dot(o.gateway.ok)}`} />
                {!o.gateway.configured ? "Not configured" : o.gateway.ok ? "Healthy" : "Not reachable"}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {o.gateway.configured && (o.gateway.ok ? `v${o.gateway.version} · up ${Math.round((o.gateway.uptimeSec ?? 0) / 3600)} h · ${o.gateway.ms} ms` : o.gateway.error ?? "")}
              </p>
              {o.gateway.configured && (
                <div className="mt-2 flex items-center gap-2">
                  <Button onClick={() => void checkIp()} disabled={checkingIp}>{checkingIp ? "Checking…" : "Check outbound IP"}</Button>
                  {ip && <span className="font-mono text-sm text-neutral-900">{ip}</span>}
                </div>
              )}
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Token storage</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-neutral-900"><span className={`h-2 w-2 rounded-full ${dot(o.storageReady)}`} />{o.storageReady ? "Encrypted (FBR_TOKEN_KEY set)" : "Not set up (FBR_TOKEN_KEY missing)"}</p>
              <p className="mt-1 text-xs text-neutral-500">Tokens are never shown here.</p>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="mb-2 flex items-center">
              <h2 className="text-sm font-semibold text-neutral-900">Businesses using FBR</h2>
              <Button className="ml-auto" onClick={() => void load()}>Refresh</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-neutral-400">
                  <tr><th className="py-1.5 pr-3">Business</th><th className="pr-3">FBR</th><th className="pr-3">Environment</th><th className="pr-3">Tokens</th><th className="pr-3">Accepted (30 d)</th><th className="pr-3">Rejected (30 d)</th><th className="pr-3">Unclear now</th><th className="pr-3">Last accepted</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {o.tenants.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1.5 pr-3 font-medium text-neutral-900"><Link href="/admin/tenants" className="hover:underline">{t.name}</Link></td>
                      <td className="pr-3">{Number(t.fbr_allowed ?? 1) === 0 ? <span className="text-rose-600">Switched off</span> : t.enabled === "true" ? "On" : "Off"}</td>
                      <td className="pr-3">{t.environment === "production" ? <span className="font-medium text-emerald-700">Production</span> : "Sandbox"}</td>
                      <td className="pr-3">{[t.has_sandbox ? "Sandbox" : null, t.has_production ? "Production" : null].filter(Boolean).join(", ") || <span className="text-amber-700">None saved</span>}</td>
                      <td className="pr-3">{t.accepted_30d}</td>
                      <td className="pr-3">{t.rejected_30d}</td>
                      <td className={`pr-3 ${t.open_uncertain ? "font-semibold text-amber-700" : ""}`}>{t.open_uncertain}</td>
                      <td className="pr-3">{when(t.last_accepted)}</td>
                      <td className="py-1 text-right"><Button onClick={() => setTesting(t.id)}>Scenario Testing</Button></td>
                    </tr>
                  ))}
                  {o.tenants.length === 0 && <tr><td colSpan={9} className="py-3 text-neutral-400">No business has FBR on yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <h2 className="mb-1 text-sm font-semibold text-neutral-900">Recent submissions needing attention</h2>
            <p className="mb-2 text-xs text-neutral-500">Unclear ones are resolved by the business (Settings &gt; FBR) after checking IRIS / the PRAL portal; MAVIN never re-sends them by itself.</p>
            <ul className="divide-y divide-neutral-100 text-xs">
              {o.problems.map((p) => (
                <li key={p.id} className="py-2">
                  <span className="font-medium text-neutral-900">{p.tenant_name ?? p.tenant_id}</span>
                  <span className="text-neutral-500"> · {p.doc_type === "invoice" ? "invoice" : "store invoice"} · {p.environment} · {p.route} · {when(p.created_at)}</span>
                  <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">{STATUS[p.status] ?? p.status}{p.http_status ? ` (HTTP ${p.http_status})` : ""}</span>
                  {p.error && <p className="mt-0.5 whitespace-pre-line text-neutral-600">{p.error}</p>}
                </li>
              ))}
              {o.problems.length === 0 && <li className="py-2 text-neutral-400">Nothing needs attention.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
