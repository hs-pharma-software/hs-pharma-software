"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Printer, Repeat } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { printDirect } from "@/lib/print";
import { buildLedger, dayMonthYear, formatStockQty, inLooseUnits, type LedgerView, type MoveKind, type QtyUnits } from "@/lib/stockLedger";

const TONE: Record<MoveKind, string> = {
  purchase: "bg-emerald-50 text-emerald-800", sale: "bg-sky-50 text-sky-800", sale_return: "bg-amber-50 text-amber-800",
  purchase_return: "bg-amber-50 text-amber-800", transfer_in: "bg-violet-50 text-violet-800", transfer_out: "bg-violet-50 text-violet-800",
  issue: "bg-sky-50 text-sky-800", return_in: "bg-amber-50 text-amber-800", dead: "bg-rose-50 text-rose-800", wastage: "bg-rose-50 text-rose-800",
  adjust: "bg-neutral-100 text-neutral-700", opening: "bg-neutral-100 text-neutral-700", correction: "bg-neutral-100 text-neutral-700",
};
const th = "pb-1.5 pr-3 font-medium";
const td = "py-2 pr-3 align-top";

/** A quantity, with the same in loose units under it when it has whole packs. */
function Qty({ n, units, className = "" }: { n: number; units: QtyUnits; className?: string }) {
  const loose = inLooseUnits(n, units);
  return (
    <span className={`tabular-nums ${className}`}>
      <span className="whitespace-nowrap">{formatStockQty(n, units)}</span>
      {loose && <span className="block whitespace-nowrap text-[11px] font-normal text-neutral-500">{loose}</span>}
    </span>
  );
}

/** One product's stock history: what is available (large, at the top), then
 * every purchase with its distributor, every sale with its invoice number, and
 * the stock left after each. A change of distributor is marked. */
