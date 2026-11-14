"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import { schemeOffer } from "@/lib/dist/engine";
import type { DistDoc, DistDocItem, DistProduct, DistScheme } from "@/lib/dist/store";
import { Err, money, useLoad, type DistCtx } from "./ui";
import { Combo } from "./Combo";
import { PurchaseRateBubble } from "@/components/invoices/PurchaseRateBubble";

type LastRates = Awaited<ReturnType<typeof dist.lastPurchaseRates>>;
type HeldBatch = { batchNo: string | null; expiry: string | null; qty: number };

interface Line {
  key: string;
  p: DistProduct;
  batch: string;
  expiry: string;
  qty: string;
  bonus: string;
  price: string;
  discPct: string;
  extraPct: string;
  discount: string;
  tax: string;
  last?: LastRates | null;
  /** Sale lines: stock now, the batches it is in, and the company's schemes. */
  stock?: number | null;
  batches?: HeldBatch[];
  schemes?: DistScheme[];
  /** Bonus / extra % typed by the user (a scheme no longer fills them). */
  ownTerms?: boolean;
  offer?: string | null;
}

const num = (v: string) => Number(v) || 0;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A line's figures as the server works them out: discount %, then extra % on
 * what is left, then rupees; sales tax on the rest. (The server's figure is final.) */
function lineFigures(l: Line) {
  const gross = num(l.qty) * num(l.price);
  const pct = (v: string) => Math.min(100, Math.max(0, num(v)));
  const first = (gross * pct(l.discPct)) / 100;
  const extra = ((gross - first) * pct(l.extraPct)) / 100;
  const disc = Math.min(gross, first + extra + Math.max(0, num(l.discount)));
  const taxed = (gross - disc) * (1 + Math.max(0, num(l.tax)) / 100);
  return { gross, disc, net: Math.round(taxed * 100) / 100 };
}

/** What the company's scheme gives a line at its quantity (unless the user typed their own terms). */
function withScheme(l: Line): Line {
  if (!l.schemes?.length) return { ...l, offer: null };
  const o = schemeOffer(l.schemes, num(l.qty), ymd(new Date()));
  if (l.ownTerms) return { ...l, offer: o?.label ?? null };
  return { ...l, bonus: o?.bonus ? String(o.bonus) : "", extraPct: o?.extraPct ? String(o.extraPct) : "", offer: o?.label ?? null };
}

/** Active products, searched as you type (↑ / ↓, Enter). */
export function ProductPicker({ onPick, companyId, autoFocus }: { onPick: (p: DistProduct) => void; companyId?: string | null; autoFocus?: boolean }) {
  const all = useLoad(() => dist.listProducts(companyId ? { companyId } : {}), [companyId]);
  const items = useMemo(() => (all.data ?? []).map((p) => ({
    id: p.id, label: p.name, sub: `${p.code}${p.company_name ? ` · ${p.company_name}` : ""}${p.barcode ? ` · ${p.barcode}` : ""}`,
    right: `${money(p.trade_price)} · stock ${p.stock}`,
  })), [all.data]);
  return (
    <Combo items={items} clearOnPick autoFocus={autoFocus} loading={all.loading} placeholder="Search product name / code / barcode (↑ ↓ Enter)"
      onPick={(id) => { const p = all.data?.find((x) => x.id === id); if (p) onPick(p); }} emptyText="No product matches." />
  );
}

const cell = "px-1 py-1";
const box = (w: string) => `!${w} !px-1.5 !py-1 text-end`;

/** The shared line grid: Product, Batch, Expiry, Qty, Bonus, Rate, Disc %, Extra %, Disc Rs, ST %, (W.T %), Net. */
function LineGrid({ lines, patch, remove, can, whtRate, showLast, onQtyFocus, sale = false }: {
  lines: Line[]; patch: (k: string, v: Partial<Line>) => void; remove: (k: string) => void;
  can: { price: (l: Line) => boolean; discount: boolean; bonus: boolean; tax: boolean };
  whtRate?: number | null; showLast?: boolean; onQtyFocus?: (k: string | null) => void; sale?: boolean;
}) {
  if (!lines.length) return <p className="rounded-xl bg-neutral-50 py-6 text-center text-xs text-neutral-400">Search a product above to add a line.</p>;
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-black/5">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="bg-neutral-50 text-[11px] text-neutral-500">
          <tr>
            <th className="px-2 py-1.5 text-start font-medium">Product</th>
            <th className="font-medium">Batch</th><th className="font-medium">Expiry</th>
            <th className="font-medium">Qty</th><th className="font-medium">Bonus</th><th className="font-medium">Rate</th>
            <th className="font-medium">Disc %</th><th className="font-medium">Extra %</th><th className="font-medium">Disc Rs</th>
            <th className="font-medium">ST %</th>{whtRate !== undefined && <th className="font-medium">W.T %</th>}
            <th className="px-2 text-end font-medium">Net</th><th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const f = lineFigures(l);
            const stock = l.stock ?? l.p.stock;
            const over = sale && num(l.qty) + num(l.bonus) > Number(stock);
            return (
              <tr key={l.key} className="border-t border-neutral-100 align-top">
                <td className="max-w-60 px-2 py-1.5">
                  <span className="font-medium text-neutral-800">{l.p.name}</span>
                  <span className={`block text-[11px] ${over ? "font-semibold text-rose-700" : "text-neutral-500"}`}>{l.p.code} · available {stock}{over ? " — not enough" : ""}</span>
                  {l.offer && <span className="block text-[11px] text-emerald-700">Scheme: {l.offer}</span>}
                  {showLast && <LastRate last={l.last} />}
                </td>
                <td className={cell}>
                  {sale && l.batches?.length ? (
                    <Select className="!w-36 !px-1.5 !py-1 text-xs" value={l.batch} onChange={(e) => { const b = l.batches!.find((x) => (x.batchNo ?? "") === e.target.value); patch(l.key, { batch: e.target.value, expiry: b?.expiry ?? "" }); }}>
                      <option value="">—</option>
                      {l.batches.map((b, i) => <option key={i} value={b.batchNo ?? ""}>{b.batchNo ?? "(no batch)"} · {b.qty}</option>)}
                    </Select>
                  ) : <Input className="!w-24 !px-1.5 !py-1" value={l.batch} onChange={(e) => patch(l.key, { batch: e.target.value })} />}
                </td>
                <td className={cell}><Input className="!w-32 !px-1.5 !py-1" type="date" value={l.expiry} onChange={(e) => patch(l.key, { expiry: e.target.value })} /></td>
                <td className={cell}><Input className={box("w-16")} type="number" min="0" step="any" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })}
                  onFocus={() => onQtyFocus?.(l.key)} onBlur={() => onQtyFocus?.(null)} /></td>
                <td className={cell}><Input className={box("w-14")} type="number" min="0" step="any" disabled={!can.bonus} value={l.bonus} onChange={(e) => patch(l.key, { bonus: e.target.value, ownTerms: true })} /></td>
                <td className={cell}><Input className={box("w-20")} type="number" min="0" step="any" disabled={!can.price(l)} value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} /></td>
                <td className={cell}><Input className={box("w-14")} type="number" min="0" max="100" step="any" disabled={!can.discount} value={l.discPct} onChange={(e) => patch(l.key, { discPct: e.target.value })} /></td>
                <td className={cell}><Input className={box("w-14")} type="number" min="0" max="100" step="any" disabled={!can.discount} value={l.extraPct} onChange={(e) => patch(l.key, { extraPct: e.target.value, ownTerms: true })} /></td>
                <td className={cell}><Input className={box("w-16")} type="number" min="0" step="any" disabled={!can.discount} value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} /></td>
                <td className={cell}><Input className={box("w-14")} type="number" min="0" step="any" disabled={!can.tax} value={l.tax} onChange={(e) => patch(l.key, { tax: e.target.value })} /></td>
                {whtRate !== undefined && <td className="px-1 py-2 text-end text-xs tabular-nums text-neutral-600">{whtRate == null ? "—" : `${whtRate} %`}</td>}
                <td className="px-2 py-2 text-end tabular-nums">
                  {money(f.net)}
                  {f.disc > 0 && <span className="block text-[10px] text-neutral-400">−{money(f.disc)}</span>}
                </td>
                <td className="py-1"><Button variant="ghost" title="Remove line" onClick={() => remove(l.key)}><Trash2 size={14} /></Button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LastRate({ last }: { last?: LastRates | null }) {
  if (last === undefined) return <span className="block text-[11px] text-neutral-400">last rate…</span>;
  const r = last?.supplier ?? last?.any;
  if (!r) return <span className="block text-[11px] text-neutral-400">never bought before</span>;
  const terms = [r.disc_pct ? `${r.disc_pct} %` : "", r.extra_disc_pct ? `+${r.extra_disc_pct} %` : "", r.bonus_qty ? `bonus ${r.bonus_qty}/${r.qty}` : ""].filter(Boolean).join(" · ");
  return (
    <span className="block text-[11px] text-sky-800" title={last?.any && last.supplier && last.any !== last.supplier ? `From any company: ${money(last.any.price)} on ${last.any.date}` : undefined}>
      Last {money(r.price)}{terms ? ` · ${terms}` : ""} · {r.date}{last?.supplier ? "" : ` (${r.party_name ?? "other company"})`}
    </span>
  );
}

