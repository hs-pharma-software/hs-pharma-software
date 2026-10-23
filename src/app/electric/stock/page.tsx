"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import { Err, EsGuard, Id, Note, PageTitle, Txt, money, useLoad } from "@/components/electric/ui";

export default function StockPage() {
  return (
    <EsGuard>
      <Stock />
    </EsGuard>
  );
}

function Stock() {
  const t = useT();
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"" | "low" | "out">("");
  const [adjusting, setAdjusting] = useState<{ id: string; name: string; sku: string; stock: number; unit: string; serialTracked: boolean } | null>(null);

  const list = useLoad(
    () => electric.listProducts({ search: search || undefined, stockFilter: (stockFilter as "low" | "out") || null, includeInactive: false }),
    [search, stockFilter]
  );

  const moves = useLoad(() => electric.stockMoves(null, 200), []);

  return (
    <div className="space-y-4">
      <PageTitle title={t("st.title")} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stock levels */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="!w-60"
              placeholder={t("c.searchProducts")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select className="!w-40" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as "" | "low" | "out")}>
              <option value="">{t("p.stock")}: {t("c.all")}</option>
              <option value="low">{t("p.low")}</option>
              <option value="out">{t("p.out")}</option>
            </Select>
          </div>
          <Err error={list.error} />
          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-start">{t("p.sku")}</th>
                  <th className="px-3 py-2 text-start">{t("p.name")}</th>
                  <th className="px-3 py-2 text-end">{t("p.stock")}</th>
                  <th className="px-3 py-2 text-end">{t("p.avgCost")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-xs"><Id>{p.sku}</Id></td>
                    <td className="px-3 py-2">
                      <span className="font-medium"><Txt>{p.name}</Txt></span>
                      {p.category_name && <span className="block text-[11px] text-neutral-400">{p.category_name}</span>}
                    </td>
                    <td className={`px-3 py-2 text-end text-xs font-semibold tabular-nums ${p.stock <= 0 ? "text-rose-600" : p.reorder_level > 0 && p.stock <= p.reorder_level ? "text-amber-600" : "text-emerald-700"}`}>
                      <Id>{p.stock}</Id> {p.unit}
                    </td>
                    <td className="px-3 py-2 text-end text-xs text-neutral-500">{money(p.avg_cost)}</td>
                    <td className="px-3 py-2 text-end">
                      <Button
                        variant="ghost"
                        title={t("st.adjust")}
                        onClick={() =>
                          setAdjusting({ id: p.id, name: p.name, sku: p.sku, stock: p.stock, unit: p.unit, serialTracked: !!p.serial_tracked })
                        }
                      >
                        <SlidersHorizontal size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!list.data?.length && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-neutral-400">
                      {list.loading ? t("c.loading") : t("c.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent movements */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">{t("st.movements")}</h2>
          <Err error={moves.error} />
          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-start">Date</th>
                  <th className="px-3 py-2 text-start">{t("p.sku")}</th>
                  <th className="px-3 py-2 text-start">Reason</th>
                  <th className="px-3 py-2 text-end">Qty</th>
                </tr>
              </thead>
              <tbody>
                {(moves.data ?? []).map((m) => (
                  <tr key={m.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      <Id>{m.created_at.slice(0, 16).replace("T", " ")}</Id>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Id>{m.sku}</Id>
                      <span className="block text-[11px] text-neutral-400 max-w-[120px] truncate">
                        <Txt>{m.name}</Txt>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600 max-w-[140px] truncate">
                      {m.reason}{m.note ? ` · ${m.note}` : ""}
                      {m.created_by && <span className="block text-[10px] text-neutral-400">{m.created_by}</span>}
                    </td>
                    <td className={`px-3 py-2 text-end text-xs font-semibold tabular-nums ${m.qty >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      <Id>{m.qty >= 0 ? `+${m.qty}` : String(m.qty)} {m.unit}</Id>
                    </td>
                  </tr>
                ))}
                {!moves.data?.length && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-neutral-400">
                      {moves.loading ? t("c.loading") : t("c.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {adjusting && (
        <AdjustModal
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            void list.reload();
            void moves.reload();
          }}
        />
      )}
    </div>
  );
}

function AdjustModal({
  product,
  onClose,
  onSaved,
}: {
  product: { id: string; name: string; sku: string; stock: number; unit: string; serialTracked: boolean };
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<"adjustment" | "count">("adjustment");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [serials, setSerials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const serialList = serials ? serials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
      await electric.adjustStock(product.id, kind, Number(qty), note, serialList);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const newQty = kind === "count" ? Number(qty) : product.stock + Number(qty || 0);

  return (
    <Modal title={t("st.adjust")} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
          <span className="text-neutral-500">{t("p.sku")}:</span> <Id>{product.sku}</Id>{" "}
          <span className="font-medium"><Txt>{product.name}</Txt></span>
          <br />
          <span className="text-neutral-500">{t("p.stock")}:</span>{" "}
          <span className="font-semibold tabular-nums"><Id>{product.stock} {product.unit}</Id></span>
        </div>

        <div className="flex gap-2">
          {(["adjustment", "count"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1.5 text-sm ${kind === k ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}
            >
              {k === "adjustment" ? t("st.adjustment") : t("st.count")}
            </button>
          ))}
        </div>

        {kind === "count" ? (
          <Note tone="neutral">
            <span className="text-xs">{t("st.count")}: enter the actual quantity on the shelf. The difference will be recorded as an adjustment.</span>
          </Note>
        ) : (
          <Note tone="neutral">
            <span className="text-xs">{t("st.adjustment")}: enter a positive number to add stock, or a negative number (e.g. −5) to remove.</span>
          </Note>
        )}

        <Field label={kind === "count" ? `${t("p.stock")} (${t("p.unit")}: ${product.unit})` : t("st.adjustment")} required>
          <Input
            type="number"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder={kind === "count" ? String(product.stock) : "+5 or −3"}
          />
        </Field>

        {qty && (
          <p className="text-sm text-neutral-600">
            New stock: <span className="font-semibold"><Id>{newQty} {product.unit}</Id></span>
          </p>
        )}

        <Field label={t("st.reason")} required>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Physical count, Damaged, Return from site…" />
        </Field>

        {product.serialTracked && qty && Math.abs(Number(qty)) > 0 && (
          <Field label={t("p.serials")} required>
            <Textarea
              rows={4}
              dir="ltr"
              placeholder={"SN001\nSN002"}
              value={serials}
              onChange={(e) => setSerials(e.target.value)}
            />
          </Field>
        )}

        <Err error={error} />
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button onClick={onClose}>{t("c.cancel")}</Button>
          <Button variant="primary" disabled={busy || !qty || !note} onClick={() => void save()}>
            {t("c.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
