"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { pick, useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import { SERIAL_DEFAULT, SPEC_FIELDS, cleanSerials, type ProductType } from "@/lib/electric/engine";
import { DEFAULT_UNITS, ES_SETTINGS, type EsProduct } from "@/lib/electric/store";
import { Err, EsGuard, Id, PageTitle, Txt, money, useLoad } from "@/components/electric/ui";
import { exportCsv, downloadCsv, buildCsv } from "@/lib/csv";

const TYPES: ProductType[] = ["general", "electrical", "cable", "solar_panel", "inverter", "battery", "electronics"];

export default function ProductsPage() {
  return (
    <EsGuard>
      <Products />
    </EsGuard>
  );
}

function Products() {
  const t = useT();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState("");
  const [stockFilter, setStockFilter] = useState<"" | "low" | "out">("");
  const [editing, setEditing] = useState<EsProduct | "new" | null>(null);
  const cats = useLoad(() => electric.listCategories(), []);
  const list = useLoad(() => electric.listProducts({ search, categoryId: categoryId || null, type: type || null, includeInactive: true, stockFilter: stockFilter || null }), [search, categoryId, type, stockFilter]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <PageTitle
        title={t("p.title")}
        actions={
          <>
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus size={14} /> {t("p.add")}
            </Button>
            <Button
              onClick={() => {
                const data = list.data ?? [];
                exportCsv(
                  `products-${new Date().toISOString().slice(0,10)}.csv`,
                  ["SKU","Name","Category","Type","Brand","Model","Unit","Price","Stock"],
                  data.map((p) => [p.sku, pick(t.lang, p.name, p.name_ur), pick(t.lang, p.category_name ?? "", p.category_name_ur), p.product_type, p.brand, p.model, p.unit, p.price, p.stock])
                );
              }}
            >
              Export CSV
            </Button>
            <Button
              onClick={() => {
                const headers = ["SKU","Name (English)*","Name (Urdu)","Category","Type*","Brand","Model","Unit*","Cost Price","Sale Price","Min Stock Level"];
                const sample = [
                  ["ELEC-001","LED Bulb 18W","ایل ای ڈی بلب","Lighting","electrical","Philips","PH-18W","Piece","85.00","120.00","10"],
                  ["SOL-001","Solar Panel 150W","سولر پینل","Solar","solar_panel","Longi","LR4-150","Panel","15000.00","18000.00","2"],
                  ["","(* = required)","","","general/electrical/cable/solar_panel/inverter/battery/electronics","","","","","",""],
                ];
                downloadCsv("products-import-sample.csv", buildCsv(headers, sample));
              }}
            >
              Sample File
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("c.searchProducts")} />
        </div>
        <Select className="!w-56" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">
            {t("p.category")}: {t("c.all")}
          </option>
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {pick(t.lang, c.name, c.name_ur)}
            </option>
          ))}
        </Select>
        <Select className="!w-44" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">
            {t("p.type")}: {t("c.all")}
          </option>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`type.${ty}`)}
            </option>
          ))}
        </Select>
        <Select className="!w-36" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as "" | "low" | "out")}>
          <option value="">{t("c.all")}</option>
          <option value="low">{t("p.low")}</option>
          <option value="out">{t("p.out")}</option>
        </Select>
      </div>
      <Err error={list.error ?? error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("p.sku")}</th>
              <th className="px-3 py-2 text-start">{t("c.name")}</th>
              <th className="px-3 py-2 text-start">{t("p.category")}</th>
              <th className="px-3 py-2 text-start">{t("p.type")}</th>
              <th className="px-3 py-2 text-start">{t("p.model")}</th>
              <th className="px-3 py-2 text-end">{t("p.price")}</th>
              <th className="px-3 py-2 text-end">{t("p.stock")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.id} className={`border-t border-neutral-100 ${p.is_active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2"><Id>{p.sku}</Id></td>
                <td className="px-3 py-2">
                  <div className="font-medium"><Txt>{pick(t.lang, p.name, p.name_ur)}</Txt></div>
                  {p.brand && <div className="text-[11px] text-neutral-500"><Txt>{p.brand}</Txt></div>}
                </td>
                <td className="px-3 py-2 text-xs"><Txt>{pick(t.lang, p.category_name ?? "", p.category_name_ur)}</Txt></td>
                <td className="px-3 py-2 text-xs">{t(`type.${p.product_type}`)}</td>
                <td className="px-3 py-2 text-xs"><Id>{p.model}</Id></td>
                <td className="px-3 py-2 text-end">{money(p.price)}</td>
                <td className={`px-3 py-2 text-end font-medium ${p.stock <= 0 ? "text-rose-600" : p.reorder_level > 0 && p.stock <= p.reorder_level ? "text-amber-600" : ""}`}>
                  <Id>{p.stock}</Id> <span className="text-xs text-neutral-500">{p.unit}</span>
                </td>
                <td className="px-3 py-2 text-end whitespace-nowrap">
                  <Button variant="ghost" onClick={() => setEditing(p)}><Pencil size={14} /></Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(`${t("c.delete")}: ${p.name}?`)) return;
                      try {
                        await electric.deleteProduct(p.id);
                        setError(null);
                        void list.reload();
                      } catch (e) {
                        setError(errorText(e));
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </td>
              </tr>
            ))}
            {!list.data?.length && (
              <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{list.loading ? t("c.loading") : t("c.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <ProductModal product={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
    </div>
  );
}

type Form = Record<string, string | boolean>;

function ProductModal({ product, onClose, onSaved }: { product: EsProduct | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const cats = useLoad(() => electric.listCategories(), []);
  const suppliers = useLoad(() => electric.listParties("supplier"), []);
  const [units, setUnits] = useState<string[]>(DEFAULT_UNITS);
  const s = (v: unknown) => (v == null ? "" : String(v));
  const [f, setF] = useState<Form>(() => ({
    name: s(product?.name), name_ur: s(product?.name_ur), sku: s(product?.sku), barcode: s(product?.barcode),
    category_id: s(product?.category_id), product_type: product?.product_type ?? "general",
    brand: s(product?.brand), manufacturer: s(product?.manufacturer), model: s(product?.model),
    description: s(product?.description), description_ur: s(product?.description_ur),
    unit: product?.unit ?? "pcs", purchase_unit: s(product?.purchase_unit), purchase_factor: s(product?.purchase_factor ?? 1),
    cost: s(product?.cost ?? ""), price: s(product?.price ?? ""), wholesale_price: s(product?.wholesale_price), min_price: s(product?.min_price),
    tax_rate: s(product?.tax_rate ?? ""), supplier_id: s(product?.supplier_id), reorder_level: s(product?.reorder_level ?? ""), location: s(product?.location),
    is_active: product ? !!product.is_active : true, serial_tracked: product ? !!product.serial_tracked : false,
    warranty_mfr_months: s(product?.warranty_mfr_months), warranty_seller_months: s(product?.warranty_seller_months),
    hs_code: s(product?.hs_code), fbr_sale_type: s(product?.fbr_sale_type), fbr_uom: s(product?.fbr_uom), sro_no: s(product?.sro_no), sro_item_serial_no: s(product?.sro_item_serial_no),
    opening_qty: "", opening_cost: "", opening_serials: "",
  }));
  const [specs, setSpecs] = useState<Record<string, string>>(() => {
    try {
      return product?.specs ? (JSON.parse(product.specs) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const type = f.product_type as ProductType;

  useEffect(() => {
    void electric.settings.get(ES_SETTINGS.units).then((v) => {
      const list = v ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];
      if (list.length) setUnits(list);
    });
    if (!product) void electric.settings.get(ES_SETTINGS.defaultTax).then((v) => v && setF((x) => ({ ...x, tax_rate: x.tax_rate || v })));
  }, [product]);

  const txt = (k: string, label: string, opts: { required?: boolean; dir?: "ltr" | "auto"; type?: string; urdu?: boolean } = {}) => (
    <Field label={label} required={opts.required}>
      <Input
        type={opts.type ?? "text"}
        step={opts.type === "number" ? "any" : undefined}
        min={opts.type === "number" ? "0" : undefined}
        dir={opts.urdu ? "rtl" : opts.dir ?? "auto"}
        className={opts.urdu ? "font-urdu" : ""}
        value={String(f[k] ?? "")}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );
  const num = (v: string | boolean) => (v === "" ? null : Number(v));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const openingQty = Number(f.opening_qty) || 0;
      await electric.saveProduct({
        id: product?.id,
        name: String(f.name), name_ur: String(f.name_ur) || null, sku: String(f.sku), barcode: String(f.barcode) || null,
        category_id: String(f.category_id) || null, product_type: type,
        brand: String(f.brand) || null, manufacturer: String(f.manufacturer) || null, model: String(f.model) || null,
        description: String(f.description) || null, description_ur: String(f.description_ur) || null,
        unit: String(f.unit), purchase_unit: String(f.purchase_unit) || null, purchase_factor: Number(f.purchase_factor) || 1,
        cost: Number(f.cost) || 0, price: Number(f.price) || 0, wholesale_price: num(f.wholesale_price), min_price: num(f.min_price),
        tax_rate: Number(f.tax_rate) || 0, supplier_id: String(f.supplier_id) || null, reorder_level: Number(f.reorder_level) || 0, location: String(f.location) || null,
        is_active: f.is_active ? 1 : 0, serial_tracked: f.serial_tracked ? 1 : 0,
        warranty_mfr_months: num(f.warranty_mfr_months), warranty_seller_months: num(f.warranty_seller_months),
        hs_code: String(f.hs_code) || null, fbr_sale_type: String(f.fbr_sale_type) || null, fbr_uom: String(f.fbr_uom) || null, sro_no: String(f.sro_no) || null, sro_item_serial_no: String(f.sro_item_serial_no) || null,
        specs,
        opening: !product && openingQty > 0 ? { qty: openingQty, unitCost: Number(f.opening_cost) || Number(f.cost) || 0, serials: cleanSerials(String(f.opening_serials).split(/[\n,]+/)) } : null,
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <fieldset className="rounded-xl border border-neutral-200 p-3">
      <legend className="px-1 text-xs font-semibold text-neutral-600">{title}</legend>
      <div className="grid gap-2 md:grid-cols-3">{children}</div>
    </fieldset>
  );

  return (
    <Modal title={product ? t("p.edit") : t("p.add")} onClose={onClose} width="max-w-4xl">
      <div className="max-h-[75vh] space-y-3 overflow-y-auto pe-1">
        {Section({
          title: t("p.basic"),
          children: (
            <>
              <Field label={t("p.type")} required>
                <Select
                  value={type}
                  onChange={(e) => {
                    const nt = e.target.value as ProductType;
                    setF((x) => ({ ...x, product_type: nt, serial_tracked: product ? x.serial_tracked : SERIAL_DEFAULT[nt], unit: !product && nt === "cable" ? "m" : x.unit, purchase_unit: !product && nt === "cable" && !x.purchase_unit ? "roll" : x.purchase_unit }));
                  }}
                >
                  {TYPES.map((ty) => <option key={ty} value={ty}>{t(`type.${ty}`)}</option>)}
                </Select>
              </Field>
              {txt("name", t("p.name"), { required: true })}
              {txt("name_ur", t("p.nameUr"), { urdu: true })}
              {txt("sku", t("p.sku"), { required: true, dir: "ltr" })}
              {txt("barcode", t("p.barcode"), { dir: "ltr" })}
              <Field label={t("p.category")}>
                <Select value={String(f.category_id)} onChange={(e) => set("category_id", e.target.value)}>
                  <option value="">{t("c.none")}</option>
                  {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(t.lang, c.name, c.name_ur)}</option>)}
                </Select>
              </Field>
              {txt("brand", t("p.brand"))}
              {txt("manufacturer", t("p.manufacturer"))}
              {txt("model", t("p.model"), { dir: "ltr" })}
              <div className="md:col-span-3 grid gap-2 md:grid-cols-2">
                <Field label={t("p.description")}><Textarea rows={2} value={String(f.description)} onChange={(e) => set("description", e.target.value)} dir="auto" /></Field>
                <Field label={t("p.descriptionUr")}><Textarea rows={2} className="font-urdu" dir="rtl" value={String(f.description_ur)} onChange={(e) => set("description_ur", e.target.value)} /></Field>
              </div>
            </>
          ),
        })}
        {SPEC_FIELDS[type].length > 0 &&
          Section({
            title: `${t("p.specs")} — ${t(`type.${type}`)}`,
            children: SPEC_FIELDS[type].map((sf) => (
              <Field key={sf.key} label={`${t(sf.label)}${sf.unit ? ` (${sf.unit})` : ""}`}>
                {sf.kind === "select" ? (
                  <Select value={specs[sf.key] ?? ""} onChange={(e) => setSpecs({ ...specs, [sf.key]: e.target.value })}>
                    <option value="">—</option>
                    {sf.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                ) : (
                  <Input type={sf.kind === "number" ? "number" : "text"} min="0" step="any" dir="ltr" value={specs[sf.key] ?? ""} onChange={(e) => setSpecs({ ...specs, [sf.key]: e.target.value })} />
                )}
              </Field>
            )),
          })}
        {Section({
          title: t("p.pricing"),
          children: (
            <>
              <Field label={t("p.unit")} required>
                <Select value={String(f.unit)} onChange={(e) => set("unit", e.target.value)}>
                  {[...new Set([...units, String(f.unit)])].map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </Field>
              <Field label={t("p.purchaseUnit")}>
                <Select value={String(f.purchase_unit)} onChange={(e) => set("purchase_unit", e.target.value)}>
                  <option value="">{t("c.none")}</option>
                  {[...new Set([...units, String(f.purchase_unit)].filter(Boolean))].map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </Field>
              {f.purchase_unit ? txt("purchase_factor", `${t("p.factor")} (1 ${f.purchase_unit} = ? ${f.unit})`, { type: "number" }) : <div />}
              {txt("cost", t("p.cost"), { type: "number" })}
              {txt("price", t("p.price"), { type: "number", required: true })}
              {txt("wholesale_price", t("p.wholesale"), { type: "number" })}
              {txt("min_price", t("p.minPrice"), { type: "number" })}
              {txt("tax_rate", t("p.tax"), { type: "number" })}
              {txt("reorder_level", t("p.reorder"), { type: "number" })}
              {txt("location", t("p.location"))}
              <Field label={t("p.supplier")}>
                <Select value={String(f.supplier_id)} onChange={(e) => set("supplier_id", e.target.value)}>
                  <option value="">{t("c.none")}</option>
                  {(suppliers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={!!f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> {t("p.isActive")}
              </label>
              {!product && (
                <>
                  {txt("opening_qty", `${t("p.opening")} (${f.unit})`, { type: "number" })}
                  {txt("opening_cost", t("p.openingCost"), { type: "number" })}
                </>
              )}
            </>
          ),
        })}
        {Section({
          title: t("p.warranty"),
          children: (
            <>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={!!f.serial_tracked} disabled={!!product && product.stock !== 0} onChange={(e) => set("serial_tracked", e.target.checked)} /> {t("p.serialTracked")}
              </label>
              {txt("warranty_mfr_months", t("p.warrantyMfr"), { type: "number" })}
              {txt("warranty_seller_months", t("p.warrantySeller"), { type: "number" })}
              {!product && !!f.serial_tracked && Number(f.opening_qty) > 0 && (
                <div className="md:col-span-3">
                  <Field label={`${t("p.serials")} — ${Number(f.opening_qty)}`}>
                    <Textarea rows={3} dir="ltr" className="font-mono text-xs" value={String(f.opening_serials)} onChange={(e) => set("opening_serials", e.target.value)} />
                  </Field>
                </div>
              )}
            </>
          ),
        })}
        {Section({
          title: t("p.fbr"),
          children: (
            <>
              {txt("hs_code", "HS Code", { dir: "ltr" })}
              {txt("fbr_sale_type", "Sale Type", { dir: "ltr" })}
              {txt("fbr_uom", "FBR UoM", { dir: "ltr" })}
              {txt("sro_no", "SRO / Schedule No", { dir: "ltr" })}
              {txt("sro_item_serial_no", "SRO Item Serial No", { dir: "ltr" })}
            </>
          ),
        })}
        <Err error={error} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose}>{t("c.cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>{t("c.save")}</Button>
      </div>
    </Modal>
  );
}
