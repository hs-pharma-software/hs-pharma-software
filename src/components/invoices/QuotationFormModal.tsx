"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { QuickCustomerDialog } from "@/components/customers/QuickCustomerDialog";
import { saleLineMath } from "@/lib/saleLineMath";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { ProductPicker } from "@/components/products/ProductPicker";
import { customersRepo } from "@/lib/repo/customers";
import { salesmenRepo } from "@/lib/repo/salesmen";
import { invoicesRepo, invoiceItemsRepo, nextQuotationNo, listItemsForInvoice } from "@/lib/repo/invoices";
import { listAvailableBatches, type ProductBatchOption } from "@/lib/repo/stock";
import { getLatestPrice, productsRepo } from "@/lib/repo/products";
import { listUomsWithShared } from "@/lib/repo/uoms";
import { hasSecondaryUnit, convertQtyOnUnitToggle, convertPriceOnUnitToggle, roundPrice, toBaseUnitQty } from "@/lib/uom";
import type { Customer, Product, Uom } from "@/lib/types";
import type { Salesman } from "@/lib/types2";
import { localDate } from "@/lib/localDate";

interface Line {
  product: Product;
  batch: ProductBatchOption | null;
  qty: number;
  salePrice: number;
  taxPct: number;
  discountPct: number;
  /** Customer's extra discount %, after the line discount. */
  extraPct: number;
  unit: "base" | "secondary";
}

/** Quotations are estimates, not sales: unlike InvoiceFormModal, saving one
 * never touches stock (no deductStock calls) - it just records the lines the
 * customer was quoted. Stock is only committed once the quotation is
 * accepted, via convertQuotationToInvoice() in the list page. */
