"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { printDirect } from "@/lib/print";
import { localDateTime } from "@/lib/localDate";
import { hospitalHeader } from "@/lib/repo/hospitalCare";
import { myOpenCollections, closeMyDay, closingPayments, METHOD_LABEL, type CashClosing, type PaymentRow, type Totals } from "@/lib/repo/cashClosing";

export const rs = (n: number) => Number(n).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const when = (s: string | null) => (s ? s.replace("T", " ").slice(0, 16) : "—");
const err = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));

/** Totals by method, as a small table. */
export function TotalsTable({ t, expectedCash }: { t: Totals; expectedCash: number }) {
  const rows: [string, number][] = [["Cash", t.cash], ["Card", t.card], ["Online transfer", t.online], ["Bank deposit", t.bank]];
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([l, v]) => <tr key={l}><td className="py-0.5 text-neutral-600">{l}</td><td className="py-0.5 text-right tabular-nums">{rs(v)}</td></tr>)}
        {t.refunds > 0 && <tr><td className="py-0.5 text-neutral-600">Refunds paid out</td><td className="py-0.5 text-right tabular-nums">−{rs(t.refunds)}</td></tr>}
        <tr className="border-t border-neutral-300 font-semibold"><td className="py-0.5">Net collected ({t.count} entries)</td><td className="py-0.5 text-right tabular-nums">{rs(t.net)}</td></tr>
        <tr className="font-semibold text-emerald-800"><td className="py-0.5">Cash that should be in the drawer</td><td className="py-0.5 text-right tabular-nums">{rs(expectedCash)}</td></tr>
      </tbody>
    </table>
  );
}