export function ProductLedger({ load, onBack, printable = true }: {
  /** Reads the product; pass a stable function (useCallback) so it is read once. */
  load: () => Promise<LedgerView>;
  onBack?: () => void;
  /** False when the page around it has its own Print button. */
  printable?: boolean;
}) {
  const [view, setView] = useState<LedgerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setView(null);
    setError(null);
    void load().then((v) => { if (current) setView(v); }).catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : String(e)); });
    return () => { current = false; };
  }, [load]);

  const ledger = useMemo(() => (view ? buildLedger(view.moves, view.available, { from, to }) : null), [view, from, to]);
  const badRange = Boolean(from && to && to < from);

  async function print() {
    try { await printDirect("a4", area.current); }
    catch (e) { setError(`Could not print: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        {onBack && <Button onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />Back to register</Button>}
        <Field label="History from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="History to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {(from || to) && <Button onClick={() => { setFrom(""); setTo(""); }}>All dates</Button>}
        {printable && <Button onClick={() => void print()} disabled={!view}><Printer size={14} aria-hidden="true" />Print A4</Button>}
      </div>
      {error && <p role="alert" className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not show the history: {error}</p>}
      {badRange && <p role="alert" className="mb-2 text-sm text-rose-700">The To date is before the From date.</p>}
      {!view || !ledger ? (!error && <p className="text-sm text-neutral-500">Loading history…</p>) : (
        <div ref={area} className={printable ? "print-area" : undefined}>
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-neutral-200 p-4">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-neutral-900">{view.name}</h3>
              <p className="text-sm text-neutral-600">{[view.company, view.generic].filter(Boolean).join(" · ") || "No company or generic name"}</p>
              {ledger.suppliers.length > 0 && (
                <p className="mt-1 text-sm text-neutral-600">
                  {ledger.suppliers.length > 1 ? "Distributors: " : "Distributor: "}
                  {ledger.suppliers.map((s, i) => (
                    <span key={`${s.name}-${s.since}`}>
                      {i > 0 && <span aria-label="then"> → </span>}
                      <span className={i === ledger.suppliers.length - 1 ? "font-semibold text-neutral-900" : ""}>{s.name}</span>
                      {ledger.suppliers.length > 1 && s.since && <span className="text-neutral-500"> ({dayMonthYear(s.since)})</span>}
                    </span>
                  ))}
                </p>
              )}
            </div>
            <div className={`rounded-xl px-4 py-2 text-right ${ledger.available > 0 ? "bg-emerald-50" : "bg-rose-50"}`}>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-600">Available stock</p>
              <p className={`text-3xl font-extrabold tabular-nums ${ledger.available > 0 ? "text-emerald-800" : "text-rose-700"}`}>
                {ledger.available > 0 ? formatStockQty(ledger.available, view.units) : "Out of stock"}
              </p>
              {ledger.available > 0 && inLooseUnits(ledger.available, view.units) && <p className="text-sm font-bold tabular-nums text-emerald-800">{inLooseUnits(ledger.available, view.units)}</p>}
            </div>
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            {from || to ? `${from ? dayMonthYear(from) : "Beginning"} to ${to ? dayMonthYear(to) : "today"}` : "All dates"}
            {" · "}In {formatStockQty(ledger.totalIn, view.units)} · Out {formatStockQty(ledger.totalOut, view.units)}
            {to ? ` · Stock at the end: ${formatStockQty(ledger.closing, view.units)}` : ""}
          </p>

          {ledger.entries.length === 0 && ledger.broughtForward === null ? <p className="mt-2 text-sm text-neutral-500">No stock movement recorded.</p> : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead><tr className="text-xs text-neutral-500">
                  <th className={th}>Date</th><th className={th}>Entry</th><th className={th}>Distributor / customer</th>
                  <th className={`${th} text-right`}>In</th><th className={`${th} text-right`}>Out</th><th className="pb-1.5 text-right font-medium">Stock after</th>
                </tr></thead>
                <tbody>
                  {ledger.broughtForward !== null && (
                    <tr className="border-t border-neutral-100 bg-neutral-50">
                      <td className={td}>{dayMonthYear(from)}</td><td className={td} colSpan={4}>Stock brought forward</td>
                      <td className="py-2 text-right align-top font-bold"><Qty n={ledger.broughtForward} units={view.units} /></td>
                    </tr>
                  )}
                  {ledger.entries.map((e) => (
                    <tr key={e.id} className="border-t border-neutral-100">
                      <td className={`${td} whitespace-nowrap`}>{e.date ? dayMonthYear(e.date) : "—"}</td>
                      <td className={td}>
                        <span className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold ${TONE[e.kind]}`}>{e.label}</span>
                        {e.ref && <span className="block text-xs font-medium text-neutral-700">{e.ref}</span>}
                        {e.details.map((d) => <span key={d} className="block text-[11px] text-neutral-500">{d}</span>)}
                      </td>
                      <td className={td}>
                        <span className={e.supplied ? "font-semibold text-neutral-900" : "text-neutral-700"}>{e.party ?? "—"}</span>
                        {e.previousSupplier && (
                          <span className="mt-0.5 flex w-fit items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                            <Repeat size={11} aria-hidden="true" />Distributor changed from {e.previousSupplier}
                          </span>
                        )}
                      </td>
                      <td className={`${td} text-right`}>{e.qty > 0 && <Qty n={e.qty} units={view.units} className="font-semibold text-emerald-700" />}</td>
                      <td className={`${td} text-right`}>{e.qty < 0 && <Qty n={-e.qty} units={view.units} className="font-semibold text-rose-700" />}</td>
                      <td className="py-2 text-right align-top font-bold"><Qty n={e.balance} units={view.units} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ledger.entries.length === 0 && <p className="mt-2 text-sm text-neutral-500">No movement in these dates.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The history in a dialog, for the stock screens that list items. */
export function ProductLedgerModal({ title, load, onClose }: { title: string; load: () => Promise<LedgerView>; onClose: () => void }) {
  return (
    <Modal title={`Stock history · ${title}`} onClose={onClose} width="max-w-5xl">
      <ProductLedger load={load} />
    </Modal>
  );
}
