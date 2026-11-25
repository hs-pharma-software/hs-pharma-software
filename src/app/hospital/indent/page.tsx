"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ProductPicker } from "@/components/products/ProductPicker";
import { isTauri } from "@/lib/platform";
import { STORES, storeLabel, type StoreId } from "@/config/hospitalStores";
import { createIndent, myIndentBook, myIndents, receiveIndent, returnIndentItems, type IndentBook, type IndentWithItems } from "@/lib/repo/storeIndents";
import type { Product } from "@/lib/types";
import { FormError } from "@/components/ui/FormError";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STATUS: Record<string, string> = { pending: "Waiting for the store", issued: "Issued: confirm what you received", received: "Received", cancelled: "Cancelled" };
const RET: Record<string, string> = { pending: "Return waiting for the store", accepted: "Return accepted", refused: "Return refused" };

/** Indent Book (head nurse / department in-charge): demand items from a store, confirm what was received, return items. */
export default function IndentBookPage() {
  const [book, setBook] = useState<IndentBook | null | undefined>(undefined);
  const [rows, setRows] = useState<IndentWithItems[]>([]);
  const [store, setStore] = useState<StoreId | "">("");
  const [items, setItems] = useState<{ productId: string | null; productName: string; qty: string }[]>([]);
  const [free, setFree] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    if (!isTauri()) return;
    try { const [b, r] = await Promise.all([myIndentBook(), myIndents()]); setBook(b); setRows(r); setError(null); }
    catch (e) { setBook(null); setError(/no such (table|column)/i.test(msg(e)) ? "Indents need the database update (v104)." : msg(e)); }
  }
  useEffect(() => { void reload(); }, []);
  const act = async (fn: () => Promise<unknown>) => { try { setError(null); await fn(); await reload(); } catch (e) { setError(msg(e)); } };

  if (book === undefined) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;
  return (
    <div>
      <PageHeader title={book ? `Indent Book ${book.book_no}` : "Indent Book"} />
      <FormError message={error} className="mb-3" />
      {!book ? <div className={card}><p className="text-sm text-neutral-500">You have no indent book yet. The purchase officer orders one for you and a store keeper issues it.</p></div> : (
        <div className={card}>
          <h2 className="mb-2 text-sm font-semibold">New indent{book.department ? ` · ${book.department}` : ""}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Store"><Select value={store} onChange={(e) => setStore(e.target.value as StoreId)}><option value="">— Choose —</option>{STORES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
            <Field label="Item from Products"><ProductPicker onSelect={(p: Product) => setItems((xs) => [...xs, { productId: p.id, productName: p.name, qty: "1" }])} placeholder="Search item" /></Field>
            <Field label="Or another item">
              <div className="flex gap-2"><Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="e.g. Register 200 pages" /><Button disabled={!free.trim()} onClick={() => { setItems((xs) => [...xs, { productId: null, productName: free.trim(), qty: "1" }]); setFree(""); }}>Add</Button></div>
            </Field>
          </div>
          {items.length > 0 && (
            <table className="mt-2 w-full text-sm"><tbody>
              {items.map((i, k) => (
                <tr key={k} className="border-t border-neutral-100">
                  <td className="py-1 pr-2">{i.productName}</td>
                  <td className="py-1 pr-2 text-right"><input type="number" min="0" step="any" aria-label={`Quantity of ${i.productName}`} value={i.qty} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} className="w-20 rounded-lg border border-neutral-200 px-2 py-0.5 text-right" /></td>
                  <td className="py-1 text-right"><button type="button" title="Remove" onClick={() => setItems((xs) => xs.filter((_, j) => j !== k))} className="text-neutral-400 hover:text-rose-600"><X size={15} /></button></td>
                </tr>
              ))}
            </tbody></table>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="flex-1"><Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
            <Button variant="primary" disabled={!store || !items.length} onClick={() => void act(async () => {
              await createIndent({ store: store as StoreId, note, items: items.map((i) => ({ productId: i.productId, productName: i.productName, qty: Number(i.qty) })) });
              setItems([]); setNote(""); setStore("");
            })}>Send to store</Button>
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        {rows.map((r) => <IndentCard key={r.id} r={r} act={act} />)}
      </div>
    </div>
  );
}

function IndentCard({ r, act }: { r: IndentWithItems; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [got, setGot] = useState<Record<string, { qty: string; note: string }>>({});
  const [ret, setRet] = useState<Record<string, { qty: string; note: string }>>({});
  return (
    <div className={card}>
      <p className="text-sm"><b>{r.indent_no}</b> · {storeLabel(r.store)} · <span className="text-neutral-600">{STATUS[r.status] ?? r.status}</span> <span className="text-xs text-neutral-400">{r.created_at.slice(0, 10)}</span></p>
      <table className="mt-1 w-full text-sm">
        <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1 pr-2 font-medium">Item</th><th className="pb-1 pr-2 text-right font-medium">Demanded</th><th className="pb-1 pr-2 text-right font-medium">Issued</th><th className="pb-1 pr-2 text-right font-medium">Received</th><th className="pb-1 font-medium" /></tr></thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.id} className="border-t border-neutral-100 align-top">
              <td className="py-1 pr-2">{i.product_name}{i.return_status && <span className="block text-[11px] text-amber-700">{RET[i.return_status]} ({i.return_qty})</span>}</td>
              <td className="py-1 pr-2 text-right">{i.qty_requested}</td>
              <td className="py-1 pr-2 text-right">{i.qty_issued ?? "—"}</td>
              <td className="py-1 pr-2 text-right">
                {r.status === "issued" ? <input type="number" min="0" max={i.qty_issued ?? 0} step="any" aria-label={`Received ${i.product_name}`} value={got[i.id]?.qty ?? String(i.qty_issued ?? 0)} onChange={(e) => setGot({ ...got, [i.id]: { qty: e.target.value, note: got[i.id]?.note ?? "" } })} className="w-20 rounded-lg border border-neutral-200 px-2 py-0.5 text-right" /> : i.qty_received ?? "—"}
                {i.received_note && <span className="block text-[11px] text-neutral-500">{i.received_note}</span>}
              </td>
              <td className="py-1">
                {r.status === "issued" && Number(got[i.id]?.qty ?? i.qty_issued) < Number(i.qty_issued) && <Input value={got[i.id]?.note ?? ""} placeholder="Why less?" onChange={(e) => setGot({ ...got, [i.id]: { qty: got[i.id]?.qty ?? String(i.qty_issued), note: e.target.value } })} />}
                {r.status === "received" && i.return_status !== "pending" && (
                  <div className="flex gap-1">
                    <input type="number" min="0" step="any" aria-label={`Return ${i.product_name}`} placeholder="Return" value={ret[i.id]?.qty ?? ""} onChange={(e) => setRet({ ...ret, [i.id]: { qty: e.target.value, note: ret[i.id]?.note ?? "" } })} className="w-20 rounded-lg border border-neutral-200 px-2 py-0.5 text-right text-sm" />
                    <Input value={ret[i.id]?.note ?? ""} placeholder="Reason" onChange={(e) => setRet({ ...ret, [i.id]: { qty: ret[i.id]?.qty ?? "", note: e.target.value } })} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex justify-end gap-2">
        {r.status === "issued" && <Button variant="primary" onClick={() => void act(() => receiveIndent(r.id, Object.fromEntries(r.items.map((i) => [i.id, { qty: Number(got[i.id]?.qty ?? i.qty_issued ?? 0), note: got[i.id]?.note }]))))}>Confirm received</Button>}
        {r.status === "received" && Object.values(ret).some((x) => Number(x.qty) > 0) && <Button onClick={() => void act(() => returnIndentItems(r.id, Object.fromEntries(Object.entries(ret).filter(([, x]) => Number(x.qty) > 0).map(([k, x]) => [k, { qty: Number(x.qty), note: x.note }]))))}>Return to store</Button>}
      </div>
    </div>
  );
}
