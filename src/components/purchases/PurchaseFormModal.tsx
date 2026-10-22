"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { ProductPicker } from "@/components/products/ProductPicker";
import { suppliersRepo } from "@/lib/repo/suppliers";
import {
  purchasesRepo,
  purchaseItemsRepo,
  nextPurchaseNo,
  listItemsForPurchase,
  planPurchaseReversal,
  applyPurchaseReversal,
} from "@/lib/repo/purchases";
import { receiveStock } from "@/lib/repo/stock";
import { getLatestPrice, priceListRepo, productsRepo } from "@/lib/repo/products";
import {
  deleteDraft,
  parseDraft,
  purchaseDraftsRepo,
  saveDraft,
  type PurchaseDraftPayload,
} from "@/lib/repo/purchaseDrafts";
import { newId } from "@/lib/id";
import { can, NO_PERMISSION_MESSAGE } from "@/lib/actionPermissions";
import type { Purchase } from "@/lib/types2";
import { assignProductToSupplier } from "@/lib/repo/productSuppliers";
import { uomsRepo } from "@/lib/repo/uoms";
import { hasSecondaryUnit, convertQtyOnUnitToggle, convertPriceOnUnitToggle, toBaseUnitQty } from "@/lib/uom";
import type { Supplier, Product, Uom } from "@/lib/types";

interface Line {
  product: Product;
  batchNo: string;
  expiryDate: string;
  purchasePrice: number;
  qty: number;
  stPct: number;
  whtPct: number;
  /** Retail (sale) price - prefilled from the current price list so the
   * cashier can see it and only has to touch it when it actually needs to
   * change on this purchase. */
  salePrice: number;
  initialSalePrice: number;
  /** Which unit qty/purchasePrice/salePrice above are currently expressed
   * in - everything is normalized back to base units (packs) on save, same
   * as product_batches/price_list always store. */
  unit: "base" | "secondary";
}

/** Stock-relevant content of the line grid, in base units. */
function linesKey(lines: Line[]): string {
  return JSON.stringify(
    lines.map((l) => {
      const packing = l.product.packing || 1;
      const sec = l.unit === "secondary";
      return [
        l.product.id,
        l.batchNo,
        l.expiryDate,
        toBaseUnitQty(l.qty, sec, packing),
        sec ? l.purchasePrice * packing : l.purchasePrice,
        l.stPct,
        l.whtPct,
        sec ? l.salePrice * packing : l.salePrice,
      ];
    })
  );
}

function makeLine(p: Product): Line {
  return {
    product: p,
    batchNo: "",
    expiryDate: "",
    purchasePrice: 0,
    qty: 1,
    stPct: 0,
    whtPct: 0,
    salePrice: 0,
    initialSalePrice: 0,
    unit: "base",
  };
}

