"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { pick, useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import type { EsProduct } from "@/lib/electric/store";
import { Err, EsGuard, Id, Note, PageTitle, Txt, money, useLoad } from "@/components/electric/ui";

export default function ProductsPage() {
  return (
    <EsGuard>
      <Products />
    </EsGuard>
  );
}

const PRODUCT_TYPES = ["general", "electrical", "cable", "solar_panel", "inverter", "battery", "electronics"] as const;

function Products() {
  const t = useT();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [stockFilter, setStockFilter] = useState<"" | "low" | "out">("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Partial<EsProduct> | null>(null);

  const categories = useLoad(() => electric.listCategories(true), []);
  const list = useLoad(
    () =>
      electric.listProducts({
        search: search || undefined,
        categoryId: categoryId || null,
        type: typeFilter || null,
        stockFilter: (stockFilter as "low" | "out") || null,
        includeInactive: showInactive,
      }),
    [search, categoryId, typeFilter, stockFilter, showInactive]
  );

  return (
    <div className="space-y-3">
      <PageTitle
        title={t("p.title")}
        actions={
          <Button variant="primary" onClick={() => setEditing({ is_active: 1, product_type: "general", unit: "pcs", purchase_factor: 1, tax_rate: 0 })}>
            <Plus size={14} /> {t("p.add")}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Input
          className="!w-72"
          placeholder={t("c.searchProducts")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select className="!w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("p.category")}: {t("c.all")}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {pick(t.lang, c.name, c.name_ur)}
            </option>
          ))}
        </Select>
        <Select className="!w-44" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">{t("p.type")}: {t("c.all")}</option>
          {PRODUCT_TYPES.map((tp) => (
            <option key={tp} value={tp}>{t(`type.${tp}`)}</option>
          ))}
        </Select>
        <Select className="!w-40" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as "" | "low" | "out")}>
          <option value="">{t("p.stock")}: {t("c.all")}</option>
          <option value="low">{t("p.low")}</option>
          <option value="out">{t("p.out")}</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t("c.inactive")}
        </label>
      </div>

      <Err error={list.error} />

      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("p.sku")}</th>
              <th className="px-3 py-2 text-start">{t("p.name")}</th>
              <th className="px-3 py-2 text-start">{t("p.category")}</th>
              <th className="px-3 py-2 text-start">{t("p.type")}</th>
              <th className="px-3 py-2 text-end">{t("p.price")}</th>
              <th className="px-3 py-2 text-end">{t("p.stock")}</th>
              <th className="px-3 py-2 text-start">{t("c.status")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.id} className={`border-t border-neutral-100 ${!p.is_active ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 text-xs">
                  <Id>{p.sku}</Id>
                  {p.barcode && <span className="block text-[10px] text-neutral-400"><Id>{p.barcode}</Id></span>}
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium"><Txt>{p.name}</Txt></span>
                  {p.name_ur && <span className="block font-urdu text-[12px]" dir="rtl">{p.name_ur}</span>}
                  {(p.brand || p.model) && (
                    <span className="block text-[11px] text-neutral-400">
                      {[p.brand, p.model].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{p.category_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{t(`type.${p.product_type}`)}</td>
                <td className="px-3 py-2 text-end text-xs font-semibold">{money(p.price)}</td>
                <td className={`px-3 py-2 text-end text-xs font-semibold ${p.stock <= 0 ? "text-rose-600" : p.reorder_level > 0 && p.stock <= p.reorder_level ? "text-amber-600" : ""}`}>
                  {p.stock} {p.unit}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${p.is_active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
                    {p.is_active ? t("c.active") : t("c.inactive")}
                  </span>
                </td>
                <td className="px-3 py-2 text-end">
                  <Button variant="ghost" onClick={() => setEditing(p)}>
                    <Pencil size={14} />
                  </Button>
                </td>
              </tr>
            ))}
            {!list.data?.length && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-neutral-400">
                  {list.loading ? t("c.loading") : t("c.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ProductModal
          value={editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void list.reload();
          }}
        />
      )}
    </div>
  );
}

function ProductModal({
  value,
  categories,
  onClose,
  onSaved,
}: {
  value: Partial<EsProduct> & { opening?: { qty: number; unitCost: number; serials?: string[] } };
  categories: { id: string; name: string; name_ur: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const isNew = !value.id;
  const [v, setV] = useState<Partial<EsProduct> & { openingQty?: number; openingCost?: number; openingSerials?: string }>(value);
  const [tab, setTab] = useState<"basic" | "pricing" | "warranty">("basic");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suppliers = useLoad(() => electric.listParties("supplier"), []);

  const n = (k: keyof EsProduct, label: string, opts: { required?: boolean; step?: string } = {}) => (
    <Field label={label} required={opts.required}>
      <Input
        type="number"
        min="0"
        step={opts.step ?? "any"}
        value={v[k] == null ? "" : String(v[k])}
        onChange={(e) => setV({ ...v, [k]: e.target.value === "" ? null : Number(e.target.value) } as typeof v)}
      />
    </Field>
  );

  const f = (k: keyof EsProduct, label: string, opts: { required?: boolean; dir?: string; cls?: string } = {}) => (
    <Field label={label} required={opts.required}>
      <Input
        dir={opts.dir}
        className={opts.cls}
        value={v[k] == null ? "" : String(v[k])}
        onChange={(e) => setV({ ...v, [k]: e.target.value || null } as typeof v)}
      />
    </Field>
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Strip form-only fields before passing to the store.
      const { openingQty, openingCost, openingSerials, ...productData } = v;
      await electric.saveProduct({
        ...productData,
        specs: productData.specs ?? null,
        opening:
          isNew && (openingQty ?? 0) > 0
            ? {
                qty: Number(openingQty),
                unitCost: Number(openingCost ?? 0),
                serials: openingSerials
                  ? openingSerials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
                  : [],
              }
            : null,
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { key: "basic" as const, label: t("p.basic") },
    { key: "pricing" as const, label: t("p.pricing") },
    { key: "warranty" as const, label: t("p.warranty") },
  ];

  return (
    <Modal title={isNew ? t("p.add") : t("p.edit")} onClose={onClose} width="max-w-3xl">
      <div className="flex gap-1 border-b border-neutral-200 pb-0 mb-3">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`rounded-t px-4 py-1.5 text-sm font-medium transition-colors ${tab === tb.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="max-h-[60vh] overflow-y-auto pe-1">
        {tab === "basic" && (
          <div className="grid gap-3 md:grid-cols-3">
            {f("name", t("p.name"), { required: true })}
            {f("name_ur", t("p.nameUr"), { dir: "rtl", cls: "font-urdu" })}
            {f("sku", t("p.sku"), { required: true })}
            {f("barcode", t("p.barcode"))}
            <Field label={t("p.category")}>
              <Select value={v.category_id ?? ""} onChange={(e) => setV({ ...v, category_id: e.target.value || null })}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(t.lang, c.name, c.name_ur)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.type")}>
              <Select value={v.product_type ?? "general"} onChange={(e) => setV({ ...v, product_type: e.target.value as EsProduct["product_type"] })}>
                {PRODUCT_TYPES.map((tp) => (
                  <option key={tp} value={tp}>{t(`type.${tp}`)}</option>
                ))}
              </Select>
            </Field>
            {f("brand", t("p.brand"))}
            {f("model", t("p.model"))}
            {f("manufacturer", t("p.manufacturer"))}
            <Field label={t("p.unit")} required>
              <Input
                value={v.unit ?? ""}
                onChange={(e) => setV({ ...v, unit: e.target.value })}
                placeholder="pcs, m, kW…"
              />
            </Field>
            {f("purchase_unit", t("p.purchaseUnit"))}
            {n("purchase_factor", t("p.factor"))}
            <Field label={t("p.image")}><Input value={v.image ?? ""} onChange={(e) => setV({ ...v, image: e.target.value || null })} /></Field>
            {f("location", t("p.location"))}
            <Field label={t("p.description")}>
              <Textarea rows={2} value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value || null })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm md:col-span-3">
              <input type="checkbox" checked={!!v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked ? 1 : 0 })} />
              {t("p.isActive")}
            </label>
          </div>
        )}

        {tab === "pricing" && (
          <div className="grid gap-3 md:grid-cols-3">
            {n("price", t("p.price"), { required: true })}
            {n("wholesale_price", t("p.wholesale"))}
            {n("min_price", t("p.minPrice"))}
            {n("cost", t("p.cost"))}
            {n("tax_rate", t("p.tax"))}
            {n("reorder_level", t("p.reorder"))}
            <Field label={t("p.supplier")}>
              <Select value={v.supplier_id ?? ""} onChange={(e) => setV({ ...v, supplier_id: e.target.value || null })}>
                <option value="">—</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            {isNew && (
              <>
                <Note tone="neutral">
                  <span className="block text-xs font-semibold mb-1">{t("p.opening")}</span>
                  <span className="text-xs text-neutral-500">Set opening stock and cost when creating this product.</span>
                </Note>
                <Field label={t("p.opening")}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={v.openingQty ?? ""}
                    onChange={(e) => setV({ ...v, openingQty: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </Field>
                <Field label={t("p.openingCost")}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={v.openingCost ?? ""}
                    onChange={(e) => setV({ ...v, openingCost: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </Field>
              </>
            )}
          </div>
        )}

        {tab === "warranty" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={!!v.serial_tracked} onChange={(e) => setV({ ...v, serial_tracked: e.target.checked ? 1 : 0 })} />
              {t("p.serialTracked")}
            </label>
            {n("warranty_mfr_months", t("p.warrantyMfr"))}
            {n("warranty_seller_months", t("p.warrantySeller"))}
            {isNew && !!v.serial_tracked && (v.openingQty ?? 0) > 0 && (
              <Field label={t("p.serials")} required>
                <Textarea
                  rows={4}
                  dir="ltr"
                  placeholder={"SN001\nSN002\nSN003"}
                  value={v.openingSerials ?? ""}
                  onChange={(e) => setV({ ...v, openingSerials: e.target.value })}
                />
              </Field>
            )}
          </div>
        )}
      </div>

      <Err error={error} />
      <div className="mt-3 flex justify-end gap-2 border-t border-neutral-100 pt-3">
        <Button onClick={onClose}>{t("c.cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {t("c.save")}
        </Button>
      </div>
    </Modal>
  );
}
