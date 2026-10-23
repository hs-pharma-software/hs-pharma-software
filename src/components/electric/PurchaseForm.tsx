"use client";

import { useMemo, useState } from "react";
import { Save, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { pick, useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import { calcDoc, cleanSerials, toRupees, type PaymentIn } from "@/lib/electric/engine";
import type { EsProduct } from "@/lib/electric/store";
import { PartyModal } from "./SaleForm";
import { DocModal, Err, Id, PageTitle, ProductSearch, Txt, money, todayYmd, useLoad } from "./ui";

interface Line {
  key: string;
  p: EsProduct;
  unit: "base" | "purchase";
  qty: string;
  cost: string;
  discount: string;
  taxRate: string;
  serials: string;
}

const unitCost = (p: EsProduct, unit: "base" | "purchase") => (unit === "purchase" && p.purchase_unit ? p.cost * (p.purchase_factor || 1) : p.cost);

export function PurchaseForm() {
  const t = useT();
  const suppliers = useLoad(() => electric.listParties("supplier"), []);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(todayYmd);
  const [lines, setLines] = useState<Line[]>([]);
  const [billDiscount, setBillDiscount] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<PaymentIn["method"]>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const calc = useMemo(
    () => calcDoc(lines.map((l) => ({ qty: Number(l.qty) || 0, price: Number(l.cost) || 0, discount: Number(l.discount) || 0, taxRate: Number(l.taxRate) || 0 })), Number(billDiscount) || 0),
    [lines, billDiscount]
  );
  const patch = (key: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...v } : l)));
  const add = (p: EsProduct) => {
    const unit = p.purchase_unit ? "purchase" : "base";
    setLines((ls) => [...ls, { key: crypto.randomUUID(), p, unit, qty: "1", cost: String(unitCost(p, unit)), discount: "", taxRate: "0", serials: "" }]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!supplierId) throw new Error("Select a supplier.");
      const r = await electric.createPurchase({
        supplierId,
        supplierInvoiceNo: invoiceNo.trim() || null,
        date,
        lines: lines.map((l) => ({ productId: l.p.id, unit: l.unit, qty: Number(l.qty), cost: Number(l.cost), discount: Number(l.discount) || 0, taxRate: Number(l.taxRate) || 0, serials: cleanSerials(l.serials.split(/[\n,]+/)) })),
        billDiscount: Number(billDiscount) || 0,
        payments: Number(paid) > 0 ? [{ method, amount: Number(paid) }] : [],
        notes: notes.trim() || null,
      });
      setSaved(r.doc.id);
      setLines([]);
      setInvoiceNo("");
      setPaid("");
      setBillDiscount("");
      setNotes("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const total = toRupees(calc.totalPaisa);
  return (
    <div className="space-y-4">
      <PageTitle title={t("pu.new")} />
      <div className="grid gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 md:grid-cols-3">
        <Field label={t("pu.supplier")} required>
          <div className="flex gap-1">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t("c.select")}</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button variant="ghost" title={t("pt.addSupplier")} onClick={() => setAdding(true)}>
              <UserPlus size={14} />
            </Button>
          </div>
        </Field>
        <Field label={t("pu.supplierInvoice")}>
          <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("c.date")}>
          <Input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
        <ProductSearch onPick={add} autoFocus />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500">
              <tr>
                <th className="px-2 py-1.5 text-start">{t("w.product")}</th>
                <th className="px-2 py-1.5 text-start">{t("c.unit")}</th>
                <th className="px-2 py-1.5 text-start">{t("c.qty")}</th>
                <th className="px-2 py-1.5 text-start">{t("pu.cost")}</th>
                <th className="px-2 py-1.5 text-start">{t("s.discount")}</th>
                <th className="px-2 py-1.5 text-start">{t("p.tax")}</th>
                <th className="px-2 py-1.5 text-end">{t("c.amount")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-t border-neutral-100 align-top">
                  <td className="px-2 py-1.5">
                    <div className="font-medium">
                      <Txt>{pick(t.lang, l.p.name, l.p.name_ur)}</Txt>
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      <Id>{l.p.sku}</Id>
                    </div>
                    {!!l.p.serial_tracked && (
                      <Textarea className="mt-1 font-mono text-xs" rows={2} dir="ltr" placeholder={t("pu.receiveSerials")} value={l.serials} onChange={(e) => patch(l.key, { serials: e.target.value })} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {l.p.purchase_unit ? (
                      <Select className="!w-28" value={l.unit} onChange={(e) => { const unit = e.target.value as "base" | "purchase"; patch(l.key, { unit, cost: String(unitCost(l.p, unit)) }); }}>
                        <option value="base">{l.p.unit}</option>
                        <option value="purchase">
                          {l.p.purchase_unit} (×{l.p.purchase_factor})
                        </option>
                      </Select>
                    ) : (
                      <span className="text-xs">{l.p.unit}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5"><Input className="!w-20" type="number" min="0" step="any" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input className="!w-28" type="number" min="0" step="any" value={l.cost} onChange={(e) => patch(l.key, { cost: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input className="!w-24" type="number" min="0" step="any" value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input className="!w-16" type="number" min="0" step="any" value={l.taxRate} onChange={(e) => patch(l.key, { taxRate: e.target.value })} /></td>
                  <td className="px-2 py-1.5 text-end font-semibold">{money(toRupees(calc.lines[i]?.totalPaisa ?? 0))}</td>
                  <td className="px-2 py-1.5">
                    <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={14} /></Button>
                  </td>
                </tr>
              ))}
              {!lines.length && (
                <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{t("c.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("pay.paid")}>
              <Input type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </Field>
            <Field label={t("pay.method")}>
              <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentIn["method"])}>
                {(["cash", "card", "bank", "digital", "cheque"] as const).map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t("c.notes")}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
          </Field>
        </div>
        <div className="space-y-2 rounded-xl bg-white p-4 text-sm ring-1 ring-black/5">
          <div className="flex justify-between"><span>{t("s.subtotal")}</span><span dir="ltr">{money(toRupees(calc.grossPaisa))}</span></div>
          <div className="flex items-center justify-between gap-2">
            <span>{t("s.billDiscount")}</span>
            <Input className="!w-32 text-end" type="number" min="0" step="any" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} />
          </div>
          <div className="flex justify-between"><span>{t("s.tax")}</span><span dir="ltr">{money(toRupees(calc.taxPaisa))}</span></div>
          <div className="flex justify-between border-t border-neutral-200 pt-2 text-lg font-bold"><span>{t("s.grandTotal")}</span><span dir="ltr">{money(total)}</span></div>
          {Number(paid) < total && <div className="flex justify-between text-rose-600"><span>{t("pay.balance")}</span><span dir="ltr">{money(total - (Number(paid) || 0))}</span></div>}
          <Err error={error} />
          <div className="flex justify-end pt-2">
            <Button variant="primary" disabled={busy || !lines.length} onClick={() => void submit()}>
              <Save size={14} /> {t("pu.save")}
            </Button>
          </div>
        </div>
      </div>
      {saved && <DocModal docId={saved} onClose={() => setSaved(null)} />}
      {adding && (
        <PartyModal
          type="supplier"
          onClose={() => setAdding(false)}
          onSaved={async (id) => {
            setAdding(false);
            await suppliers.reload();
            setSupplierId(id);
          }}
        />
      )}
    </div>
  );
}
