"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ProductPicker } from "@/components/products/ProductPicker";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { STORES, storeLabel, type StoreId } from "@/config/hospitalStores";
import { listVendors, bankLine, type VendorRow } from "@/lib/repo/vendors";
import {
  STORE_PURCHASE_STATUS, cancelStorePurchase, getStorePurchase, listStorePurchases, postStorePurchase, saveStorePurchase,
  type StorePurchaseRow, type StorePurchaseStatus,
} from "@/lib/repo/hospitalStores";
import type { Product } from "@/lib/types";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TONE: Record<StorePurchaseStatus, string> = {
  draft: "bg-neutral-100 text-neutral-700", posted: "bg-sky-100 text-sky-800", returned: "bg-rose-100 text-rose-800", verified: "bg-emerald-100 text-emerald-800", cancelled: "bg-neutral-100 text-neutral-400",
};

/** Purchase Cell > Purchase: the purchase officer's store purchases. */
export default function StorePurchasesPage() {
  const [rows, setRows] = useState<StorePurchaseRow[]>([]);
  const [status, setStatus] = useState<StorePurchaseStatus | "">("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try { setRows(await listStorePurchases({ status, search })); setError(null); }
    catch (e) { setError(/no such (table|column)/i.test(msg(e)) ? "Store purchases need the database update (v103)." : msg(e)); }
  }
  useEffect(() => { const t = setTimeout(() => void reload(), 200); return () => clearTimeout(t); }, [status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn: () => Promise<unknown>) { try { await fn(); await reload(); } catch (e) { notify(msg(e)); } }

  return (
    <div>
      <PageHeader title="Purchase" actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} className="mr-1" />New Purchase</Button>} />
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Find"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Purchase no, invoice, vendor" /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as StorePurchaseStatus | "")}><option value="">All</option>{(Object.keys(STORE_PURCHASE_STATUS) as StorePurchaseStatus[]).map((s) => <option key={s} value={s}>{STORE_PURCHASE_STATUS[s]}</option>)}</Select></Field>
        </div>
        <FormError message={error} className="mt-2" />
        {rows.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No purchases.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-3 font-medium">Purchase</th><th className="pb-1.5 pr-3 font-medium">Vendor</th><th className="pb-1.5 pr-3 font-medium">Stores</th><th className="pb-1.5 pr-3 text-right font-medium">Total</th><th className="pb-1.5 pr-3 font-medium">Status</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100 align-top">
                    <td className="py-1.5 pr-3"><span className="font-mono text-xs">{r.purchase_no}</span><span className="block text-[11px] text-neutral-500">{r.date}{r.vendor_invoice_no ? ` · Inv ${r.vendor_invoice_no}` : ""} · {r.items} items</span></td>
                    <td className="py-1.5 pr-3">{r.vendor_name ?? "—"}<span className="block font-mono text-[11px] text-neutral-500">{r.vendor_no}</span></td>
                    <td className="py-1.5 pr-3 text-xs">{r.stores.split(",").filter(Boolean).map((s) => storeLabel(s).replace(" Store", "")).join(", ")}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.total)}</td>
                    <td className="py-1.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}>{STORE_PURCHASE_STATUS[r.status]}</span>
                      {r.status === "returned" && r.return_reason && <span className="mt-0.5 block text-[11px] text-rose-700">{r.return_reason}</span>}</td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      {(r.status === "draft" || r.status === "returned") && <>
                        <Button variant="ghost" onClick={() => setEditing(r.id)}>Edit</Button>
                        <Button variant="ghost" onClick={() => {
                          const comment = r.status === "returned" ? window.prompt("Comment for the store keeper (what was corrected):") : "";
                          if (r.status === "returned" && !comment?.trim()) return;
                          void act(() => postStorePurchase(r.id, comment));
                        }}>{r.status === "returned" ? "Post again" : "Post to store"}</Button>
                        <Button variant="ghost" onClick={() => { const why = window.prompt("Cancel this purchase. Reason:"); if (why?.trim()) void act(() => cancelStorePurchase(r.id, why)); }}>Cancel</Button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <PurchaseForm id={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

interface Line { productId: string | null; productName: string; companyName: string | null; qty: string; rate: string; store: StoreId | ""; locked?: boolean }

function PurchaseForm({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(localDate());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [freeName, setFreeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listVendors().then(setVendors).catch(() => setVendors([]));
    if (id) void getStorePurchase(id).then((d) => {
      if (!d) return;
      setVendorId(d.purchase.vendor_id ?? ""); setInvoiceNo(d.purchase.vendor_invoice_no ?? ""); setDate(d.purchase.date); setNote(d.purchase.note ?? "");
      setLines(d.items.map((i) => ({ productId: i.product_id, productName: i.product_name, companyName: i.company_name, qty: String(i.qty), rate: String(i.rate), store: i.store, locked: i.status === "verified" })));
    });
  }, [id]);

  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const add = (p: Product) => setLines((ls) => [...ls, { productId: p.id, productName: p.name, companyName: p.company_name ?? null, qty: "1", rate: "", store: "" }]);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const vendor = vendors.find((v) => v.id === vendorId);

  async function save(post: boolean) {
    setBusy(true);
    setError(null);
    try {
      const p = await saveStorePurchase({
        id, vendorId, vendorInvoiceNo: invoiceNo, date, note,
        items: lines.filter((l) => !l.locked).map((l) => ({ productId: l.productId, productName: l.productName, companyName: l.companyName, qty: Number(l.qty), rate: Number(l.rate), store: l.store as StoreId })),
      });
      if (post) await postStorePurchase(p.id, p.status === "returned" ? window.prompt("Comment for the store keeper (what was corrected):") : null);
      onSaved();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title={id ? "Edit purchase" : "New purchase"} onClose={onClose} width="max-w-5xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Vendor" required>
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} autoFocus>
            <option value="">— Choose —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.vendor_no ? ` · ${v.vendor_no}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Vendor's invoice no."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {vendor && bankLine(vendor) && <p className="mt-1 text-xs text-neutral-600"><span className="font-medium text-neutral-500">Pay to:</span> {bankLine(vendor)}</p>}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <Field label="Add an item from Products"><ProductPicker onSelect={add} placeholder="Search item, e.g. Ballpoint" /></Field>
        <Field label="Or an item not in Products">
          <div className="flex gap-2">
            <Input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder="e.g. Hand-wash soap 500 ml" />
            <Button disabled={!freeName.trim()} onClick={() => { setLines((ls) => [...ls, { productId: null, productName: freeName.trim(), companyName: null, qty: "1", rate: "", store: "" }]); setFreeName(""); }}>Add</Button>
          </div>
        </Field>
      </div>
      {lines.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1 pr-2 font-medium">Item</th><th className="pb-1 pr-2 font-medium">Qty</th><th className="pb-1 pr-2 font-medium">Purchase rate</th><th className="pb-1 pr-2 font-medium">Store</th><th className="pb-1 pr-2 text-right font-medium">Amount</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1 pr-2">{l.productName}{l.locked && <span className="block text-[11px] text-emerald-700">Received into the store</span>}</td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="any" disabled={l.locked} aria-label={`Quantity of ${l.productName}`} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className="w-20 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm" /></td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="any" disabled={l.locked} aria-label={`Rate of ${l.productName}`} value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} className="w-24 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm" /></td>
                  <td className="py-1 pr-2">
                    <select aria-label={`Store of ${l.productName}`} disabled={l.locked} value={l.store} onChange={(e) => set(i, { store: e.target.value as StoreId })} className={`rounded-lg border px-2 py-1 text-sm ${l.store ? "border-neutral-200" : "border-amber-400 bg-amber-50"}`}>
                      <option value="">— Store —</option>{STORES.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{money((Number(l.qty) || 0) * (Number(l.rate) || 0))}</td>
                  <td className="py-1 text-right">{!l.locked && <button type="button" title="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-rose-600"><X size={15} /></button>}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-neutral-300 font-semibold"><td className="py-1" colSpan={4}>Total</td><td className="py-1 pr-2 text-right tabular-nums">{money(total)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Field label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      <FormError message={error} className="mt-2" />
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Close</Button>
        <Button disabled={busy || !vendorId || !lines.length} onClick={() => void save(false)}>Save draft</Button>
        <Button variant="primary" disabled={busy || !vendorId || !lines.length} onClick={() => void save(true)}>Save and post to store</Button>
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">Once posted, the purchase cannot be edited. Each store keeper verifies their items (or returns the purchase with a reason); verified purchases go to Finance for payment.</p>
    </Modal>
  );
}
