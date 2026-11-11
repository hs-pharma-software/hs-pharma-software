"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { ProductPicker, type ProductPickerHandle } from "@/components/products/ProductPicker";
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
import type { OrderForPurchase } from "@/lib/repo/orders";
import { purchaseLineMath } from "@/lib/purchaseMath";
import { isMissingSchemaError } from "@/lib/dbErrors";
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
import { listUomsWithShared } from "@/lib/repo/uoms";
import { hasSecondaryUnit, convertQtyOnUnitToggle, convertPriceOnUnitToggle, toBaseUnitQty } from "@/lib/uom";
import { imeiListProblem, imeisOfPurchase, parseImeis, receiveImeis, removePurchaseImeis } from "@/lib/repo/imei";
import { useAuthStore } from "@/store/authStore";
import type { Supplier, Product, Uom } from "@/lib/types";
import { localDate } from "@/lib/localDate";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";

interface Line {
  product: Product;
  batchNo: string;
  expiryDate: string;
  purchasePrice: number;
  qty: number;
  /** Free units the supplier adds; paid for nothing, received in stock. */
  bonusQty: number;
  stPct: number;
  whtPct: number;
  /** Extra discount % on this product (off the supplier's amount, before taxes). */
  discPct: number;
  /** Retail (sale) price - prefilled from the current price list so the
   * cashier can see it and only has to touch it when it actually needs to
   * change on this purchase. */
  salePrice: number;
  initialSalePrice: number;
  /** Which unit qty/purchasePrice/salePrice above are currently expressed
   * in - everything is normalized back to base units (packs) on save, same
   * as product_batches/price_list always store. */
  unit: "base" | "secondary";
  /** Mobile shop: the IMEIs of an IMEI-tracked product's handsets, one per line. */
  imeis?: string;
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
        toBaseUnitQty(l.bonusQty, sec, packing),
        sec ? l.purchasePrice * packing : l.purchasePrice,
        l.stPct,
        l.whtPct,
        l.discPct,
        sec ? l.salePrice * packing : l.salePrice,
        parseImeis(l.imeis ?? "").join(","),
      ];
    })
  );
}

/** A line that can't be saved, and the field to fix (data-field name). */
interface LineProblem {
  field: string;
  message: string;
}

/** Problems that stop a save, per line, in line order. Same rules as the grid:
 * no negative numbers (the inputs' min="0") and, for IMEI-tracked products,
 * one IMEI per handset received, none repeated across lines. */
function linesProblems(lines: Line[]): (LineProblem | null)[] {
  const seen = new Set<string>();
  const numbers: [keyof Line, string, string][] = [
    ["purchasePrice", "purchase", "Purchase rate"],
    ["salePrice", "retail", "Sale rate"],
    ["qty", "qty", "Quantity"],
    ["bonusQty", "bonus", "Bonus"],
    ["stPct", "st", "S.T %"],
    ["whtPct", "wht", "W.T %"],
    ["discPct", "disc", "Extra discount %"],
  ];
  return lines.map((l) => {
    for (const [key, field, label] of numbers) {
      if (Number(l[key]) < 0) return { field, message: `${l.product.name}: ${label} can't be negative.` };
    }
    if (Number(l.discPct) > 100) return { field: "disc", message: `${l.product.name}: Extra discount can't be more than 100%.` };
    if (!l.product.track_imei) return null;
    const sec = l.unit === "secondary";
    const units = toBaseUnitQty(l.qty, sec, l.product.packing || 1) + toBaseUnitQty(l.bonusQty, sec, l.product.packing || 1);
    const list = parseImeis(l.imeis ?? "");
    const problem = imeiListProblem(list, units, l.product.name) ?? list.map((i) => (seen.has(i) ? `IMEI ${i} is entered twice.` : (seen.add(i), null))).find(Boolean) ?? null;
    return problem ? { field: "imei", message: problem } : null;
  });
}