export function QuotationFormModal({ onClose, onSaved, quotationId, viewOnly = false }: {
  onClose: () => void;
  onSaved: () => void;
  /** Open this quotation (view or edit) instead of a new one. */
  quotationId?: string;
  /** Read only: nothing can be changed or saved. */
  viewOnly?: boolean;
}) {
  const [loading, setLoading] = useState(Boolean(quotationId));
  const [quotationNo, setQuotationNo] = useState<number | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [salesmanId, setSalesmanId] = useState("");
  const [quickAddCustomer, setQuickAddCustomer] = useState(false);
  const [quickAddSalesman, setQuickAddSalesman] = useState(false);
  const [invoiceType, setInvoiceType] = useState("Retail");
  const [description, setDescription] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [discountRs, setDiscountRs] = useState("0");
  const [charges, setCharges] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uoms, setUoms] = useState<Uom[]>([]);

  useEffect(() => {
    void customersRepo.list().then(setCustomers);
    void salesmenRepo.list().then(setSalesmen);
    void listUomsWithShared().then(setUoms);
  }, []);

  // An existing quotation: its header and lines (lines in base units, as saved).
  useEffect(() => {
    if (!quotationId) return;
    void (async () => {
      try {
        const q = await invoicesRepo.get(quotationId);
        if (!q || !q.is_quotation) throw new Error("Quotation not found.");
        setQuotationNo(q.quotation_no ?? null);
        setCustomerId(q.customer_id ?? "");
        setSalesmanId(q.salesman_id ?? "");
        setInvoiceType(q.invoice_type === "wholesale" ? "Wholesale" : "Retail");
        setDescription(q.description ?? "");
        setDiscountRs(String(q.discount_rs ?? 0));
        setCharges(String(q.charges ?? 0));
        const rebuilt: Line[] = [];
        for (const item of await listItemsForInvoice(quotationId)) {
          const product = await productsRepo.get(item.product_id);
          if (!product) continue;
          rebuilt.push({ product, batch: null, qty: item.qty, salePrice: item.sale_price ?? 0, taxPct: item.tax_pct ?? 0, discountPct: item.discount_pct ?? 0, extraPct: Number(item.extra_disc_pct ?? 0), unit: "base" });
        }
        setLines(rebuilt);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [quotationId]);

  function unitName(id: string | null) {
    return uoms.find((u) => u.id === id)?.name ?? "Unit";
  }

  function toggleLineUnit(idx: number, toSecondary: boolean) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const packing = l.product.packing || 1;
        return {
          ...l,
          unit: toSecondary ? "secondary" : "base",
          qty: convertQtyOnUnitToggle(l.qty, toSecondary, packing),
          salePrice: convertPriceOnUnitToggle(l.salePrice, toSecondary, packing),
        };
      })
    );
  }

  /** Estimate-only: still shows current stock/price for reference, but
   * doesn't reserve a batch - the real batch is picked at accept time since
   * stock may have moved by then. */
  async function onProductSelected(p: Product) {
    setError(null);
    const existingIdx = lines.findIndex((l) => l.product.id === p.id);
    if (existingIdx >= 0) {
      updateLine(existingIdx, { qty: lines[existingIdx].qty + 1 });
      return;
    }
    const batches = await listAvailableBatches(p.id);
    const price = await getLatestPrice(p.id);
    setLines((prev) => [
      ...prev,
      {
        product: p,
        batch: batches[0] ?? null,
        qty: 1,
        taxPct: p.gst_rate_pct ?? 0,
        discountPct: 0,
        extraPct: 0,
        ...(() => {
          const defaultUnit: "base" | "secondary" = hasSecondaryUnit(p) ? "secondary" : "base";
          const pk = p.packing || 1;
          const rawPrice = price?.salePrice ?? batches[0]?.purchase_price ?? 0;
          return { salePrice: defaultUnit === "secondary" ? roundPrice(rawPrice / pk) : rawPrice, unit: defaultUnit };
        })(),
      },
    ]);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  // Extra discount: only for a customer the owner allowed it (never walk-in).
  const extraOn = Boolean(customerId) && Number(customers.find((c) => c.id === customerId)?.extra_discount ?? 0) === 1;
  const extraOf = (l: Line) => (extraOn ? l.extraPct : 0);
  const lineMath = (l: Line) => saleLineMath(l.salePrice, l.qty, l.discountPct, extraOf(l), l.taxPct);

  function lineTotal(l: Line) {
    return lineMath(l).total;
  }

  const total = lines.reduce((s, l) => s + l.salePrice * l.qty, 0);
  const lineDiscountTotal = lines.reduce((s, l) => s + lineMath(l).discountRs, 0);
  const taxTotal = lines.reduce((s, l) => s + lineMath(l).tax, 0);
  const payable = total - lineDiscountTotal - (Number(discountRs) || 0) + (Number(charges) || 0) + taxTotal;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (viewOnly) return;
    if (lines.length === 0) {
      setError("Add at least one product line.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const header = {
        inv_on: "cash",
        invoice_type: invoiceType.toLowerCase(),
        description: description || null,
        salesman_id: salesmanId || null,
        customer_id: customerId || null,
        total,
        charges: Number(charges) || 0,
        discount_pct: 0,
        discount_rs: Number(discountRs) || 0,
        tax_pct: 0,
        payable,
        paid: 0,
        balance: payable,
      };
      let quotation: { id: string };
      if (quotationId) {
        // Editing: same number and date; the lines are replaced (a quotation never touched stock).
        const current = await invoicesRepo.get(quotationId);
        if (!current || !current.is_quotation) throw new Error("Quotation not found.");
        if (current.converted_invoice_id) throw new Error("This quotation was already turned into an invoice and can no longer be edited.");
        await invoicesRepo.update(quotationId, header);
        for (const item of await listItemsForInvoice(quotationId)) await invoiceItemsRepo.remove(item.id);
        quotation = { id: quotationId };
      } else quotation = await invoicesRepo.create({
        invoice_no: null,
        quotation_no: await nextQuotationNo(),
        date: localDate(),
        ...header,
        is_return: 0,
        is_memorized: 0,
        is_quotation: 1,
        converted_invoice_id: null,
        original_invoice_id: null,
      });

      for (const l of lines) {
        // Normalized to base units (packs) so convertQuotationToInvoice()
        // can deduct stock correctly later regardless of which unit this
        // quotation line was entered in.
        const isSecondary = l.unit === "secondary";
        const packing = l.product.packing || 1;
        const finalQty = toBaseUnitQty(l.qty, isSecondary, packing);
        const finalSalePrice = isSecondary ? l.salePrice * packing : l.salePrice;
        const m = saleLineMath(finalSalePrice, finalQty, l.discountPct, extraOf(l), l.taxPct);
        await invoiceItemsRepo.create({
          invoice_id: quotation.id,
          product_id: l.product.id,
          batch_no: l.batch?.batch_no ?? null,
          packing: l.product.packing,
          uom_id: l.product.base_unit_id,
          avail_qty: l.batch?.qty ?? null,
          qty: finalQty,
          bonus_qty: 0,
          purchase_price: l.batch?.purchase_price ?? 0,
          sale_price: finalSalePrice,
          tax_pct: l.taxPct,
          further_tax_pct: 0,
          tax_rs: m.tax,
          discount_pct: l.discountPct,
          discount_rs: m.discountRs,
          extra_disc_pct: extraOf(l),
          total: m.total,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={viewOnly ? `Quotation #${quotationNo ?? ""}` : quotationId ? `Edit Quotation #${quotationNo ?? ""}` : "Add Quotation"} onClose={onClose} width="max-w-6xl">
      {loading ? <p className="py-10 text-center text-sm text-neutral-400">Loading quotation...</p> : (
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <fieldset disabled={viewOnly} className="contents">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          <Field label="Invoice Type">
            <Select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
              <option value="Retail">Retail</option>
              <option value="Wholesale">Wholesale</option>
            </Select>
          </Field>
          <div className="flex items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <Field label="Salesman (Optional)">
                <Select value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}>
                  <option value="">{"\u2014"}</option>
                  {salesmen.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAddSalesman(true)}>
              +
            </Button>
          </div>
          <div className="col-span-2 flex items-end gap-1.5 sm:col-span-1">
            <div className="min-w-0 flex-1">
              <Field label="Customer Name">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Walk-in</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAddCustomer(true)}>
              +
            </Button>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </div>

        {!viewOnly && (
          <Field label="Barcode/Product Name">
            <ProductPicker onSelect={(p) => void onProductSelected(p)} autoFocus />
          </Field>
        )}

        <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
          {/* rt: on a phone each line is a card of "label: value" rows, as on invoices. */}
          <table className="rt w-full min-w-max text-sm">
            <thead>
              <tr className="bg-neutral-900 text-left text-white">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Unit</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Sale Price</th>
                <th className="px-2 py-2">Tax %</th>
                <th className="px-2 py-2">Disc %</th>
                {extraOn && <th className="px-2 py-2" title="Customer's extra discount, on the price after Disc %">Extra Disc %</th>}
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={extraOn ? 9 : 8} className="px-2 py-6 text-center text-neutral-400">
                    No content in table
                  </td>
                </tr>
              ) : (
                lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-neutral-100 last:border-0">
                    <td data-label="Product" className="rt-title px-2 py-1.5">{l.product.name}</td>
                    <td data-label="Unit" className="px-2 py-1.5">
                      {hasSecondaryUnit(l.product) ? (
                        <UnitToggle
                          baseLabel={unitName(l.product.base_unit_id)}
                          secondaryLabel={unitName(l.product.secondary_unit_id)}
                          value={l.unit}
                          onChange={(u) => toggleLineUnit(idx, u === "secondary")}
                        />
                      ) : (
                        <span className="text-neutral-500">{unitName(l.product.base_unit_id)}</span>
                      )}
                    </td>
                    <td data-label="Qty" className="px-2 py-1.5">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td data-label="Sale Price" className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.salePrice}
                        onChange={(e) => updateLine(idx, { salePrice: Number(e.target.value) })}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td data-label="Tax %" className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.taxPct}
                        onChange={(e) => updateLine(idx, { taxPct: Number(e.target.value) })}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td data-label="Disc %" className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.discountPct}
                        onChange={(e) => updateLine(idx, { discountPct: Number(e.target.value) })}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    {extraOn && (
                      <td data-label="Extra Disc %" className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={l.extraPct}
                          onChange={(e) => updateLine(idx, { extraPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                          title="Extra discount % on the price after Disc %"
                          aria-label={`Extra discount of ${l.product.name}`}
                          className="w-16 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-1"
                        />
                      </td>
                    )}
                    <td data-label="Total" className="px-2 py-1.5 font-semibold">{lineTotal(l).toFixed(2)}</td>
                    <td data-label="" className="px-2 py-1.5">
                      {!viewOnly && (
                        <button type="button" onClick={() => removeLine(idx)} className="min-h-9 px-1 text-rose-600 hover:underline">
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          <Field label="Total">
            <Input value={total.toFixed(2)} disabled />
          </Field>
          <Field label="Charges">
            <Input type="number" min="0" step="any" value={charges} onChange={(e) => setCharges(e.target.value)} />
          </Field>
          <Field label="Discount Rs">
            <Input type="number" min="0" step="any" value={discountRs} onChange={(e) => setDiscountRs(e.target.value)} />
          </Field>
          <Field label="Tax">
            <Input value={taxTotal.toFixed(2)} disabled />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          <Field label="Payable (Estimated)">
            <Input value={payable.toFixed(2)} disabled />
          </Field>
        </div>

        </fieldset>
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <p className="text-xs text-neutral-400">
          Quotations don&apos;t affect stock or sales figures. Accept the quotation from the list to generate a real invoice.
        </p>

        {/* Phones: pinned to the bottom of the sheet with the estimated payable, as on invoices. */}
        <div className="sticky -bottom-3 z-10 -mx-3 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 bg-white px-3 py-2.5 shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)] sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-3 sm:shadow-none">
          <span className="flex w-full items-baseline justify-between text-sm font-semibold tabular-nums text-neutral-900 sm:hidden">
            <span className="text-neutral-500">Payable (Est.)</span>
            <span className="text-base">Rs {payable.toFixed(2)}</span>
          </span>
          {viewOnly ? (
            <Button type="button" onClick={onClose} className="max-sm:flex-1">Close</Button>
          ) : (
            <>
              <Button type="button" onClick={onClose} className="max-sm:px-3">
                {quotationId ? "Cancel" : "Reset"}
              </Button>
              <Button type="submit" variant="primary" disabled={saving || lines.length === 0} className="max-sm:flex-1">
                {saving ? "Saving..." : quotationId ? "Save Changes" : "Save"}
              </Button>
            </>
          )}
        </div>
      </form>
      )}

      {quickAddCustomer && (
        <QuickCustomerDialog
          onClose={() => setQuickAddCustomer(false)}
          onCreated={(created) => {
            setCustomers((prev) => [...prev, created]);
            setCustomerId(created.id);
            setQuickAddCustomer(false);
          }}
        />
      )}
      {quickAddSalesman && (
        <QuickAddDialog
          title="Add Salesman"
          onClose={() => setQuickAddSalesman(false)}
          onSubmit={async ({ name }) => {
            const created = await salesmenRepo.create({ name, phone: null });
            setSalesmen((prev) => [...prev, created]);
            setSalesmanId(created.id);
            setQuickAddSalesman(false);
          }}
        />
      )}
    </Modal>
  );
}

