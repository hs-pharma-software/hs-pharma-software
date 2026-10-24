"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { ProductPicker, type ProductPickerHandle } from "@/components/products/ProductPicker";
import { customersRepo } from "@/lib/repo/customers";
import { salesmenRepo } from "@/lib/repo/salesmen";
import {
  invoicesRepo,
  invoiceItemsRepo,
  nextInvoiceNo,
  listItemsForInvoice,
  restoreInvoiceStock,
  countInvoicesThisMonth,
  type InvoiceItemWithProduct,
} from "@/lib/repo/invoices";
import { deductStock, listAvailableBatches, type ProductBatchOption } from "@/lib/repo/stock";
import { getLatestPrice, productsRepo } from "@/lib/repo/products";
import { getEffectiveDiscountPct } from "@/lib/repo/categories";
import { uomsRepo, listUomsWithShared } from "@/lib/repo/uoms";
import { useAuthStore } from "@/store/authStore";
import {
  hasSecondaryUnit,
  convertQtyOnUnitToggle,
  convertPriceOnUnitToggle,
  toBaseUnitQty,
  fromBaseUnitQty,
} from "@/lib/uom";
import { loadFbrSettings } from "@/lib/fbr";
import { FBR_PROVINCES, isValidNtnOrCnic, isValidPkMobile, normalizeNtn } from "@/lib/fbrData";
import type { Customer, Product, Uom } from "@/lib/types";
import type { Salesman, Invoice } from "@/lib/types2";
import { businessType } from "@/config/businessTypes";
import { getRxForInvoice, markPrescriptionInvoiced } from "@/lib/repo/clinic";

/** Today as YYYY-MM-DD in local (Pakistan) time, not UTC. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Line {
  product: Product;
  batch: ProductBatchOption;
  qty: number;
  bonusQty: number;
  salePrice: number;
  taxPct: number;
  discountPct: number;
  /** Which unit qty/bonusQty/salePrice above are currently expressed in -
   * everything is normalized back to base units (packs) on save, matching
   * how invoice_items/product_batches always store it. */
  unit: "base" | "secondary";
}

// Column indices for the editable inputs in each line row.
const COL_QTY = 0;
const COL_BONUS = 1;
const COL_PRICE = 2;
const COL_TAX = 3;
const COL_DISC = 4;
const LAST_COL = COL_DISC;