const newLine = (p: DistProduct, price: number, tax: number): Line => ({
  key: crypto.randomUUID(), p, batch: "", expiry: "", qty: "1", bonus: "", price: String(price || ""), discPct: "", extraPct: "", discount: "", tax: String(tax),
});

/** Direct sales invoice (outside a booking). Price / discount / bonus / WHT changes
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
  // The administrator, and sub-users allowed in Permissions > Invoices.
  const showsRate = c.can("invoices.view_cost");
  const [rateKey, setRateKey] = useState<string | null>(null);
  const rateLine = rateKey ? lines.find((l) => l.key === rateKey) : undefined;
  const toLines = () => lines.map((l) => ({
    productId: l.p.id, qty: num(l.qty), price: c.can("invoices.edit_price") ? num(l.price) : null,
    discount: num(l.discount), discPct: num(l.discPct), extraDiscPct: num(l.extraPct), bonusQty: num(l.bonus),
    batchNo: l.batch.trim() || null, expiry: l.expiry || null,
  }));
  useEffect(() => {
    if (!customerId || !lines.length) return setPreview(null);
    const h = setTimeout(() => void dist.previewWht(customerId, toLines()).then(setPreview).catch(() => setPreview(null)), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, lines]);
  // A new quantity re-applies the company's scheme (unless the user typed their own bonus / extra %).
  const patch = (k: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? ("qty" in v ? withScheme({ ...l, ...v }) : { ...l, ...v }) : l)));
  const customer = customers.data?.find((x) => x.id === customerId);
  const appliedRate = whtRate !== "" ? num(whtRate) : preview ? preview.treatment.rate : null;
  const customerItems = useMemo(() => (customers.data ?? []).map((x) => ({
    id: x.id, label: x.business_name, sub: `${x.code}${x.owner_name ? ` · ${x.owner_name}` : ""}${x.mobile ? ` · ${x.mobile}` : ""} · ATL ${x.atl_status}`,
  })), [customers.data]);
  /** A product picked: its stock, batches (earliest expiry first) and scheme come with it. */
  const addProduct = (p: DistProduct) => {
    const l = newLine(p, p.trade_price, p.sales_tax_rate);
    setLines((ls) => [...ls, l]);
    void dist.productStock(p.id).then((s) => {
      const first = s.batches.find((b) => b.qty > 0);
      setLines((ls) => ls.map((x) => (x.key === l.key ? withScheme({ ...x, stock: s.stock, batches: s.batches, schemes: s.schemes, batch: first?.batchNo ?? "", expiry: first?.expiry ?? "" }) : x)));
    }).catch(() => undefined);
  };
  return (
    <Modal title="New sales invoice" onClose={onClose} width="max-w-6xl">
      <div className="space-y-3 text-sm">
        <Field label="Customer" required>
          <Combo items={customerItems} value={customerId} onPick={setCustomerId} autoFocus loading={customers.loading} placeholder="Search customer name / code / mobile (↑ ↓ Enter)" emptyText="No customer matches." />
          {customer && preview && <span className="text-[11px] text-neutral-500">Withholding {preview.treatment.section}: {preview.treatment.rate} % ({preview.treatment.status === "active" ? "on the Active Taxpayers List" : preview.treatment.status})</span>}
        </Field>
        <ProductPicker onPick={addProduct} />
        <LineGrid
          sale lines={lines} patch={patch} remove={(k) => setLines((ls) => ls.filter((x) => x.key !== k))}
          can={{ price: () => c.can("invoices.edit_price"), discount: c.can("invoices.discount"), bonus: c.can("invoices.bonus"), tax: false }}
          whtRate={appliedRate} onQtyFocus={setRateKey}
        />
        {showsRate && rateLine && <PurchaseRateBubble rate={Number(rateLine.p.cost) || 0} onClose={() => setRateKey(null)} />}
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

/** New purchase, or (with `edit`) a saved one changed. */
export function PurchaseForm({ c, onClose, onSaved, edit }: { c: DistCtx; onClose: () => void; onSaved: (id: string) => void; edit?: { doc: DistDoc; items: DistDocItem[] } | null }) {
  const companies = useLoad(() => dist.listCompanies({ includeInactive: false }), []);
  const products = useLoad(() => (edit ? dist.listProducts({ includeInactive: true }) : Promise.resolve([])), [edit?.doc.id]);
  const [supplierId, setSupplierId] = useState(edit?.doc.party_id ?? "");
  const [invoiceNo, setInvoiceNo] = useState(edit?.doc.supplier_invoice_no ?? "");
  const [date, setDate] = useState(edit?.doc.date ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [whtRate, setWhtRate] = useState(edit && edit.doc.wht_rate ? String(edit.doc.wht_rate) : "");
  const [whtSection, setWhtSection] = useState(edit?.doc.wht_section ?? "236G");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const patch = (k: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...v } : l)));
  // Editing: the saved lines, once the products are known.
  useEffect(() => {
    if (!edit || !products.data || lines.length) return;
    const s = (v: number | null | undefined) => (v ? String(v) : "");
    setLines(edit.items.flatMap((i) => {
      const p = products.data!.find((x) => x.id === i.product_id);
      if (!p) return [];
      return [{
        key: crypto.randomUUID(), p, batch: i.batch_no ?? "", expiry: i.expiry ?? "", qty: String(i.qty), bonus: s(i.bonus_qty), price: String(i.price),
        discPct: s(i.disc_pct), extraPct: s(i.extra_disc_pct), discount: i.disc_pct || i.extra_disc_pct ? "" : s(i.discount), tax: s(i.sales_tax_rate), last: null,
      }];
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, products.data]);
  // Last purchase rate of each line's product (from this company, else from any).
  const loadLast = (key: string, productId: string, sup: string) =>
    void dist.lastPurchaseRates(productId, sup || null).then((last) => patch(key, { last })).catch(() => patch(key, { last: null }));
  useEffect(() => {
    if (edit) return;
    for (const l of lines) loadLast(l.key, l.p.id, supplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);
  const goods = lines.reduce((s, l) => s + lineFigures(l).net, 0);
  const wht = Math.round(goods * num(whtRate)) / 100;
  const companyItems = useMemo(() => (companies.data ?? []).map((s) => ({ id: s.id, label: s.name, sub: s.code || undefined })), [companies.data]);
  const input = () => ({
    supplierId, supplierInvoiceNo: invoiceNo || null, whtRate: num(whtRate), whtSection, date: date || undefined,
    lines: lines.map((l) => ({
      productId: l.p.id, qty: num(l.qty), cost: num(l.price), discount: num(l.discount), discPct: num(l.discPct), extraDiscPct: num(l.extraPct),
      bonusQty: num(l.bonus), taxRate: num(l.tax), batchNo: l.batch.trim() || null, expiry: l.expiry || null,
    })),
  });
  return (
    <Modal title={edit ? `Edit purchase #${edit.doc.doc_no}` : "New purchase"} onClose={onClose} width="max-w-6xl">
      <div className="space-y-3 text-sm">
        <div className="grid gap-2 md:grid-cols-3">
          <Field label="Company (supplier)" required>
            <Combo items={companyItems} value={supplierId} onPick={setSupplierId} autoFocus={!edit} loading={companies.loading} placeholder="Search company (↑ ↓ Enter)" />
          </Field>
          <Field label="Supplier invoice #"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <ProductPicker onPick={(p) => {
          const l = newLine(p, p.cost, 0);
          setLines((ls) => [...ls, l]);
          loadLast(l.key, p.id, supplierId);
        }} />
        <LineGrid
          lines={lines} patch={patch} remove={(k) => setLines((ls) => ls.filter((x) => x.key !== k))} showLast={!edit}
          can={{ price: (l) => !(l.p.cost > 0) || c.can("purchases.edit_price"), discount: c.can("purchases.discount"), bonus: true, tax: c.can("purchases.edit_tax") }}
        />
        <div className="grid gap-2 md:grid-cols-3">
          <Field label="Withholding tax charged by the supplier (W.T %)">
            <Input type="number" min="0" max="100" step="any" disabled={!c.can("purchases.edit_tax")} value={whtRate} onChange={(e) => setWhtRate(e.target.value)} placeholder="e.g. 0.1" />
          </Field>
          <Field label="Section">
            <Select value={whtSection} disabled={!c.can("purchases.edit_tax")} onChange={(e) => setWhtSection(e.target.value)}>
              <option value="236G">236G · distributors / wholesalers (0.1 % ATL / 2 % non-ATL)</option>
              <option value="236H">236H · retailers (0.5 % ATL / 2.5 % non-ATL)</option>
            </Select>
          </Field>
          <div className="self-end rounded-xl bg-neutral-50 px-3 py-2 text-end">
            <p className="text-xs text-neutral-500">Goods {money(goods)}{num(whtRate) > 0 ? ` + W.T ${money(wht)}` : ""}</p>
            <p className="font-semibold">Approx. owed {money(goods + wht)}</p>
            <p className="text-[10px] text-neutral-400">calculated exactly when saved</p>
          </div>
        </div>
        {edit ? (
          <Field label="Reason for the change (audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong quantity entered" /></Field>
        ) : c.can("payments.receive") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Paid now"><Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {edit && <p className="text-xs text-neutral-500">Stock moves by the difference. Payments already made stay on the purchase.</p>}
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!supplierId || !lines.length}
            onClick={async () => {
              setError(null);
              try {
                const r = edit
                  ? await dist.updatePurchase(edit.doc.id, { ...input(), reason: reason || null })
                  : await dist.createPurchase({ ...input(), payments: Number(paid) > 0 ? [{ method, amount: Number(paid) }] : [] });
                onSaved(r.doc.id);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {edit ? "Save changes" : "Save purchase"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
