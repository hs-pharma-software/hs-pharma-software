"use client";

import { useEffect, useRef, useState } from "react";
import { STANDALONE } from "@/lib/edition";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { QuickCustomerDialog } from "@/components/customers/QuickCustomerDialog";
import { saleLineMath } from "@/lib/saleLineMath";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { PurchaseRateBubble, useShowsPurchaseRate } from "@/components/invoices/PurchaseRateBubble";
import { ImeiPicker } from "@/components/mobile/ImeiPicker";
import { MeasurementPicker } from "@/components/cloth/MeasurementPicker";
import { measurementsRepo, measurementSummary, touchMeasurement, type ClothMeasurement } from "@/lib/cloth";
import { imeisOfInvoice, sellImeis } from "@/lib/repo/imei";
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
import { allocateBatches, batchLabel, totalStock, STOCK_EPS } from "@/lib/batchAllocation";
import { getLatestPrice, productsRepo } from "@/lib/repo/products";
import { getEffectiveDiscountPct } from "@/lib/repo/categories";
import { listUomsWithShared } from "@/lib/repo/uoms";
import { useAuthStore } from "@/store/authStore";
import {
  hasSecondaryUnit,
  convertQtyOnUnitToggle,
  convertPriceOnUnitToggle,
  inferEntryUnit,
  roundPrice,
  toSecondaryQty,
  toBaseUnitQty,
  fromBaseUnitQty,
} from "@/lib/uom";
import { loadFbrSettings } from "@/lib/fbr";
import { FBR_PROVINCES, isValidNtnOrCnic, isValidPkMobile, normalizeNtn } from "@/lib/fbrData";
import type { Customer, Product, Uom } from "@/lib/types";
import type { Salesman, Invoice } from "@/lib/types2";
import { CustomerPicker } from "@/components/invoices/CustomerPicker";
import { getCustomerUnpaidTotal } from "@/lib/repo/ledger";
import { businessType } from "@/config/businessTypes";
import { getRxForInvoice, markPrescriptionInvoiced } from "@/lib/repo/clinic";
import { localDate } from "@/lib/localDate";
import { serverJson } from "@/lib/serverMode";
import { desktopCall, useDesktopStatus, NeedsInternetError } from "@/lib/desktopBridge";
import { enterToNextField, useFieldHotkeys } from "@/lib/formKeys";

