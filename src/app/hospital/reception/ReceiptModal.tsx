"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { printDirect } from "@/lib/print";
import { localDateTime } from "@/lib/localDate";
import { visitReceiptFor, collectVisitFees, type FeeScope, type ScopedReceipt } from "@/lib/repo/receptionFees";
import type { PaymentMethod } from "@/lib/types-hospital";

const METHOD: Record<string, string> = { cash: "Cash", card: "Card", online: "Online transfer", bank: "Bank deposit" };
const rs = (n: number) => n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const when = (s: string) => s.replace("T", " ").slice(0, 16);

const TITLE: Record<FeeScope, string> = { all: "PAYMENT RECEIPT", lab: "LABORATORY PAYMENT RECEIPT", imaging: "RADIOLOGY PAYMENT RECEIPT" };

/** The payment receipt of a visit (opened from the Due amount): every charge,
 * every payment, and the balance; at the lab or radiology counter only that
 * department's charges. Collecting the balance marks each test / scan paid. */
export function ReceiptModal({ episodeId, scope = "all", onClose, onChanged }: { episodeId: string; scope?: FeeScope; onClose: () => void; onChanged: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [r, setR] = useState<ScopedReceipt | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);

  const load = () => visitReceiptFor(episodeId, scope).then(setR).catch((e) => window.alert(`Could not load the receipt: ${e instanceof Error ? e.message : String(e)}`));
  useEffect(() => { void load(); }, [episodeId, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  async function collect() {
    if (!r || busy || !(r.due > 0)) return;
    if (!window.confirm(`Take Rs ${rs(r.due)} from ${r.patient?.name ?? "the patient"} by ${METHOD[method]}?`)) return;
    setBusy(true);
    try {
      await collectVisitFees(r.episode.id, scope, method);
      await load();
      onChanged();
    } catch (e) {
      window.alert(`Could not take the payment: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    try {
      await printDirect("a5", areaRef.current);
    } catch (e) {
      window.alert(`Could not print: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Modal title="Payment receipt" onClose={onClose}>
      {!r ? <p className="text-sm text-neutral-400">Loading…</p> : (
        <>
          <div ref={areaRef} className="print-area mx-auto w-full max-w-[140mm] bg-white text-[12px] text-neutral-900">
            <div className="border-b-2 border-neutral-800 pb-1.5 text-center">
              <p className="text-base font-bold leading-tight">{r.hospital.name}</p>
              {(r.hospital.address || r.hospital.phone) && <p className="text-[11px] text-neutral-600">{[r.hospital.address, r.hospital.phone].filter(Boolean).join(" · ")}</p>}
              <p className="mt-1 text-sm font-semibold tracking-wide">{TITLE[scope]}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-b border-neutral-300 py-1.5 text-[11px]">
              <p><span className="text-neutral-500">Receipt / Visit:</span> <span className="font-mono">{r.episode.episode_no}</span></p>
              <p><span className="text-neutral-500">Date:</span> {r.episode.date}{r.episode.token_no ? ` · Token ${r.episode.token_no}` : ""}</p>
              <p><span className="text-neutral-500">Patient:</span> <b>{r.patient?.name ?? "—"}</b></p>
              <p><span className="text-neutral-500">MR No:</span> <span className="font-mono">{r.patient?.mr_no ?? "—"}</span></p>
              {r.doctorName && <p><span className="text-neutral-500">Doctor:</span> {r.doctorName}</p>}
              {r.episode.department && <p><span className="text-neutral-500">Department:</span> {r.episode.department}</p>}
            </div>

            <table className="mt-1.5 w-full text-left">
              <thead><tr className="border-b border-neutral-400 text-[10px] uppercase tracking-wide text-neutral-600">
                <th className="py-0.5 pr-2 font-semibold">Service</th><th className="py-0.5 pr-2 text-right font-semibold">Qty</th><th className="py-0.5 text-right font-semibold">Amount (Rs)</th>
              </tr></thead>
              <tbody>
                {r.charges.length === 0 && <tr><td colSpan={3} className="py-1 text-neutral-500">{scope === "all" ? "No charges on this visit." : `No ${scope === "lab" ? "lab" : "radiology"} charges on this visit.`}</td></tr>}
                {r.charges.map((c) => (
                  <tr key={c.id} className="border-b border-neutral-100">
                    <td className="py-0.5 pr-2">
                      {c.description}{c.discount_pct ? <span className="text-neutral-500"> (−{c.discount_pct}%)</span> : null}
                      {c.id in r.chargePaid ? <span className={`ml-1 text-[10px] font-semibold ${r.chargePaid[c.id] ? "text-emerald-700" : "text-rose-600"}`}>{r.chargePaid[c.id] ? "PAID" : "UNPAID"}</span> : null}
                    </td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{c.qty}</td>
                    <td className="py-0.5 text-right tabular-nums">{rs(Number(c.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {r.payments.length > 0 && (
              <table className="mt-2 w-full text-left text-[11px]">
                <thead><tr className="border-b border-neutral-300 text-[10px] uppercase tracking-wide text-neutral-600">
                  <th className="py-0.5 pr-2 font-semibold">Received</th><th className="py-0.5 pr-2 font-semibold">Method</th><th className="py-0.5 text-right font-semibold">Rs</th>
                </tr></thead>
                <tbody>
                  {r.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-0.5 pr-2">{when(p.received_at)}{p.type === "refund" ? " · Refund" : p.type === "deposit" ? " · Deposit" : ""}</td>
                      <td className="py-0.5 pr-2">{METHOD[p.method] ?? p.method}{p.reference ? <span className="text-neutral-500"> · {p.reference}</span> : null}</td>
                      <td className="py-0.5 text-right tabular-nums">{p.type === "refund" ? "−" : ""}{rs(Number(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="ml-auto mt-2 w-56 text-[12px]">
              <div className="flex justify-between"><span>Total</span><span className="tabular-nums">{rs(r.total)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span className="tabular-nums">{rs(r.paid)}</span></div>
              <div className="mt-0.5 flex justify-between border-t border-neutral-800 pt-0.5 font-bold">
                <span>{r.due > 0 ? "Balance due" : r.due < 0 ? "Advance / refundable" : "Balance"}</span><span className="tabular-nums">{rs(Math.abs(r.due))}</span>
              </div>
            </div>
            <p className="mt-3 text-center text-[10px] text-neutral-500">Printed {when(localDateTime())}. Thank you.</p>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
            {r.due > 0 && (
              <>
                <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="!w-40" aria-label="Payment method">
                  {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Button onClick={() => void collect()} disabled={busy}>{busy ? "…" : `Collect Rs ${rs(r.due)}`}</Button>
              </>
            )}
            <Button variant="primary" onClick={() => void print()}><Printer size={14} className="mr-1" />Print receipt</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
