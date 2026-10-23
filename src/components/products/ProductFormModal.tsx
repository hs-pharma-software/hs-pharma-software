"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DescriptionCombobox } from "@/components/ui/DescriptionCombobox";
import { addGenericName, findExact, listGenericNames, normalizeGenericName } from "@/lib/repo/genericNames";
import { suggestFbrDetails, type CatalogProduct, type FbrFields, type FbrSuggestion } from "@/lib/fbrAutofill";
import { Button } from "@/components/ui/Button";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { UnitToggle } from "@/components/ui/UnitToggle";
import { ProductFbrFields } from "@/components/products/ProductFbrFields";
import { detectNarcotic } from "@/lib/narcotics";
import { categoriesRepo, subCategoriesRepo, listCategoriesWithShared, listSubCategoriesWithShared } from "@/lib/repo/categories";
import { uomsRepo, listUomsWithShared } from "@/lib/repo/uoms";
import { productsRepo, productBatchesRepo, priceListRepo, getCurrentRates, createSharedProduct, searchSharedCatalog } from "@/lib/repo/products";
import { isPharmacyFamilyType } from "@/lib/catalogAccess";
import { useAuthStore } from "@/store/authStore";
import { hasSecondaryUnit, convertQtyOnUnitToggle, convertPriceOnUnitToggle, toBaseUnitQty } from "@/lib/uom";
import type { Category, SubCategory, Uom, Product } from "@/lib/types";

type QuickAddTarget = "category" | "subCategory" | "baseUnit" | "secondaryUnit" | null;

