"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ProductPicker } from "@/components/products/ProductPicker";
import { isTauri } from "@/lib/platform";
import { addImeisToStock, parseImeis, searchImeiRegister, type ImeiRegisterRow, type ImeiStatus } from "@/lib/repo/imei";
import type { Product } from "@/lib/types";

const STATUS: Record<ImeiStatus, { label: string; cls: string }> = {
  in_stock: { label: "In stock", cls: "bg-emerald-100 text-emerald-800" },
  sold: { label: "Sold", cls: "bg-sky-100 text-sky-800" },
  returned: { label: "Returned to supplier", cls: "bg-neutral-100 text-neutral-600" },
};

/** Mobile shop: every handset by IMEI: in stock, sold (to whom, on which
 * bill) or returned to the supplier. Search by IMEI, model, buyer, CNIC or mobile. */
export default function ImeiRegisterPage() {
  const [rows, setRows] = useState<ImeiRegisterRow[]>([]);
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<ImeiStatus | "all">("all");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setRows(await searchImeiRegister(term, status));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [term, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<ImeiRegisterRow>[] = [
    { header: "IMEI", render: (r) => <span className="font-mono text-xs">{r.imei}{r.imei2 ? <span className="block text-neutral-500">{r.imei2}</span> : null}</span> },
    { header: "Model", render: (r) => r.product_name },
    { header: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span> },
    { header: "Bought", render: (r) => (r.purchase_no != null ? `Purchase #${r.purchase_no}${r.supplier_name ? ` · ${r.supplier_name}` : ""}` : "Opening stock") },
    { header: "Cost", render: (r) => <span className="tabular-nums">{Number(r.purchase_price).toFixed(2)}</span> },
    { header: "Sold on", render: (r) => (r.invoice_no ? `Bill #${r.invoice_no} · ${r.sold_at?.slice(0, 10) ?? ""}` : "—") },
    {
      header: "Buyer",
      render: (r) => (r.customer_name ? (
        <span><span className="font-medium">{r.customer_name}</span><span className="block text-xs text-neutral-500">{[r.customer_cnic, r.customer_mobile].filter(Boolean).join(" · ")}</span></span>
      ) : "—"),
    },
  ];

  return (
    <div>
      <PageHeader title="IMEI Register" actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} />Add IMEIs to stock</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input id="imei-search" className="max-w-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search IMEI, model, buyer, CNIC or mobile…" autoFocus />
        <Select id="imei-status" className="w-48" value={status} onChange={(e) => setStatus(e.target.value as ImeiStatus | "all")}>
          <option value="all">All handsets</option>
          <option value="in_stock">In stock</option>
          <option value="sold">Sold</option>
          <option value="returned">Returned to supplier</option>
        </Select>
      </div>
      {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
      <DataTable columns={columns} rows={rows} emptyMessage="No handset found. IMEIs are added on purchases of products with Track IMEI on." />
      <p className="mt-2 text-xs text-neutral-500">Handsets are bought in on Purchase, sold on New Invoice (with the buyer&apos;s CNIC and mobile) and come back with Sale Item Return.</p>
      {adding && <AddImeisModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
    </div>
  );
}

/** IMEIs for handsets already in stock (entered before IMEI tracking). */
function AddImeisModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imeis = parseImeis(text);

  async function save() {
    if (!product) return;
    setSaving(true);
    setError(null);
    try {
      await addImeisToStock(product.id, imeis);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add IMEIs to stock" onClose={onClose} width="max-w-lg">
      <p className="mb-3 text-sm text-neutral-600">For handsets already in stock without an IMEI (opening stock). New handsets get their IMEIs on the purchase.</p>
      <div className="flex flex-col gap-3">
        <Field label="Model" required>
          {product ? (
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-1.5 text-sm">
              <span>{product.name}{!product.track_imei && <span className="ml-2 text-xs text-amber-700">Track IMEI is off</span>}</span>
              <button type="button" className="text-xs text-neutral-500 hover:text-neutral-800" onClick={() => setProduct(null)}>Change</button>
            </div>
          ) : <ProductPicker onSelect={setProduct} placeholder="Search the model…" autoFocus />}
        </Field>
        <Field label={`IMEIs (${imeis.length})`} required>
          <Textarea id="add-imeis" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Scan or type one IMEI per line" className="font-mono" />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !product || !imeis.length}>{saving ? "Saving…" : "Add to stock"}</Button>
      </div>
    </Modal>
  );
}
