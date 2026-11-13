"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import type { DistMode } from "@/lib/dist/engine";
import type { DistProduct } from "@/lib/dist/store";
import { DistGuard, Err, Note, PageTitle, money, useLoad } from "@/components/dist/ui";
import { useCan } from "@/lib/actionPermissions";
import { buildCsv, downloadCsv as saveCsv } from "@/lib/csv";
import { parseCsv } from "@/lib/productImport";
import { detectNarcotic } from "@/lib/narcotics";

const CSV_HEADERS = ["code", "name", "company", "category", "unit", "pack_size", "generic_name", "strength", "dosage_form", "drap_reg_no", "barcode", "trade_price", "retail_price", "cost", "sales_tax_rate", "reorder_level", "opening_qty"];

export default function CatalogPage() {
  return <DistGuard need="catalog.view">{(c) => <Catalog mode={c.mode} canManage={c.can("catalog.manage")} canExport={c.can("reports.view")} />}</DistGuard>;
}

function Catalog({ mode, canManage, canExport }: { mode: DistMode; canManage: boolean; canExport: boolean }) {
  // Import / export / sample file: switched on per business by the Super Admin (off by default).
  const canCsv = useCan("products.csv");
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string; errors?: { row: number; code: string; message: string }[] } | null>(null);
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
            {canCsv && canExport && <Button onClick={() => saveCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(CSV_HEADERS, (list.data ?? []).map((p) => [p.code, p.name, p.company_name, p.category_name, p.unit, p.pack_size, p.generic_name, p.strength, p.dosage_form, p.drap_reg_no, p.barcode, p.trade_price, p.retail_price, p.cost, p.sales_tax_rate, p.reorder_level, p.stock])))}>Export CSV</Button>}
            {canCsv && canManage && <Button onClick={() => saveCsv("products-import-sample.csv", buildCsv(CSV_HEADERS, mode === "pharma"
              ? [["PAN500", "Panadol 500mg Tab", "GSK", "Tablets", "box", "10", "Paracetamol", "500mg", "Tablet", "012345", "8964000001", "420", "500", "380", "0", "20", "100"],
                 ["TRM50", "Tramal 50mg Cap", "Searle", "Capsules", "box", "10", "Tramadol", "50mg", "Capsule", "067890", "", "650", "750", "600", "0", "5", "10"]]
              : [["SOAP100", "Bath Soap 100g", "Unilever", "Personal Care", "pcs", "72", "", "", "", "", "8961000001", "95", "110", "85", "18", "50", "500"]]))}>Sample File</Button>}
            {canCsv && canManage && (
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50">
                Import CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setImportMsg(null);
                  try {
                    const [head, ...body] = parseCsv(await file.text()).filter((r) => r.some((c) => c.trim()));
                    const rows = body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
                    const r = await dist.importProducts(rows);
                    setImportMsg({ ok: !r.errors.length, text: `${r.created} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} not imported` : ""}.`, errors: r.errors });
                    void list.reload();
                  } catch (err) {
                    setImportMsg({ ok: false, text: errorText(err) });
                  }
                }} />
              </label>
            )}
            {canManage && <Button variant="primary" disabled={!companies.data?.length} onClick={() => setEditing({ is_active: 1, unit: mode === "pharma" ? "box" : "pcs", pack_size: 1 })}><Plus size={14} /> Add product</Button>}
          </>
        }
      />
      {!companies.data?.length && !companies.loading && <Err error="Add a company first (Companies)." />}
      {importMsg && (
        <Note tone={importMsg.ok ? "emerald" : "amber"}>
          {importMsg.text}
          {!!importMsg.errors?.length && <ul className="mt-1 list-disc ps-5 text-xs">{importMsg.errors.slice(0, 20).map((x) => <li key={x.row}>Row {x.row}{x.code ? ` (${x.code})` : ""}: {x.message}</li>)}</ul>}
        </Note>
      )}
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
                  {p.is_narcotic === 1 && <span className="ms-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800" title="Sold only to customers with a valid CDSL (Form-9)">Narcotic · Form-9</span>}
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
            {(() => {
              const hit = detectNarcotic(v.generic_name, v.name);
              return hit ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-900 md:col-span-3" role="status">
                  <b>Narcotic / controlled ({hit.toLowerCase()})</b>: this product will be sold only to customers with a valid CDSL (Form-9).
                </p>
              ) : null;
            })()}
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