export function ProductFormModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(product);
  const { currentTenant } = useAuthStore.getState();
  const isPharmacyTenant = isPharmacyFamilyType(currentTenant?.businessType);
  const isGeneralStoreTenant = currentTenant?.businessType === "general_store";

  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [quickAdd, setQuickAdd] = useState<QuickAddTarget>(null);
  const [saving, setSaving] = useState(false);

  // Product classification (pharmacy tenants only): 'pharma' | 'general_store'
  // Pre-populate from existing product or derive from tenant type.
  const [productClassification, setProductClassification] = useState<"pharma" | "general_store">(
    (product?.product_classification as "pharma" | "general_store") ??
      (isGeneralStoreTenant ? "general_store" : "pharma")
  );
  const [catalogDuplicateSearch, setCatalogDuplicateSearch] = useState("");
  const [catalogDuplicates, setCatalogDuplicates] = useState<Product[]>([]);

  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [companyName, setCompanyName] = useState(product?.company_name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [subCategoryId, setSubCategoryId] = useState(product?.sub_category_id ?? "");
  const [baseUnitId, setBaseUnitId] = useState(product?.base_unit_id ?? "");
  const [secondaryUnitId, setSecondaryUnitId] = useState(product?.secondary_unit_id ?? "");
  const [packing, setPacking] = useState(String(product?.packing ?? 1));
  const [gstRate, setGstRate] = useState(String(product?.gst_rate_pct ?? 0));
  const [maxStockQty, setMaxStockQty] = useState(String(product?.max_stock_qty ?? ""));
  const [expiryLimitDays, setExpiryLimitDays] = useState(String(product?.stock_expiry_limit_days ?? ""));
  const [location, setLocation] = useState(product?.location ?? "");

  // FBR fields
  const [hsCode, setHsCode] = useState(product?.hs_code ?? "");
  const [fbrSaleType, setFbrSaleType] = useState(product?.fbr_sale_type ?? "");
  const [fbrSaleRate, setFbrSaleRate] = useState(String(product?.fbr_sale_rate ?? 0));
  const [fbrUom, setFbrUom] = useState(product?.fbr_uom ?? "");
  const [sroNo, setSroNo] = useState(product?.sro_no ?? "");
  const [sroItemSerialNo, setSroItemSerialNo] = useState(product?.sro_item_serial_no ?? "");
  const [fbrQtyFactor, setFbrQtyFactor] = useState(String(product?.fbr_qty_factor || 1));

  const [isNarcotic, setIsNarcotic] = useState(Boolean(product?.is_narcotic));
  const [narcoticTouched, setNarcoticTouched] = useState(isEdit);
  const narcoticMatch = detectNarcotic(name, description);

  useEffect(() => {
    if (!narcoticTouched) setIsNarcotic(Boolean(narcoticMatch));
  }, [narcoticMatch, narcoticTouched]);

  // Description list + FBR auto-fill from description.
  const [genericNames, setGenericNames] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [autofill, setAutofill] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; suggestion: FbrSuggestion; previous: FbrFields }
  >({ status: "idle" });
  // Opening an existing product must not re-classify it; only a changed
  // description (or the Auto-fill button) triggers a fill.
  const lastAutofilled = useRef(normalizeGenericName(product?.description ?? "").toUpperCase());

  useEffect(() => {
    void Promise.all([listGenericNames(), productsRepo.list()]).then(([names, products]) => {
      setGenericNames(names);
      setCatalog(products);
    });
  }, []);

  function currentFbr(): FbrFields {
    return { hsCode, saleType: fbrSaleType, saleRate: fbrSaleRate, uom: fbrUom, sroNo, sroItem: sroItemSerialNo };
  }

  function applyFbr(f: FbrFields) {
    setHsCode(f.hsCode);
    setFbrSaleType(f.saleType);
    setFbrSaleRate(f.saleRate);
    setFbrUom(f.uom);
    setSroNo(f.sroNo);
    setSroItemSerialNo(f.sroItem);
  }

  async function runAutofill(desc: string, opts: { force?: boolean; forceAi?: boolean } = {}) {
    const key = normalizeGenericName(desc).toUpperCase();
    if (!key || (!opts.force && !opts.forceAi && key === lastAutofilled.current)) return;
    lastAutofilled.current = key;
    const previous = currentFbr();
    setAutofill({ status: "running" });
    const suggestion = await suggestFbrDetails(name, desc, catalog, { excludeId: product?.id, forceAi: opts.forceAi });
    applyFbr(suggestion);
    setAutofill({ status: "done", suggestion, previous });
  }

  async function addDescription(value: string) {
    const stored = await addGenericName(value, genericNames);
    setGenericNames((prev) =>
      findExact(prev, stored) ? prev : [...prev, stored].sort((a, b) => a.localeCompare(b))
    );
    setDescription(stored);
    void runAutofill(stored);
  }

  // Opening stock (create only)
  const [batchNo, setBatchNo] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [purchasePrice, setPurchasePrice] = useState("0");
  const [salePrice, setSalePrice] = useState("0");
  const [wholesalePrice, setWholesalePrice] = useState("0");
  const [mrp, setMrp] = useState("0");
  const [expiryDate, setExpiryDate] = useState("");
  /** Which unit Quantity/prices above are currently expressed in \u2014 e.g. for
   * a Pack of 10 Tab, entering "1" Pack here at Rs.100 is the same physical
   * stock as "10" Tab at Rs.10 each; toggling converts qty and price so the
   * total value stays put, and everything is normalized back to base units
   * (packs) on save since that's what product_batches always tracks in. */
  const [openingStockUnit, setOpeningStockUnit] = useState<"base" | "secondary">("base");

  // Current rates (edit only) \u2014 the product's most recent batch cost and
  // retail price, shown so they can actually be changed after creation
  // instead of only ever being set once at Add time.
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [currentBatchNo, setCurrentBatchNo] = useState<string | null>(null);
  const [currentWholesale, setCurrentWholesale] = useState(0);
  const [currentMrp, setCurrentMrp] = useState(0);
  const [purchaseRate, setPurchaseRate] = useState("0");
  const [initialPurchaseRate, setInitialPurchaseRate] = useState("0");
  const [retailRate, setRetailRate] = useState("0");
  const [initialRetailRate, setInitialRetailRate] = useState("0");
  const [ratesLoaded, setRatesLoaded] = useState(!isEdit);
  const [currentRatesUnit, setCurrentRatesUnit] = useState<"base" | "secondary">("base");

  async function reloadLookups() {
    const [cats, uomList] = await Promise.all([listCategoriesWithShared(), listUomsWithShared()]);
    setCategories(cats);
    setUoms(uomList);
  }

  useEffect(() => {
    void reloadLookups();
  }, []);

  useEffect(() => {
    if (!isEdit || !product) return;
    void getCurrentRates(product.id).then((rates) => {
      setCurrentBatchId(rates.batchId);
      setCurrentBatchNo(rates.batchNo);
      setCurrentWholesale(rates.wholesalePrice);
      setCurrentMrp(rates.mrp);
      setPurchaseRate(String(rates.purchasePrice));
      setInitialPurchaseRate(String(rates.purchasePrice));
      setRetailRate(String(rates.salePrice));
      setInitialRetailRate(String(rates.salePrice));
      setRatesLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!categoryId) {
      setSubCategories([]);
      return;
    }
    void listSubCategoriesWithShared(categoryId).then(setSubCategories);
  }, [categoryId]);

  // Auto-fill Secondary Unit from the chosen sub category's default (e.g.
  // "Tablets" -> Tab) \u2014 only when nothing's picked yet, so it never
  // clobbers a deliberate choice.
  useEffect(() => {
    if (!subCategoryId || secondaryUnitId) return;
    const sc = subCategories.find((s) => s.id === subCategoryId);
    if (sc?.default_secondary_unit_id) setSecondaryUnitId(sc.default_secondary_unit_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subCategoryId, subCategories]);

  const packingNum = Number(packing) || 1;
  const productHasSecondaryUnit = hasSecondaryUnit({ base_unit_id: baseUnitId || null, secondary_unit_id: secondaryUnitId || null });
  const baseUnitName = uoms.find((u) => u.id === baseUnitId)?.name ?? "Base";
  const secondaryUnitName = uoms.find((u) => u.id === secondaryUnitId)?.name ?? "Secondary";

  function toggleOpeningStockUnit(toSecondary: boolean) {
    setQuantity((v) => String(convertQtyOnUnitToggle(Number(v) || 0, toSecondary, packingNum)));
    setPurchasePrice((v) => String(convertPriceOnUnitToggle(Number(v) || 0, toSecondary, packingNum)));
    setSalePrice((v) => String(convertPriceOnUnitToggle(Number(v) || 0, toSecondary, packingNum)));
    setWholesalePrice((v) => String(convertPriceOnUnitToggle(Number(v) || 0, toSecondary, packingNum)));
    setMrp((v) => String(convertPriceOnUnitToggle(Number(v) || 0, toSecondary, packingNum)));
    setOpeningStockUnit(toSecondary ? "secondary" : "base");
  }

  function toggleCurrentRatesUnit(toSecondary: boolean) {
    setPurchaseRate((v) => String(convertPriceOnUnitToggle(Number(v) || 0, toSecondary, packingNum)));
    setRetailRate((v) => String(convertPriceOnUnitToggle(Number(v) || 0, toSecondary, packingNum)));
    setCurrentRatesUnit(toSecondary ? "secondary" : "base");
  }

  // Current Rates are always loaded/compared in base-unit terms regardless
  // of which unit is currently displayed, so the "changed" highlight and
  // the save logic stay correct across a unit toggle.
  const finalPurchaseRate =
    currentRatesUnit === "secondary" ? (Number(purchaseRate) || 0) * packingNum : Number(purchaseRate) || 0;
  const finalRetailRate =
    currentRatesUnit === "secondary" ? (Number(retailRate) || 0) * packingNum : Number(retailRate) || 0;
  const purchaseRateChanged = Math.abs(finalPurchaseRate - (Number(initialPurchaseRate) || 0)) > 0.0001;
  const retailRateChanged = Math.abs(finalRetailRate - (Number(initialRetailRate) || 0)) > 0.0001;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !baseUnitId) return;
    setSaving(true);
    try {
      // Determine if this product should go into the shared catalog.
      // Pharmacy-family and general-store tenants use the shared catalog;
      // all others create tenant-private products.
      const catalogGroup =
        isPharmacyTenant ? productClassification :
        isGeneralStoreTenant ? "general_store" :
        null;

      const payload = {
        barcode: barcode || null,
        name: name.trim(),
        company_name: companyName || null,
        description: description || null,
        category_id: categoryId || null,
        sub_category_id: subCategoryId || null,
        base_unit_id: baseUnitId || null,
        secondary_unit_id: secondaryUnitId || null,
        packing: Number(packing) || 1,
        gst_rate_pct: Number(gstRate) || 0,
        max_stock_qty: maxStockQty ? Number(maxStockQty) : null,
        stock_expiry_limit_days: expiryLimitDays ? Number(expiryLimitDays) : null,
        location: location || null,
        hs_code: hsCode || null,
        fbr_sale_type: fbrSaleType || null,
        fbr_sale_rate: Number(fbrSaleRate) || 0,
        fbr_uom: fbrUom || null,
        sro_no: sroNo || null,
        sro_item_serial_no: sroItemSerialNo || null,
        fbr_qty_factor: Number(fbrQtyFactor) > 0 ? Number(fbrQtyFactor) : 1,
        is_narcotic: isNarcotic ? 1 : 0,
        catalog_group: catalogGroup,
        product_classification: catalogGroup,
      };

      if (isEdit && product) {
        await productsRepo.update(product.id, payload);
        if (currentBatchId && purchaseRateChanged) {
          await productBatchesRepo.update(currentBatchId, { purchase_price: finalPurchaseRate });
        }
        if (retailRateChanged) {
          await priceListRepo.create({
            product_id: product.id,
            batch_no: currentBatchNo,
            sale_price: finalRetailRate,
            wholesale_price: currentWholesale,
            mrp: currentMrp,
            comment: "Updated via Product Detail",
          });
        }
      } else {
        const isSecondary = openingStockUnit === "secondary";
        const finalQty = toBaseUnitQty(Number(quantity) || 0, isSecondary, packingNum);
        const finalPurchasePrice = isSecondary ? (Number(purchasePrice) || 0) * packingNum : Number(purchasePrice) || 0;
        const finalSalePrice = isSecondary ? (Number(salePrice) || 0) * packingNum : Number(salePrice) || 0;
        const finalWholesalePrice = isSecondary ? (Number(wholesalePrice) || 0) * packingNum : Number(wholesalePrice) || 0;
        const finalMrp = isSecondary ? (Number(mrp) || 0) * packingNum : Number(mrp) || 0;

        // Shared catalog products (pharmacy/general-store) use createSharedProduct
        // to bypass tenant_id stamping; all others use the normal repo.
        const created = catalogGroup
          ? await createSharedProduct(payload)
          : await productsRepo.create(payload);

        if (finalQty > 0) {
          await productBatchesRepo.create({
            product_id: created.id,
            batch_no: batchNo || null,
            expiry_date: expiryDate || null,
            qty: finalQty,
            location: location || null,
            purchase_price: finalPurchasePrice,
          });
        }
        if (finalSalePrice > 0 || finalMrp > 0) {
          await priceListRepo.create({
            product_id: created.id,
            batch_no: batchNo || null,
            sale_price: finalSalePrice,
            wholesale_price: finalWholesalePrice,
            mrp: finalMrp,
            comment: null,
          });
        }
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Product" : "Add Product"} onClose={onClose} width="max-w-4xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* Product classification — shown only for pharmacy tenants (create mode).
            General-store tenants are auto-classified; other tenants create
            tenant-private products with no catalog_group. */}
        {(isPharmacyTenant || isGeneralStoreTenant) && !isEdit && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-800">Product Classification</span>
              {(isPharmacyTenant || isGeneralStoreTenant) && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                  Added to shared catalog
                </span>
              )}
            </div>
            {isPharmacyTenant ? (
              <div className="flex gap-2">
                {(["pharma", "general_store"] as const).map((cls) => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => {
                      setProductClassification(cls);
                      // Reset duplicate search on classification change
                      setCatalogDuplicateSearch("");
                      setCatalogDuplicates([]);
                    }}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      productClassification === cls
                        ? "border-sky-500 bg-sky-50 text-sky-700"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                    }`}
                  >
                    {cls === "pharma" ? "Pharma" : "General Store"}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-600">
                General Store — auto-applied for all products in this business.
              </p>
            )}
            {/* Duplicate check search for shared catalog products */}
            {isPharmacyTenant && (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  Check for existing {productClassification === "pharma" ? "pharma" : "general store"} master product
                </label>
                <input
                  type="text"
                  placeholder="Search shared catalog before adding a new one..."
                  value={catalogDuplicateSearch}
                  onChange={async (e) => {
                    setCatalogDuplicateSearch(e.target.value);
                    if (e.target.value.trim().length >= 2) {
                      const results = await searchSharedCatalog(e.target.value, productClassification);
                      setCatalogDuplicates(results);
                    } else {
                      setCatalogDuplicates([]);
                    }
                  }}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200"
                />
                {catalogDuplicates.length > 0 && (
                  <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-2">
                    <p className="mb-1 text-xs font-medium text-amber-700">
                      {catalogDuplicates.length} similar product{catalogDuplicates.length > 1 ? "s" : ""} already in shared catalog:
                    </p>
                    {catalogDuplicates.map((p) => (
                      <div key={p.id} className="text-xs text-amber-800">
                        • {p.name}{p.company_name ? ` (${p.company_name})` : ""}
                      </div>
                    ))}
                    <p className="mt-1 text-xs text-amber-600">Review before creating a duplicate.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Barcode">
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </Field>
          <Field label="Product Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Company Name">
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </Field>
        </div>

        <Field label="Description (Generic Name)">
          <DescriptionCombobox
            value={description}
            onChange={setDescription}
            onCommit={(v) => void runAutofill(v)}
            options={genericNames}
            onAdd={addDescription}
          />
        </Field>

        <label
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ring-1 ${
            isNarcotic ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-neutral-50 text-neutral-600 ring-black/[0.04]"
          }`}
        >
          <input
            type="checkbox"
            checked={isNarcotic}
            onChange={(e) => {
              setIsNarcotic(e.target.checked);
              setNarcoticTouched(true);
            }}
            className="h-4 w-4 accent-rose-600"
          />
          <span className="font-medium">Narcotic / Controlled drug</span>
          <span className="text-xs opacity-75">
            {narcoticMatch
              ? `Detected: ${narcoticMatch}. Invoices need customer name and mobile.`
              : "Invoices with this product will need customer name and mobile."}
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <Field label="Base Unit" required>
                <Select value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} required>
                  <option value="">Select...</option>
                  {uoms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAdd("baseUnit")}>
              +
            </Button>
          </div>

          <Field label="Packing" required>
            <Input type="number" min="0" step="any" value={packing} onChange={(e) => setPacking(e.target.value)} required />
          </Field>

          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <Field label="Secondary Unit">
                <Select value={secondaryUnitId} onChange={(e) => setSecondaryUnitId(e.target.value)}>
                  <option value="">Select...</option>
                  {uoms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAdd("secondaryUnit")}>
              +
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <Field label="Category">
                <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubCategoryId(""); }}>
                  <option value="">Select...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAdd("category")}>
              +
            </Button>
          </div>

          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <Field label="Sub Category">
                <Select value={subCategoryId} onChange={(e) => setSubCategoryId(e.target.value)} disabled={!categoryId}>
                  <option value="">Select...</option>
                  {subCategories.map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      {sc.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="button" onClick={() => setQuickAdd("subCategory")} disabled={!categoryId}>
              +
            </Button>
          </div>

          <Field label="GST Rate %">
            <Input type="number" min="0" step="any" value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Max Stock Quantity (Base Unit)">
            <Input type="number" min="0" step="any" value={maxStockQty} onChange={(e) => setMaxStockQty(e.target.value)} />
          </Field>
          <Field label="Stock Expiry Limit (No. Of Days)">
            <Input type="number" min="0" step="1" value={expiryLimitDays} onChange={(e) => setExpiryLimitDays(e.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>

        {/* FBR / Tax Details */}
        <div className="flex items-center rounded-md bg-[#006633]/[0.06] px-3 py-1.5">
          <div className="mr-2 flex h-5 w-5 items-center justify-center rounded bg-[#006633] text-[9px] font-bold text-white">FBR</div>
          <span className="text-sm font-medium text-neutral-700">FBR / Tax Details</span>
          <button
            type="button"
            disabled={!description.trim() || autofill.status === "running"}
            onClick={() => void runAutofill(description, { force: true })}
            className="ml-auto rounded-full bg-white px-3 py-1 text-xs font-medium text-[#006633] ring-1 ring-[#006633]/20 hover:bg-[#006633]/[0.06] disabled:opacity-40"
            title="Fill the FBR fields from the description"
          >
            Auto-fill from description
          </button>
        </div>
        {autofill.status === "running" && (
          <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">Filling FBR details from the description...</p>
        )}
        {autofill.status === "done" && (
          <div className="flex flex-wrap items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-sky-100">
            <span className="flex-1 whitespace-normal break-words">
              <span className="font-semibold">
                {autofill.suggestion.source === "catalog"
                  ? "Filled from your catalog"
                  : autofill.suggestion.source === "ai"
                    ? "Filled by AI (Gemini)"
                    : "Filled by built-in rules"}
                :
              </span>{" "}
              {autofill.suggestion.note}. Please review - every field below can be changed.
            </span>
            {autofill.suggestion.source !== "ai" && (
              <button type="button" className="font-medium underline" onClick={() => void runAutofill(description, { forceAi: true })}>
                Ask AI
              </button>
            )}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                applyFbr(autofill.previous);
                setAutofill({ status: "idle" });
              }}
            >
              Undo
            </button>
          </div>
        )}
        <ProductFbrFields
          hsCode={hsCode}
          setHsCode={setHsCode}
          saleType={fbrSaleType}
          setSaleType={setFbrSaleType}
          saleRate={fbrSaleRate}
          setSaleRate={setFbrSaleRate}
          uom={fbrUom}
          setUom={setFbrUom}
          sroNo={sroNo}
          setSroNo={setSroNo}
          sroItem={sroItemSerialNo}
          setSroItem={setSroItemSerialNo}
          qtyFactor={fbrQtyFactor}
          setQtyFactor={setFbrQtyFactor}
          baseUnitName={baseUnitName}
        />

        {isEdit && (
          <>
            <div className="flex items-center justify-between rounded-md bg-neutral-100 px-3 py-1.5">
              <span className="text-sm font-medium text-neutral-700">Current Rates</span>
              {productHasSecondaryUnit && (
                <UnitToggle
                  baseLabel={baseUnitName}
                  secondaryLabel={secondaryUnitName}
                  value={currentRatesUnit}
                  onChange={(u) => toggleCurrentRatesUnit(u === "secondary")}
                />
              )}
            </div>
            {!ratesLoaded ? (
              <p className="text-sm text-neutral-400">Loading current rates...</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label={`Purchase Rate / ${currentRatesUnit === "secondary" ? secondaryUnitName : baseUnitName}${currentBatchNo ? ` (batch ${currentBatchNo})` : ""}`}
                >
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={purchaseRate}
                    readOnly
                    disabled
                    title="Purchase rate cannot be changed here \u2014 update via Purchase entry"
                    className="cursor-not-allowed opacity-60"
                  />
                </Field>
                <Field label={`Retail Rate / ${currentRatesUnit === "secondary" ? secondaryUnitName : baseUnitName}`}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={retailRate}
                    onChange={(e) => setRetailRate(e.target.value)}
                    className={retailRateChanged ? "!border-amber-400 !bg-amber-50" : ""}
                  />
                </Field>
              </div>
            )}
          </>
        )}

        {!isEdit && (
          <>
            <div className="flex items-center justify-between rounded-md bg-neutral-100 px-3 py-1.5">
              <span className="text-sm font-medium text-neutral-700">Opening Stock &amp; Pricing Detail</span>
              {productHasSecondaryUnit && (
                <UnitToggle
                  baseLabel={baseUnitName}
                  secondaryLabel={secondaryUnitName}
                  value={openingStockUnit}
                  onChange={(u) => toggleOpeningStockUnit(u === "secondary")}
                />
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Batch No">
                <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
              </Field>
              <Field label={`Quantity (${openingStockUnit === "secondary" ? secondaryUnitName : baseUnitName})`}>
                <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field label="Expiry Date">
                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </Field>
              <Field label={`Pur Price / ${openingStockUnit === "secondary" ? secondaryUnitName : baseUnitName}`}>
                <Input type="number" min="0" step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
              </Field>
              <Field label={`Sale Price / ${openingStockUnit === "secondary" ? secondaryUnitName : baseUnitName}`}>
                <Input type="number" min="0" step="any" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
              </Field>
              <Field label={`Wholesale / ${openingStockUnit === "secondary" ? secondaryUnitName : baseUnitName}`}>
                <Input type="number" min="0" step="any" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} />
              </Field>
              <Field label="MRP">
                <Input type="number" min="0" step="any" value={mrp} onChange={(e) => setMrp(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>

      {quickAdd && (
        <QuickAddDialog
          title={
            quickAdd === "category"
              ? "Add Categories"
              : quickAdd === "subCategory"
                ? "Add SubCategories"
                : "Add Unit"
          }
          onClose={() => setQuickAdd(null)}
          onSubmit={async ({ name: n, description: d }) => {
            if (quickAdd === "category") {
              const created = await categoriesRepo.create({ name: n, description: d || null, flat_discount_pct: 0, image_url: null });
              await reloadLookups();
              setCategoryId(created.id);
            } else if (quickAdd === "subCategory") {
              const created = await subCategoriesRepo.create({
                category_id: categoryId,
                name: n,
                description: d || null,
                image_url: null,
              });
              setSubCategories((prev) => [...prev, created]);
              setSubCategoryId(created.id);
            } else {
              const created = await uomsRepo.create({ name: n, description: d || null });
              await reloadLookups();
              if (quickAdd === "baseUnit") setBaseUnitId(created.id);
              if (quickAdd === "secondaryUnit") setSecondaryUnitId(created.id);
            }
            setQuickAdd(null);
          }}
        />
      )}
    </Modal>
  );
}