export function InvoiceFormModal({
  invoice,
  rxId,
  onClose,
  onSaved,
  active = true,
}: {
  /** Pass an existing invoice to edit it in place; omit to create a new one. */
  invoice?: Invoice | null;
  /** Prescription ID: pre-populate invoice lines from this prescription's rx items. */
  rxId?: string;
  onClose: () => void;
  onSaved: () => void;
  /** False while another invoice tab is in front: keyboard shortcuts are
   * ignored so only the visible form reacts. */
  active?: boolean;
}) {
  const isEdit = Boolean(invoice);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [customerId, setCustomerId] = useState(invoice?.customer_id ?? "");
  const [salesmanId, setSalesmanId] = useState(invoice?.salesman_id ?? "");
  const [quickAddCustomer, setQuickAddCustomer] = useState(false);
  const [quickAddSalesman, setQuickAddSalesman] = useState(false);
  const [invOn, setInvOn] = useState(invoice ? (invoice.inv_on === "credit" ? "Credit" : "Cash") : "Cash");
  // Contractors may date an invoice in the past (work billed later); other
  // types always use today's date.
  const canPickDate = businessType(useAuthStore((s) => s.currentTenant?.businessType)).id === "contractor";
  const [invoiceDate, setInvoiceDate] = useState(invoice?.date ?? localToday());
  const [invoiceType, setInvoiceType] = useState(
    invoice ? (invoice.invoice_type === "wholesale" ? "Wholesale" : "Retail") : "Retail"
  );
  const [description, setDescription] = useState(invoice?.description ?? "");

  const [customerName, setCustomerName] = useState(invoice?.customer_name ?? "");
  const [customerPhone, setCustomerPhone] = useState(invoice?.customer_phone ?? "");
  const [buyerNtn, setBuyerNtn] = useState(invoice?.buyer_ntn_cnic ?? "");
  const [buyerProvince, setBuyerProvince] = useState(invoice?.buyer_province ?? "");
  const [buyerAddress, setBuyerAddress] = useState(invoice?.buyer_address ?? "");
  const [buyerRegType, setBuyerRegType] = useState(invoice?.buyer_registration_type ?? "Unregistered");
  const [fbrEnabled, setFbrEnabled] = useState(false);

  const [lines, setLines] = useState<Line[]>([]);
  const [originalItems, setOriginalItems] = useState<InvoiceItemWithProduct[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(isEdit);

  const [discountRs, setDiscountRs] = useState(String(invoice?.discount_rs ?? 0));
  const [charges, setCharges] = useState(String(invoice?.charges ?? 0));
  const [paid, setPaid] = useState(String(invoice?.paid ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uoms, setUoms] = useState<Uom[]>([]);

  // Refs for keyboard navigation
  const formRef = useRef<HTMLFormElement>(null);
  const pickerRef = useRef<ProductPickerHandle>(null);
  // lineInputRefs[rowIdx][colIdx] -> the input element
  const lineInputRefs = useRef<(HTMLInputElement | null)[][]>([]);
  const prevLinesLen = useRef(0);

  // After a new line is appended, focus its Qty input.
  useEffect(() => {
    if (lines.length > prevLinesLen.current) {
      const newIdx = lines.length - 1;
      lineInputRefs.current[newIdx]?.[COL_QTY]?.focus();
    }
    prevLinesLen.current = lines.length;
  }, [lines.length]);

  // Ctrl+S -> Save, Ctrl+D -> Save as draft. Only the form in the active tab
  // listens, otherwise every open invoice tab would save at once.
  const draftRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "d") {
        e.preventDefault();
        draftRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // Back in front: put the cursor in the product search so scanning works.
  useEffect(() => {
    if (active) setTimeout(() => pickerRef.current?.focus(), 30);
  }, [active]);

  function setLineRef(rowIdx: number, colIdx: number, el: HTMLInputElement | null) {
    if (!lineInputRefs.current[rowIdx]) lineInputRefs.current[rowIdx] = [];
    lineInputRefs.current[rowIdx][colIdx] = el;
  }

  /** Enter on a line input: advance to next column; last column returns focus to the product search bar. */
  function handleLineEnter(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (colIdx < LAST_COL) {
      lineInputRefs.current[rowIdx]?.[colIdx + 1]?.focus();
    } else {
      pickerRef.current?.focus();
    }
  }

  useEffect(() => {
    void customersRepo.list().then(setCustomers);
    void salesmenRepo.list().then(setSalesmen);
    void listUomsWithShared().then(setUoms);
    void loadFbrSettings().then((s) => {
      setFbrEnabled(s.enabled);
      setBuyerProvince((prev) => prev || s.sellerProvince);
    });
  }, []);

  function onCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setCustomerName(c?.name ?? "");
    setCustomerPhone(c?.phone ?? "");
    setBuyerNtn(c?.cnic_ntn ?? "");
    setBuyerAddress(c?.address ?? "");
    if (c?.province) setBuyerProvince(c.province);
  }

  function validateBuyer(): string | null {
    if (narcoticNames.length > 0) {
      if (!customerName.trim() || !customerPhone.trim()) {
        return `Customer name and mobile number are required for narcotic products (${narcoticNames.join(", ")}).`;
      }
    }
    if (customerPhone.trim() && !isValidPkMobile(customerPhone)) {
      return "Mobile number must be like 03XXXXXXXXX or +923XXXXXXXXX.";
    }
    if (buyerNtn.trim() && !isValidNtnOrCnic(buyerNtn)) {
      return "Buyer NTN must be 7-9 digits or CNIC 13 digits.";
    }
    if (buyerRegType === "Registered" && !buyerNtn.trim()) {
      return "A registered buyer needs an NTN/CNIC for FBR.";
    }
    if (fbrEnabled && !buyerProvince) {
      return "Buyer province is required for FBR digital invoicing.";
    }
    return null;
  }

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
          salePrice: convertPriceOnUnitToggle(l.salePrice, toSecondary, packing),
        };
      })
    );
  }

  // Edit mode: load the invoice's existing line items and reconstruct the
  // line editor from them (current batch qty where that batch still exists).
  useEffect(() => {
    if (!invoice) return;
    (async () => {
      const items = await listItemsForInvoice(invoice.id);
      setOriginalItems(items);
      const reconstructed: Line[] = [];
      for (const item of items) {
        const product = await productsRepo.get(item.product_id);
        if (!product) continue;
        const batches = await listAvailableBatches(item.product_id);
        const matching = batches.find((b) => b.batch_no === item.batch_no);
        const batch: ProductBatchOption = matching ?? {
          id: `stale:${item.id}`,
          batch_no: item.batch_no,
          expiry_date: null,
          qty: item.qty + item.bonus_qty,
          purchase_price: item.purchase_price,
        };
        reconstructed.push({
          product,
          batch,
          qty: item.qty,
          bonusQty: item.bonus_qty,
          salePrice: item.sale_price,
          taxPct: item.tax_pct,
          discountPct: item.discount_pct,
          // Stored items are already normalized to base units.
          unit: "base",
        });
      }
      setLines(reconstructed);
      setLoadingExisting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  // Pre-populate lines from a prescription's rx items (one-click Create Invoice from Rx).
  useEffect(() => {
    if (!rxId || invoice) return;
    (async () => {
      const rx = await getRxForInvoice(rxId).catch(() => ({ items: [], notes: null }));
      const rxItems = rx.items;
      if (!rxItems.length) return;
      const newLines: Line[] = [];
      for (const item of rxItems) {
        // Try to find the product by id (when doctor selected from catalogue)
        // or by name search (free-text fallback).
        let product: Product | null = null;
        if (item.product_id) {
          product = await productsRepo.get(item.product_id).catch(() => null);
        }
        if (!product) {
          // Name-based lookup: find first matching non-deleted product.
          const matches = await productsRepo.list({ where: "name LIKE ?", params: [`%${item.product_name}%`], orderBy: "name ASC" }).catch(() => []);
          product = matches[0] ?? null;
        }
        if (!product) continue;
        const batches = await listAvailableBatches(product.id).catch(() => []);
        const batch = batches[0];
        if (!batch) continue;
        const [priceObj, discPct] = await Promise.all([
          getLatestPrice(product.id).catch(() => null),
          getEffectiveDiscountPct(product).catch(() => 0),
        ]);
        const salePrice = priceObj?.salePrice ?? batch.purchase_price;
        newLines.push({
          product,
          batch,
          qty: item.qty,
          bonusQty: 0,
          salePrice,
          taxPct: product.tax_rate_pct,
          discountPct: discPct,
          unit: "base",
        });
      }
      if (newLines.length) {
        setLines(newLines);
        if (rx?.notes) setDescription(rx.notes);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rxId]);

  /** No manual batch picker: picking a product adds it straight away, using
   * the batch with the earliest expiry (FEFO) that `listAvailableBatches`
   * already sorts to the front. If the same product is scanned twice, bump
   * the existing line's qty instead of adding a duplicate row. */
  async function onProductSelected(p: Product) {
    setError(null);
    const existingIdx = lines.findIndex((l) => l.product.id === p.id);
    const batches = await listAvailableBatches(p.id);
    const batch = batches[0];
    if (!batch) {
      setError(`${p.name} has no available stock.`);
      return;
    }
    if (existingIdx >= 0) {
      const existing = lines[existingIdx];
      const availInLineUnit = fromBaseUnitQty(batch.qty, existing.unit === "secondary", p.packing || 1);
      if (existing.qty + existing.bonusQty + 1 > availInLineUnit) {
        setError(`Only ${availInLineUnit} of ${p.name} available.`);
        return;
      }
      updateLine(existingIdx, { qty: existing.qty + 1 });
      return;
    }
    const [price, discountPct] = await Promise.all([getLatestPrice(p.id), getEffectiveDiscountPct(p)]);
    setLines((prev) => [
      ...prev,
      {
        product: p,
        batch,
        qty: 1,
        bonusQty: 0,
        taxPct: p.gst_rate_pct ?? 0,
        discountPct,
        ...(() => {
          const defaultUnit: "base" | "secondary" = hasSecondaryUnit(p) ? "secondary" : "base";
          const pk = p.packing || 1;
          const rawPrice = price?.salePrice ?? batch.purchase_price;
          return { salePrice: defaultUnit === "secondary" ? rawPrice / pk : rawPrice, unit: defaultUnit };
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

  function lineTotal(l: Line) {
    const gross = l.salePrice * l.qty;
    const discount = gross * (l.discountPct / 100);
    const taxable = gross - discount;
    const tax = taxable * (l.taxPct / 100);
    return taxable + tax;
  }

  const narcoticNames = lines.filter((l) => l.product.is_narcotic).map((l) => l.product.name);
  const total = lines.reduce((s, l) => s + l.salePrice * l.qty, 0);
  const lineDiscountTotal = lines.reduce((s, l) => s + l.salePrice * l.qty * (l.discountPct / 100), 0);
  const taxTotal = lines.reduce((s, l) => {
    const gross = l.salePrice * l.qty;
    const discount = gross * (l.discountPct / 100);
    return s + (gross - discount) * (l.taxPct / 100);
  }, 0);
  const payable = total - lineDiscountTotal - (Number(discountRs) || 0) + (Number(charges) || 0) + taxTotal;
  const balance = payable - (Number(paid) || 0);

  async function buildLineItems(invoiceId: string, skipStockDeduct = false) {
    for (const l of lines) {
      let batchId = l.batch.id;
      if (isEdit && batchId.startsWith("stale:")) {
        const fresh = await listAvailableBatches(l.product.id);
        const match = fresh.find((b) => b.batch_no === l.batch.batch_no) ?? fresh[0];
        if (!match) throw new Error(`No stock available for ${l.product.name}.`);
        batchId = match.id;
      }
      const isSecondary = l.unit === "secondary";
      const packing = l.product.packing || 1;
      const finalQty = toBaseUnitQty(l.qty, isSecondary, packing);
      const finalBonusQty = toBaseUnitQty(l.bonusQty, isSecondary, packing);
      const finalSalePrice = isSecondary ? l.salePrice * packing : l.salePrice;

      if (!skipStockDeduct) {
        await deductStock(batchId, finalQty + finalBonusQty);
      }
      await invoiceItemsRepo.create({
        invoice_id: invoiceId,
        product_id: l.product.id,
        batch_no: l.batch.batch_no,
        packing: l.product.packing,
        uom_id: l.product.base_unit_id,
        avail_qty: l.batch.qty,
        qty: finalQty,
        bonus_qty: finalBonusQty,
        purchase_price: l.batch.purchase_price,
        sale_price: finalSalePrice,
        tax_pct: l.taxPct,
        further_tax_pct: 0,
        tax_rs: (finalSalePrice * finalQty - finalSalePrice * finalQty * (l.discountPct / 100)) * (l.taxPct / 100),
        discount_pct: l.discountPct,
        discount_rs: finalSalePrice * finalQty * (l.discountPct / 100),
        total: lineTotal(l),
      });
    }
  }

  function invoiceHeader() {
    return {
      date: canPickDate ? invoiceDate : invoice?.date ?? localToday(),
      inv_on: invOn.toLowerCase(),
      invoice_type: invoiceType.toLowerCase(),
      description: description || null,
      salesman_id: salesmanId || null,
      customer_id: customerId || null,
      customer_name: customerName.trim() || null,
      customer_phone: customerPhone.trim() || null,
      buyer_ntn_cnic: normalizeNtn(buyerNtn) || null,
      buyer_province: buyerProvince || null,
      buyer_address: buyerAddress.trim() || null,
      buyer_registration_type: buyerRegType,
      total,
      charges: Number(charges) || 0,
      discount_pct: 0,
      discount_rs: Number(discountRs) || 0,
      tax_pct: 0,
      payable,
      paid: Number(paid) || 0,
      balance,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) {
      setError("Add at least one product line.");
      return;
    }
    if (canPickDate && (!invoiceDate || invoiceDate > localToday())) {
      setError("Invoice date can't be in the future.");
      return;
    }
    const buyerError = validateBuyer();
    if (buyerError) {
      setError(buyerError);
      return;
    }
    if (!isEdit) {
      const cap = useAuthStore.getState().currentTenant?.maxInvoicesPerMonth;
      if (cap != null) {
        const monthStart = new Date();
        monthStart.setDate(1);
        const used = await countInvoicesThisMonth(monthStart.toISOString().slice(0, 10));
        if (used >= cap) {
          setError(`Your plan allows up to ${cap} invoices per month - that limit has been reached for this month.`);
          return;
        }
      }
    }
    setSaving(true);
    setError(null);
    try {
      let invoiceId: string;
      if (isEdit && invoice) {
        // Put back what the original items had deducted, delete them, then
        // deduct fresh for whatever the form now says - this way editing
        // can't drift from a plain delete+recreate's stock bookkeeping.
        await restoreInvoiceStock(originalItems);
        for (const item of originalItems) await invoiceItemsRepo.remove(item.id);
        await invoicesRepo.update(invoice.id, invoiceHeader());
        invoiceId = invoice.id;
      } else {
        const invoiceNo = await nextInvoiceNo();
        const created = await invoicesRepo.create({
          ...invoiceHeader(),
          invoice_no: invoiceNo,
          is_return: 0,
          is_memorized: 0,
          converted_invoice_id: null,
        });
        invoiceId = created.id;
      }
      await buildLineItems(invoiceId);
      // Billed from a received prescription: mark it invoiced so it is not billed twice.
      if (rxId && !invoice) await markPrescriptionInvoiced(rxId, invoiceId).catch(() => undefined);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDraft() {
    if (lines.length === 0) {
      setError("Add at least one product line.");
      return;
    }
    const buyerError = validateBuyer();
    if (buyerError) {
      setError(buyerError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const invoiceNo = await nextInvoiceNo();
      const created = await invoicesRepo.create({
        ...invoiceHeader(),
        invoice_no: invoiceNo,
        is_return: 0,
        is_memorized: 1,
        converted_invoice_id: null,
      });
      // Drafts don't deduct stock - stock is deducted when converting to a real invoice.
      await buildLineItems(created.id, true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+D always runs the latest handleDraft (it closes over current state).
  draftRef.current = () => {
    if (!isEdit && !saving) void handleDraft();
  };

  return (
    <Modal title={isEdit ? "Edit Invoice" : "Create Invoice"} onClose={onClose} width="max-w-6xl">
      {loadingExisting ? (
        <p className="py-10 text-center text-sm text-neutral-400">Loading invoice...</p>
      ) : (
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {canPickDate && (
            <Field label="Invoice Date" required>
              <Input
                type="date"
                value={invoiceDate}
                max={localToday()}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
              />
              {invoiceDate < localToday() && (
                <span className="text-[11px] text-amber-700">Back-dated invoice</span>
              )}
            </Field>
          )}
          <Field label="Inv On (F9)" required>
            <Select value={invOn} onChange={(e) => setInvOn(e.target.value)} required>
              <option value="Cash">Cash</option>
              <option value="Credit">Credit</option>
            </Select>
          </Field>
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
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <Field label="Customer Name (F3)">
                <Select value={customerId} onChange={(e) => onCustomerChange(e.target.value)}>
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
        </div>

        <div className="rounded-xl bg-neutral-50/80 p-3 ring-1 ring-black/[0.04]">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-5 w-7 items-center justify-center rounded bg-[#006633] text-[9px] font-bold text-white">FBR</div>
            <span className="text-xs font-semibold text-neutral-700">Customer &amp; Buyer Details</span>
            {fbrEnabled && <span className="text-[11px] text-neutral-400">Sent to FBR with this invoice</span>}
          </div>
          {narcoticNames.length > 0 && (
            <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700 ring-1 ring-rose-200">
              Narcotic product on this invoice ({narcoticNames.join(", ")}). Customer name and mobile number are required.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Customer Name" required={narcoticNames.length > 0}>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in Customer" />
            </Field>
            <Field label="Mobile Number" required={narcoticNames.length > 0}>
              <Input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="03XXXXXXXXX"
              />
            </Field>
            <Field label="Buyer Registration Type" required={fbrEnabled}>
              <Select value={buyerRegType} onChange={(e) => setBuyerRegType(e.target.value)}>
                <option value="Unregistered">Unregistered</option>
                <option value="Registered">Registered</option>
              </Select>
            </Field>
            <Field label="Buyer NTN / CNIC" required={buyerRegType === "Registered"}>
              <Input
                value={buyerNtn}
                onChange={(e) => setBuyerNtn(e.target.value)}
                placeholder="NTN (e.g. 1234567 or A123456) or CNIC (13 digits)"
              />
            </Field>
            <Field label="Buyer Province" required={fbrEnabled}>
              <Select value={buyerProvince} onChange={(e) => setBuyerProvince(e.target.value)}>
                <option value="">Select...</option>
                {FBR_PROVINCES.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Buyer Address">
              <Input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} />
            </Field>
          </div>
        </div>

        <Field label="Barcode/Product Name">
          <ProductPicker ref={pickerRef} onSelect={(p) => void onProductSelected(p)} autoFocus />
        </Field>

        <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-neutral-900 text-left text-white">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Unit</th>
                <th className="px-2 py-2">Batch</th>
                <th className="px-2 py-2">Avail</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Bonus</th>
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
                  <td colSpan={11} className="px-2 py-6 text-center text-neutral-400">
                    No content in table
                  </td>
                </tr>
              ) : (
                lines.map((l, idx) => {
                  const isSecondary = l.unit === "secondary";
                  const availInLineUnit = fromBaseUnitQty(l.batch.qty, isSecondary, l.product.packing || 1);
                  return (
                  <tr key={idx} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-1.5">
                      {l.product.name}
                      {Boolean(l.product.is_narcotic) && (
                        <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          NARCOTIC
                        </span>
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
                    <td className="px-2 py-1.5">{l.batch.batch_no ?? "\u2014"}</td>
                    <td className="px-2 py-1.5">{availInLineUnit}</td>
                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_QTY, el)}
                        type="number"
                        min="1"
                        max={availInLineUnit - l.bonusQty}
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_QTY)}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_BONUS, el)}
                        type="number"
                        min="0"
                        step="any"
                        value={l.bonusQty}
                        onChange={(e) => updateLine(idx, { bonusQty: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_BONUS)}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_PRICE, el)}
                        type="number"
                        min="0"
                        step="any"
                        value={l.salePrice}
                        onChange={(e) => updateLine(idx, { salePrice: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_PRICE)}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_TAX, el)}
                        type="number"
                        min="0"
                        step="any"
                        value={l.taxPct}
                        onChange={(e) => updateLine(idx, { taxPct: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_TAX)}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_DISC, el)}
                        type="number"
                        min="0"
                        step="any"
                        value={l.discountPct}
                        onChange={(e) => updateLine(idx, { discountPct: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_DISC)}
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
                  );
                })
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
          <Field label="Discount Rs (F12)">
            <Input type="number" min="0" step="any" value={discountRs} onChange={(e) => setDiscountRs(e.target.value)} />
          </Field>
          <Field label="Tax">
            <Input value={taxTotal.toFixed(2)} disabled />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Payable">
            <Input value={payable.toFixed(2)} disabled />
          </Field>
          <Field label="Paid (F8)" required>
            <Input type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} required />
          </Field>
          <Field label="Balance">
            <Input value={balance.toFixed(2)} disabled />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          {!isEdit && (
            <Button
              type="button"
              onClick={() => void handleDraft()}
              disabled={saving || lines.length === 0}
              title="Ctrl+D"
            >
              Draft
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={saving || lines.length === 0} title="Ctrl+S">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Save"}
          </Button>
        </div>
      </form>
      )}

      {quickAddCustomer && (
        <QuickAddDialog
          title="Add Customer"
          onClose={() => setQuickAddCustomer(false)}
          onSubmit={async ({ name }) => {
            const created = await customersRepo.create({ name, opening_balance: 0, balance_type: "receivable" });
            setCustomers((prev) => [...prev, created]);
            setCustomerId(created.id);
            setCustomerName(created.name);
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

