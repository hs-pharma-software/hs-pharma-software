"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Printer, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { ProductPicker } from "@/components/products/ProductPicker";
import { KIND_CLS, printPurchaseOrder } from "@/components/vendor/portal";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { notify } from "@/lib/notify";
import { useAuthStore } from "@/store/authStore";
import { STORES, type StoreId } from "@/config/hospitalStores";
import { listVendors, type VendorRow } from "@/lib/repo/vendors";
import {
  PO_STATUS_LABEL, RFQ_KIND_LABEL, RFQ_STATUS_LABEL, cancelPurchaseOrder, cancelRfq, createRfq, getPurchaseOrder, getRfq, issuePurchaseOrders,
  listPurchaseOrders, listRfqs, lowestBids, quoteFor, type PoRow, type PoStatus, type RfqDetail, type RfqRow, type RfqStatus,
} from "@/lib/repo/purchaseOrders";
import type { Product } from "@/lib/types";

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5";
const rs = (n: number) => `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const UOMS = ["Nos", "Pack", "Box", "Carton", "Dozen", "Kg", "Gram", "Litre", "ml", "Meter", "Roll", "Ream", "Set", "Pair", "Bottle", "Tube", "Vial"];
const RFQ_TONE: Record<RfqStatus, string> = { open: "bg-amber-100 text-amber-800", awarded: "bg-emerald-100 text-emerald-800", cancelled: "bg-neutral-100 text-neutral-500" };
const PO_TONE: Record<PoStatus, string> = { issued: "bg-sky-100 text-sky-800", invoiced: "bg-emerald-100 text-emerald-800", cancelled: "bg-neutral-100 text-neutral-500" };

/** Purchase Cell > Purchase Orders: requests for rates to vendors, the rate comparison, and the orders issued. */
export default function PurchaseOrdersPage() {
  const [tab, setTab] = useState<"requests" | "orders">("requests");
  const [creating, setCreating] = useState(false);
  const [openRfq, setOpenRfq] = useState<string | null>(null);
  const [openPo, setOpenPo] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  const refresh = () => setStamp((s) => s + 1);

  return (
    <div>
      <PageHeader title="Purchase Orders" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} className="mr-1" />New Order</Button>} />
      <p className="mb-3 text-sm text-neutral-600">
        Ask one vendor (a <b>petty purchase</b>) or several (a <b>quotation</b>) for rates. Each vendor quotes in the vendor portal; compare the rates here and issue the purchase order.
        Vendors without a login yet: Purchase Cell › Vendor Logins.
      </p>
      <div role="tablist" aria-label="Purchase orders" className="mb-3 inline-flex rounded-xl bg-neutral-200/70 p-1 text-sm">
        {([["requests", "Quotation requests"], ["orders", "Purchase orders"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-9 rounded-lg px-4 font-medium transition-colors ${tab === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>{label}</button>
        ))}
      </div>
      {tab === "requests" ? <RequestsList stamp={stamp} onOpen={setOpenRfq} /> : <OrdersList stamp={stamp} onOpen={setOpenPo} />}
      {creating && <NewOrderModal onClose={() => setCreating(false)} onSent={(no) => { setCreating(false); setTab("requests"); refresh(); notify(`${no} sent to the vendor portal.`, "success"); }} />}
      {openRfq && <RfqModal id={openRfq} onClose={() => setOpenRfq(null)} onChanged={refresh} onOpenPo={(id) => { setOpenRfq(null); setTab("orders"); setOpenPo(id); }} />}
      {openPo && <PoModal id={openPo} onClose={() => setOpenPo(null)} onChanged={refresh} />}
    </div>
  );
}

function RequestsList({ stamp, onOpen }: { stamp: number; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<RfqRow[] | null>(null);
  const [status, setStatus] = useState<RfqStatus | "">("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    const t = setTimeout(() => {
      listRfqs({ status, search }).then((r) => { setRows(r); setError(null); })
        .catch((e) => { setRows([]); setError(/no such (table|column)/i.test(msg(e)) ? "Purchase orders need the database update (v109)." : msg(e)); });
    }, 200);
    return () => clearTimeout(t);
  }, [status, search, stamp]);
  return (
    <div className={card}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56"><Field label="Find"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Request no, product or vendor" /></Field></div>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as RfqStatus | "")}>
            <option value="">All</option>{(Object.keys(RFQ_STATUS_LABEL) as RfqStatus[]).map((s) => <option key={s} value={s}>{RFQ_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
      </div>
      <FormError message={error} className="mt-3" />
      {rows === null ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />
        : rows.length === 0 ? <p className="fade-in mt-4 text-sm text-neutral-400">No requests. Press New Order to ask vendors for rates.</p> : (
        <ul className="mt-3 divide-y divide-neutral-100">
          {rows.map((r, i) => (
            <li key={r.id} className="row-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button type="button" onClick={() => onOpen(r.id)} className="row-clickable flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-left">
                <span className="font-mono text-sm font-semibold">{r.rfq_no}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_CLS[r.kind]}`}>{RFQ_KIND_LABEL[r.kind]}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RFQ_TONE[r.status]}`}>{RFQ_STATUS_LABEL[r.status]}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{r.title || `${r.items} item${r.items === 1 ? "" : "s"}`} · {r.vendor_names}</span>
                <span className="text-xs tabular-nums text-neutral-500">{r.status === "open" ? `${r.quoted} of ${r.vendors} quoted` : ""}{r.due_date ? ` · by ${r.due_date}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrdersList({ stamp, onOpen }: { stamp: number; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<PoRow[] | null>(null);
  const [status, setStatus] = useState<PoStatus | "">("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    const t = setTimeout(() => {
      listPurchaseOrders({ status, search }).then((r) => { setRows(r); setError(null); }).catch((e) => { setRows([]); setError(msg(e)); });
    }, 200);
    return () => clearTimeout(t);
  }, [status, search, stamp]);
  return (
    <div className={card}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56"><Field label="Find"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PO no, vendor, product or request no" /></Field></div>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as PoStatus | "")}>
            <option value="">All</option>{(Object.keys(PO_STATUS_LABEL) as PoStatus[]).map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
      </div>
      <FormError message={error} className="mt-3" />
      {rows === null ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />
        : rows.length === 0 ? <p className="fade-in mt-4 text-sm text-neutral-400">No purchase orders yet: they are issued from a quotation request.</p> : (
        <ul className="mt-3 divide-y divide-neutral-100">
          {rows.map((p, i) => (
            <li key={p.id} className="row-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button type="button" onClick={() => onOpen(p.id)} className="row-clickable flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-left">
                <span className="font-mono text-sm font-semibold">{p.po_no}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_CLS[p.kind]}`}>{RFQ_KIND_LABEL[p.kind]}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PO_TONE[p.status]}`}>{PO_STATUS_LABEL[p.status]}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{p.vendor_name}{p.vendor_no ? ` (${p.vendor_no})` : ""} · {p.items} item{p.items === 1 ? "" : "s"}{p.rfq_no ? ` · ${p.rfq_no}` : ""}</span>
                <span className="text-sm font-semibold tabular-nums">{rs(p.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Line { productId: string | null; productName: string; specification: string; qty: string; uom: string; store: StoreId | "" }

function NewOrderModal({ onClose, onSent }: { onClose: () => void; onSent: (no: string) => void }) {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [vendorFind, setVendorFind] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [freeName, setFreeName] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void listVendors().then(setVendors).catch(() => setVendors([])); }, []);

  const shown = useMemo(() => {
    const q = vendorFind.trim().toLowerCase();
    return vendors.filter((v) => !q || `${v.name} ${v.vendor_no ?? ""} ${v.company_name ?? ""}`.toLowerCase().includes(q));
  }, [vendors, vendorFind]);
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const add = (p: Product) => setLines((ls) => [...ls, { productId: p.id, productName: p.name, specification: "", qty: "1", uom: "Nos", store: "" }]);
  const toggle = (id: string) => setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]));
  const badQty = (l: Line) => !(Number(l.qty) > 0);
  const pastDue = Boolean(due) && due < localDate();

  async function send() {
    setTried(true);
    if (!picked.length) { setError("Choose at least one vendor."); document.getElementById("po-vendor-find")?.focus(); return; }
    if (!lines.length) { setError("Add at least one product."); return; }
    const bad = lines.findIndex(badQty);
    if (bad >= 0) { document.getElementById(`po-qty-${bad}`)?.focus(); return; }
    if (pastDue) { document.getElementById("po-due")?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await createRfq({
        title, dueDate: due || null, note, vendorIds: picked,
        items: lines.map((l) => ({ productId: l.productId, productName: l.productName, specification: l.specification, qty: Number(l.qty), uom: l.uom, store: l.store })),
      });
      onSent(r.rfq_no);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title="New order · ask vendors for rates" onClose={() => { if (!lines.length || window.confirm("Close without sending?")) onClose(); }} width="max-w-5xl">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600"><span className="text-rose-600" aria-hidden="true">*</span> Vendors to ask</p>
          <Input id="po-vendor-find" value={vendorFind} onChange={(e) => setVendorFind(e.target.value)} placeholder="Find vendor" aria-label="Find vendor" />
          <ul className={`mt-2 max-h-72 overflow-y-auto rounded-xl ring-1 ${tried && !picked.length ? "ring-rose-300" : "ring-black/[0.06]"}`}>
            {shown.map((v) => (
              <li key={v.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 border-b border-neutral-100 px-3 py-1.5 text-sm last:border-0 hover:bg-neutral-50">
                  <input type="checkbox" className="h-4 w-4" checked={picked.includes(v.id)} onChange={() => toggle(v.id)} />
                  <span className="min-w-0 flex-1 truncate">{v.name}{v.vendor_no ? <span className="ml-1 font-mono text-[11px] text-neutral-400">{v.vendor_no}</span> : null}</span>
                </label>
              </li>
            ))}
            {!shown.length && <li className="px-3 py-3 text-sm text-neutral-400">No vendor found. Add vendors in Supplier &amp; Vendors.</li>}
          </ul>
          <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${picked.length === 1 ? "bg-violet-50 text-violet-800" : picked.length > 1 ? "bg-indigo-50 text-indigo-800" : "bg-neutral-50 text-neutral-500"}`}>
            {picked.length === 0 ? "One vendor = petty purchase; more than one = quotation." : picked.length === 1 ? "1 vendor: petty purchase" : `${picked.length} vendors: quotation`}
          </p>
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem]">
            <Field label="Subject (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stationery for December" /></Field>
            <Field label="Rates wanted by" error={tried && pastDue ? "The date has passed" : undefined}>
              <Input id="po-due" type="date" min={localDate()} value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={(tried && pastDue) || undefined} />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Add a product from Products"><ProductPicker onSelect={add} placeholder="Search product" /></Field>
            <Field label="Or a product not in Products">
              <div className="flex gap-2">
                <Input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder="e.g. A4 paper 80 gsm"
                  onKeyDown={(e) => { if (e.key === "Enter" && freeName.trim()) { e.preventDefault(); setLines((ls) => [...ls, { productId: null, productName: freeName.trim(), specification: "", qty: "1", uom: "Nos", store: "" }]); setFreeName(""); } }} />
                <Button onClick={() => { if (!freeName.trim()) return; setLines((ls) => [...ls, { productId: null, productName: freeName.trim(), specification: "", qty: "1", uom: "Nos", store: "" }]); setFreeName(""); }}>Add</Button>
              </div>
            </Field>
          </div>
          {lines.length === 0 ? (
            <p className={`mt-3 rounded-xl px-3 py-6 text-center text-sm ${tried ? "bg-rose-50 text-rose-700" : "bg-neutral-50 text-neutral-400"}`}>Add the products to ask rates for.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {lines.map((l, i) => (
                <li key={i} className="row-in rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{l.productName}</p>
                    <button type="button" aria-label={`Remove ${l.productName}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      className="-m-1.5 flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-rose-50 hover:text-rose-600"><X size={15} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_7rem_9rem]">
                    <div className="col-span-2 sm:col-span-1"><Field label="Specification"><Input value={l.specification} onChange={(e) => set(i, { specification: e.target.value })} placeholder="Size, quality, brand…" /></Field></div>
                    <Field label="Quantity" error={tried && badQty(l) ? "Enter it" : undefined}>
                      <Input id={`po-qty-${i}`} type="number" inputMode="decimal" min="0" step="any" value={l.qty} aria-invalid={(tried && badQty(l)) || undefined} onChange={(e) => set(i, { qty: e.target.value })} />
                    </Field>
                    <Field label="Unit (UoM)"><Input list="po-uoms" value={l.uom} onChange={(e) => set(i, { uom: e.target.value })} /></Field>
                    <div className="col-span-2 sm:col-span-1">
                      <Field label="For store">
                        <Select value={l.store} onChange={(e) => set(i, { store: e.target.value as StoreId | "" })}>
                          <option value="">Later</option>{STORES.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
                        </Select>
                      </Field>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <datalist id="po-uoms">{UOMS.map((u) => <option key={u} value={u} />)}</datalist>
          <div className="mt-3"><Field label="Note for the vendors (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivery at the main store; rates with GST" /></Field></div>
        </div>
      </div>
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void send()}>Send to {picked.length > 1 ? `${picked.length} vendors` : "vendor"}</Button>
      </div>
    </Modal>
  );
}

const VENDOR_STATUS: Record<string, { label: string; cls: string }> = {
  requested: { label: "No rates yet", cls: "text-amber-700" }, quoted: { label: "Rates received", cls: "text-sky-700" },
  declined: { label: "Declined", cls: "text-neutral-400" }, awarded: { label: "Order issued", cls: "text-emerald-700" }, not_awarded: { label: "Not selected", cls: "text-neutral-400" },
};

function RfqModal({ id, onClose, onChanged, onOpenPo }: { id: string; onClose: () => void; onChanged: () => void; onOpenPo: (poId: string) => void }) {
  const [d, setD] = useState<RfqDetail | null>(null);
  const [awards, setAwards] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"issue" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const x = await getRfq(id);
      setD(x);
      if (x) setAwards(lowestBids(x));
    } catch (e) { setError(msg(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (!d) return <Modal title="Request" onClose={onClose}><FormError message={error} />{!error && <div className="h-40 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />}</Modal>;
  const open = d.rfq.status === "open";
  const best = lowestBids(d);
  const vendorTotal = (vendorId: string) => d.items.reduce((s, it) => { const q = quoteFor(d, it.id, vendorId); return s + (q ? Number(q.rate) * Number(it.qty) : 0); }, 0);
  const chosenTotal = d.items.reduce((s, it) => { const v = awards[it.id]; const q = v ? quoteFor(d, it.id, v) : null; return s + (q ? Number(q.rate) * Number(it.qty) : 0); }, 0);
  const anyQuote = d.vendors.some((v) => v.status === "quoted");

  async function issue() {
    setBusy("issue");
    setError(null);
    try {
      const pos = await issuePurchaseOrders(id, awards, { note });
      notify(`${pos.map((p) => p.po_no).join(", ")} issued: the vendor${pos.length > 1 ? "s" : ""} see${pos.length > 1 ? "" : "s"} it in the portal.`, "success");
      onChanged();
      await load();
    } catch (e) { setError(msg(e)); } finally { setBusy(null); }
  }
  async function cancel() {
    const why = window.prompt("Cancel this request. Reason:");
    if (!why?.trim()) return;
    setBusy("cancel");
    try { await cancelRfq(id, why); onChanged(); await load(); } catch (e) { setError(msg(e)); } finally { setBusy(null); }
  }

  return (
    <Modal title={`${d.rfq.rfq_no} · ${RFQ_KIND_LABEL[d.rfq.kind]}`} onClose={onClose} width="max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RFQ_TONE[d.rfq.status]}`}>{RFQ_STATUS_LABEL[d.rfq.status]}</span>
        <span>Sent {d.rfq.created_at.slice(0, 10)}{d.rfq.created_by_name ? ` by ${d.rfq.created_by_name}` : ""}</span>
        {d.rfq.due_date && <span>· rates wanted by {d.rfq.due_date}</span>}
        {d.rfq.cancel_reason && <span className="text-rose-700">· cancelled: {d.rfq.cancel_reason}</span>}
      </div>
      {d.rfq.title && <p className="mb-1 font-medium">{d.rfq.title}</p>}
      {d.rfq.note && <p className="mb-3 whitespace-pre-line text-sm text-neutral-600">{d.rfq.note}</p>}
      <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left align-bottom text-xs text-neutral-500">
              <th className="px-3 py-2 font-medium">Item</th>
              {d.vendors.map((v) => (
                <th key={v.id} className="px-3 py-2 text-right font-medium">
                  <span className="block text-sm font-semibold text-neutral-800">{v.vendor_name}</span>
                  <span className={`block ${VENDOR_STATUS[v.status]?.cls ?? ""}`}>{VENDOR_STATUS[v.status]?.label ?? v.status}</span>
                  {v.delivery_days != null && <span className="block">Delivery {v.delivery_days} day(s)</span>}
                  {v.valid_till && <span className="block">Valid till {v.valid_till}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.items.map((it) => (
              <tr key={it.id} className="border-t border-neutral-100 align-top">
                <td className="px-3 py-2">
                  <span className="font-medium">{it.product_name}</span>
                  <span className="block text-xs text-neutral-500">{it.qty}{it.uom ? ` ${it.uom}` : ""}{it.specification ? ` · ${it.specification}` : ""}</span>
                </td>
                {d.vendors.map((v) => {
                  const q = quoteFor(d, it.id, v.vendor_id);
                  const raw = d.quotes.find((x) => x.rfq_item_id === it.id && x.vendor_id === v.vendor_id);
                  const lowest = best[it.id] === v.vendor_id && d.vendors.length > 1;
                  const chosen = awards[it.id] === v.vendor_id;
                  return (
                    <td key={v.id} className={`px-3 py-2 text-right ${chosen ? "bg-emerald-50" : ""}`}>
                      {q ? (
                        <label className={`flex cursor-pointer flex-col items-end gap-0.5 ${open ? "" : "cursor-default"}`}>
                          <span className="flex items-center gap-1.5">
                            {open && <input type="radio" name={`award-${it.id}`} className="h-4 w-4" checked={chosen} onChange={() => setAwards((a) => ({ ...a, [it.id]: v.vendor_id }))} aria-label={`${it.product_name}: ${v.vendor_name}`} />}
                            <span className="font-semibold tabular-nums">{rs(Number(q.rate))}</span>
                          </span>
                          <span className="text-xs tabular-nums text-neutral-500">{rs(Number(q.rate) * Number(it.qty))}</span>
                          {q.offered_spec && <span className="text-xs text-neutral-600">{q.offered_spec}</span>}
                          {lowest && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">Lowest</span>}
                        </label>
                      ) : <span className="text-xs text-neutral-400">{raw && Number(raw.available) === 0 ? "Not available" : "—"}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
              <td className="px-3 py-2">Total quoted</td>
              {d.vendors.map((v) => <td key={v.id} className="px-3 py-2 text-right tabular-nums">{v.status === "quoted" || v.status === "awarded" || v.status === "not_awarded" ? rs(vendorTotal(v.vendor_id)) : "—"}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {d.vendors.some((v) => v.remarks || v.decline_reason) && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-neutral-600">
          {d.vendors.filter((v) => v.remarks || v.decline_reason).map((v) => <li key={v.id}><b>{v.vendor_name}:</b> {v.decline_reason ? `declined: ${v.decline_reason}` : v.remarks}</li>)}
        </ul>
      )}
      {d.orders.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.orders.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpenPo(p.id)} className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100">
              {p.po_no} · {p.vendor_name} · {rs(p.total)}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-3">
          {!anyQuote && <p role="status" className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">No vendor has quoted yet. Vendors quote in the vendor portal (Purchase Cell › Vendor Logins gives them a login).</p>}
          <Field label="Note on the purchase order (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Deliver to the General Store by 5 December" /></Field>
          <p className="mt-2 text-sm text-neutral-600">Chosen: <b className="tabular-nums">{rs(chosenTotal)}</b> · the lowest rate is chosen for each item; pick another vendor with the round buttons (e.g. a better specification).</p>
        </div>
      )}
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Close</Button>
        {open && <Button loading={busy === "cancel"} disabled={busy !== null} onClick={() => void cancel()}>Cancel request</Button>}
        {open && <Button variant="primary" loading={busy === "issue"} disabled={busy !== null} onClick={() => void issue()}>Issue purchase order</Button>}
      </div>
    </Modal>
  );
}

function PoModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const hospital = useAuthStore((s) => s.currentTenant?.name ?? "Hospital");
  const [d, setD] = useState<Awaited<ReturnType<typeof getPurchaseOrder>>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await getPurchaseOrder(id)); } catch (e) { setError(msg(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Modal title="Purchase order" onClose={onClose}><FormError message={error} />{!error && <div className="h-40 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />}</Modal>;
  const { po, items } = d;
  const print = () => printPurchaseOrder({
    poNo: po.po_no, kindLabel: RFQ_KIND_LABEL[po.kind], rfqNo: null, issuedAt: (po.issued_at ?? po.created_at).slice(0, 10), issuedBy: po.issued_by_name,
    hospitalName: hospital, vendorName: d.vendorName, vendorNo: d.vendorNo, deliveryDays: po.delivery_days, note: po.note, total: po.total,
    items: items.map((i) => ({ productName: i.product_name, specification: i.specification, qty: Number(i.qty), uom: i.uom, rate: Number(i.rate) })),
  });
  async function cancel() {
    const why = window.prompt("Cancel this purchase order. Reason (the vendor sees it):");
    if (!why?.trim()) return;
    setBusy(true);
    try { await cancelPurchaseOrder(id, why); onChanged(); await load(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Purchase order ${po.po_no}`} onClose={onClose} width="max-w-3xl">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PO_TONE[po.status]}`}>{PO_STATUS_LABEL[po.status]}</span>
        <span>{d.vendorName}{d.vendorNo ? ` (${d.vendorNo})` : ""} · {RFQ_KIND_LABEL[po.kind]} · issued {(po.issued_at ?? po.created_at).slice(0, 10)}{po.issued_by_name ? ` by ${po.issued_by_name}` : ""}</span>
        {po.cancel_reason && <span className="text-rose-700">· cancelled: {po.cancel_reason}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-2 font-medium">Item</th><th className="pb-1.5 pr-2 text-right font-medium">Qty</th><th className="pb-1.5 pr-2 text-right font-medium">Rate</th><th className="pb-1.5 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-neutral-100 align-top">
                <td className="py-1.5 pr-2">{it.product_name}{it.specification && <span className="block text-xs text-neutral-500">{it.specification}</span>}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{it.qty}{it.uom ? ` ${it.uom}` : ""}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{rs(it.rate)}</td>
                <td className="py-1.5 text-right tabular-nums">{rs(Number(it.qty) * Number(it.rate))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-neutral-300 font-semibold"><td className="py-1.5" colSpan={3}>Total</td><td className="py-1.5 text-right tabular-nums">{rs(po.total)}</td></tr>
          </tbody>
        </table>
      </div>
      {po.note && <p className="mt-2 whitespace-pre-line text-sm text-neutral-700"><b>Note:</b> {po.note}</p>}
      {po.status === "invoiced" && <p className="mt-2 text-sm text-emerald-800">The vendor submitted the invoice: forward it to the store from Purchase Cell › Purchase.</p>}
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Close</Button>
        {po.status === "issued" && <Button loading={busy} disabled={busy} onClick={() => void cancel()}>Cancel order</Button>}
        <Button variant="primary" onClick={print}><Printer size={14} className="mr-1" />Print</Button>
      </div>
    </Modal>
  );
}
