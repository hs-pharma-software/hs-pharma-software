"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { PaymentsManager, payApi } from "@/components/payments/PaymentsManager";

interface Overview {
  merchants: { tenantId: string | null; tenantName: string; provider: string; environment: string; status: string; enabled: boolean; lastTestOk: boolean | null; lastTestAt: string | null }[];
  pendingRequests: number; inReview: number; secretsReady: boolean; providers: { id: string; label: string; integrationReady: boolean }[];
}
interface Req { id: string; tenantId: string; tenantName: string | null; methods: string[]; note: string | null; status: string; decisionNote: string | null; createdAt: string }

/** Super Admin > Payments: readiness across businesses, requests to approve,
 * and MAVIN.pk's own merchant account for subscription payments.
 * Per-business switches are in Tenants > (business) > Permissions > Payments. */
export default function AdminPaymentsPage() {
  const [o, setO] = useState<Overview | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [ov, r] = await Promise.all([payApi<Overview>("overview"), payApi<Req[]>("requests")]);
      setO(ov);
      setReqs(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (r: Req, approve: boolean) => {
    const note = approve ? "" : prompt(`Why is the request from ${r.tenantName ?? "this business"} not approved?`);
    if (!approve && !note) return;
    try { await payApi("decide", { id: r.id, approve, note }); setMsg(approve ? "Approved: the requested switches are on for that business." : "Rejected."); void load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Payments" />
      {msg && <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800">{msg}</p>}
      {o && (
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm"><p className="text-neutral-500">Requests waiting</p><p className="text-2xl font-semibold tabular-nums">{o.pendingRequests}</p></div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm"><p className="text-neutral-500">Payments to review</p><p className="text-2xl font-semibold tabular-nums">{o.inReview}</p></div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
            <p className="text-neutral-500">Provider connections</p>
            {o.providers.map((p) => <p key={p.id}>{p.label}: <b>{p.integrationReady ? "built" : "waiting for official kit"}</b></p>)}
            {!o.secretsReady && <p className="mt-1 text-amber-700">PAYMENTS_SECRET_KEY is not set on the server.</p>}
          </div>
        </section>
      )}
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Requests from businesses</h2>
        {!reqs.length ? <p className="text-sm text-neutral-500">No requests.</p> : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {reqs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-neutral-900">{r.tenantName ?? r.tenantId}</p>
                  <p className="text-xs text-neutral-600">{r.methods.join(", ")}{r.note ? ` · ${r.note}` : ""} · {new Date(r.createdAt).toLocaleDateString("en-PK")}</p>
                  {r.decisionNote && <p className="text-xs text-neutral-500">{r.decisionNote}</p>}
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => void decide(r, true)}>Approve</Button>
                    <Button onClick={() => void decide(r, false)}>Reject</Button>
                  </div>
                ) : <span className="text-xs text-neutral-500">{r.status}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {o && o.merchants.some((m) => m.tenantId) && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Business connections</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="py-1">Business</th><th>Provider</th><th>Environment</th><th>Status</th><th>Last test</th></tr></thead>
              <tbody>
                {o.merchants.filter((m) => m.tenantId).map((m) => (
                  <tr key={`${m.tenantId}-${m.provider}-${m.environment}`} className="border-t border-neutral-100">
                    <td className="py-1.5">{m.tenantName}</td><td>{m.provider}</td><td>{m.environment}</td><td>{m.enabled ? "active" : m.status}</td>
                    <td>{m.lastTestOk == null ? "—" : m.lastTestOk ? "passed" : "not passed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <h2 className="pt-2 text-base font-semibold text-neutral-900">MAVIN.pk&apos;s own account (subscription payments)</h2>
      <PaymentsManager tenantId={null} />
    </div>
  );
}
