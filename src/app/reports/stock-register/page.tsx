"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { localDate } from "@/lib/localDate";
import { groupRegister, stockRegister, type RegisterRow, type StockGroup } from "@/lib/repo/stockReports";
import { StockReportShell, packs } from "@/components/reports/StockReportShell";

const th = "pb-1.5 pr-3 font-medium";
const td = "py-1.5 pr-3";
const num = `${td} text-right tabular-nums`;
const firstOfMonth = () => `${localDate().slice(0, 7)}-01`;

/** Reports > Stock Register: opening stock, what came in and went out, and closing stock in a period. */
export default function StockRegisterPage() {
  const [group, setGroup] = useState<StockGroup>("product");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(localDate());
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try { setRows(await stockRegister(from, to, search)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }

  const groups = useMemo(() => (rows && group !== "product" ? groupRegister(rows, group) : []), [rows, group]);
  const list = group === "product" ? (rows ?? []).map((r) => ({ ...r, label: r.name, sub: [r.company, r.generic].filter(Boolean).join(" · "), products: 1 })) : groups.map((g) => ({ ...g, sub: `${g.products} product${g.products === 1 ? "" : "s"}` }));
  const head = group === "product" ? "Product" : group === "company" ? "Company" : group === "distributor" ? "Distributor" : "Generic name";

  return (
    <StockReportShell title="Stock Register" group={group} setGroup={setGroup}
      controls={<>
        <Field label="From"><Input id="sr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input id="sr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Search"><Input id="sr-q" value={search} placeholder="Product, generic, company" onChange={(e) => setSearch(e.target.value)} /></Field>
        <Button variant="primary" onClick={() => void run()} disabled={loading}>{loading ? "Running…" : "Report"}</Button>
      </>}>
      <p className="mb-2 hidden text-xs print:block">{from} to {to}</p>
      {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not run the report: {error}</p>}
      {rows === null ? <p className="text-sm text-neutral-400">Choose the period and press Report.</p> : list.length === 0 ? <p className="text-sm text-neutral-400">No stock movement in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500">
              <th className={th}>{head}</th>
              <th className={`${th} text-right`}>Opening</th><th className={`${th} text-right`}>Received</th><th className={`${th} text-right`}>Sale returns</th>
              <th className={`${th} text-right`}>Sold</th><th className={`${th} text-right`}>Purchase returns</th><th className={`${th} text-right`}>Closing</th>
            </tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className={td}>{r.label}{r.sub && <span className="block text-[11px] text-neutral-500">{r.sub}</span>}</td>
                  <td className={num}>{packs(r.opening)}</td><td className={`${num} text-emerald-700`}>{packs(r.received)}</td><td className={num}>{packs(r.saleReturns)}</td>
                  <td className={`${num} text-rose-700`}>{packs(r.sold)}</td><td className={num}>{packs(r.purchaseReturns)}</td><td className={`${num} font-semibold`}>{packs(r.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-neutral-500">Quantities in packs, bonus included. Opening and closing are worked out from today&apos;s stock and the purchases and sales after each date; stock corrected by hand (not by a purchase, sale or return) shows in the opening.</p>
        </div>
      )}
    </StockReportShell>
  );
}
