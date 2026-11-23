"use client";

import { useEffect, useState } from "react";
import { FilePlus2, Pencil, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ProductPicker } from "@/components/products/ProductPicker";
import { isTauri } from "@/lib/platform";
import { hasSecondaryUnit } from "@/lib/uom";
import { useFormTabs } from "@/store/formTabsStore";
import { useCan } from "@/lib/actionPermissions";
import {
  deletePreInvoice, listPreInvoices, preInvoiceEstimate, savePreInvoice, type PreInvoice, type PreInvoiceLine,
} from "@/lib/repo/preInvoices";
import type { Product } from "@/lib/types";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

type Est = { total: number; outOfStock: string[] };
type EditLine = PreInvoiceLine & { canSplit: boolean };

/** Invoices > Pre Invoices: saved invoice patterns (e.g. a Gynae operation's
 * medicines). "Use" opens a new invoice with the lines at today's prices and
 * batches; enter the patient's name, then save and print as usual. */
export default function PreInvoicesPage() {
  const [rows, setRows] = useState<PreInvoice[]>([]);
  const [est, setEst] = useState<Record<string, Est>>({});
  const [editing, setEditing] = useState<{ id: string | null; name: string; description: string; lines: EditLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openFromPre = useFormTabs((s) => s.openNewFromPreInvoice);
  // Changing the patterns is for those who may edit invoices; everyone may use them.
  const canEdit = useCan("invoice.edit");

  async function reload() {
    if (!isTauri()) return;
    try {
      const list = await listPreInvoices();
      setRows(list);
      setError(null);
      const pairs = await Promise.all(list.map(async (p) => [p.id, await preInvoiceEstimate(p).catch(() => ({ total: 0, outOfStock: [] }))] as const));
      setEst(Object.fromEntries(pairs));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/no such table/i.test(m) ? "Pre Invoices need the database update (v95)." : m);
    }
  }
  useEffect(() => { void reload(); }, []);

  async function editorFor(p: PreInvoice | null) {
    setError(null);
    setEditing({
      id: p?.id ?? null, name: p?.name ?? "", description: p?.description ?? "",
      lines: (p?.lines ?? []).map((l) => ({ ...l, canSplit: l.unit === "secondary" })),
    });
  }

  function addProduct(prod: Product) {
    setEditing((e) => {
      if (!e) return e;
      const i = e.lines.findIndex((l) => l.productId === prod.id && l.unit === "base");
      if (i >= 0) return { ...e, lines: e.lines.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l)) };
      return { ...e, lines: [...e.lines, { productId: prod.id, name: prod.name, qty: 1, unit: "base", canSplit: hasSecondaryUnit(prod) }] };
    });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await savePreInvoice({ id: editing.id, name: editing.name, description: editing.description, lines: editing.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unit: l.unit })) });
      setEditing(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: PreInvoice) {
    if (!window.confirm(`Delete the pre invoice "${p.name}"? Invoices already made from it stay.`)) return;
    try { await deletePreInvoice(p.id); await reload(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div>
      <PageHeader title="Pre Invoices" actions={canEdit ? <Button variant="primary" onClick={() => void editorFor(null)}><FilePlus2 size={14} />New Pre Invoice</Button> : undefined} />
      <p className="mb-4 text-sm text-neutral-600">Saved medicine patterns, e.g. a Gynae operation. Press <b>Use</b>, enter the patient&apos;s name, then save and print. Prices and batches are today&apos;s.</p>
      {error && !editing && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {rows.length === 0 ? (
        <div className={card}><p className="text-sm text-neutral-400">No pre invoices yet.{canEdit ? " Press New Pre Invoice to save the first pattern." : ""}</p></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const e = est[p.id];
            return (
              <div key={p.id} className={`${card} flex flex-col`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-neutral-900">{p.name}</p>
                    {p.description && <p className="text-xs text-neutral-500">{p.description}</p>}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-2 text-neutral-500">
                      <button type="button" title="Edit" onClick={() => void editorFor(p)} className="hover:text-neutral-900"><Pencil size={15} /></button>
                      <button type="button" title="Delete" onClick={() => void remove(p)} className="hover:text-rose-600"><Trash2 size={15} /></button>
                    </div>
                  )}
                </div>
                <ul className="mt-3 flex-1 space-y-0.5 text-sm text-neutral-700">
                  {p.lines.slice(0, 6).map((l, i) => (
                    <li key={i} className="flex justify-between gap-2"><span className="truncate">{l.name}</span><span className="tabular-nums text-neutral-500">× {l.qty}{l.unit === "secondary" ? " (loose)" : ""}</span></li>
                  ))}
                  {p.lines.length > 6 && <li className="text-xs text-neutral-400">and {p.lines.length - 6} more</li>}
                </ul>
                <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                  <div className="text-xs text-neutral-500">
                    {p.lines.length} item{p.lines.length === 1 ? "" : "s"}{e ? <> · about <b className="text-neutral-800">{rs(e.total)}</b></> : null}
                    {e && e.outOfStock.length > 0 && <span className="block text-rose-600">Short: {e.outOfStock.join(", ")}</span>}
                  </div>
                  <Button variant="primary" onClick={() => openFromPre(p.id)}>Use</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? "Edit pre invoice" : "New pre invoice"} onClose={() => setEditing(null)} width="max-w-2xl">
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={editing.name} placeholder="e.g. Gynae operation (C-section)" onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></Field>
              <Field label="Note (optional)"><Input value={editing.description} placeholder="e.g. Dr. Saima's list" onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            </div>
            <Field label="Add medicine"><ProductPicker onSelect={addProduct} placeholder="Search a product to add" /></Field>
            {editing.lines.length === 0 ? <p className="text-sm text-neutral-400">No medicines added yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 font-medium">Medicine</th><th className="pb-1.5 font-medium">Qty</th><th className="pb-1.5 font-medium">Unit</th><th /></tr></thead>
                <tbody>
                  {editing.lines.map((l, i) => (
                    <tr key={`${l.productId}-${i}`} className="border-t border-neutral-100">
                      <td className="py-1.5 pr-2">{l.name}</td>
                      <td className="py-1.5 pr-2">
                        <input type="number" min="0" step="any" aria-label={`Quantity of ${l.name}`} value={l.qty}
                          onChange={(ev) => setEditing({ ...editing, lines: editing.lines.map((x, j) => (j === i ? { ...x, qty: Number(ev.target.value) } : x)) })}
                          className="w-20 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm" />
                      </td>
                      <td className="py-1.5 pr-2">
                        {l.canSplit ? (
                          <select aria-label={`Unit of ${l.name}`} value={l.unit} onChange={(ev) => setEditing({ ...editing, lines: editing.lines.map((x, j) => (j === i ? { ...x, unit: ev.target.value as PreInvoiceLine["unit"] } : x)) })}
                            className="rounded-lg border border-neutral-200 px-2 py-1 text-sm">
                            <option value="base">Pack</option><option value="secondary">Loose</option>
                          </select>
                        ) : <span className="text-neutral-500">Pack</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        <button type="button" title="Remove" onClick={() => setEditing({ ...editing, lines: editing.lines.filter((_, j) => j !== i) })} className="text-neutral-400 hover:text-rose-600"><X size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
