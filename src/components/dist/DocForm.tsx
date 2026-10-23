"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import type { DistProduct } from "@/lib/dist/store";
import { Err, money, useLoad, type DistCtx } from "./ui";

interface Line {
  key: string;
  p: DistProduct;
  qty: string;
  price: string;
  discount: string;
  tax: string;
}

function ProductPicker({ onPick }: { onPick: (p: DistProduct) => void }) {
  const [q, setQ] = useState("");
  const hits = useLoad(() => (q.trim() ? dist.listProducts({ search: q }) : Promise.resolve([])), [q]);
  return (
    <div className="relative">
      <Input placeholder="Search product name / code / barcode" value={q} onChange={(e) => setQ(e.target.value)} />
      {!!hits.data?.length && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl bg-white text-sm shadow-lg ring-1 ring-black/10">
          {hits.data.slice(0, 15).map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full justify-between px-3 py-1.5 text-start hover:bg-amber-50" onClick={() => { onPick(p); setQ(""); }}>
                <span>{p.name} <span className="text-[11px] text-neutral-400">{p.code} · {p.company_name}</span></span>
                <span className="text-xs">{money(p.trade_price)} · stock {p.stock}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Direct sales invoice (outside a booking). Price / discount / WHT changes
 * appear only for users allowed to make them, and are re-checked by the data layer. */
export function SaleForm({ c, onClose, onSaved }: { c: DistCtx; onClose: () => void; onSaved: (id: string) => void }) {
  const customers = useLoad(() => dist.listCustomers({ status: "active" }), []);
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [description, setDescription] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [whtRate, setWhtRate] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof dist.previewWht>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toLines = () => lines.map((l) => ({ productId: l.p.id, qty: Number(l.qty), price: c.can("invoices.edit_price") ? Number(l.price) : null, discount: Number(l.discount) || 0 }));
  useEffect(() => {
    if (!customerId || !lines.length) return setPreview(null);
    const h = setTimeout(() => void dist.previewWht(customerId, toLines()).then(setPreview).catch(() => setPreview(null)), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, lines]);
  const patch = (k: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...v } : l)));
  return (
    <Modal title="New sales invoice" onClose={onClose} width="max-w-4xl">
      <div className="space-y-3 text-sm">
        <Field label="Customer" required>
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {(customers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.business_name} ({x.code}) · ATL {x.atl_status}</option>)}
          </Select>
        </Field>
        <ProductPicker onPick={(p) => setLines((ls) => [...ls, { key: crypto.randomUUID(), p, qty: "1", price: String(p.trade_price), discount: "", tax: String(p.sales_tax_rate) }])} />
        <table className="w-full">
          <thead className="text-xs text-neutral-500"><tr><th className="text-start">Product</th><th>Qty</th><th>Price</th><th>Discount (Rs)</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-neutral-100">
                <td>{l.p.name} <span className="text-[11px] text-neutral-400">stock {l.p.stock}</span></td>
                <td><Input className="!w-20" type="number" min="0" step="any" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></td>
                <td><Input className="!w-28" type="number" min="0" step="any" disabled={!c.can("invoices.edit_price")} value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} /></td>
                <td><Input className="!w-24" type="number" min="0" step="any" disabled={!c.can("invoices.discount")} value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} /></td>
                <td><Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={14} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.can("invoices.edit_description") && <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>}
        {preview && (
          <div className="rounded-xl bg-neutral-50 p-3">
            <p>Goods total: <b>{money(preview.goods)}</b></p>
            <p>Withholding {preview.treatment.section}: <b>{preview.treatment.status}</b> → {preview.treatment.rate}% on {money(preview.base)} = <b>{money(preview.amount)}</b></p>
            <p className="text-xs text-neutral-500">{preview.treatment.note}</p>
            {preview.treatment.blocked && <Err error={preview.treatment.blocked} />}
            <p className="text-base">Payable: <b>{money(preview.payable)}</b></p>
          </div>
        )}
        {c.can("invoices.edit_wht_rate") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Override WHT rate % (optional)"><Input type="number" min="0" step="any" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} /></Field>
            <Field label="Reason (required to override)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        )}
        {c.can("payments.receive") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Received now"><Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>
        )}
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!customerId || !lines.length}
            onClick={async () => {
              setError(null);
              try {
                const r = await dist.createSale({ customerId, lines: toLines(), description: description || null, payments: Number(paid) > 0 ? [{ method, amount: Number(paid) }] : [], wht: whtRate !== "" ? { rate: Number(whtRate), reason } : undefined });
                onSaved(r.doc.id);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Save invoice
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PurchaseForm({ c, onClose, onSaved }: { c: DistCtx; onClose: () => void; onSaved: (id: string) => void }) {
  const companies = useLoad(() => dist.listCompanies({ includeInactive: false }), []);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [error, setError] = useState<string | null>(null);
  const patch = (k: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...v } : l)));
  const total = lines.reduce((s, l) => s + ((Number(l.qty) || 0) * (Number(l.price) || 0) - (Number(l.discount) || 0)) * (1 + (Number(l.tax) || 0) / 100), 0);
  return (
    <Modal title="New purchase" onClose={onClose} width="max-w-4xl">
      <div className="space-y-3 text-sm">
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="Company (supplier)" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select company…</option>
              {(companies.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Supplier invoice #"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
        </div>
        <ProductPicker onPick={(p) => setLines((ls) => [...ls, { key: crypto.randomUUID(), p, qty: "1", price: String(p.cost || ""), discount: "", tax: "0" }])} />
        <table className="w-full">
          <thead className="text-xs text-neutral-500"><tr><th className="text-start">Product</th><th>Qty</th><th>Cost</th><th>Discount</th><th>Tax %</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-neutral-100">
                <td>{l.p.name}</td>
                <td><Input className="!w-20" type="number" min="0" step="any" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></td>
                <td><Input className="!w-28" type="number" min="0" step="any" disabled={l.p.cost > 0 && !c.can("purchases.edit_price")} value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} /></td>
                <td><Input className="!w-24" type="number" min="0" step="any" disabled={!c.can("purchases.discount")} value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} /></td>
                <td><Input className="!w-20" type="number" min="0" step="any" disabled={!c.can("purchases.edit_tax")} value={l.tax} onChange={(e) => patch(l.key, { tax: e.target.value })} /></td>
                <td><Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={14} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-end">Approx. total {money(total)} (calculated exactly when saved)</p>
        {c.can("payments.receive") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Paid now"><Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>
        )}
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!supplierId || !lines.length}
            onClick={async () => {
              setError(null);
              try {
                const r = await dist.createPurchase({ supplierId, supplierInvoiceNo: invoiceNo || null, lines: lines.map((l) => ({ productId: l.p.id, qty: Number(l.qty), cost: Number(l.price), discount: Number(l.discount) || 0, taxRate: Number(l.tax) || 0 })), payments: Number(paid) > 0 ? [{ method, amount: Number(paid) }] : [] });
                onSaved(r.doc.id);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Save purchase
          </Button>
        </div>
      </div>
    </Modal>
  );
}
