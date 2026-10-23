"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { pick, useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import { calcDoc, toRupees, type PaymentIn } from "@/lib/electric/engine";
import { ES_SETTINGS, type EsProduct } from "@/lib/electric/store";
import type { InvoiceLang } from "./EsInvoice";
import { DocModal, Err, Id, Note, PageTitle, ProductSearch, SerialPicker, Txt, money, todayYmd, useLoad } from "./ui";

interface Line {
  key: string;
  p: EsProduct;
  unit: "base" | "purchase";
  qty: string;
  price: string;
  discount: string;
  serials: string[];
}

const METHODS: PaymentIn["method"][] = ["cash", "card", "bank", "digital", "cheque"];
const unitPrice = (p: EsProduct, unit: "base" | "purchase") => (unit === "purchase" && p.purchase_unit ? p.price * (p.purchase_factor || 1) : p.price);

/** New sales invoice or quotation. */
export function SaleForm({ mode }: { mode: "sale" | "quotation" }) {
  const t = useT();
  const sale = mode === "sale";
  const customers = useLoad(() => electric.listParties("customer"), []);
  const [customerId, setCustomerId] = useState("");
  const [walkName, setWalkName] = useState("");
  const [walkPhone, setWalkPhone] = useState("");
  const [date, setDate] = useState(todayYmd);
  const [validUntil, setValidUntil] = useState("");
  const [lang, setLang] = useState<InvoiceLang>("en");
  const [lines, setLines] = useState<Line[]>([]);
  const [billDiscount, setBillDiscount] = useState("");
  const [payments, setPayments] = useState<{ method: PaymentIn["method"]; amount: string }[]>([{ method: "cash", amount: "" }]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ id: string; change: number } | null>(null);
  const [addingCustomer, setAddingCustomer] = useState(false);

  useEffect(() => {
    void electric.settings.get(ES_SETTINGS.invoiceLang).then((v) => v && setLang(v as InvoiceLang));
  }, []);

  const calc = useMemo(
    () => calcDoc(lines.map((l) => ({ qty: Number(l.qty) || 0, price: Number(l.price) || 0, discount: Number(l.discount) || 0, taxRate: l.p.tax_rate })), Number(billDiscount) || 0),
    [lines, billDiscount]
  );
  const total = toRupees(calc.totalPaisa);
  const tendered = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const add = (p: EsProduct) => {
    setError(null);
    setLines((ls) => {
      const same = ls.find((l) => l.p.id === p.id && l.unit === "base" && !p.serial_tracked);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l));
      return [...ls, { key: crypto.randomUUID(), p, unit: "base", qty: "1", price: String(unitPrice(p, "base")), discount: "", serials: [] }];
    });
  };
  const patch = (key: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...v } : l)));

  const reset = () => {
    setLines([]);
    setBillDiscount("");
    setPayments([{ method: "cash", amount: "" }]);
    setNotes("");
    setWalkName("");
    setWalkPhone("");
    setCustomerId("");
    setValidUntil("");
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const cust = customers.data?.find((c) => c.id === customerId);
      const common = {
        customerId: customerId || null,
        customerName: cust ? cust.name : walkName.trim() || null,
        customerPhone: cust ? cust.phone : walkPhone.trim() || null,
        date,
        lang,
        lines: lines.map((l) => ({ productId: l.p.id, unit: l.unit, qty: Number(l.qty), price: Number(l.price), discount: Number(l.discount) || 0, serials: l.serials })),
        billDiscount: Number(billDiscount) || 0,
        notes: notes.trim() || null,
      };
      if (sale) {
        const r = await electric.createSale({ ...common, payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })) });
        setSaved({ id: r.doc.id, change: r.change });
      } else {
        const r = await electric.createQuotation({ ...common, validUntil: validUntil || null });
        setSaved({ id: r.doc.id, change: 0 });
      }
      reset();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle title={sale ? t("s.newSale") : t("s.newQuotation")} />
      <div className="grid gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 md:grid-cols-4">
        <Field label={t("s.customer")}>
          <div className="flex gap-1">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t("c.walkIn")}</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` — ${c.phone}` : ""}
                </option>
              ))}
            </Select>
            <Button variant="ghost" title={t("pt.addCustomer")} onClick={() => setAddingCustomer(true)}>
              <UserPlus size={14} />
            </Button>
          </div>
        </Field>
        {!customerId && (
          <>
            <Field label={t("s.customerName")}>
              <Input value={walkName} onChange={(e) => setWalkName(e.target.value)} dir="auto" />
            </Field>
            <Field label={t("s.customerPhone")}>
              <Input value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} dir="ltr" />
            </Field>
          </>
        )}
        <Field label={t("c.date")}>
          <Input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {!sale && (
          <Field label={t("s.validUntil")}>
            <Input type="date" value={validUntil} min={date} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        )}
        <Field label={t("s.invoiceLang")}>
          <Select value={lang} onChange={(e) => setLang(e.target.value as InvoiceLang)}>
            <option value="en">{t("lang.en")}</option>
            <option value="ur">{t("lang.ur")}</option>
            <option value="bi">{t("set.bilingual")}</option>
          </Select>
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
                <th className="px-2 py-1.5 text-start">{t("c.price")}</th>
                <th className="px-2 py-1.5 text-start">{t("s.discount")}</th>
                <th className="px-2 py-1.5 text-end">{t("s.tax")}</th>
                <th className="px-2 py-1.5 text-end">{t("c.amount")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = calc.lines[i];
                const baseQty = (Number(l.qty) || 0) * (l.unit === "purchase" ? l.p.purchase_factor || 1 : 1);
                return (
                  <tr key={l.key} className="border-t border-neutral-100 align-top">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">
                        <Txt>{pick(t.lang, l.p.name, l.p.name_ur)}</Txt>
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        <Id>{l.p.sku}</Id> · {t("p.stock")}: <Id>{l.p.stock}</Id> {l.p.unit}
                      </div>
                      {sale && !!l.p.serial_tracked && (
                        <div className="mt-1">
                          <SerialPicker productId={l.p.id} count={Math.max(0, Math.round(baseQty))} value={l.serials} onChange={(v) => patch(l.key, { serials: v })} />
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {l.p.purchase_unit ? (
                        <Select
                          className="!w-24"
                          value={l.unit}
                          onChange={(e) => {
                            const unit = e.target.value as "base" | "purchase";
                            patch(l.key, { unit, price: String(unitPrice(l.p, unit)), serials: [] });
                          }}
                        >
                          <option value="base">{l.p.unit}</option>
                          <option value="purchase">
                            {l.p.purchase_unit} (×{l.p.purchase_factor})
                          </option>
                        </Select>
                      ) : (
                        <span className="text-xs">{l.p.unit}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="!w-20" type="number" min="0" step="any" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value, serials: [] })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="!w-28" type="number" min="0" step="any" value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="!w-24" type="number" min="0" step="any" value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5 text-end text-xs">
                      {l.p.tax_rate ? (
                        <>
                          <Id>{l.p.tax_rate}%</Id>
                          <br />
                          {money(toRupees(c?.taxPaisa ?? 0))}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-end font-semibold">{money(toRupees(c?.totalPaisa ?? 0))}</td>
                    <td className="px-2 py-1.5">
                      <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!lines.length && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-neutral-400">
                    {t("c.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
          {sale && (
            <>
              <p className="text-sm font-semibold">{t("pay.payment")}</p>
              {payments.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <Select value={p.method} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentIn["method"] } : x)))}>
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`pay.${m}`)}
                      </option>
                    ))}
                  </Select>
                  <Input type="number" min="0" step="any" placeholder={t("pay.received")} value={p.amount} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  {i === 0 ? (
                    <Button onClick={() => setPayments(payments.map((x, j) => (j === 0 ? { ...x, amount: String(Math.max(0, total - payments.slice(1).reduce((s, y) => s + (Number(y.amount) || 0), 0))) } : x)))}>{t("pay.exact")}</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setPayments(payments.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="ghost" onClick={() => setPayments([...payments, { method: "digital", amount: "" }])}>
                <Plus size={14} /> {t("pay.split")}
              </Button>
            </>
          )}
          <Field label={t("c.notes")}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
          </Field>
        </div>
        <div className="space-y-2 rounded-xl bg-white p-4 text-sm ring-1 ring-black/5">
          <Row label={t("s.subtotal")} value={money(toRupees(calc.grossPaisa))} />
          <div className="flex items-center justify-between gap-2">
            <span>{t("s.billDiscount")}</span>
            <Input className="!w-32 text-end" type="number" min="0" step="any" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} />
          </div>
          <Row label={t("s.discount")} value={money(toRupees(calc.discountPaisa))} />
          <Row label={t("s.tax")} value={money(toRupees(calc.taxPaisa))} />
          <Row label={t("s.grandTotal")} value={money(total)} big />
          {sale && (
            <>
              <Row label={t("pay.received")} value={money(Math.min(tendered, total))} />
              {tendered > total && <Row label={t("pay.change")} value={money(tendered - total)} />}
              {tendered < total && <Row label={`${t("pay.balance")} (${t("s.credit")})`} value={money(total - tendered)} tone="rose" />}
            </>
          )}
          <Err error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={reset}>{t("c.cancel")}</Button>
            <Button variant="primary" disabled={busy || !lines.length} onClick={() => void submit()}>
              <Save size={14} /> {sale ? t("s.saveInvoice") : t("s.saveQuotation")}
            </Button>
          </div>
        </div>
      </div>

      {saved && saved.change > 0 && (
        <Note tone="emerald">
          {t("pay.change")}: <b>{money(saved.change)}</b>
        </Note>
      )}
      {saved && <DocModal docId={saved.id} onClose={() => setSaved(null)} />}
      {addingCustomer && (
        <PartyModal
          type="customer"
          onClose={() => setAddingCustomer(false)}
          onSaved={async (id) => {
            setAddingCustomer(false);
            await customers.reload();
            setCustomerId(id);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: "rose" }) {
  return (
    <div className={`flex justify-between ${big ? "border-t border-neutral-200 pt-2 text-lg font-bold" : ""} ${tone === "rose" ? "text-rose-600" : ""}`}>
      <span>{label}</span>
      <span dir="ltr">{value}</span>
    </div>
  );
}

/** Quick add of a customer or supplier (shared party tables). */
export function PartyModal({ type, onClose, onSaved }: { type: "customer" | "supplier"; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [opening, setOpening] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={type === "customer" ? t("pt.addCustomer") : t("pt.addSupplier")} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <Field label={t("c.name")} required>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
        </Field>
        <Field label={t("c.phone")}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("c.address")}>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} dir="auto" />
        </Field>
        <Field label={t("pt.opening")}>
          <Input type="number" min="0" step="any" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("c.cancel")}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const r = await electric.saveParty(type, { name, phone, address, opening_balance: Number(opening) || 0 });
                onSaved((r as { id: string }).id);
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
