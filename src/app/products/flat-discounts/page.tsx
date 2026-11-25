"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { flatDiscountCompanies, listFlatDiscountProducts, setFlatDiscount, type FlatDiscountProduct } from "@/lib/repo/flatDiscounts";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

/** Products > Flat Discounts: the business's own discount % on a product,
 * filled in on every invoice line of that product (before the category's). */
export default function FlatDiscountsPage() {
  const [rows, setRows] = useState<FlatDiscountProduct[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("");
  const [only, setOnly] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!isTauri()) return;
    try {
      setRows(await listFlatDiscountProducts({ search, company, onlyDiscounted: only }));
      setEdits({});
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void flatDiscountCompanies().then(setCompanies).catch(() => setCompanies([])); }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [search, company, only]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = Object.entries(edits).filter(([id, v]) => {
    const r = rows.find((x) => x.id === id);
    return r && v.trim() !== "" && Number(v) !== r.flat_discount_pct;
  });

  async function saveChanged() {
    setBusy(true);
    setMsg(null);
    try {
      let n = 0;
      for (const [id, v] of changed) n += await setFlatDiscount([id], Number(v));
      setMsg(`${n} product${n === 1 ? "" : "s"} saved.`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function applyBulk() {
    const pct = Number(bulk);
    if (bulk.trim() === "" || !(pct >= 0 && pct <= 100)) { setMsg("Enter a discount between 0 and 100%."); return; }
    if (!window.confirm(`Set a flat discount of ${pct}% on all ${rows.length} products shown?${pct === 0 ? " (0 removes their discount)" : ""}`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const n = await setFlatDiscount(rows.map((r) => r.id), pct);
      setMsg(`${n} product${n === 1 ? "" : "s"} updated.`);
      setBulk("");
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Flat Discounts" actions={<Button loading={busy} variant="primary" disabled={busy || changed.length === 0} onClick={() => void saveChanged()}>{busy ? "Saving…" : `Save${changed.length ? ` (${changed.length})` : ""}`}</Button>} />
      <div className={card}>
        <p className="mb-3 text-sm text-neutral-600">A product&apos;s flat discount is filled in automatically on every invoice line of that product. It comes before the category&apos;s flat discount; the cashier can still change it on an invoice.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Search"><Input id="fd-q" value={search} placeholder="Product, barcode or generic" onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Company">
            <Select id="fd-company" value={company} onChange={(e) => setCompany(e.target.value)}><option value="">All</option>{companies.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Only products with a flat discount</label>
          <div className="ml-auto flex items-end gap-2">
            <Field label="Same % for all shown"><Input id="fd-bulk" type="number" min="0" max="100" step="any" value={bulk} placeholder="e.g. 10" onChange={(e) => setBulk(e.target.value)} /></Field>
            <Button disabled={busy || rows.length === 0} onClick={() => void applyBulk()}>Apply to {rows.length}</Button>
          </div>
        </div>
        {msg && <p className="mt-2 text-sm text-neutral-700">{msg}</p>}
      </div>
      <div className={`${card} mt-4`}>
        {rows.length === 0 ? <p className="text-sm text-neutral-400">No products match.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="pb-1.5 pr-2 font-medium">Product</th><th className="pb-1.5 pr-2 font-medium">Company</th>
                  <th className="pb-1.5 pr-2 font-medium">Category discount</th><th className="pb-1.5 font-medium">Flat discount %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = edits[r.id] ?? (r.flat_discount_pct ? String(r.flat_discount_pct) : "");
                  const dirty = edits[r.id] !== undefined && edits[r.id].trim() !== "" && Number(edits[r.id]) !== r.flat_discount_pct;
                  return (
                    <tr key={r.id} className="border-t border-neutral-100">
                      <td className="py-1.5 pr-2">{r.name}{r.generic_name && <span className="block text-[11px] text-neutral-500">{r.generic_name}</span>}</td>
                      <td className="py-1.5 pr-2">{r.company_name ?? "—"}</td>
                      <td className="py-1.5 pr-2 text-neutral-500">{r.category_discount_pct ? `${r.category_discount_pct}%${r.category_name ? ` (${r.category_name})` : ""}` : "—"}</td>
                      <td className="py-1.5">
                        <input type="number" min="0" max="100" step="any" aria-label={`Flat discount for ${r.name}`} value={v} placeholder="0"
                          onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value }))}
                          className={`w-24 rounded-lg border px-2 py-1 text-right text-sm ${dirty ? "border-amber-400 bg-amber-50" : "border-neutral-200"}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 500 && <p className="mt-2 text-xs text-neutral-500">Showing the first 500; search or pick a company to narrow down.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
