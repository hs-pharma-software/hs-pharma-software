"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { ProductPicker } from "@/components/products/ProductPicker";
import { customersRepo } from "@/lib/repo/customers";
import { salesmenRepo } from "@/lib/repo/salesmen";
import { invoicesRepo, invoiceItemsRepo, nextQuotationNo } from "@/lib/repo/invoices";
import { listAvailableBatches, type ProductBatchOption } from "@/lib/repo/stock";
import { getLatestPrice } from "@/lib/repo/products";
import { uomsRepo } from "@/lib/repo/uoms";
import { hasSecondaryUnit, convertQtyOnUnitToggle, convertPriceOnUnitToggle, toBaseUnitQty } from "@/lib/uom";
import type { Customer, Product, Uom } from "@/lib/types";
import type { Salesman } from "@/lib/types2";

interface Line {
  product: Product;
  batch: ProductBatchOption | null;
  qty: number;
  salePrice: number;
  taxPct: number;
  discountPct: number;
  unit: "base" | "secondary";
}

/** Quotations are estimates, not sales: unlike InvoiceFormModal, saving one
 * never touches stock (no deductStock calls) — it just records the lines the
 * customer was quoted. Stock is only committed once the quotation is
 * accepted, via convertQuotationToInvoice() in the list page. */
export function QuotationFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
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
    void uomsRepo.list().then(setUoms);
  }, []);

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
   * doesn't reserve a batch — the real batch is picked at accept time since
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
        salePrice: price?.salePrice ?? batches[0]?.purchase_price ?? 0,
        taxPct: p.gst_rate_pct ?? 0,
        discountPct: 0,
        unit: "base",
      },
    ]);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function lineTotal(l: Line) {
    const gross = l.salePrice * l.qty;
    const discount = gross * (l.discountPct / 100);
    const taxable = gross - discount;
    const tax = taxable * (l.taxPct / 100);
    return taxable + tax;
  }

  const total = lines.reduce((s, l) => s + l.salePrice * l.qty, 0);
  const lineDiscountTotal = lines.reduce((s, l) => s + l.salePrice * l.qty * (l.discountPct / 100), 0);
  const taxTotal = lines.reduce((s, l) => {
    const gross = l.salePrice * l.qty;
    const discount = gross * (l.discountPct / 100);
    return s + (gross - discount) * (l.taxPct / 100);
  }, 0);
  const payable = total - lineDiscountTotal - (Number(discountRs) || 0) + (Number(charges) || 0) + taxTotal;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) {
      setError("Add at least one product line.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const quotationNo = await nextQuotationNo();
      const quotation = await invoicesRepo.create({
        invoice_no: null,
        quotation_no: quotationNo,
        date: new Date().toISOString().slice(0, 10),
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
          tax_rs: (finalSalePrice * finalQty - finalSalePrice * finalQty * (l.discountPct / 100)) * (l.taxPct / 100),
          discount_pct: l.discountPct,
          discount_rs: finalSalePrice * finalQty * (l.discountPct / 100),
          total: lineTotal(l),
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
    <Modal title="-:Add Quotation:-" onClose={onClose} width="max-w-6xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Invoice Type">
            <Select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
              <option value="Retail">Retail</option>
              <option value="Wholesale">Wholesale</option>
            </Select>
          </Field>
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <Field label="Salesman (Optional)">
                <Select value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}>
                  <option value="">—</option>
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
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
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
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        <Field label="Barcode/Product Name">
          <ProductPicker onSelect={(p) => void onProductSelected(p)} autoFocus />
        </Field>

        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-neutral-900 text-left text-white">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Unit</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Sale Price</th>
                <th className="px-2 py-2">Tax %</th>
                <th className="px-2 py-2">Disc %</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-neutral-400">
                    No content in table
                  </td>
                </tr>
              ) : (
                lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-1.5">{l.product.name}</td>
                    <td className="px-2 py-1.5">
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
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.salePrice}
                        onChange={(e) => updateLine(idx, { salePrice: Number(e.target.value) })}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.taxPct}
                        onChange={(e) => updateLine(idx, { taxPct: Number(e.target.value) })}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.discountPct}
                        onChange={(e) => updateLine(idx, { discountPct: Number(e.target.value) })}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">{lineTotal(l).toFixed(2)}</td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => removeLine(idx)} className="text-rose-600 hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Payable (Estimated)">
            <Input value={payable.toFixed(2)} disabled />
          </Field>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <p className="text-xs text-neutral-400">
          Quotations don&apos;t affect stock or sales figures. Accept the quotation from the list to generate a real invoice.
        </p>

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={saving || lines.length === 0}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>

      {quickAddCustomer && (
        <QuickAddDialog
          title="-:Add Customer:-"
          onClose={() => setQuickAddCustomer(false)}
          onSubmit={async ({ name }) => {
            const created = await customersRepo.create({ name, opening_balance: 0, balance_type: "receivable" });
            setCustomers((prev) => [...prev, created]);
            setCustomerId(created.id);
            setQuickAddCustomer(false);
          }}
        />
      )}
      {quickAddSalesman && (
        <QuickAddDialog
          title="-:Add Salesman:-"
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
