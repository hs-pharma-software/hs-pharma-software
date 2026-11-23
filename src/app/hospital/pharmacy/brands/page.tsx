"use client";

import { useEffect, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { isTauri } from "@/lib/platform";
import {
  genericLabelFor, listSelectedBrands, pharmacyBrands, pharmacyGenerics, removeSelectedBrand, selectBrand,
  type BrandSelection, type PharmacyBrand, type PharmacyGeneric,
} from "@/lib/repo/brandSelections";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Pharmacy Department > Selected Brands: the brand of the linked pharmacy
 * for each generic. Doctors see the generic; the print and the pharmacy order show the brand. */
export default function SelectedBrandsPage() {
  const [rows, setRows] = useState<BrandSelection[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try { setRows(await listSelectedBrands(search)); setError(null); } catch (e) {
      setError(/no such table/i.test(msg(e)) ? "Selected Brands need the database update (v98)." : msg(e));
    }
  }
  useEffect(() => { const t = setTimeout(() => void reload(), 200); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(r: BrandSelection) {
    if (!window.confirm(`Remove ${r.generic_label}? Doctors will no longer find it.`)) return;
    try { await removeSelectedBrand(r.id); await reload(); } catch (e) { window.alert(msg(e)); }
  }

  return (
    <div>
      <PageHeader title="Selected Brands" actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Add Products</Button>} />
      <div className={card}>
        <div className="mb-3 max-w-md"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search generic, brand or company" aria-label="Search selected brands" /></div>
        {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {rows.length === 0 ? <p className="text-sm text-neutral-400">No brands chosen yet. Press Add Products, find a generic and choose its brand.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className="pb-1.5 pr-3 font-medium">Doctors see (generic)</th><th className="pb-1.5 pr-3 font-medium">Prescription prints (brand)</th>
                <th className="pb-1.5 pr-3 font-medium">Company</th><th className="pb-1.5 pr-3 font-medium">Chosen by</th><th />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className="py-1.5 pr-3 font-medium">{r.generic_label}</td>
                    <td className="py-1.5 pr-3">{r.product_name}</td>
                    <td className="py-1.5 pr-3 text-neutral-600">{r.company_name ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-xs text-neutral-500">{r.selected_by_name ?? ""} · {r.updated_at.slice(0, 10)}</td>
                    <td className="py-1.5 text-right"><button type="button" title="Remove" onClick={() => void remove(r)} className="text-neutral-400 hover:text-rose-600"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <AddProductsModal onClose={() => setAdding(false)} onSaved={() => void reload()} />}
    </div>
  );
}

/** Left: find a generic the pharmacy stocks. Right: its brands; choose one. */
function AddProductsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [term, setTerm] = useState("");
  const [generics, setGenerics] = useState<PharmacyGeneric[]>([]);
  const [generic, setGeneric] = useState<string | null>(null);
  const [brands, setBrands] = useState<PharmacyBrand[]>([]);
  const [picked, setPicked] = useState<PharmacyBrand | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { void pharmacyGenerics(term).then((g) => { setGenerics(g); setError(null); }).catch((e) => setError(msg(e))); }, 250);
    return () => clearTimeout(t);
  }, [term]);
  useEffect(() => {
    setPicked(null);
    if (!generic) { setBrands([]); return; }
    void pharmacyBrands(generic).then(setBrands).catch((e) => setError(msg(e)));
  }, [generic]);

  function choose(b: PharmacyBrand) {
    setPicked(b);
    setLabel(genericLabelFor(b.generic, b.name));
    setSaved(null);
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await selectBrand({ genericLabel: label, genericName: picked.generic, product: { id: picked.id, name: picked.name, company: picked.company } });
      setSaved(`${label} → ${picked.name}`);
      setPicked(null);
      onSaved();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title="Add products" onClose={onClose} width="max-w-5xl">
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search generic, e.g. Omeprazole" className="pl-8" autoFocus aria-label="Search generic" />
          </div>
          <div className="max-h-[26rem] overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
            {generics.length === 0 ? <p className="p-3 text-sm text-neutral-400">{term ? "The pharmacy has no stock of this generic." : "Type a generic name."}</p> : generics.map((g) => (
              <button key={g.generic} type="button" onClick={() => setGeneric(g.generic)}
                className={`flex w-full items-center justify-between border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-0 ${generic === g.generic ? "bg-sky-50 font-semibold" : "hover:bg-neutral-50"}`}>
                <span>{g.generic}</span><span className="text-xs text-neutral-500">{g.brands} brand{g.brands === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-neutral-700">{generic ? `Brands of ${generic} in the pharmacy` : "Choose a generic on the left"}</p>
          <div className="max-h-[18rem] overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
            {generic && brands.length === 0 ? <p className="p-3 text-sm text-neutral-400">No brand in stock.</p> : (
              <table className="w-full text-sm">
                <tbody>
                  {brands.map((b) => (
                    <tr key={b.id} onClick={() => choose(b)} className={`cursor-pointer border-b border-neutral-100 last:border-0 ${picked?.id === b.id ? "bg-emerald-50" : "hover:bg-neutral-50"}`}>
                      <td className="px-3 py-2"><input type="radio" readOnly checked={picked?.id === b.id} aria-label={`Choose ${b.name}`} className="mr-2" />{b.name}</td>
                      <td className="px-3 py-2 text-neutral-600">{b.company ?? ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{b.stock.toLocaleString("en-PK", { maximumFractionDigits: 1 })} in stock</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.price != null ? `Rs ${b.price.toLocaleString("en-PK")}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {picked && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3">
              <div className="min-w-64 flex-1"><Field label="Doctors will see"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field></div>
              <p className="pb-2 text-sm">prints as <b>{picked.name}</b></p>
              <Button variant="primary" disabled={busy || !label.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Select brand"}</Button>
            </div>
          )}
          {saved && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved: {saved}</p>}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
