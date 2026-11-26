"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { isTauri } from "@/lib/platform";
import { notify } from "@/lib/notify";
import { STORES, isStoreId, type StoreId } from "@/config/hospitalStores";
import { forwardVendorInvoice, getPurchaseOrder, listVendorInvoices, returnVendorInvoice, type VendorInvoiceRow } from "@/lib/repo/purchaseOrders";

const rs = (n: number) => `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Purchase Cell > Purchase: invoices vendors submitted in the vendor portal.
 * Forwarded, each becomes a store purchase posted to its stores (verified by
 * the store keepers, then paid by Finance). */
export function VendorInvoicesPanel({ onForwarded }: { onForwarded: () => void }) {
  const [rows, setRows] = useState<VendorInvoiceRow[]>([]);
  const [opened, setOpened] = useState<VendorInvoiceRow | null>(null);
  const load = useCallback(async () => {
    if (!isTauri()) return;
    // Before the v109 database update there are none to show.
    setRows(await listVendorInvoices("submitted").catch(() => []));
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!rows.length) return null;
  return (
    <section className="rise-in mb-4 rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-200" aria-label="Invoices from vendors">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-950">
        Invoices from vendors <span className="rounded-full bg-sky-600 px-2 py-0.5 text-xs text-white">{rows.length}</span>
      </h2>
      <ul className="divide-y divide-sky-100">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1 basis-56 text-sm">
              <b>{r.vendor_name}</b>{r.vendor_no ? <span className="ml-1 font-mono text-[11px] text-sky-800/70">{r.vendor_no}</span> : null}
              <span className="block text-xs text-sky-900/80">Invoice {r.invoice_no} of {r.invoice_date} · against {r.po_no}{r.note ? ` · ${r.note}` : ""}</span>
            </div>
            <span className="text-sm font-semibold tabular-nums text-sky-950">{rs(r.amount)}</span>
            <Button variant="primary" onClick={() => setOpened(r)}>Forward to store</Button>
          </li>
        ))}
      </ul>
      {opened && <ForwardModal invoice={opened} onClose={() => setOpened(null)} onDone={(m) => { setOpened(null); notify(m, "success"); void load(); onForwarded(); }} />}
    </section>
  );
}

function ForwardModal({ invoice, onClose, onDone }: { invoice: VendorInvoiceRow; onClose: () => void; onDone: (message: string) => void }) {
  const [items, setItems] = useState<{ id: string; name: string; qty: number; uom: string | null; rate: number }[]>([]);
  const [stores, setStores] = useState<Record<string, StoreId | "">>({});
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<"forward" | "return" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getPurchaseOrder(invoice.po_id).then((d) => {
      if (!d) return;
      setItems(d.items.map((i) => ({ id: i.id, name: i.product_name, qty: Number(i.qty), uom: i.uom, rate: Number(i.rate) })));
      setStores(Object.fromEntries(d.items.map((i) => [i.id, i.store && isStoreId(i.store) ? i.store : ""])));
    }).catch((e) => setError(msg(e)));
  }, [invoice.po_id]);

  async function forward() {
    setTried(true);
    const missing = items.findIndex((i) => !stores[i.id]);
    if (missing >= 0) { document.getElementById(`fw-store-${missing}`)?.focus(); return; }
    setBusy("forward");
    setError(null);
    try { await forwardVendorInvoice(invoice.id, stores); onDone(`${invoice.vendor_name}'s invoice ${invoice.invoice_no} was posted to the store for checking.`); }
    catch (e) { setError(msg(e)); } finally { setBusy(null); }
  }
  async function sendBack() {
    if (!reason.trim()) { setTried(true); document.getElementById("fw-reason")?.focus(); return; }
    setBusy("return");
    setError(null);
    try { await returnVendorInvoice(invoice.id, reason); onDone(`Invoice ${invoice.invoice_no} returned to ${invoice.vendor_name}.`); }
    catch (e) { setError(msg(e)); } finally { setBusy(null); }
  }

  return (
    <Modal title={`Invoice ${invoice.invoice_no} · ${invoice.vendor_name}`} onClose={onClose} width="max-w-2xl">
      <p className="mb-3 text-sm text-neutral-600">Against {invoice.po_no} · dated {invoice.invoice_date} · <b className="tabular-nums">{rs(invoice.amount)}</b>. Choose the store that receives each item; the store keeper checks it, then Finance pays it.</p>
      <ul className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-neutral-50 px-3 py-2 ring-1 ring-black/[0.04]">
            <span className="min-w-0 flex-1 basis-48 text-sm"><b>{it.name}</b><span className="block text-xs text-neutral-500">{it.qty}{it.uom ? ` ${it.uom}` : ""} × {rs(it.rate)}</span></span>
            <select id={`fw-store-${i}`} aria-label={`Store for ${it.name}`} value={stores[it.id] ?? ""} onChange={(e) => setStores((s) => ({ ...s, [it.id]: e.target.value as StoreId | "" }))}
              aria-invalid={(tried && !stores[it.id]) || undefined}
              className={`min-h-9 rounded-lg border px-2 text-sm ${tried && !stores[it.id] ? "border-rose-400 bg-rose-50" : "border-neutral-200 bg-white"}`}>
              <option value="">— Store —</option>{STORES.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {tried && items.some((i) => !stores[i.id]) && !returning && <p role="alert" className="field-msg mt-2 text-xs text-rose-600">Choose the store for each item.</p>}
      {returning && (
        <div className="fade-in mt-3 rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
          <Field label="Why is it returned? (the vendor sees this)" error={tried && !reason.trim() ? "Write the reason" : undefined}>
            <Input id="fw-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={(tried && !reason.trim()) || undefined} autoFocus placeholder="e.g. Invoice amount does not match the delivery" />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => { setReturning(false); setTried(false); }}>Back</Button>
            <Button variant="primary" loading={busy === "return"} disabled={busy !== null} onClick={() => void sendBack()}>Return to vendor</Button>
          </div>
        </div>
      )}
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Close</Button>
        {!returning && <Button disabled={busy !== null} onClick={() => { setReturning(true); setTried(false); }}>Return to vendor</Button>}
        {!returning && <Button variant="primary" loading={busy === "forward"} disabled={busy !== null || !items.length} onClick={() => void forward()}>Forward to store</Button>}
      </div>
    </Modal>
  );
}
