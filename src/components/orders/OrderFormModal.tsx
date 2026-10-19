"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { ProductPicker } from "@/components/products/ProductPicker";
import { suppliersRepo } from "@/lib/repo/suppliers";
import { ordersRepo, orderItemsRepo } from "@/lib/repo/orders";
import { uomsRepo } from "@/lib/repo/uoms";
import { hasSecondaryUnit, convertQtyOnUnitToggle, convertPriceOnUnitToggle, toBaseUnitQty } from "@/lib/uom";
import type { Supplier, Product, Uom } from "@/lib/types";

interface Line {
  product: Product;
  purchasePrice: number;
  qty: number;
  unit: "base" | "secondary";
}

export function OrderFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [quickAddSupplier, setQuickAddSupplier] = useState(false);
  const [orderType, setOrderType] = useState("Stock Level Order");
  const [lines, setLines] = useState<Line[]>([]);
  const [advancePayment, setAdvancePayment] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [uoms, setUoms] = useState<Uom[]>([]);

  useEffect(() => {
    void suppliersRepo.list().then(setSuppliers);
    void uomsRepo.list().then(setUoms);
  }, []);

  function unitName(id: string | null) {
    return uoms.find((u) => u.id === id)?.name ?? "Unit";
  }

  const estimatedPrice = lines.reduce((s, l) => s + l.purchasePrice * l.qty, 0);

  function addProduct(p: Product) {
    if (lines.some((l) => l.product.id === p.id)) return;
    setLines((prev) => [...prev, { product: p, purchasePrice: 0, qty: 1, unit: "base" }]);
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  }

  function toggleLineUnit(id: string, toSecondary: boolean) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.product.id !== id) return l;
        const packing = l.product.packing || 1;
        return {
          ...l,
          unit: toSecondary ? "secondary" : "base",
          qty: convertQtyOnUnitToggle(l.qty, toSecondary, packing),
          purchasePrice: convertPriceOnUnitToggle(l.purchasePrice, toSecondary, packing),
        };
      })
    );
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.product.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || lines.length === 0) return;
    setSaving(true);
    try {
      const order = await ordersRepo.create({
        date: new Date().toISOString().slice(0, 10),
        supplier_id: supplierId,
        order_type: orderType,
        estimated_price: estimatedPrice,
        advance_payment: Number(advancePayment) || 0,
        payment_method: paymentMethod,
        bank_id: null,
        description: description || null,
      });
      for (const line of lines) {
        // Normalized to base units (packs) — same convention as
        // product_batches/purchase_items everywhere else in the app.
        const isSecondary = line.unit === "secondary";
        const packing = line.product.packing || 1;
        const finalQty = toBaseUnitQty(line.qty, isSecondary, packing);
        const finalPurchasePrice = isSecondary ? line.purchasePrice * packing : line.purchasePrice;
        await orderItemsRepo.create({
          order_id: order.id,
          product_id: line.product.id,
          packing: line.product.packing,
          uom_id: line.product.base_unit_id,
          purchase_price: finalPurchasePrice,
          qty: finalQty,
          avail_qty: null,
          max_stock_qty: line.product.max_stock_qty,
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="-:Add Order:-" onClose={onClose} width="max-w-4xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-end gap-1.5 sm:col-span-2">
            <div className="flex-1">
              <Field label="Supplier Name" required>
                <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required autoFocus>
                  <option value="">Select...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAddSupplier(true)}>
              +
            </Button>
          </div>
          <Field label="Order Type">
            <Select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
              <option value="Stock Level Order">Stock Level Order</option>
              <option value="Manual Order">Manual Order</option>
            </Select>
          </Field>
        </div>

        <Field label="Barcode/Product Name">
          <ProductPicker onSelect={addProduct} />
        </Field>

        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-neutral-900 text-left text-white">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Unit</th>
                <th className="px-2 py-2">Packing</th>
                <th className="px-2 py-2">Pur Price</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-neutral-400">
                    No content in table
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.product.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-1.5">{l.product.name}</td>
                    <td className="px-2 py-1.5">
                      {hasSecondaryUnit(l.product) ? (
                        <UnitToggle
                          baseLabel={unitName(l.product.base_unit_id)}
                          secondaryLabel={unitName(l.product.secondary_unit_id)}
                          value={l.unit}
                          onChange={(u) => toggleLineUnit(l.product.id, u === "secondary")}
                        />
                      ) : (
                        <span className="text-neutral-500">{unitName(l.product.base_unit_id)}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{l.product.packing}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.purchasePrice}
                        onChange={(e) => updateLine(l.product.id, { purchasePrice: Number(e.target.value) })}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(l.product.id, { qty: Number(e.target.value) })}
                        className="w-20 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => removeLine(l.product.id)} className="text-rose-600 hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Estimated Price">
            <Input value={estimatedPrice.toFixed(2)} disabled />
          </Field>
          <Field label="Advance Payment">
            <Input type="number" min="0" step="any" value={advancePayment} onChange={(e) => setAdvancePayment(e.target.value)} />
          </Field>
          <Field label="Payment Method" required>
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={saving || lines.length === 0}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>

      {quickAddSupplier && (
        <QuickAddDialog
          title="-:Add Supplier:-"
          onClose={() => setQuickAddSupplier(false)}
          onSubmit={async ({ name }) => {
            const created = await suppliersRepo.create({
              name,
              opening_balance: 0,
              balance_type: "payable",
            });
            setSuppliers((prev) => [...prev, created]);
            setSupplierId(created.id);
            setQuickAddSupplier(false);
          }}
        />
      )}
    </Modal>
  );
}
