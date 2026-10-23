"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { pick, useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import { cleanSerials } from "@/lib/electric/engine";
import type { EsProduct } from "@/lib/electric/store";
import { Err, EsGuard, Id, PageTitle, ProductSearch, Txt, money, useLoad } from "@/components/electric/ui";

export default function StockPage() {
  return (
    <EsGuard>
      <Stock />
    </EsGuard>
  );
}

function Stock() {
  const t = useT();
  const [product, setProduct] = useState<EsProduct | null>(null);
  const [adjusting, setAdjusting] = useState<EsProduct | null>(null);
  const products = useLoad(() => electric.listProducts({}), []);
  const moves = useLoad(() => electric.stockMoves(product?.id ?? null, 300), [product?.id]);
  const value = (products.data ?? []).reduce((s, p) => s + Math.max(0, p.stock) * p.avg_cost, 0);
  return (
    <div className="space-y-4">
      <PageTitle title={t("st.title")} />
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label={t("nav.products")} value={String(products.data?.length ?? 0)} />
        <Stat label={t("d.inventoryValue")} value={money(value)} />
        <Stat label={t("d.outOfStock")} value={String((products.data ?? []).filter((p) => p.stock <= 0).length)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-72 flex-1">
          <ProductSearch onPick={setProduct} />
        </div>
        {product && (
          <>
            <span className="text-sm">
              <Txt>{pick(t.lang, product.name, product.name_ur)}</Txt> — {t("p.stock")}: <Id>{product.stock}</Id> {product.unit}
            </span>
            <Button onClick={() => setAdjusting(product)}>
              <SlidersHorizontal size={14} /> {t("st.adjust")}
            </Button>
            <Button variant="ghost" onClick={() => setProduct(null)}>{t("c.all")}</Button>
          </>
        )}
      </div>
      <Err error={moves.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <p className="px-3 pt-3 text-sm font-semibold">{t("st.movements")}</p>
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("c.date")}</th>
              <th className="px-3 py-2 text-start">{t("w.product")}</th>
              <th className="px-3 py-2 text-start">{t("c.status")}</th>
              <th className="px-3 py-2 text-end">{t("c.qty")}</th>
              <th className="px-3 py-2 text-end">{t("pu.cost")}</th>
              <th className="px-3 py-2 text-start">{t("c.notes")}</th>
            </tr>
          </thead>
          <tbody>
            {(moves.data ?? []).map((m) => (
              <tr key={m.id} className="border-t border-neutral-100">
                <td className="px-3 py-1.5 text-xs"><Id>{m.created_at.slice(0, 16).replace("T", " ")}</Id></td>
                <td className="px-3 py-1.5"><Txt>{pick(t.lang, m.name, m.name_ur)}</Txt></td>
                <td className="px-3 py-1.5 text-xs">{t(`mv.${m.reason}`)}</td>
                <td className={`px-3 py-1.5 text-end font-medium ${m.qty < 0 ? "text-rose-600" : "text-emerald-700"}`}><Id>{m.qty > 0 ? `+${m.qty}` : m.qty}</Id></td>
                <td className="px-3 py-1.5 text-end text-xs">{m.unit_cost ? money(m.unit_cost) : ""}</td>
                <td className="px-3 py-1.5 text-xs"><Txt>{m.note}</Txt></td>
              </tr>
            ))}
            {!moves.data?.length && <tr><td colSpan={6} className="py-8 text-center text-neutral-400">{moves.loading ? t("c.loading") : t("c.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {adjusting && (
        <AdjustModal
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={async () => {
            setAdjusting(null);
            const fresh = await electric.getProduct(adjusting.id);
            setProduct(fresh);
            void products.reload();
            void moves.reload();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold" dir="ltr">{value}</p>
    </div>
  );
}

function AdjustModal({ product, onClose, onDone }: { product: EsProduct; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<"adjustment" | "count">("adjustment");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [serials, setSerials] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("st.adjust")} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <p className="text-sm"><Txt>{pick(t.lang, product.name, product.name_ur)}</Txt> — {t("p.stock")}: <Id>{product.stock}</Id> {product.unit}</p>
        <Field label={t("c.status")}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as "adjustment" | "count")}>
            <option value="adjustment">{t("st.adjustment")}</option>
            <option value="count">{t("st.count")}</option>
          </Select>
        </Field>
        <Field label={`${t("c.qty")} (${product.unit})`} required>
          <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {!!product.serial_tracked && (
          <Field label={t("p.serials")}>
            <Textarea rows={3} dir="ltr" className="font-mono text-xs" value={serials} onChange={(e) => setSerials(e.target.value)} />
          </Field>
        )}
        <Field label={t("st.reason")} required>
          <Input value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
        </Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("c.cancel")}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await electric.adjustStock(product.id, kind, Number(qty), note, cleanSerials(serials.split(/[\n,]+/)));
                onDone();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {t("c.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
