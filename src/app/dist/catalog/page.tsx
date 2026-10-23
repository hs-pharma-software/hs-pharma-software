"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import type { DistMode } from "@/lib/dist/engine";
import type { DistProduct } from "@/lib/dist/store";
import { DistGuard, Err, PageTitle, downloadCsv, money, useLoad } from "@/components/dist/ui";

export default function CatalogPage() {
  return <DistGuard need="catalog.view">{(c) => <Catalog mode={c.mode} canManage={c.can("catalog.manage")} canExport={c.can("reports.view")} />}</DistGuard>;
}

function Catalog({ mode, canManage, canExport }: { mode: DistMode; canManage: boolean; canExport: boolean }) {
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [editing, setEditing] = useState<Partial<DistProduct> | null>(null);
  const companies = useLoad(() => dist.listCompanies({ includeInactive: true }), []);
  const cats = useLoad(() => dist.listCategories(true), []);
  const list = useLoad(() => dist.listProducts({ search, companyId: companyId || null, categoryId: categoryId || null, includeInactive: true }), [search, companyId, categoryId]);
  return (
    <div className="space-y-3">
      <PageTitle
        title={mode === "pharma" ? "Pharma Products" : "Products"}
        sub="Your own catalog only."
        actions={
          <>
            {canExport && <Button onClick={() => downloadCsv("products.csv", (list.data ?? []).map(({ code, name, company_name, category_name, unit, trade_price, retail_price, stock }) => ({ code, name, company_name, category_name, unit, trade_price, retail_price, stock })))}>Export CSV</Button>}
            {canManage && <Button variant="primary" disabled={!companies.data?.length} onClick={() => setEditing({ is_active: 1, unit: mode === "pharma" ? "box" : "pcs", pack_size: 1 })}><Plus size={14} /> Add product</Button>}
          </>
        }
      />
      {!companies.data?.length && !companies.loading && <Err error="Add a company first (Companies)." />}
      <div className="flex flex-wrap gap-2">
        <Input className="!w-72" placeholder={mode === "pharma" ? "Search name, code, barcode, generic" : "Search name, code, barcode, brand"} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="!w-56" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">All companies</option>
          {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="!w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">Code</th>
              <th className="px-3 py-2 text-start">Product</th>
              <th className="px-3 py-2 text-start">Company</th>
              <th className="px-3 py-2 text-start">Category</th>
              <th className="px-3 py-2 text-end">Trade price</th>
              <th className="px-3 py-2 text-end">ST %</th>
              <th className="px-3 py-2 text-end">Stock</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.id} className={`border-t border-neutral-100 ${p.is_active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2 text-xs">{p.code}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-[11px] text-neutral-500">{[p.generic_name, p.strength, p.dosage_form, p.brand, p.size, `${p.unit}${p.pack_size > 1 ? ` × ${p.pack_size}` : ""}`].filter(Boolean).join(" · ")}</span>
                </td>
                <td className="px-3 py-2 text-xs">{p.company_name}</td>
                <td className="px-3 py-2 text-xs">{p.category_name ?? "—"}</td>
                <td className="px-3 py-2 text-end">{money(p.trade_price)}</td>
                <td className="px-3 py-2 text-end text-xs">{p.sales_tax_rate}</td>
                <td className={`px-3 py-2 text-end ${p.stock <= 0 ? "text-rose-600" : p.reorder_level && p.stock <= p.reorder_level ? "text-amber-600" : ""}`}>{p.stock}</td>
                <td className="px-3 py-2 text-end">{canManage && <Button variant="ghost" onClick={() => setEditing(p)}><Pencil size={14} /></Button>}</td>
              </tr>
            ))}
            {!list.data?.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "No content in table"}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <ProductModal mode={mode} value={editing} companies={companies.data ?? []} categories={cats.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />
      )}
    </div>
  );
}

function ProductModal({ mode, value, companies, categories, onClose, onSaved }: { mode: DistMode; value: Partial<DistProduct>; companies: { id: string; name: string }[]; categories: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<DistProduct> & { openingQty?: number }>(value);
  const [error, setError] = useState<string | null>(null);
  const t = (k: keyof DistProduct, label: string, opts: { required?: boolean; num?: boolean } = {}) => (
    <Field label={label} required={opts.required}>
      <Input type={opts.num ? "number" : "text"} step="any" min={opts.num ? "0" : undefined} value={v[k] == null ? "" : String(v[k])} onChange={(e) => setV({ ...v, [k]: opts.num ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })} />
    </Field>
  );
  return (
    <Modal title={value.id ? "Edit product" : "Add product"} onClose={onClose} width="max-w-3xl">
      <div className="grid max-h-[70vh] gap-3 overflow-y-auto md:grid-cols-3">
        <Field label="Company" required>
          <Select value={v.company_id ?? ""} onChange={(e) => setV({ ...v, company_id: e.target.value })}>
            <option value="">Select…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={v.category_id ?? ""} onChange={(e) => setV({ ...v, category_id: e.target.value || null })}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {t("code", "Product code", { required: true })}
        {t("name", "Product name", { required: true })}
        {t("barcode", "Barcode")}
        {t("unit", "Unit (box, pack, carton…)")}
        {t("pack_size", "Pack size", { num: true })}
        {mode === "pharma" ? (
          <>
            {t("generic_name", "Generic name")}
            {t("strength", "Strength")}
            {t("dosage_form", "Dosage form")}
            {t("drap_reg_no", "DRAP registration no.")}
          </>
        ) : (
          <>
            {t("brand", "Brand")}
            {t("size", "Size / weight")}
          </>
        )}
        {t("trade_price", "Trade price (selling)", { required: true, num: true })}
        {t("retail_price", "Retail price / MRP", { num: true })}
        {t("cost", "Purchase cost", { num: true })}
        {t("min_price", "Minimum selling price", { num: true })}
        {t("sales_tax_rate", "Sales tax %", { num: true })}
        {t("reorder_level", "Reorder level", { num: true })}
        {!value.id && (
          <Field label="Opening stock">
            <Input type="number" min="0" step="any" value={v.openingQty ?? ""} onChange={(e) => setV({ ...v, openingQty: Number(e.target.value) || 0 })} />
          </Field>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={v.is_active !== 0} onChange={(e) => setV({ ...v, is_active: e.target.checked ? 1 : 0 })} /> Active</label>
      </div>
      <Err error={error} />
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { try { await dist.saveProduct(v); onSaved(); } catch (e) { setError(errorText(e)); } }}>Save</Button>
      </div>
    </Modal>
  );
}
