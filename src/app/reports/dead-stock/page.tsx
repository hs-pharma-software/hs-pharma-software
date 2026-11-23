"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { addDays } from "@/lib/repo/facility";
import { deadStock, type DeadStockRow } from "@/lib/repo/stockReports";
import { card, money, packs } from "@/components/reports/StockReportShell";

const th = "pb-1.5 pr-3 font-medium";
const td = "py-1.5 pr-3";
const num = `${td} text-right tabular-nums`;
const PERIODS = [[30, "Last 30 days"], [60, "Last 60 days"], [90, "Last 90 days"], [180, "Last 6 months"]] as const;

/** Reports > Dead Stock: products on the shelves that sold nothing in the period (default: the last whole month). */
export default function DeadStockPage() {
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<DeadStockRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const since = addDays(localDate(), -days);

  useEffect(() => {
    if (!isTauri()) return;
    setLoading(true);
    deadStock(since).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  }, [since]);

  const value = rows.reduce((a, r) => a + r.cost, 0);
  return (
    <div>
      <PageHeader title="Dead Stock" actions={<Button variant="secondary" onClick={() => window.print()} className="print:hidden"><Printer size={14} />Print</Button>} />
      <div className={`${card} print:hidden`}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Not sold in">
            <Select id="ds-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>{PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</Select>
          </Field>
          <p className="pb-2 text-sm text-neutral-600">Products with stock and no sale since {since}.</p>
        </div>
      </div>
      <div className={`${card} print-area mt-4`}>
        <p className="mb-2 hidden text-lg font-bold print:block">Dead Stock · no sale since {since}</p>
        {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not run the report: {error}</p>}
        <div className="mb-3 flex flex-wrap gap-x-6 text-sm">
          <span>Products: <b>{rows.length}</b></span>
          <span>Money held in dead stock (at cost): <b className="text-rose-700">Rs {money(value)}</b></span>
        </div>
        {loading ? <p className="text-sm text-neutral-400">Loading…</p> : rows.length === 0 ? <p className="text-sm text-neutral-400">No dead stock: every product with stock sold in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className={th}>Product</th><th className={th}>Company</th><th className={th}>Last sold</th>
                <th className={`${th} text-right`}>Qty (packs)</th><th className={`${th} text-right`}>Cost (Rs)</th><th className={th}>Nearest expiry</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className={td}>{r.name}{r.generic && <span className="block text-[11px] text-neutral-500">{r.generic}</span>}</td>
                    <td className={td}>{r.company ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.lastSale ?? <span className="text-rose-600">Never</span>}</td>
                    <td className={num}>{packs(r.qty)}</td>
                    <td className={num}>{money(r.cost)}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.nearestExpiry ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