export function PurchaseFormModal({
  onClose,
  onSaved,
  initialProducts,
  purchase,
  draftId,
  active = true,
}: {
  onClose: () => void;
  onSaved: () => void;
  /** Pre-fills the line grid (e.g. from Order's low-stock reorder list) so
   * the cashier only has to fill in batch/expiry/price/qty per line instead
   * of re-searching for each product. */
  initialProducts?: Product[];
  /** Pass an existing purchase to edit it. */
  purchase?: Purchase | null;
  /** Resume a saved draft. */
  draftId?: string;
  /** False while another tab is in front: shortcuts are ignored. */
  active?: boolean;
}) {
  const isEdit = Boolean(purchase);
  // New purchases are drafted under this id (auto-save + Draft button).
  const draftIdRef = useRef<string>(draftId ?? newId());
  const draftReady = useRef(!draftId);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [quickAddSupplier, setQuickAddSupplier] = useState(false);
  const [supplierId, setSupplierId] = useState(purchase?.supplier_id ?? "");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(purchase?.supplier_invoice_no ?? "");
  const [lines, setLines] = useState<Line[]>((initialProducts ?? []).map(makeLine));
  const [discountRs, setDiscountRs] = useState(String(purchase?.discount_rs ?? 0));
  const [paidAmount, setPaidAmount] = useState(String(purchase?.paid_amount ?? 0));
  const [paymentMethod, setPaymentMethod] = useState(purchase?.payment_method ?? "Cash");
  const [description, setDescription] = useState(purchase?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(isEdit || Boolean(draftId));
  const [uoms, setUoms] = useState<Uom[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  /** Snapshot of the saved lines; if unchanged, an edit only updates the
   * header (paid amount, description...) and leaves stock alone. */
  const originalLinesKey = useRef<string | null>(null);

  useEffect(() => {
    void suppliersRepo.list().then(setSuppliers);
    void uomsRepo.list().then(setUoms);
  }, []);

  // Edit mode: rebuild the line grid from the saved purchase lines (stored in
  // base units, so every line starts in the base unit).
  useEffect(() => {
    if (!purchase) return;
    void (async () => {
      const items = await listItemsForPurchase(purchase.id);
      const rebuilt: Line[] = [];
      for (const item of items) {
        const product = await productsRepo.get(item.product_id);
        if (!product) continue;
        const salePrice = (await getLatestPrice(item.product_id))?.salePrice ?? 0;
        rebuilt.push({
          product,
          batchNo: item.batch_no ?? "",
          expiryDate: item.expiry_date ?? "",
          purchasePrice: item.purchase_price,
          qty: item.received_qty,
          stPct: item.st_pct,
          whtPct: item.wht_pct,
          salePrice,
          initialSalePrice: salePrice,
          unit: "base",
        });
      }
      setLines(rebuilt);
      originalLinesKey.current = linesKey(rebuilt);
      setLoadingExisting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase?.id]);

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
          purchasePrice: convertPriceOnUnitToggle(l.purchasePrice, toSecondary, packing),
          salePrice: convertPriceOnUnitToggle(l.salePrice, toSecondary, packing),
        };
      })
    );
  }

  // Hydrate retail price for any products pre-filled in (the sync useState
  // initializer above can't await the price-list lookup itself).
  useEffect(() => {
    if (!initialProducts || initialProducts.length === 0) return;
    void Promise.all(initialProducts.map((p) => getLatestPrice(p.id))).then((prices) => {
      setLines((prev) =>
        prev.map((l, i) => {
          const price = prices[i]?.salePrice ?? 0;
          return { ...l, salePrice: price, initialSalePrice: price };
        })
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume a draft: restore header fields and rebuild lines from product ids.
  useEffect(() => {
    if (!draftId || isEdit) return;
    void (async () => {
      const row = await purchaseDraftsRepo.get(draftId);
      const d = row ? parseDraft(row) : null;
      if (d) {
        setSupplierId(d.supplierId);
        setSupplierInvoiceNo(d.supplierInvoiceNo);
        setDiscountRs(d.discountRs);
        setPaidAmount(d.paidAmount);
        setPaymentMethod(d.paymentMethod);
        setDescription(d.description);
        const rebuilt: Line[] = [];
        for (const l of d.lines) {
          const product = await productsRepo.get(l.productId);
          if (product) rebuilt.push({ ...l, product });
        }
        setLines(rebuilt);
      }
      draftReady.current = true;
      setLoadingExisting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  function draftPayload(): PurchaseDraftPayload {
    return {
      supplierId,
      supplierInvoiceNo,
      discountRs,
      paidAmount,
      paymentMethod,
      description,
      lines: lines.map(({ product, ...rest }) => ({ ...rest, productId: product.id })),
    };
  }

  function draftTitle(): string {
    const supplier = suppliers.find((s) => s.id === supplierId)?.name ?? "No supplier";
    return `${supplier} - ${lines.length} item(s)`;
  }

  // Auto-save new purchases while typing, so nothing is lost if the app is
  // closed or crashes. Saved 1.5 s after the last change.
  useEffect(() => {
    if (isEdit || !draftReady.current) return;
    if (!supplierId && lines.length === 0) return;
    const t = setTimeout(() => {
      void saveDraft(draftIdRef.current, draftPayload(), draftTitle(), true)
        .then(() => setDraftStatus(`Auto-saved to drafts ${new Date().toLocaleTimeString()}`))
        .catch(() => setDraftStatus("Auto-save failed"));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, supplierInvoiceNo, discountRs, paidAmount, paymentMethod, description, lines, isEdit]);

  async function saveAsDraft() {
    if (isEdit) return;
    if (!supplierId && lines.length === 0) {
      setError("Nothing to save yet.");
      return;
    }
    await saveDraft(draftIdRef.current, draftPayload(), draftTitle(), false);
    onSaved();
  }

  // Ctrl+S save, Ctrl+D draft - only in the tab that's in front.
  const keyActions = useRef({ save: () => undefined as void, draft: () => undefined as void });
  keyActions.current = {
    save: () => formRef.current?.requestSubmit(),
    draft: () => void saveAsDraft(),
  };
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (key === "s") {
        e.preventDefault();
        keyActions.current.save();
      } else if (key === "d") {
        e.preventDefault();
        keyActions.current.draft();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  async function addProduct(p: Product) {
    if (lines.some((l) => l.product.id === p.id)) return;
    const price = await getLatestPrice(p.id);
    const salePrice = price?.salePrice ?? 0;
    setLines((prev) => [...prev, { ...makeLine(p), salePrice, initialSalePrice: salePrice }]);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function lineTotal(l: Line) {
    const amount = l.purchasePrice * l.qty;
    return amount + amount * (l.stPct / 100) - amount * (l.whtPct / 100);
  }

  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tax = lines.reduce((s, l) => s + l.purchasePrice * l.qty * ((l.stPct - l.whtPct) / 100), 0);
  const payable = subtotal - (Number(discountRs) || 0);
  const balance = payable - (Number(paidAmount) || 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || lines.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const header = {
        supplier_id: supplierId,
        supplier_invoice_no: supplierInvoiceNo || null,
        discount_rs: Number(discountRs) || 0,
        tax,
        payable,
        paid_amount: Number(paidAmount) || 0,
        balance,
        description: description || null,
        payment_method: paymentMethod,
      };
      let purchaseId: string;
      if (isEdit && purchase) {
        if (!can("purchase.edit")) throw new Error(NO_PERMISSION_MESSAGE);
        if (originalLinesKey.current === linesKey(lines)) {
          await purchasesRepo.update(purchase.id, header);
          onSaved();
          return;
        }
        // Take the original stock back out first; refuse if part of it has
        // already been sold, so stock can't go negative.
        const reversal = await planPurchaseReversal(purchase.id);
        if (reversal.problems.length > 0) {
          throw new Error(`This purchase can't be edited:\n${reversal.problems.join("\n")}`);
        }
        await applyPurchaseReversal(reversal);
        for (const item of await listItemsForPurchase(purchase.id)) await purchaseItemsRepo.remove(item.id);
        await purchasesRepo.update(purchase.id, header);
        purchaseId = purchase.id;
      } else {
        const created = await purchasesRepo.create({
          ...header,
          purchase_no: await nextPurchaseNo(),
          date: new Date().toISOString().slice(0, 10),
          order_id: null,
          discount_pct: 0,
          bank_id: null,
          slip_no: null,
          advance_payment: 0,
          is_return: 0,
          original_purchase_id: null,
        });
        purchaseId = created.id;
      }

      for (const l of lines) {
        // Everything the cashier typed (possibly in the secondary unit, e.g.
        // Tab) gets normalized back to base units (Pack) here - that's what
        // product_batches, purchase_items and price_list always store in,
        // regardless of which unit was used to enter this line.
        const isSecondary = l.unit === "secondary";
        const packing = l.product.packing || 1;
        const finalQty = toBaseUnitQty(l.qty, isSecondary, packing);
        const finalPurchasePrice = isSecondary ? l.purchasePrice * packing : l.purchasePrice;
        const finalSalePrice = isSecondary ? l.salePrice * packing : l.salePrice;
        const lineTotalValue = lineTotal(l);

        const batch = await receiveStock({
          productId: l.product.id,
          batchNo: l.batchNo || null,
          qty: finalQty,
          purchasePrice: finalPurchasePrice,
          expiryDate: l.expiryDate || null,
          location: null,
        });
        await purchaseItemsRepo.create({
          purchase_id: purchaseId,
          product_id: l.product.id,
          location: null,
          batch_no: l.batchNo || batch.batch_no,
          expiry_date: l.expiryDate || null,
          uom_id: l.product.base_unit_id,
          purchase_price: finalPurchasePrice,
          booked_qty: finalQty,
          received_qty: finalQty,
          avail_qty: batch.qty,
          amount: finalPurchasePrice * finalQty,
          st_pct: l.stPct,
          wht_pct: l.whtPct,
          total: lineTotalValue,
        });
        // Only write a new price-list entry when the retail price was
        // actually changed on this purchase - avoids spamming price_list
        // with an unchanged duplicate row on every routine purchase.
        if (Math.abs(finalSalePrice - l.initialSalePrice) > 0.0001) {
          await priceListRepo.create({
            product_id: l.product.id,
            batch_no: l.batchNo || batch.batch_no,
            sale_price: finalSalePrice,
            wholesale_price: 0,
            mrp: 0,
            comment: "Updated via Purchase",
          });
        }
        // Buying a product from this supplier is what "assigned" means -
        // Assign To Supplier no longer requires manually re-adding every
        // product a supplier has already sold you.
        await assignProductToSupplier(l.product.id, supplierId);
      }
      // Saved for real: the in-progress draft is no longer needed.
      if (!isEdit) await deleteDraft(draftIdRef.current).catch(() => undefined);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? `Edit Purchase #${purchase?.purchase_no ?? ""}` : "Add Purchase"} onClose={onClose} width="max-w-6xl">
      {loadingExisting ? (
        <p className="py-10 text-center text-sm text-neutral-400">Loading purchase...</p>
      ) : (
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <Field label="Supplier Name (F3)" required>
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
          <Field label="Invoice #">
            <Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
          </Field>
        </div>

        <Field label="Barcode/Product Name">
          <ProductPicker onSelect={(p) => void addProduct(p)} />
        </Field>

        <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-neutral-900 text-left text-white">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Unit</th>
                <th className="px-2 py-2">Batch No</th>
                <th className="px-2 py-2">Expiry</th>
                <th className="px-2 py-2">Pur Price</th>
                <th className="px-2 py-2">Retail</th>
                <th className="px-2 py-2">Rec Qty</th>
                <th className="px-2 py-2">ST %</th>
                <th className="px-2 py-2">WHT %</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-2 py-6 text-center text-neutral-400">
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
                        value={l.batchNo}
                        onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        value={l.expiryDate}
                        onChange={(e) => updateLine(idx, { expiryDate: e.target.value })}
                        className="w-36 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.purchasePrice}
                        onChange={(e) => updateLine(idx, { purchasePrice: Number(e.target.value) })}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.salePrice}
                        onChange={(e) => updateLine(idx, { salePrice: Number(e.target.value) })}
                        title={
                          l.salePrice !== l.initialSalePrice
                            ? `Changed from ${l.initialSalePrice.toFixed(2)} - will update the price list`
                            : "Current retail price"
                        }
                        className={`w-24 rounded border px-1.5 py-1 ${
                          l.salePrice !== l.initialSalePrice
                            ? "border-amber-400 bg-amber-50"
                            : "border-neutral-300"
                        }`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                        className="w-20 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.stPct}
                        onChange={(e) => updateLine(idx, { stPct: Number(e.target.value) })}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.whtPct}
                        onChange={(e) => updateLine(idx, { whtPct: Number(e.target.value) })}
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Discount Rs (F12)">
            <Input type="number" min="0" step="any" value={discountRs} onChange={(e) => setDiscountRs(e.target.value)} />
          </Field>
          <Field label="Tax">
            <Input value={tax.toFixed(2)} disabled />
          </Field>
          <Field label="Payable">
            <Input value={payable.toFixed(2)} disabled />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Paid (F8)" required>
            <Input type="number" min="0" step="any" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required />
          </Field>
          <Field label="Balance">
            <Input value={balance.toFixed(2)} disabled />
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

        {error && (
          <p className="whitespace-pre-line rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 pt-3">
          {!isEdit && draftStatus && <span className="mr-auto text-[11px] text-neutral-400">{draftStatus}</span>}
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          {!isEdit && (
            <Button type="button" onClick={() => void saveAsDraft()} disabled={saving} title="Ctrl+D">
              Draft
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={saving || lines.length === 0} title="Ctrl+S">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Save"}
          </Button>
        </div>
      </form>
      )}

      {quickAddSupplier && (
        <QuickAddDialog
          title="Add Supplier"
          onClose={() => setQuickAddSupplier(false)}
          onSubmit={async ({ name }) => {
            const created = await suppliersRepo.create({ name, opening_balance: 0, balance_type: "payable" });
            setSuppliers((prev) => [...prev, created]);
            setSupplierId(created.id);
            setQuickAddSupplier(false);
          }}
        />
      )}
    </Modal>
  );
}