/** The signed-in user's collections since their last closing, and closing the day. */
export function CloseDayModal({ onClose, onClosed }: { onClose: () => void; onClosed?: (c: CashClosing) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof myOpenCollections>> | null>(null);
  const [counted, setCounted] = useState("");
  const [handedTo, setHandedTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<CashClosing | null>(null);
  useEffect(() => { void myOpenCollections().then(setData).catch(err); }, []);
  const diff = data && counted.trim() !== "" ? Math.round((Number(counted) - data.expectedCash) * 100) / 100 : null;

  async function close() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const c = await closeMyDay({ countedCash: Number(counted), handedTo, note });
      setClosed(c);
      onClosed?.(c);
    } catch (e) { err(e); } finally { setBusy(false); }
  }

  if (closed) return <ClosingSlipModal closing={closed} onClose={onClose} />;
  return (
    <Modal title="Close my day" onClose={onClose}>
      {!data ? <p className="text-sm text-neutral-400">Loading…</p> : data.rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing has been collected since your last closing.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-neutral-500">Everything you collected since {when(data.since)}. Count the cash in your drawer and enter it below.</p>
          <TotalsTable t={data.totals} expectedCash={data.expectedCash} />
          <details className="text-xs">
            <summary className="cursor-pointer text-neutral-600">Show the {data.rows.length} entries</summary>
            <PaymentList rows={data.rows} />
          </details>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cash counted (Rs)" required><Input id="cd-counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
            <Field label="Handed over to"><Input id="cd-to" value={handedTo} placeholder="Accountant / cashier name" onChange={(e) => setHandedTo(e.target.value)} /></Field>
          </div>
          {diff !== null && diff !== 0 && (
            <p className={`rounded-lg px-3 py-2 text-sm ${diff < 0 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>
              {diff < 0 ? `Short by Rs ${rs(-diff)}` : `Rs ${rs(diff)} more than expected`}. Write what happened.
            </p>
          )}
          <Field label="Note"><Textarea id="cd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || counted.trim() === ""} onClick={() => void close()}>{busy ? "Closing…" : "Close my day"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function PaymentList({ rows }: { rows: PaymentRow[] }) {
  return (
    <div className="mt-1 max-h-60 overflow-y-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-neutral-500"><th className="pr-2 font-medium">Time</th><th className="pr-2 font-medium">Patient</th><th className="pr-2 font-medium">For</th><th className="pr-2 font-medium">Method</th><th className="text-right font-medium">Rs</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-neutral-100">
              <td className="pr-2 tabular-nums">{when(r.received_at)}</td>
              <td className="pr-2">{r.patient_name} <span className="text-neutral-400">{r.episode_no}</span></td>
              <td className="pr-2">{r.notes ?? r.reference ?? "—"}</td>
              <td className="pr-2">{METHOD_LABEL[r.method] ?? r.method}</td>
              <td className={`text-right tabular-nums ${r.type === "refund" ? "text-rose-700" : ""}`}>{r.type === "refund" ? "−" : ""}{rs(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A day closing as a printable slip. */
export function ClosingSlipModal({ closing: c, onClose, actions }: { closing: CashClosing; onClose: () => void; actions?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hospital, setHospital] = useState<{ name: string; address: string | null; phone: string | null } | null>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  useEffect(() => {
    void hospitalHeader().then(setHospital).catch(() => undefined);
    void closingPayments(c.id).then(setRows).catch(() => undefined);
  }, [c.id]);
  const t: Totals = { count: c.payments_count, cash: c.cash, card: c.card, online: c.online, bank: c.bank, refunds: c.refunds, net: c.net_total };
  return (
    <Modal title={`Day closing ${c.closing_no}`} onClose={onClose}>
      <div ref={ref} className="print-area mx-auto w-full max-w-[140mm] bg-white text-[12px] text-neutral-900">
        <div className="border-b-2 border-neutral-800 pb-1.5 text-center">
          <p className="text-base font-bold leading-tight">{hospital?.name ?? ""}</p>
          <p className="mt-1 text-sm font-semibold tracking-wide">CASH CLOSING</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-b border-neutral-300 py-1.5 text-[11px]">
          <p><span className="text-neutral-500">Closing:</span> <span className="font-mono">{c.closing_no}</span></p>
          <p><span className="text-neutral-500">By:</span> <b>{c.user_name}</b>{c.desk ? ` · ${c.desk}` : ""}</p>
          <p><span className="text-neutral-500">From:</span> {when(c.from_at)}</p>
          <p><span className="text-neutral-500">To:</span> {when(c.to_at)}</p>
        </div>
        <div className="py-1.5"><TotalsTable t={t} expectedCash={Math.round((c.cash - c.refunds) * 100) / 100} /></div>
        <div className="grid grid-cols-2 gap-x-4 border-t border-neutral-300 py-1.5 text-[12px]">
          <p><span className="text-neutral-500">Cash counted:</span> <b className="tabular-nums">{rs(c.counted_cash)}</b></p>
          <p className={c.difference < 0 ? "font-semibold text-rose-700" : c.difference > 0 ? "font-semibold text-amber-700" : ""}>
            <span className="text-neutral-500">Difference:</span> {c.difference === 0 ? "None" : `${c.difference > 0 ? "+" : "−"}${rs(Math.abs(c.difference))}`}
          </p>
          {c.handed_to && <p className="col-span-2"><span className="text-neutral-500">Handed to:</span> {c.handed_to}</p>}
          {c.note && <p className="col-span-2"><span className="text-neutral-500">Note:</span> {c.note}</p>}
          <p className="col-span-2"><span className="text-neutral-500">Status:</span> {c.status === "verified" ? `Verified by ${c.verified_by_name}, ${when(c.verified_at)}${c.verify_note ? ` (${c.verify_note})` : ""}` : "Waiting for verification"}</p>
        </div>
        {rows.length > 0 && <PaymentList rows={rows} />}
        <div className="mt-6 grid grid-cols-2 gap-8 text-center text-[11px] text-neutral-600">
          <p className="border-t border-neutral-400 pt-1">Receptionist</p>
          <p className="border-t border-neutral-400 pt-1">Received by</p>
        </div>
        <p className="mt-3 text-center text-[10px] text-neutral-500">Printed {localDateTime()}</p>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
        {actions}
        <Button variant="primary" onClick={() => void printDirect("a5", ref.current).catch(err)}><Printer size={14} className="mr-1" />Print</Button>
      </div>
    </Modal>
  );
}