/** A labelled field in a phone product row. */
function RowField({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${wide ? "col-span-full" : ""}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

const rowInput = "w-full min-w-0 rounded-lg border border-neutral-300 bg-white px-2 py-1.5";

function makeLine(p: Product): Line {
  return {
    product: p,
    batchNo: "",
    expiryDate: "",
    purchasePrice: 0,
    qty: 1,
    bonusQty: 0,
    stPct: 0,
    whtPct: 0,
    discPct: 0,
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
  fromOrder,
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
  /** Convert an order: its supplier, products, quantities and rates are filled
   * in; the user adds batch, expiry and what was actually received. */
  fromOrder?: OrderForPurchase;
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
  const [supplierId, setSupplierId] = useState(purchase?.supplier_id ?? fromOrder?.supplierId ?? "");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(purchase?.supplier_invoice_no ?? "");
  const [lines, setLines] = useState<Line[]>((initialProducts ?? []).map(makeLine));
  // A cloth store keeps no batches or expiry dates.
  const noBatches = useAuthStore((s) => s.currentTenant?.businessType) === "cloth_store";
  const [discountRs, setDiscountRs] = useState(String(purchase?.discount_rs ?? 0));
  const [paidAmount, setPaidAmount] = useState(String(purchase?.paid_amount ?? 0));
  const [paymentMethod, setPaymentMethod] = useState(purchase?.payment_method ?? "Cash");
  const [description, setDescription] = useState(purchase?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(isEdit || Boolean(draftId) || Boolean(fromOrder));
  const [uoms, setUoms] = useState<Uom[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  // Phones: products are compact rows; one opens at a time to enter its details.
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [openRow, setOpenRow] = useState<number | null>(null);
  // Error marks on product rows show once a save has been tried.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  /** Snapshot of the saved lines; if unchanged, an edit only updates the
   * header (paid amount, description...) and leaves stock alone. */
  const originalLinesKey = useRef<string | null>(null);

  useEffect(() => {
    void suppliersRepo.list().then(setSuppliers);
    void listUomsWithShared().then(setUoms);
  }, []);

  // Edit mode: rebuild the line grid from the saved purchase lines (stored in
  // base units, so every line starts in the base unit).
  useEffect(() => {
    if (!purchase) return;
    void (async () => {
      const items = await listItemsForPurchase(purchase.id);
      // IMEIs of the purchase, handed out to its lines of that product in order.
      const imeiPool = await imeisOfPurchase(purchase.id);
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
          bonusQty: Number(item.bonus_qty ?? 0),
          stPct: item.st_pct,
          whtPct: item.wht_pct,
          discPct: Number(item.disc_pct ?? 0),
          salePrice,
          initialSalePrice: salePrice,
          unit: "base",
          imeis: (() => {
            const pool = imeiPool.get(item.product_id);
            if (!pool?.length) return undefined;
            const take = pool.splice(0, item.received_qty + Number(item.bonus_qty ?? 0));
            return take.map((u) => u.imei).join("\n");
          })(),
        });
      }
      setLines(rebuilt);
      originalLinesKey.current = linesKey(rebuilt);
      setLoadingExisting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase?.id]);

  // Converting an order: its lines, in base units, with the current retail price.
  useEffect(() => {
    if (!fromOrder || isEdit) return;
    void (async () => {
      const built: Line[] = [];
      for (const l of fromOrder.lines) {
        const product = await productsRepo.get(l.productId);
        if (!product) continue;
        const salePrice = (await getLatestPrice(l.productId))?.salePrice ?? 0;
        built.push({ ...makeLine(product), qty: l.qty, purchasePrice: l.purchasePrice, salePrice, initialSalePrice: salePrice });
      }
      setLines(built);
      setLoadingExisting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromOrder?.orderId]);

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
          bonusQty: convertQtyOnUnitToggle(l.bonusQty, toSecondary, packing),
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
          if (product) rebuilt.push({ bonusQty: 0, discPct: 0, ...l, product });
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
  useEffect(() => {
    keyActions.current = {
      save: () => formRef.current?.requestSubmit(),
      draft: () => void saveAsDraft(),
    };
  });
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

  // Keyboard entry: a new line opens at its first empty field; Enter moves to the
  // next empty field of the line, and from the last one back to the product search.
  const pickerRef = useRef<ProductPickerHandle>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const focusRow = useRef<number | null>(null);
  // Focus the row's first field when none is empty (a product picked again).
  const focusFirstIfNone = useRef(false);
  // Phones: the field to focus once its (just opened) row has rendered.
  const focusField = useRef<{ row: number; field: string } | null>(null);
  const cellsOf = (row: number) => Array.from(linesRef.current?.querySelectorAll<HTMLInputElement>(`[data-row="${row}"] [data-cell]`) ?? []);
  const isEmpty = (el: HTMLInputElement) => el.value.trim() === "" || (el.dataset.zeroEmpty === "1" && Number(el.value) === 0);
  function focusCell(el: HTMLInputElement | undefined) {
    if (!el) { pickerRef.current?.focus(); return; }
    el.focus();
    if (el.type !== "date") el.select();
  }
  useEffect(() => {
    if (focusRow.current === null) return;
    const row = focusRow.current;
    const cells = cellsOf(row);
    // Phones: wait for the row to open and render its fields.
    if (cells.length === 0 && row < lines.length && isPhone && openRow !== row) return;
    focusRow.current = null;
    const firstIfNone = focusFirstIfNone.current;
    focusFirstIfNone.current = false;
    focusCell(cells.find(isEmpty) ?? (firstIfNone ? cells[0] : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, openRow]);
  /** Focus the pending field if its row is on screen; true when done. */
  function tryFocusField(): boolean {
    const f = focusField.current;
    if (!f) return true;
    const el = linesRef.current?.querySelector<HTMLElement>(`[data-row="${f.row}"] [data-field="${f.field}"]`);
    if (!el) return false;
    focusField.current = null;
    el.focus();
    el.scrollIntoView({ block: "center" });
    return true;
  }
  useEffect(() => {
    tryFocusField();
  });
  function onLineKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLInputElement;
    if (e.key !== "Enter" || !el.dataset?.cell) return;
    e.preventDefault();
    const row = Number(el.closest<HTMLElement>("[data-row]")?.dataset.row);
    const cells = cellsOf(row);
    focusCell(cells.slice(cells.indexOf(el) + 1).find(isEmpty));
  }

  async function addProduct(p: Product) {
    const existing = lines.findIndex((l) => l.product.id === p.id);
    if (existing >= 0) {
      // Already on the list: go to that line (phones: open it, close the other).
      if (isPhone && openRow !== existing) {
        focusRow.current = existing;
        focusFirstIfNone.current = true;
        setOpenRow(existing);
        return;
      }
      focusCell(cellsOf(existing).find(isEmpty) ?? cellsOf(existing)[0]);
      return;
    }
    const price = await getLatestPrice(p.id);
    const salePrice = price?.salePrice ?? 0;
    focusRow.current = lines.length;
    setLines((prev) => [...prev, { ...makeLine(p), salePrice, initialSalePrice: salePrice }]);
    // Phones: the new product opens for entry and the previous one closes.
    setOpenRow(lines.length);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setOpenRow((o) => (o === null || o === idx ? null : o > idx ? o - 1 : o));
  }

  /** Paid on the quantity bought; sales tax and withholding tax are both added. */
  function lineTotal(l: Line) {
    return purchaseLineMath(l.purchasePrice, l.qty, l.bonusQty, l.stPct, l.whtPct, l.discPct).total;
  }

  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tax = lines.reduce((s, l) => {
    const m = purchaseLineMath(l.purchasePrice, l.qty, l.bonusQty, l.stPct, l.whtPct, l.discPct);
    return s + m.st + m.wht;
  }, 0);
  const payable = subtotal - (Number(discountRs) || 0);
  const balance = payable - (Number(paidAmount) || 0);
  // Error marks on the phone rows (after a save attempt).
  const rowProblems = submitAttempted ? linesProblems(lines) : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || lines.length === 0) return;
    // Negative numbers; mobile shop: one IMEI per handset received, none repeated.
    setSubmitAttempted(true);
    const problems = linesProblems(lines);
    const bad = problems.findIndex(Boolean);
    if (bad >= 0) {
      setError(problems[bad]!.message);
      // Phones: open the line and put the cursor in the field to fix.
      if (isPhone) {
        focusField.current = { row: bad, field: problems[bad]!.field };
        // Already open: focus now; otherwise once it has opened.
        if (!tryFocusField()) setOpenRow(bad);
      }
      return;
    }
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
        // Its handsets come out too (refused when one is sold already).
        await removePurchaseImeis(purchase.id);
        await applyPurchaseReversal(reversal);
        for (const item of await listItemsForPurchase(purchase.id)) await purchaseItemsRepo.remove(item.id);
        await purchasesRepo.update(purchase.id, header);
        purchaseId = purchase.id;
      } else {
        const created = await purchasesRepo.create({
          ...header,
          purchase_no: await nextPurchaseNo(),
          date: localDate(),
          order_id: fromOrder?.orderId ?? null,
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
        const finalBonus = toBaseUnitQty(l.bonusQty, isSecondary, packing);
        const finalPurchasePrice = isSecondary ? l.purchasePrice * packing : l.purchasePrice;
        // Cost of one unit in stock: bonus units came free (85 for 1 + 1 bonus = 42.50).
        // After the line's extra discount.
        const lineMath = purchaseLineMath(finalPurchasePrice, finalQty, finalBonus, 0, 0, l.discPct);
        const netRate = lineMath.netRate;
        const finalSalePrice = isSecondary ? l.salePrice * packing : l.salePrice;
        const lineTotalValue = lineTotal(l);

        const batch = await receiveStock({
          productId: l.product.id,
          batchNo: l.batchNo || null,
          qty: finalQty + finalBonus,
          purchasePrice: netRate,
          expiryDate: l.expiryDate || null,
          location: null,
        });
        if (l.product.track_imei) await receiveImeis({ productId: l.product.id, imeis: parseImeis(l.imeis ?? ""), purchaseId, price: netRate });
        const item = {
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
          amount: lineMath.amount,
          st_pct: l.stPct,
          wht_pct: l.whtPct,
          disc_pct: Math.min(100, Math.max(0, Number(l.discPct) || 0)),
          total: lineTotalValue,
        };
        if (finalBonus > 0) {
          try {
            await purchaseItemsRepo.create({ ...item, bonus_qty: finalBonus });
          } catch (e) {
            if (isMissingSchemaError(e)) throw new Error("Bonus on purchases needs the latest database update (v61). Ask the administrator to run it, or save without bonus.");
            throw e;
          }
        } else {
          await purchaseItemsRepo.create(item);
        }
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
          {/* Enter in the search picks the highlighted product (ProductPicker);
              it must never submit the whole purchase. */}
          <div onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
            <ProductPicker ref={pickerRef} onSelect={(p) => void addProduct(p)} />
          </div>
        </Field>

        {isPhone ? (
        <div ref={linesRef} onKeyDown={onLineKeyDown} className="flex flex-col gap-2">
          {lines.length === 0 ? (
            <p className="rounded-xl px-3 py-5 text-center text-sm text-neutral-400 ring-1 ring-black/[0.06]">No products added yet</p>
          ) : (
            lines.map((l, idx) => {
              const open = openRow === idx;
              const problem = submitAttempted ? rowProblems[idx] : null;
              const bodyId = `purchase-line-${idx}`;
              return (
                <div key={idx} data-row={idx} className={`rounded-xl bg-white ring-1 ${problem ? "ring-rose-300" : "ring-black/[0.08]"}`}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => setOpenRow(open ? null : idx)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left"
                  >
                    {problem && <AlertCircle size={16} aria-hidden className="shrink-0 text-rose-600" />}
                    <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium text-neutral-900">
                      {l.product.name}
                      {problem && <span className="sr-only"> (needs correction)</span>}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900">{lineTotal(l).toFixed(2)}</span>
                    <ChevronDown size={18} aria-hidden className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div id={bodyId} className="flex flex-col gap-2 border-t border-neutral-100 px-3 pb-3 pt-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Unit</span>
                        {hasSecondaryUnit(l.product) ? (
                          <UnitToggle
                            baseLabel={unitName(l.product.base_unit_id)}
                            secondaryLabel={unitName(l.product.secondary_unit_id)}
                            value={l.unit}
                            onChange={(u) => toggleLineUnit(idx, u === "secondary")}
                          />
                        ) : (
                          <span className="text-sm text-neutral-600">{unitName(l.product.base_unit_id)}</span>
                        )}
                      </div>
                      {!noBatches && (
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
                          <RowField label="Batch">
                            <input data-cell="batch" data-field="batch" value={l.batchNo} onChange={(e) => updateLine(idx, { batchNo: e.target.value })} className={rowInput} />
                          </RowField>
                          <RowField label="Expiry">
                            <input data-cell="expiry" data-field="expiry" type="date" value={l.expiryDate} onChange={(e) => updateLine(idx, { expiryDate: e.target.value })} className={rowInput} />
                          </RowField>
                        </div>
                      )}
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
                        <RowField label="Purchase Rate">
                          <input type="number" inputMode="decimal" min="0" step="any" data-cell="purchase" data-field="purchase" data-zero-empty="1" value={l.purchasePrice} onChange={(e) => updateLine(idx, { purchasePrice: Number(e.target.value) })} className={rowInput} />
                        </RowField>
                        <RowField label="Sale Rate">
                          <input
                            type="number" inputMode="decimal" min="0" step="any" data-cell="retail" data-field="retail" data-zero-empty="1"
                            value={l.salePrice}
                            onChange={(e) => updateLine(idx, { salePrice: Number(e.target.value) })}
                            title={l.salePrice !== l.initialSalePrice ? `Changed from ${l.initialSalePrice.toFixed(2)} - will update the price list` : "Current retail price"}
                            className={`${rowInput} ${l.salePrice !== l.initialSalePrice ? "!border-amber-400 bg-amber-50" : ""}`}
                          />
                        </RowField>
                        <RowField label="Quantity">
                          <input type="number" inputMode="decimal" min="0" step="any" data-cell="qty" data-field="qty" data-zero-empty="1" value={l.qty} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} className={rowInput} />
                        </RowField>
                        <RowField label="Bonus">
                          <input type="number" inputMode="decimal" min="0" step="any" data-cell="bonus" data-field="bonus" value={l.bonusQty} onChange={(e) => updateLine(idx, { bonusQty: Number(e.target.value) })} title="Free units the supplier added" className={rowInput} />
                        </RowField>
                        <RowField label="S.T %">
                          <input type="number" inputMode="decimal" min="0" step="any" data-cell="st" data-field="st" value={l.stPct} onChange={(e) => updateLine(idx, { stPct: Number(e.target.value) })} className={rowInput} />
                        </RowField>
                        <RowField label="W.T %">
                          <input type="number" inputMode="decimal" min="0" step="any" data-cell="wht" data-field="wht" value={l.whtPct} onChange={(e) => updateLine(idx, { whtPct: Number(e.target.value) })} className={rowInput} />
                        </RowField>
                        <RowField label="Extra Disc %">
                          <input type="number" inputMode="decimal" min="0" max="100" step="any" data-cell="disc" data-field="disc" value={l.discPct} onChange={(e) => updateLine(idx, { discPct: Number(e.target.value) })} title="Extra discount % on this product, before taxes" className={rowInput} />
                        </RowField>
                      </div>
                      {Boolean(l.product.track_imei) && (
                        <RowField label="IMEIs" wide>
                          <textarea
                            data-field="imei"
                            aria-label={`IMEIs of ${l.product.name}`}
                            rows={2}
                            value={l.imeis ?? ""}
                            onChange={(e) => updateLine(idx, { imeis: e.target.value })}
                            placeholder="Scan IMEIs, one per line"
                            className={`${rowInput} font-mono text-sm`}
                          />
                          <span className="text-[10px] text-neutral-500">{parseImeis(l.imeis ?? "").length} IMEI(s) for {l.qty + l.bonusQty} unit(s)</span>
                        </RowField>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`text-xs tabular-nums ${l.bonusQty > 0 ? "font-semibold text-emerald-700" : "text-neutral-500"}`}
                          title="Cost of one unit with the bonus counted (rate x qty / (qty + bonus))"
                        >
                          Net rate {purchaseLineMath(l.purchasePrice, l.qty, l.bonusQty, 0, 0, l.discPct).netRate.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          aria-label={`Remove ${l.product.name}`}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
                        >
                          <Trash2 size={14} aria-hidden /> Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        ) : (
        <div ref={linesRef} onKeyDown={onLineKeyDown} className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-neutral-900 text-left text-white">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Unit</th>
                {!noBatches && <th className="px-2 py-2">Batch No</th>}
                {!noBatches && <th className="px-2 py-2">Expiry</th>}
                <th className="px-2 py-2">Pur Price</th>
                <th className="px-2 py-2">Retail</th>
                <th className="px-2 py-2">Rec Qty</th>
                <th className="px-2 py-2">Bonus</th>
                <th className="px-2 py-2" title="Extra discount % on this product (off the supplier's rate, before taxes)">Extra Disc %</th>
                <th className="px-2 py-2" title="Cost of one unit after the extra discount, with the bonus counted">Net Rate</th>
                <th className="px-2 py-2">ST %</th>
                <th className="px-2 py-2">WHT %</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={noBatches ? 11 : 13} className="px-2 py-6 text-center text-neutral-400">
                    No content in table
                  </td>
                </tr>
              ) : (
                lines.map((l, idx) => (
                  <tr key={idx} data-row={idx} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-1.5">
                      {l.product.name}
                      {Boolean(l.product.track_imei) && (
                        <div className="mt-1">
                          <textarea
                            aria-label={`IMEIs of ${l.product.name}`}
                            rows={2}
                            value={l.imeis ?? ""}
                            onChange={(e) => updateLine(idx, { imeis: e.target.value })}
                            placeholder="Scan IMEIs, one per line"
                            className="w-56 rounded border border-neutral-300 px-1.5 py-1 font-mono text-xs"
                          />
                          <span className="block text-[10px] text-neutral-500">{parseImeis(l.imeis ?? "").length} IMEI(s) for {l.qty + l.bonusQty} unit(s)</span>
                        </div>
                      )}
                    </td>
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
                    {!noBatches && <td className="px-2 py-1.5">
                      <input
                        data-cell="batch"
                        value={l.batchNo}
                        onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>}
                    {!noBatches && <td className="px-2 py-1.5">
                      <input
                        data-cell="expiry"
                        type="date"
                        value={l.expiryDate}
                        onChange={(e) => updateLine(idx, { expiryDate: e.target.value })}
                        className="w-36 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        data-cell="purchase"
                        data-zero-empty="1"
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
                        data-cell="retail"
                        data-zero-empty="1"
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
                        data-cell="qty"
                        data-zero-empty="1"
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
                        data-cell="bonus"
                        value={l.bonusQty}
                        onChange={(e) => updateLine(idx, { bonusQty: Number(e.target.value) })}
                        title="Free units the supplier added"
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        data-cell="disc"
                        value={l.discPct}
                        onChange={(e) => updateLine(idx, { discPct: Number(e.target.value) })}
                        title="Extra discount % on this product, before taxes"
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className={`px-2 py-1.5 tabular-nums ${l.bonusQty > 0 || l.discPct > 0 ? "font-semibold text-emerald-700" : "text-neutral-500"}`}>
                      {purchaseLineMath(l.purchasePrice, l.qty, l.bonusQty, 0, 0, l.discPct).netRate.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        data-cell="st"
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
                        data-cell="wht"
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
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
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

        {!isEdit && draftStatus && <p className="text-[11px] text-neutral-400 sm:hidden">{draftStatus}</p>}

        {/* Phones: pinned to the bottom of the sheet with the payable amount. */}
        <div className="form-actions items-center">
          {!isEdit && draftStatus && <span className="mr-auto text-[11px] text-neutral-400 max-sm:hidden">{draftStatus}</span>}
          <span className="mr-auto flex shrink-0 flex-col text-[11px] leading-tight text-neutral-500 sm:hidden">
            Payable
            <span className="text-sm font-semibold tabular-nums text-neutral-900">{payable.toFixed(2)}</span>
          </span>
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

