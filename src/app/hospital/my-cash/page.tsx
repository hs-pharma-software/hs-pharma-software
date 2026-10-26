"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/platform";
import { myOpenCollections, myClosings, type CashClosing } from "@/lib/repo/cashClosing";
import { CloseDayModal, ClosingSlipModal, PaymentList, TotalsTable, rs } from "@/components/hospital/finance/CloseDay";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

/** A receptionist's own cash: what they have taken since their last closing, and their closings. */
export default function MyCashPage() {
  const [open, setOpen] = useState<Awaited<ReturnType<typeof myOpenCollections>> | null>(null);
  const [closings, setClosings] = useState<CashClosing[]>([]);
  const [closing, setClosing] = useState(false);
  const [viewing, setViewing] = useState<CashClosing | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setOpen(await myOpenCollections()); setClosings(await myClosings()); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void reload(); }, []);
  return (
    <div>
      <PageHeader title="My Cash" actions={<Button variant="primary" onClick={() => setClosing(true)} disabled={!open?.rows.length}>Close my day</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Since my last closing</h2>
          {!open ? <p className="text-sm text-neutral-400">Loading…</p> : open.rows.length === 0 ? <p className="text-sm text-neutral-400">Nothing collected since your last closing.</p> : (
            <>
              <TotalsTable t={open.totals} expectedCash={open.expectedCash} />
              <PaymentList rows={[...open.rows].reverse()} />
            </>
          )}
        </div>
        <div className={card}>
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">My closings</h2>
          {closings.length === 0 ? <p className="text-sm text-neutral-400">No closings yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1 pr-2 font-medium">Closing</th><th className="pb-1 pr-2 font-medium">Closed</th><th className="pb-1 pr-2 text-right font-medium">Net</th><th className="pb-1 pr-2 text-right font-medium">Difference</th><th className="pb-1 font-medium">Status</th></tr></thead>
              <tbody>
                {closings.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setViewing(c)}>
                    <td className="py-1 pr-2 font-mono text-xs">{c.closing_no}</td>
                    <td className="py-1 pr-2 tabular-nums">{c.to_at.slice(0, 16)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{rs(c.net_total)}</td>
                    <td className={`py-1 pr-2 text-right tabular-nums ${c.difference < 0 ? "text-rose-700" : c.difference > 0 ? "text-amber-700" : "text-neutral-500"}`}>{c.difference === 0 ? "—" : rs(c.difference)}</td>
                    <td className="py-1 text-xs">{c.status === "verified" ? <span className="text-emerald-700">Verified</span> : <span className="text-amber-700">Waiting</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {closing && <CloseDayModal onClose={() => { setClosing(false); void reload(); }} onClosed={() => void reload()} />}
      {viewing && <ClosingSlipModal closing={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