/** Today as YYYY-MM-DD in local (Pakistan) time, not UTC. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Line {
  product: Product;
  /** The earliest-expiring batch (price fallback). */
  batch: ProductBatchOption;
  /** Every batch in stock, earliest expiry first: a line may use several. */
  batches: ProductBatchOption[];
  /** Stock this invoice already holds (editing a saved invoice), base units. */
  extraAvail: number;
  qty: number;
  bonusQty: number;
  salePrice: number;
  taxPct: number;
  discountPct: number;
  /** Customer's extra discount %, after the line discount (only for customers allowed it). */
  extraPct: number;
  /** Which unit qty/bonusQty/salePrice above are currently expressed in -
   * everything is normalized back to base units (packs) on save, matching
   * how invoice_items/product_batches always store it. */
  unit: "base" | "secondary";
  /** Mobile shop: the IMEIs of the handsets sold on this line. */
  imeis?: string[];
  /** Contractor Medicine invoice: batch written on the line (print only). */
  printBatch?: string;
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
  webOrderId,
  cloneFrom,
  onClose,
  onSaved,
  active = true,
}: {
  /** Pass an existing invoice to edit it in place; omit to create a new one. */
  invoice?: Invoice | null;
  /** Prescription ID: pre-populate invoice lines from this prescription's rx items. */
  rxId?: string;
  /** Website order: pre-populate lines (the order's prices) and link the saved invoice to it. */
  webOrderId?: string;
  /** Start a new invoice as a copy of this one (customer, buyer details, lines). */
  cloneFrom?: Invoice | null;
  onClose: () => void;
  /** The saved invoice (not for a draft). */
  onSaved: (saved?: { id: string; no: number | null; offlineReceipt?: string; offlineRef?: string }) => void;
  /** False while another invoice tab is in front: keyboard shortcuts are
   * ignored so only the visible form reacts. */
  active?: boolean;
}) {
  const isEdit = Boolean(invoice);
  // MAVIN desktop app without internet: this same form saves cash sales on the computer.
  const desktop = useDesktopStatus();
  const offline = desktop?.online === false;
  /** A save that lost its connection half way: it may have reached the server, so no second save until checked. */
  const [uncertainSave, setUncertainSave] = useState(false);
  // A memorized draft holds no stock: editing it neither puts stock back nor takes any.
  const isDraft = Boolean(invoice?.is_memorized);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  // Edited invoice, or the one being cloned: the header starts from it.
  const base = invoice ?? cloneFrom ?? null;
  const [customerId, setCustomerId] = useState(base?.customer_id ?? "");
  const [salesmanId, setSalesmanId] = useState(base?.salesman_id ?? "");
  const [quickAddCustomer, setQuickAddCustomer] = useState(false);
  const [quickAddSalesman, setQuickAddSalesman] = useState(false);
  const [invOn, setInvOn] = useState(invoice ? (invoice.inv_on === "credit" ? "Credit" : "Cash") : "Cash");
  // Contractors may date an invoice in the past (work billed later); other
  // types always use today's date.
  const isContractor = businessType(useAuthStore((s) => s.currentTenant?.businessType)).id === "contractor";
  const canPickDate = isContractor;
  // Contractors see what the customer still owes (on screen only, never
  // printed) instead of Cash / Credit; the invoice is credit when unpaid.
  const [customerOwes, setCustomerOwes] = useState<number | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(invoice?.date ?? localToday());
  const [invoiceType, setInvoiceType] = useState(
    base
      ? ({ wholesale: "Wholesale", medicine: "Medicine", general: "General" } as Record<string, string>)[base.invoice_type ?? ""] ??
          (isContractor ? "General" : "Retail")
      : isContractor ? "General" : "Retail"
  );
  // Contractors: General invoices have no batch; Medicine ones (allowed by
  // the Super Admin) take a batch written on each line, printed on the invoice.
  const medicineAllowed = useAuthStore((s) => s.currentTenant?.medicineInvoiceAllowed === true);
  const contractorKind = isContractor ? (invoiceType === "Medicine" ? "medicine" : "general") : null;
  const [description, setDescription] = useState(base?.description ?? "");

  const [customerName, setCustomerName] = useState(base?.customer_name ?? "");
  const [customerPhone, setCustomerPhone] = useState(base?.customer_phone ?? "");
  const [buyerNtn, setBuyerNtn] = useState(base?.buyer_ntn_cnic ?? "");
  const [buyerProvince, setBuyerProvince] = useState(base?.buyer_province ?? "");
  const [buyerAddress, setBuyerAddress] = useState(base?.buyer_address ?? "");
  const [buyerRegType, setBuyerRegType] = useState(base?.buyer_registration_type ?? "Unregistered");
  const [fbrEnabled, setFbrEnabled] = useState(false);

  const [lines, setLines] = useState<Line[]>([]);
  // The admin sees a line's purchase rate while in its quantity box.
  const showsRate = useShowsPurchaseRate();
  const [rateLine, setRateLine] = useState<number | null>(null);
  // Mobile shop: the line whose handsets are being picked.
  const [imeiLine, setImeiLine] = useState<number | null>(null);
  // Cloth store: the customer's saved custom size on this bill.
  const isClothStore = useAuthStore((s) => s.currentTenant?.businessType) === "cloth_store";
  const [measurement, setMeasurement] = useState<ClothMeasurement | null>(null);
  const [pickingMeasurement, setPickingMeasurement] = useState(false);
  useEffect(() => {
    const id = (invoice as { measurement_id?: string | null } | null)?.measurement_id;
    if (id) void measurementsRepo.get(id).then(setMeasurement).catch(() => setMeasurement(null));
  }, [invoice]);
  const [originalItems, setOriginalItems] = useState<InvoiceItemWithProduct[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(isEdit || Boolean(cloneFrom));

  const [discountRs, setDiscountRs] = useState(String(base?.discount_rs ?? 0));
  const [charges, setCharges] = useState(String(base?.charges ?? 0));
  const [paid, setPaid] = useState(String(invoice?.paid ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phones: buyer details folded into one line unless opened or needed.
  const [buyerOpen, setBuyerOpen] = useState(false);
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

  /** Enter on a line input: the next column that can be typed in (locked ones,
   * e.g. bonus and price offline, are skipped); after the last, back to the
   * product search bar. */
  function handleLineEnter(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    for (let c = colIdx + 1; c <= LAST_COL; c++) {
      const el = lineInputRefs.current[rowIdx]?.[c];
      if (el && !el.disabled && !el.readOnly) {
        el.focus();
        el.select();
        return;
      }
    }
    pickerRef.current?.focus();
  }

  useFieldHotkeys(formRef, active);

  useEffect(() => {
    void customersRepo.list().then(setCustomers);
    void salesmenRepo.list().then((list) => {
      setSalesmen(list);
      // A new invoice by a salesman's own login goes on that salesman (his sales and progress).
      if (!invoice) {
        const uid = useAuthStore.getState().currentUser?.id;
        const mine = list.find((s) => s.user_id && s.user_id === uid);
        if (mine) setSalesmanId((cur) => cur || mine.id);
      }
    });
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
    setBuyerNtn((isContractor ? c?.ntn || c?.cnic_ntn : c?.cnic_ntn) ?? "");
    setBuyerAddress(c?.address ?? "");
    if (c?.province) {
      // Contractors: match the saved province to FBR's list (any letter case).
      const p = c.province.trim().toLowerCase();
      const match = isContractor ? FBR_PROVINCES.find((x) => x.label.toLowerCase() === p || x.fbr.toLowerCase() === p) : null;
      setBuyerProvince(match?.label ?? c.province);
    }
    // Contractors: the customer's saved FBR registration fills the buyer type too.
    if (isContractor) {
      const reg = (c?.registration_type ?? "").toLowerCase();
      setBuyerRegType(reg.startsWith("reg") ? "Registered" : reg.startsWith("unreg") ? "Unregistered" : c?.ntn ? "Registered" : "Unregistered");
    }
  }

  useEffect(() => {
    if (!isContractor || !customerId) return setCustomerOwes(null);
    let live = true;
    getCustomerUnpaidTotal(customerId, invoice?.id).then((n) => live && setCustomerOwes(n), () => live && setCustomerOwes(null));
    return () => {
      live = false;
    };
  }, [isContractor, customerId, invoice?.id]);

  function validateBuyer(): string | null {
    // A handset is sold to a known buyer: name, CNIC and mobile on the bill.
    if (lines.some((l) => l.product.track_imei)) {
      if (!customerName.trim() || !customerPhone.trim() || !buyerNtn.trim()) {
        return "Selling a handset: enter the buyer's name, CNIC and mobile number.";
      }
      if (normalizeNtn(buyerNtn).length !== 13) return "Enter the buyer's 13-digit CNIC.";
    }
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
  // Clone: the same lines on a new invoice (stock is taken again on save).
  useEffect(() => {
    const src = invoice ?? cloneFrom;
    if (!src) return;
    const cloning = !invoice;
    (async () => {
      const items = await listItemsForInvoice(src.id);
      if (!cloning) setOriginalItems(items);
      const draft = cloning || Boolean(src.is_memorized);
      const reconstructed: Line[] = [];
      // A line sold from several batches was saved as one item per batch: show it as one line again.
      for (const item of items) {
        const same = reconstructed.find((l) => l.product.id === item.product_id && l.salePrice === item.sale_price
          && l.taxPct === item.tax_pct && l.discountPct === item.discount_pct && l.extraPct === Number(item.extra_disc_pct ?? 0));
        const held = draft ? 0 : Number(item.qty) + Number(item.bonus_qty);
        if (same) {
          same.qty += Number(item.qty);
          same.bonusQty += Number(item.bonus_qty);
          same.extraAvail += held;
          continue;
        }
        const product = await productsRepo.get(item.product_id);
        if (!product) continue;
        const batches = await listAvailableBatches(item.product_id);
        const batch: ProductBatchOption = batches.find((b) => b.batch_no === item.batch_no) ?? batches[0] ?? {
          id: `stale:${item.id}`,
          batch_no: item.batch_no,
          expiry_date: null,
          qty: 0,
          purchase_price: item.purchase_price,
        };
        reconstructed.push({
          product,
          batch,
          batches,
          extraAvail: held,
          qty: Number(item.qty),
          bonusQty: Number(item.bonus_qty),
          salePrice: item.sale_price,
          taxPct: item.tax_pct,
          discountPct: item.discount_pct,
          extraPct: Number(item.extra_disc_pct ?? 0),
          printBatch: item.line_batch ?? undefined,
          // Stored items are already normalized to base units.
          unit: "base",
        });
      }
      // The handsets sold on this bill go back on their lines.
      const sold = draft ? new Map<string, string[]>() : await imeisOfInvoice(src.id);
      for (const l of reconstructed) {
        const pool = sold.get(l.product.id);
        if (pool?.length) l.imeis = pool.splice(0, l.qty + l.bonusQty);
      }
      // Saved in base units: show each line in the unit it was entered in (3 CAP, not 0.43 Pack).
      setLines(reconstructed.map((l) => {
        const pk = l.product.packing || 1;
        if (inferEntryUnit(l.qty, l.bonusQty, pk, hasSecondaryUnit(l.product)) === "base") return l;
        return {
          ...l,
          unit: "secondary" as const,
          qty: toSecondaryQty(l.qty, pk),
          bonusQty: toSecondaryQty(l.bonusQty, pk),
          salePrice: roundPrice(l.salePrice / pk),
        };
      }));
      setLoadingExisting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, cloneFrom?.id]);

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
        // The server leaves purchase_price out for logins without purchase prices: no price then (typed by hand).
        const salePrice = priceObj?.salePrice ?? batch.purchase_price ?? 0;
        newLines.push({
          product,
          batch,
          batches,
          extraAvail: 0,
          qty: item.qty,
          bonusQty: 0,
          salePrice,
          taxPct: product.tax_rate_pct,
          discountPct: discPct,
          extraPct: 0,
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

  // Pre-populate from a website order: its products, quantities and agreed prices.
  useEffect(() => {
    if (!webOrderId || invoice) return;
    (async () => {
      const o = await serverJson<{ result: { orderNo: number; customerName: string; phone: string; notes: string | null; items: { productId: string; name: string; qty: number; price: number }[] } }>(
        "/api/web/manage/", { action: "orderForInvoice", id: webOrderId },
      ).then((r) => r.result).catch((e) => { setError(e instanceof Error ? e.message : String(e)); return null; });
      if (!o) return;
      const newLines: Line[] = [];
      const missing: string[] = [];
      for (const item of o.items) {
        const product = await productsRepo.get(item.productId).catch(() => null);
        const batches = product ? await listAvailableBatches(product.id).catch(() => []) : [];
        if (!product || !batches[0]) { missing.push(item.name); continue; }
        const discPct = await getEffectiveDiscountPct(product).catch(() => 0);
        newLines.push({ product, batch: batches[0], batches, extraAvail: 0, qty: item.qty, bonusQty: 0, salePrice: item.price, taxPct: product.tax_rate_pct, discountPct: discPct, extraPct: 0, unit: "base" });
      }
      if (newLines.length) setLines(newLines);
      setCustomerName(o.customerName);
      setCustomerPhone(o.phone);
      setDescription(`Website order #${o.orderNo}${o.notes ? `: ${o.notes}` : ""}`);
      if (missing.length) setError(`No stock found for: ${missing.join(", ")}. Add them by hand or update the order.`);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webOrderId]);

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
      const availInLineUnit = fromBaseUnitQty(lineAvail(existing), existing.unit === "secondary", p.packing || 1);
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
        batches,
        extraAvail: 0,
        qty: 1,
        bonusQty: 0,
        taxPct: p.gst_rate_pct ?? 0,
        discountPct,
        extraPct: 0,
        ...(() => {
          const defaultUnit: "base" | "secondary" = hasSecondaryUnit(p) ? "secondary" : "base";
          const pk = p.packing || 1;
          const rawPrice = price?.salePrice ?? batch.purchase_price ?? 0;
          return { salePrice: defaultUnit === "secondary" ? roundPrice(rawPrice / pk) : rawPrice, unit: defaultUnit };
        })(),
      },
    ]);
  }

  /** All of the product's stock this line may sell, base units. */
  function lineAvail(l: Line): number {
    return totalStock(l.batches) + l.extraAvail;
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

  const narcoticNames = lines.filter((l) => l.product.is_narcotic).map((l) => l.product.name);
  // Opened by the person, or when it matters: narcotics (name and mobile needed), a registered buyer, or an error to fix.
  const buyerShown = buyerOpen || narcoticNames.length > 0 || buyerRegType === "Registered" || Boolean(error);
  const total = lines.reduce((s, l) => s + l.salePrice * l.qty, 0);
  const lineDiscountTotal = lines.reduce((s, l) => s + lineMath(l).discountRs, 0);
  const taxTotal = lines.reduce((s, l) => s + lineMath(l).tax, 0);
  const payable = total - lineDiscountTotal - (Number(discountRs) || 0) + (Number(charges) || 0) + taxTotal;
  const balance = payable - (Number(paid) || 0);

  /** Saves the lines as invoice items. A line larger than one batch is taken
   * from several, earliest expiry first, and saved as one item per batch (so
   * the print shows every batch). A draft takes no stock: it records the
   * batches it would use, and any shortfall on the last one. */
  async function buildLineItems(invoiceId: string, skipStockDeduct = false) {
    const used = new Map<string, number>();
    const fresh = new Map<string, ProductBatchOption[]>();
    for (const l of lines) {
      if (!fresh.has(l.product.id)) fresh.set(l.product.id, await listAvailableBatches(l.product.id));
      const batches = fresh.get(l.product.id)!;
      const isSecondary = l.unit === "secondary";
      const packing = l.product.packing || 1;
      const finalQty = toBaseUnitQty(l.qty, isSecondary, packing);
      const finalBonusQty = toBaseUnitQty(l.bonusQty, isSecondary, packing);
      const finalSalePrice = isSecondary ? l.salePrice * packing : l.salePrice;
      const { parts, short } = allocateBatches(batches, finalQty, finalBonusQty, used);
      if (short > STOCK_EPS) {
        if (!skipStockDeduct) throw new Error(`Not enough stock of ${l.product.name}: ${short} more needed than all its batches hold.`);
        // A draft may hold more than is in stock: the rest goes on the last batch (or the line's own).
        if (!parts.length) parts.push({ batch: l.batch, qty: 0, bonus: 0 });
        const last = parts[parts.length - 1];
        last.qty += Math.max(0, finalQty - parts.reduce((t, p) => t + p.qty, 0));
        last.bonus += Math.max(0, finalBonusQty - parts.reduce((t, p) => t + p.bonus, 0));
      }
      for (const part of parts) {
        if (!skipStockDeduct) await deductStock(part.batch.id, part.qty + part.bonus);
        const m = saleLineMath(finalSalePrice, part.qty, l.discountPct, extraOf(l), l.taxPct);
        await invoiceItemsRepo.create({
          invoice_id: invoiceId,
          product_id: l.product.id,
          batch_no: part.batch.batch_no,
          line_batch: contractorKind === "medicine" ? l.printBatch?.trim() || null : null,
          packing: l.product.packing,
          uom_id: l.product.base_unit_id,
          avail_qty: part.batch.qty,
          qty: part.qty,
          bonus_qty: part.bonus,
          purchase_price: part.batch.purchase_price,
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
    }
  }

  /** Every handset line has one IMEI per unit sold. */
  function imeiProblem(): string | null {
    for (const l of lines) {
      if (!l.product.track_imei) continue;
      const units = toBaseUnitQty(l.qty, l.unit === "secondary", l.product.packing || 1) + toBaseUnitQty(l.bonusQty, l.unit === "secondary", l.product.packing || 1);
      if ((l.imeis ?? []).length !== units) return `${l.product.name}: pick ${units} IMEI${units === 1 ? "" : "s"} (${(l.imeis ?? []).length} picked). Click IMEI on the line.`;
    }
    return null;
  }

  /** Before anything is saved: every product's lines fit in its stock (all
   * batches, plus what this invoice already holds when it is edited). */
  function stockProblem(): string | null {
    const need = new Map<string, { name: string; qty: number; avail: number }>();
    for (const l of lines) {
      const isSecondary = l.unit === "secondary";
      const packing = l.product.packing || 1;
      const q = toBaseUnitQty(l.qty, isSecondary, packing) + toBaseUnitQty(l.bonusQty, isSecondary, packing);
      const cur = need.get(l.product.id) ?? { name: l.product.name, qty: 0, avail: 0 };
      cur.qty += q;
      cur.avail = Math.max(cur.avail, lineAvail(l));
      need.set(l.product.id, cur);
    }
    for (const n of need.values()) {
      if (n.qty > n.avail + STOCK_EPS) return `Only ${Math.round(n.avail * 1000) / 1000} of ${n.name} in stock (all batches), ${Math.round(n.qty * 1000) / 1000} entered.`;
    }
    return null;
  }

  function invoiceHeader() {
    return {
      date: canPickDate ? invoiceDate : invoice?.date ?? localToday(),
      inv_on: isContractor ? (balance > 0.005 ? "credit" : "cash") : invOn.toLowerCase(),
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
      ...(isClothStore ? { measurement_id: measurement?.id ?? null } : {}),
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
    const stockError = stockProblem();
    if (stockError) {
      setError(stockError);
      return;
    }
    const imeiError = imeiProblem();
    if (imeiError) {
      setError(imeiError);
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
        const used = await countInvoicesThisMonth(localDate(monthStart));
        if (used >= cap) {
          setError(`Your plan allows up to ${cap} invoices per month - that limit has been reached for this month.`);
          return;
        }
      }
    }
    if (offline) {
      await saveOffline();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let invoiceId: string;
      // The edited invoice keeps its number; a new one gets the next.
      let savedNo: number | null = invoice?.invoice_no ?? null;
      if (isEdit && invoice) {
        // Put back what the original items had deducted, delete them, then
        // deduct fresh for whatever the form now says - this way editing
        // can't drift from a plain delete+recreate's stock bookkeeping.
        if (!isDraft) await restoreInvoiceStock(originalItems);
        for (const item of originalItems) await invoiceItemsRepo.remove(item.id);
        await invoicesRepo.update(invoice.id, invoiceHeader());
        invoiceId = invoice.id;
      } else {
        const invoiceNo = await nextInvoiceNo();
        savedNo = invoiceNo;
        const created = await invoicesRepo.create({
          ...invoiceHeader(),
          invoice_no: invoiceNo,
          is_return: 0,
          is_memorized: 0,
          converted_invoice_id: null,
        });
        invoiceId = created.id;
      }
      await buildLineItems(invoiceId, isDraft);
      if (isClothStore && measurement) await touchMeasurement(measurement.id).catch(() => undefined);
      // Handsets: sold to this buyer (an edited bill's earlier ones go back first).
      if (!isDraft && (lines.some((l) => l.product.track_imei) || isEdit)) {
        await sellImeis(
          invoiceId,
          lines.filter((l) => l.product.track_imei).map((l) => ({ productId: l.product.id, productName: l.product.name, imeis: l.imeis ?? [] })),
          { name: customerName.trim() || null, mobile: customerPhone.trim() || null, cnic: normalizeNtn(buyerNtn) || null }
        );
      }
      // Billed from a received prescription: mark it invoiced so it is not billed twice.
      if (rxId && !invoice) await markPrescriptionInvoiced(rxId, invoiceId).catch(() => undefined);
      // Billed from a website order: link it once, so it is not billed twice and its stock hold ends.
      if (webOrderId && !invoice && !isDraft) await serverJson("/api/web/manage/", { action: "linkInvoice", id: webOrderId, invoiceId }).catch(() => undefined);
      onSaved(isDraft ? undefined : { id: invoiceId, no: savedNo });
    } catch (err) {
      // Desktop app: the connection dropped during the save. Part of it may be on the server already.
      if (err instanceof NeedsInternetError) {
        setUncertainSave(true);
        setError("The internet dropped while this invoice was being saved, so it may be partly saved on MAVIN.pk. The bill is kept here. When the connection is back, check Sales before saving it again.");
      } else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /** Offline (desktop app): a cash sale saved on this computer in one step, sent to MAVIN.pk once when the internet returns. */
  async function saveOffline() {
    const block = uncertainSave
      ? "The last save may already be on MAVIN.pk. Reconnect and check Sales before saving this bill offline."
      : isEdit || isDraft ? "Editing a saved invoice needs an internet connection."
      : invOn.toLowerCase() !== "cash" ? "Offline sales are cash only. Set Inv On to Cash."
      : lines.some((l) => l.bonusQty > 0) ? "Bonus quantities need an internet connection."
      : lines.some((l) => extraOf(l) > 0) ? "Extra discount needs an internet connection."
      : lines.some((l) => l.product.track_imei) ? "Handsets with IMEI numbers need an internet connection."
      : (Number(charges) || 0) !== 0 || (Number(discountRs) || 0) !== 0 ? "Charges and bill discount need an internet connection."
      : (Number(paid) || 0) + 0.005 < payable ? "Offline sales are cash only: Paid must cover the total."
      : desktop?.sellBlock ?? null;
    if (block) {
      setError(block);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await desktopCall((b) => b.createSale({
        lines: lines.map((l) => ({ productId: l.product.id, unit: l.unit === "secondary" ? "loose" : "pack", qty: l.qty, discountPct: l.discountPct })),
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        tendered: Number(paid) || 0,
      }));
      onSaved({ id: r.saleId, no: null, offlineReceipt: r.receipt, offlineRef: r.offlineRef });
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
  useEffect(() => {
    draftRef.current = () => {
      if (!isEdit && !saving) void handleDraft();
    };
  });

  return (
    <Modal title={isDraft ? "Edit Memorized Invoice" : isEdit ? "Edit Invoice" : "Create Invoice"} onClose={onClose} width="max-w-6xl" closeOnEscape={false}>
      {loadingExisting ? (
        <p className="py-10 text-center text-sm text-neutral-400">Loading invoice...</p>
      ) : (
      <form ref={formRef} onSubmit={handleSubmit} onKeyDown={(e) => enterToNextField(e, () => pickerRef.current?.focus())} className="flex flex-col gap-3">
        {offline && (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <b>Offline.</b> Cash sales are saved on this computer and sent to MAVIN.pk once when the internet returns.
            Prices, tax and stock are this computer&apos;s copy{desktop?.copyRefreshedAt ? ` as of ${new Date(desktop.copyRefreshedAt).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}` : ""};
            sales made on other counters or online since then are not included. Credit, bonus, charges, bill discount, editing invoices and FBR submission need internet.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
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
          {isContractor ? (
            <Field label="Customer Balance">
              <div
                title="Unpaid invoices of this customer. Shown here only, not printed."
                className={`rounded-lg border px-3 py-1.5 text-sm tabular-nums ${customerOwes && customerOwes > 0.005 ? "border-amber-300 bg-amber-50 font-semibold text-amber-800" : "border-neutral-200 bg-neutral-50 text-neutral-500"}`}
              >
                {customerId ? (customerOwes == null ? "..." : `Rs ${customerOwes.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : "Walk-in"}
              </div>
            </Field>
          ) : (
            <Field label="Inv On (F9)" required>
              <Select value={invOn} onChange={(e) => setInvOn(e.target.value)} required>
                <option value="Cash">Cash</option>
                <option value="Credit">Credit</option>
              </Select>
            </Field>
          )}
          <Field label="Invoice Type">
            <Select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
              {isContractor ? (
                <>
                  <option value="General">General</option>
                  {(medicineAllowed || invoiceType === "Medicine") && <option value="Medicine">Medicine</option>}
                </>
              ) : (
                <>
                  <option value="Retail">Retail</option>
                  <option value="Wholesale">Wholesale</option>
                </>
              )}
            </Select>
          </Field>
          {!isContractor && (
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
          )}
          <div className={`col-span-2 flex items-end gap-1.5 sm:col-span-1 ${isContractor ? "sm:col-span-4" : ""}`}>
            <div className="min-w-0 flex-1">
              <Field label="Customer Name (F3)">
                {isContractor ? (
                  <CustomerPicker
                    customers={customers}
                    value={customerId}
                    onSelect={onCustomerChange}
                    onFreeText={(name) => setCustomerName(name)}
                    placeholder="Walk-in - type a name, mobile or NTN/CNIC to search"
                    large
                  />
                ) : (
                  <Select value={customerId} onChange={(e) => onCustomerChange(e.target.value)}>
                    <option value="">Walk-in</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAddCustomer(true)}>
              +
            </Button>
          </div>
        </div>

        <div className="rounded-xl bg-neutral-50/80 p-3 ring-1 ring-black/[0.04]">
          <button
            type="button"
            onClick={() => setBuyerOpen((v) => !v)}
            aria-expanded={buyerShown}
            className="flex w-full items-center gap-2 text-left sm:pointer-events-none sm:mb-2"
          >
            {!STANDALONE && <div className="flex h-5 w-7 shrink-0 items-center justify-center rounded bg-[#006633] text-[9px] font-bold text-white">FBR</div>}
            <span className="text-xs font-semibold text-neutral-700">{STANDALONE ? "Customer Details" : "Customer & Buyer Details"}</span>
            {fbrEnabled && <span className="hidden text-[11px] text-neutral-400 sm:inline">Sent to FBR with this invoice</span>}
            <span className="ml-auto min-w-0 truncate text-[11px] text-neutral-500 sm:hidden">
              {buyerShown ? "Hide" : `${customerName.trim() || "Walk-in"} · ${buyerRegType}${buyerProvince ? ` · ${buyerProvince}` : ""}`}
            </span>
          </button>
          <div className={buyerShown ? "mt-2 sm:mt-0" : "max-sm:hidden"}>
          {narcoticNames.length > 0 && (
            <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700 ring-1 ring-rose-200">
              Narcotic product on this invoice ({narcoticNames.join(", ")}). Customer name and mobile number are required.
            </p>
          )}
          {isClothStore && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900 ring-1 ring-violet-200">
              <span className="font-semibold">Custom size:</span>
              {measurement ? (
                <span className="min-w-0 flex-1 truncate" title={measurementSummary(measurement)}>
                  {measurement.customer_name} · {measurement.garment} · {measurementSummary(measurement)}
                </span>
              ) : <span className="flex-1 text-violet-700">none (standard size)</span>}
              <button type="button" onClick={() => setPickingMeasurement(true)} className="rounded-full bg-white px-2.5 py-0.5 font-medium ring-1 ring-violet-300 hover:bg-violet-100">
                {measurement ? "Change" : "Add custom size"}
              </button>
              {measurement && <button type="button" onClick={() => setMeasurement(null)} className="text-violet-700 hover:underline">Remove</button>}
              {measurement && (
                <label className="flex basis-full items-center gap-2 sm:basis-auto">
                  <span className="font-semibold">Custom charges (Rs)</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label="Custom charges"
                    value={charges}
                    onChange={(e) => setCharges(e.target.value)}
                    placeholder="Stitching / alteration"
                    className="w-28 rounded-lg border border-violet-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums text-neutral-900"
                  />
                  <span className="text-violet-700">added to the total</span>
                </label>
              )}
            </div>
          )}
          {pickingMeasurement && (
            <MeasurementPicker
              defaults={{ customer_name: customerName, mobile: customerPhone }}
              onClose={() => setPickingMeasurement(false)}
              onPick={(m) => {
                setMeasurement(m);
                setPickingMeasurement(false);
                if (!customerName.trim()) setCustomerName(m.customer_name);
                if (!customerPhone.trim() && m.mobile) setCustomerPhone(m.mobile);
              }}
            />
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
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
            {/* FBR buyer fields: not in Mavin Pharmacy Offline. */}
            {!STANDALONE && <>
            <Field label="Buyer Registration Type" required={fbrEnabled}>
              <Select value={buyerRegType} onChange={(e) => setBuyerRegType(e.target.value)}>
                <option value="Unregistered">Unregistered</option>
                <option value="Registered">Registered</option>
              </Select>
            </Field>
            <div className="col-span-2 sm:col-span-1">
              <Field label="Buyer NTN / CNIC" required={buyerRegType === "Registered"}>
                <Input
                  value={buyerNtn}
                  onChange={(e) => setBuyerNtn(e.target.value)}
                  placeholder="NTN (e.g. 1234567 or A123456) or CNIC (13 digits)"
                />
              </Field>
            </div>
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
            </>}
          </div>
          </div>
        </div>

        <Field label="Barcode/Product Name">
          <ProductPicker ref={pickerRef} onSelect={(p) => void onProductSelected(p)} autoFocus />
        </Field>

        <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
          <table className="rt w-full min-w-max text-sm">
            <thead>
              <tr className="bg-neutral-900 text-left text-white">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Unit</th>
                {!isClothStore && contractorKind !== "general" && <th className="px-2 py-2">Batch</th>}
                <th className="px-2 py-2">Avail</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Bonus</th>
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
                  <td colSpan={(isClothStore || contractorKind === "general" ? 10 : 11) + (extraOn ? 1 : 0)} className="px-2 py-6 text-center text-neutral-400">
                    No content in table
                  </td>
                </tr>
              ) : (
                lines.map((l, idx) => {
                  const isSecondary = l.unit === "secondary";
                  const availInLineUnit = Math.round(fromBaseUnitQty(lineAvail(l), isSecondary, l.product.packing || 1) * 1000) / 1000;
                  const pk = l.product.packing || 1;
                  const usesBatches = batchLabel(l.batches, toBaseUnitQty(l.qty, isSecondary, pk), toBaseUnitQty(l.bonusQty, isSecondary, pk));
                  return (
                  <tr key={idx} className="border-b border-neutral-100 last:border-0">
                    <td data-label="Product" className="rt-title px-2 py-1.5">
                      {l.product.name}
                      {Boolean(l.product.is_narcotic) && (
                        <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          NARCOTIC
                        </span>
                      )}
                      {isClothStore && [l.product.attr_type, l.product.attr_color, l.product.attr_size].some(Boolean) && (
                        <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
                          {[l.product.attr_type, l.product.attr_color, l.product.attr_size].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {Boolean(l.product.track_imei) && (() => {
                        const need = toBaseUnitQty(l.qty, isSecondary, pk) + toBaseUnitQty(l.bonusQty, isSecondary, pk);
                        const have = (l.imeis ?? []).length;
                        return (
                          <button type="button" onClick={() => setImeiLine(idx)} title={(l.imeis ?? []).join(", ") || "Pick the IMEIs sold"}
                            className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${have === need ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                            IMEI {have}/{need}
                          </button>
                        );
                      })()}
                    </td>
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
                    {contractorKind === "medicine" ? (
                      <td data-label="Batch" className="px-2 py-1.5">
                        <input
                          value={l.printBatch ?? ""}
                          onChange={(e) => updateLine(idx, { printBatch: e.target.value })}
                          placeholder="Batch no"
                          aria-label={`Batch of ${l.product.name}`}
                          className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                        />
                      </td>
                    ) : !isClothStore && contractorKind !== "general" && <td data-label="Batch" className="px-2 py-1.5" title={l.batches.length > 1 ? `${l.batches.length} batches in stock` : undefined}>{usesBatches}</td>}
                    <td data-label="Avail" className="px-2 py-1.5">{availInLineUnit}</td>
                    <td data-label="Qty" className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_QTY, el)}
                        type="number"
                        min="1"
                        max={availInLineUnit - l.bonusQty}
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_QTY)}
                        onFocus={() => setRateLine(idx)}
                        onBlur={() => setRateLine((cur) => (cur === idx ? null : cur))}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td data-label="Bonus" className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_BONUS, el)}
                        type="number"
                        min="0"
                        step="any"
                        value={l.bonusQty}
                        disabled={offline}
                        title={offline ? "Bonus needs internet" : undefined}
                        onChange={(e) => updateLine(idx, { bonusQty: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_BONUS)}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td data-label="Sale Price" className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_PRICE, el)}
                        type="number"
                        min="0"
                        step="any"
                        value={l.salePrice}
                        disabled={offline}
                        title={offline ? "Offline, the price list price is used" : undefined}
                        onChange={(e) => updateLine(idx, { salePrice: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_PRICE)}
                        className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td data-label="Tax %" className="px-2 py-1.5">
                      <input
                        ref={(el) => setLineRef(idx, COL_TAX, el)}
                        type="number"
                        min="0"
                        step="any"
                        value={l.taxPct}
                        disabled={offline}
                        title={offline ? "Offline, the product's tax rate is used" : undefined}
                        onChange={(e) => updateLine(idx, { taxPct: Number(e.target.value) })}
                        onKeyDown={(e) => handleLineEnter(e, idx, COL_TAX)}
                        className="w-16 rounded border border-neutral-300 px-1.5 py-1"
                      />
                    </td>
                    <td data-label="Disc %" className="px-2 py-1.5">
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
                      <button type="button" onClick={() => removeLine(idx)} className="min-h-9 px-1 text-rose-600 hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {imeiLine != null && lines[imeiLine] && (() => {
            const l = lines[imeiLine];
            const pk = l.product.packing || 1;
            const sec = l.unit === "secondary";
            return (
              <ImeiPicker
                productId={l.product.id}
                productName={l.product.name}
                count={toBaseUnitQty(l.qty, sec, pk) + toBaseUnitQty(l.bonusQty, sec, pk)}
                current={l.imeis ?? []}
                elsewhere={lines.filter((_, i) => i !== imeiLine).flatMap((x) => x.imeis ?? [])}
                onClose={() => setImeiLine(null)}
                onDone={(imeis) => { updateLine(imeiLine, { imeis }); setImeiLine(null); }}
              />
            );
          })()}
          {showsRate && active && rateLine != null && lines[rateLine] && (() => {
            const l = lines[rateLine];
            const secondary = l.unit === "secondary";
            const rate = secondary ? l.batch.purchase_price / (l.product.packing || 1) : l.batch.purchase_price;
            return (
              <PurchaseRateBubble
                rate={rate}
                unit={unitName(secondary ? l.product.secondary_unit_id : l.product.base_unit_id)}
                onClose={() => setRateLine(null)}
              />
            );
          })()}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          <Field label="Total">
            <Input value={total.toFixed(2)} disabled />
          </Field>
          <Field label={isClothStore && measurement ? "Charges (incl. custom)" : "Charges"}>
            <Input type="number" min="0" step="any" value={charges} disabled={offline} title={offline ? "Needs internet" : undefined} onChange={(e) => setCharges(e.target.value)} />
          </Field>
          <Field label="Discount Rs (F12)">
            <Input type="number" min="0" step="any" value={discountRs} disabled={offline} title={offline ? "Needs internet" : undefined} onChange={(e) => setDiscountRs(e.target.value)} />
          </Field>
          <Field label="Tax">
            <Input value={taxTotal.toFixed(2)} disabled />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
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

        <div className="sticky -bottom-3 z-10 -mx-3 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 bg-white px-3 py-2.5 shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.15)] sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:shadow-none">
          <span className="flex w-full items-baseline justify-between text-sm font-semibold tabular-nums text-neutral-900 sm:hidden">
            <span className="text-neutral-500">Payable</span>
            <span className="text-base">Rs {payable.toFixed(2)}</span>
          </span>
          <Button type="button" onClick={onClose} className="max-sm:px-3">
            Reset
          </Button>
          {!isEdit && (
            <Button
              type="button"
              onClick={() => void handleDraft()}
              disabled={saving || lines.length === 0}
              title="Ctrl+D"
              className="max-sm:px-3"
            >
              Draft
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={saving || lines.length === 0} title={offline ? "Save on this computer (Ctrl+S); sent when the internet returns" : "Ctrl+S"} className="max-sm:flex-1">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Save"}
          </Button>
        </div>
      </form>
      )}

      {quickAddCustomer && (
        <QuickCustomerDialog
          onClose={() => setQuickAddCustomer(false)}
          onCreated={(created) => {
            setCustomers((prev) => [...prev, created]);
            setCustomerId(created.id);
            setCustomerName(created.name);
            setCustomerPhone(created.phone ?? "");
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

