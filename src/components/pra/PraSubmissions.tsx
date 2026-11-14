"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";

export interface PraSub {
  id: string; sourceId: string; branchId: string | null; posId: string; environment: string; usin: string; refUsin: string | null; invoiceType: number;
  status: string; attempts: number; fiscalInvoiceNo: string | null; responseCode: string | null; responseText: string | null; blockedReason: string | null;
  saleValue: number; salesTax: number; praWithholding: number; incomeTaxWithholding: number; total: number; paymentMethods: string[]; praPaymentMode: number | null;
  rule: { ruleKey: string; version: number; classification: string | null } | null; sentAt: string | null; acceptedAt: string | null; createdAt: string;
}

export const PRA_STATE_LABEL: Record<string, string> = {
  disabled: "Disabled", setup_required: "Setup required", sandbox_ready: "Sandbox ready", awaiting_whitelist: "Awaiting whitelist",
  ready_for_approval: "Ready for approval", live: "Live", suspended: "Suspended",
};
export const PRA_SUB_LABEL: Record<string, string> = {
  sending: "Sending", queued: "Queued (not sent yet)", accepted: "Accepted", rejected: "Rejected by PRA", needs_reconciliation: "Needs reconciliation", blocked: "Blocked (not sent)", legacy: "Sent by desktop sender",
};
const TONE: Record<string, string> = {
  accepted: "bg-emerald-100 text-emerald-800", rejected: "bg-rose-100 text-rose-800", needs_reconciliation: "bg-amber-100 text-amber-900", blocked: "bg-amber-100 text-amber-900",
  queued: "bg-sky-100 text-sky-800", sending: "bg-sky-100 text-sky-800", legacy: "bg-neutral-100 text-neutral-700",
};
const call = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<{ result: T }>("/api/pra/", { action, ...body }).then((r) => r.result);
const money = (n: number) => `Rs ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A business's PRA submissions (branch-scoped by the server), with the portal-check actions for the owner / Super Admin. */
export function PraSubmissions({ tenantId, canReconcile }: { tenantId?: string; canReconcile: boolean }) {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<PraSub[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setRows(await call<PraSub[]>("list", { tenantId, status: status || undefined })); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  }, [tenantId, status]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await load(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  };
  const counts = (rows ?? []).reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {["", "needs_reconciliation", "blocked", "rejected", "queued", "accepted"].map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs ${status === s ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
            {s ? `${PRA_SUB_LABEL[s]}${counts[s] && !status ? ` (${counts[s]})` : ""}` : "All"}
          </button>
        ))}
        <Button onClick={() => void act(() => call("process", { tenantId }), "Pending bills checked and sent.")}>Send pending now</Button>
        <Button variant="ghost" onClick={() => void load()}>Refresh</Button>
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>{msg.text}</p>}
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr><th className="px-3 py-2">USIN</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">POS / env</th><th className="px-3 py-2 text-end">Sale value</th><th className="px-3 py-2 text-end">Sales tax</th><th className="px-3 py-2">Payment</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-neutral-100 align-top">
                <td className="px-3 py-2 font-medium">{r.usin}<span className="block text-[11px] text-neutral-500">{r.createdAt.slice(0, 16).replace("T", " ")}</span></td>
                <td className="px-3 py-2 text-xs">{r.invoiceType === 3 ? `Credit of ${r.refUsin}` : r.invoiceType === 2 ? "Debit" : "New"}</td>
                <td className="px-3 py-2 text-xs">{r.posId}<span className="block text-neutral-500">{r.environment}</span></td>
                <td className="px-3 py-2 text-end tabular-nums">{money(r.saleValue)}</td>
                <td className="px-3 py-2 text-end tabular-nums">{money(r.salesTax)}{r.rule && <span className="block text-[10px] text-neutral-500">{r.rule.ruleKey} v{r.rule.version}</span>}</td>
                <td className="px-3 py-2 text-xs">{r.paymentMethods.join(" + ") || "—"}{r.praPaymentMode != null && <span className="block text-neutral-500">PRA mode {r.praPaymentMode}</span>}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.status] ?? "bg-neutral-100"}`}>{PRA_SUB_LABEL[r.status] ?? r.status}</span>
                  {r.fiscalInvoiceNo && <span className="block font-mono text-[11px]">{r.fiscalInvoiceNo}</span>}
                  {(r.blockedReason || (r.status !== "accepted" && r.responseText)) && <span className="block max-w-xs text-[11px] text-neutral-600">{r.blockedReason ?? r.responseText}{r.responseCode ? ` (code ${r.responseCode})` : ""}</span>}
                </td>
                <td className="space-y-1 px-3 py-2 text-end">
                  {canReconcile && (r.status === "needs_reconciliation" || r.status === "legacy") && (
                    <Button onClick={() => {
                      const no = prompt(`Invoice ${r.usin}: check PRA's IRIS IMS Fiscal Report (e.pra.punjab.gov.pk).\n\nIf PRA shows it, enter the PRA fiscal invoice number exactly as shown:`);
                      if (no) void act(() => call("reconcile", { tenantId, id: r.id, found: true, fiscalNo: no.trim() }), "Recorded as accepted.");
                    }}>Found on PRA</Button>
                  )}
                  {canReconcile && (r.status === "needs_reconciliation" || r.status === "rejected") && (
                    <Button onClick={() => {
                      if (confirm(r.status === "rejected" ? `Send invoice ${r.usin} again (after fixing what PRA refused)?` : `Invoice ${r.usin} is NOT on PRA's IRIS IMS Fiscal Report? It will be sent again.`))
                        void act(() => call("reconcile", { tenantId, id: r.id, found: false }), "Queued to send again.");
                    }}>{r.status === "rejected" ? "Send again" : "Not on PRA"}</Button>
                  )}
                </td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">No PRA submissions.</td></tr>}
            {!rows && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The business's own view (owner / staff): state, and what to do. */
export function PraServerStatus() {
  const [s, setS] = useState<{ managed: boolean; state: string } | null>(null);
  const [setupData, setSetup] = useState<{ counters: { counter: string; branchId: string; environment: string; status: string; sector: string }[]; branches: { id: string; name: string }[] } | null>(null);
  useEffect(() => {
    void call<{ managed: boolean; state: string }>("status").then(setS).catch(() => setS(null));
    void call<typeof setupData>("setup").then(setSetup).catch(() => setSetup(null));
  }, []);
  if (!s) return null;
  return (
    <div className="space-y-2 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/[0.05]">
      <h2 className="text-base font-semibold">PRA e-Invoicing by MAVIN.pk · <span className="text-sky-800">{PRA_STATE_LABEL[s.state] ?? s.state}</span></h2>
      <p className="text-neutral-600">
        Your bills are sent to PRA by MAVIN&apos;s server for the counters PRA registered. Setup, POS IDs and going live are handled by MAVIN.pk; ask them to change anything.
        A receipt shows the PRA fiscal number only once PRA has accepted the bill.
      </p>
      {setupData?.counters?.length ? (
        <ul className="text-xs text-neutral-700">
          {setupData.counters.map((c, i) => <li key={i}>{setupData.branches.find((b) => b.id === c.branchId)?.name ?? c.branchId} · counter {c.counter} · {c.sector} · {c.environment} · {c.status}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
