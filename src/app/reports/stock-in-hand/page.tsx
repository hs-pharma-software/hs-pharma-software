"use client";

import { useEffect, useMemo, useState } from "react";
import { Field, Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { groupStock, stockInHandProducts, type StockGroup, type StockProductRow } from "@/lib/repo/stockReports";
import { StockReportShell, money, packs } from "@/components/reports/StockReportShell";

const th = "pb-1.5 pr-3 font-medium";
const td = "py-1.5 pr-3";
const num = `${td} text-right tabular-nums`;

/** Reports > Stock in Hand: what is on the shelves now, by product, company, distributor or generic name. */
export default function StockInHandPage() {
  const [group, setGroup] = useState<StockGroup>("product");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<StockProductRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTauri()) return;
    const t = setTimeout(() => {
      setLoading(true);
      stockInHandProducts(search).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const groups = useMemo(() => (group === "product" ? [] : groupStock(rows, group)), [rows, group]);
  const totals = rows.reduce((a, r) => ({ qty: a.qty + r.qty, cost: a.cost + r.cost, retail: a.retail + r.retail }), { qty: 0, cost: 0, retail: 0 });

  return (
    <StockReportShell title="Stock in Hand" group={group} setGroup={setGroup}
      controls={<Field label="Search"><Input id="sih-q" value={search} placeholder="Product, generic, company, barcode" onChange={(e) => setSearch(e.target.value)} /></Field>}>
      {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not run the report: {error}</p>}
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>Products: <b>{rows.length}</b></span>
        <span>Stock at cost: <b>Rs {money(totals.cost)}</b></span>
        <span>Stock at sale price: <b>Rs {money(totals.retail)}</b></span>
      </div>
      {loading && rows.length === 0 ? <p className="text-sm text-neutral-400">Loading…</p> : rows.length === 0 ? <p className="text-sm text-neutral-400">No stock.</p> : (
        <div className="overflow-x-auto">
          {group === "product" ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className={th}>Product</th><th className={th}>Company</th><th className={th}>Distributor</th>
                <th className={`${th} text-right`}>Qty (packs)</th><th className={`${th} text-right`}>Cost (Rs)</th><th className={`${th} text-right`}>Sale value (Rs)</th><th className={th}>Nearest expiry</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className={td}>{r.name}{r.generic && <span className="block text-[11px] text-neutral-500">{r.generic}</span>}</td>
                    <td className={td}>{r.company ?? "—"}</td>
                    <td className={td}>{r.distributor ?? "—"}</td>
                    <td className={num}>{packs(r.qty)}</td>
                    <td className={num}>{money(r.cost)}</td>
                    <td className={num}>{money(r.retail)}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.nearestExpiry ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className={th}>{group === "company" ? "Company" : group === "distributor" ? "Distributor" : "Generic name"}</th>
                <th className={`${th} text-right`}>Products</th><th className={`${th} text-right`}>Qty (packs)</th><th className={`${th} text-right`}>Cost (Rs)</th><th className={`${th} text-right`}>Sale value (Rs)</th>
              </tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-t border-neutral-100">
                    <td className={td}>{g.label}</td><td className={num}>{g.products}</td><td className={num}>{packs(g.qty)}</td><td className={num}>{money(g.cost)}</td><td className={num}>{money(g.retail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </StockReportShell>
  );
}
