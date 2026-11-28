"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { localDate } from "@/lib/localDate";
import { groupLabel, groupRegister, stockRegister, type RegisterRow, type StockGroup } from "@/lib/repo/stockReports";
import { productLedger, stockSearchItems } from "@/lib/repo/stockLedger";
import { matchingItems, type SearchItem } from "@/lib/stockLedger";
import { StockReportShell, packs } from "@/components/reports/StockReportShell";
import { StockSearchBox, type StockPick } from "@/components/stock/StockSearchBox";
import { ProductLedger } from "@/components/stock/ProductLedger";

const th = "pb-1.5 pr-3 font-medium";
const td = "py-1.5 pr-3";
const num = `${td} text-right tabular-nums`;
const firstOfMonth = () => `${localDate().slice(0, 7)}-01`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Reports > Stock Register: opening stock, what came in and went out, and closing stock in a period.
 * Searching offers products (also finished ones), companies, distributors and generic names; a product
 * opens its history: each purchase and its distributor, each sale and its invoice, and the stock left. */
export default function StockRegisterPage() {
  const [group, setGroup] = useState<StockGroup>("product");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(localDate());
  const [items, setItems] = useState<SearchItem[]>([]);
  const [pick, setPick] = useState<StockPick | null>(null);
  /** A company, distributor or generic row opened from the grouped report. */
  const [within, setWithin] = useState<{ by: Exclude<StockGroup, "product">; label: string } | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  /** Whether the rows loaded include finished products with no movement (a search shows them). */
  const [rowsAll, setRowsAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void stockSearchItems().then(setItems).catch((e: unknown) => setError(message(e)));
  }, []);

  async function run(all = Boolean(pick)) {
    setLoading(true);
    setError(null);
    try {
      setRows(await stockRegister(from, to, "", { all }));
      setRowsAll(all);
    } catch (e) { setError(message(e)); } finally { setLoading(false); }
  }

  function choose(next: StockPick | null) {
    setPick(next);
    setWithin(null);
    if (next?.kind === "product") { setProduct(next.value); return; }
    setProduct(null);
    if (next) { setGroup("product"); void run(true); }
    else if (rowsAll) void run(false);
  }

  const shown = useMemo(() => {
    let list = rows ?? [];
    if (pick && pick.kind !== "product") {
      const ids = new Set(matchingItems(items, pick).map((i) => i.id));
      // Products bought before the search list was read still match the typed words.
      list = list.filter((r) => ids.has(r.id) || (pick.kind === "text" && r.name.toLowerCase().includes(pick.value.toLowerCase())));
    }
    if (within) list = list.filter((r) => groupLabel(r, within.by) === within.label);
    return list;
  }, [rows, pick, within, items]);

  const groups = useMemo(() => (group !== "product" ? groupRegister(shown, group) : []), [shown, group]);
  const list = group === "product"
    ? shown.map((r) => ({ ...r, label: r.name, sub: [r.company, r.generic, r.distributor].filter(Boolean).join(" · "), products: 1 }))
    : groups.map((g) => ({ ...g, sub: `${g.products} product${g.products === 1 ? "" : "s"}`, distributorTrail: null }));
  const head = group === "product" ? "Product" : group === "company" ? "Company" : group === "distributor" ? "Distributor" : "Generic name";

  const loadProduct = useCallback(() => productLedger(product!), [product]);

  function back() {
    setProduct(null);
    if (pick?.kind === "product") setPick(null);
  }

  return (
    <StockReportShell title="Stock Register" group={group} setGroup={(g) => { setGroup(g); setWithin(null); back(); }}
      controls={<>
        <StockSearchBox items={items} picked={pick} onPick={choose} />
        <Field label="From"><Input id="sr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input id="sr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button loading={loading} variant="primary" onClick={() => { back(); void run(); }} disabled={loading}>{loading ? "Running…" : "Report"}</Button>
      </>}>
      {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not run the report: {error}</p>}
      {product ? <ProductLedger key={product} load={loadProduct} onBack={back} printable={false} /> : (
        <>
          <p className="mb-2 hidden text-xs print:block">{from} to {to}{pick ? ` · ${pick.label}` : ""}{within ? ` · ${within.label}` : ""}</p>
          {within && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-neutral-600 print:hidden">
              Products of <b>{within.label}</b>
              <button type="button" onClick={() => { setGroup(within.by); setWithin(null); }} aria-label={`Stop showing only ${within.label}`} className="rounded-full p-1 hover:bg-neutral-100"><X size={12} aria-hidden="true" /></button>
            </p>
          )}
          {rows === null ? <p className="text-sm text-neutral-400">Choose the period and press Report, or search a product to see its history.</p> : list.length === 0 ? <p className="text-sm text-neutral-400">{pick || within ? "No stock or purchases match the search." : "No stock movement in this period."}</p> : (
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
                      <td className={td}>
                        <button type="button" className="group inline-flex items-center gap-1.5 text-left font-medium text-sky-800 hover:underline print:text-neutral-900"
                          title={group === "product" ? "Show this product's history" : `Show the products of ${r.label}`}
                          onClick={() => { if (group === "product") setProduct(r.id); else { setWithin({ by: group, label: r.label }); setGroup("product"); } }}>
                          {r.label}{group === "product" && <History size={12} aria-hidden="true" className="shrink-0 print:hidden" />}
                        </button>
                        {r.sub && <span className="block text-[11px] text-neutral-500">{r.sub}</span>}
                        {r.distributorTrail && <span className="mt-0.5 flex w-fit items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900"><Repeat size={11} aria-hidden="true" />Distributor changed: {r.distributorTrail}</span>}
                      </td>
                      <td className={num}>{packs(r.opening)}</td><td className={`${num} text-emerald-700`}>{packs(r.received)}</td><td className={num}>{packs(r.saleReturns)}</td>
                      <td className={`${num} text-rose-700`}>{packs(r.sold)}</td><td className={num}>{packs(r.purchaseReturns)}</td><td className={`${num} font-bold`}>{packs(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-neutral-500">Quantities in packs, bonus included. Opening and closing are worked out from today&apos;s stock and the purchases and sales after each date; stock corrected by hand (not by a purchase, sale or return) shows in the opening. Open a product to see every purchase and sale of it.</p>
            </div>
          )}
        </>
      )}
    </StockReportShell>
  );
}
