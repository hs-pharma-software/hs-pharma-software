"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { dbSelect } from "@/lib/db";
import { searchProductsByNameOrBarcode } from "@/lib/repo/products";
import { addStockToBatch, receiveStock } from "@/lib/repo/stock";
import { businessType } from "@/config/businessTypes";
import { exportCsv, downloadCsv, buildCsv } from "@/lib/csv";
import { PackagePlus } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import type { Product } from "@/lib/types";

interface StockRow {
  id: string;
  barcode: string | null;
  product_name: string;
  company_name: string | null;
  location: string | null;
  category_name: string | null;
  uom_name: string | null;
  secondary_unit_id: string | null;
  secondary_unit_name: string | null;
  packing: number;
  avail_qty: number;
  batch_no: string | null;
  expiry_date: string | null;
  mrp: number;
  sale_price: number;
  purchase_price: number;
}

export default function StockPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [batchNo, setBatchNo] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [purchasePrice, setPurchasePrice] = useState("0");
  const [expiryDate, setExpiryDate] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  const sessionTenant = useAuthStore((s) => s.currentTenant);
  const tenantId = sessionTenant?.sourceTenantId ?? sessionTenant?.id ?? null;
  const mrpDiscountPct = sessionTenant?.mrpDiscountPct ?? 0;
  // Contractors top up stock by hand per item; not for stock viewed from
  // another account (dealer portal).
  const canTopUp =
    businessType(sessionTenant?.businessType).id === "contractor" && !sessionTenant?.sourceTenantId;
  const [topUp, setTopUp] = useState<StockRow | null>(null);
  const [topUpQty, setTopUpQty] = useState("");
  const [topUpPrice, setTopUpPrice] = useState("");
  const [topUpError, setTopUpError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(
      await dbSelect<StockRow>(
        `
        SELECT pb.id, p.barcode, p.name AS product_name, p.company_name, pb.location,
               c.name AS category_name, u.name AS uom_name,
               p.secondary_unit_id, su.name AS secondary_unit_name,
               COALESCE(p.packing, 1) AS packing,
               pb.qty AS avail_qty,
               pb.batch_no, pb.expiry_date, COALESCE(pb.purchase_price, 0) AS purchase_price,
               COALESCE(pl.mrp, 0) AS mrp,
               COALESCE(pl.sale_price, 0) AS sale_price
        FROM product_batches pb
        JOIN products p ON p.id = pb.product_id AND (p.tenant_id = pb.tenant_id OR p.tenant_id IS NULL)
        LEFT JOIN categories c ON c.id = p.category_id AND (c.tenant_id = pb.tenant_id OR c.tenant_id IS NULL)
        LEFT JOIN uoms u ON u.id = p.base_unit_id
        LEFT JOIN uoms su ON su.id = p.secondary_unit_id
        LEFT JOIN (
          SELECT product_id, sale_price, mrp
          FROM price_list
          WHERE deleted_at IS NULL AND tenant_id = ?
          GROUP BY product_id
          HAVING MAX(created_at)
        ) pl ON pl.product_id = p.id
        WHERE pb.deleted_at IS NULL AND pb.tenant_id = ? AND pb.qty > 0
        ORDER BY p.name ASC
      `,
        [tenantId, tenantId]
      )
    );
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!productQuery.trim()) {
      setProductResults([]);
      return;
    }
    const t = setTimeout(() => {
      void searchProductsByNameOrBarcode(productQuery).then(setProductResults);
    }, 200);
    return () => clearTimeout(t);
  }, [productQuery]);

  const filtered = rows.filter((r) => {
    const term = search.toLowerCase();
    return !term || r.product_name.toLowerCase().includes(term) || (r.barcode ?? "").toLowerCase().includes(term);
  });

  const discountFactor = mrpDiscountPct > 0 ? 1 - mrpDiscountPct / 100 : 0;

  const totalStockValue = filtered.reduce((sum, r) => sum + r.avail_qty * r.sale_price, 0);

  const columns: Column<StockRow>[] = [
    { header: "Barcode", render: (r) => r.barcode ?? "\u2014" },
    { header: "Product Name", render: (r) => <span className="font-medium">{r.product_name}</span> },
    { header: "Company", render: (r) => r.company_name ?? "\u2014" },
    { header: "Batch", render: (r) => r.batch_no ?? "\u2014" },
    { header: "Expiry", render: (r) => r.expiry_date ?? "\u2014" },
    { header: "Location", render: (r) => r.location ?? "\u2014" },
    { header: "UOM", render: (r) => r.uom_name ?? "\u2014" },
    {
      header: "Avail Qty",
      render: (r) => {
        const packing = r.packing || 1;
        const isFractional = !!r.secondary_unit_id && packing > 1 && Math.abs(r.avail_qty - Math.round(r.avail_qty)) > 0.001;
        if (isFractional) {
          return <span className="font-semibold">{Math.round(r.avail_qty * packing)} <span className="font-normal text-neutral-500">{r.secondary_unit_name ?? ""}</span></span>;
        }
        return <span className="font-semibold">{r.avail_qty} <span className="font-normal text-neutral-500">{r.uom_name ?? ""}</span></span>;
      },
    },
    { header: "Sale Price", render: (r) => r.sale_price > 0 ? r.sale_price.toFixed(2) : "\u2014" },
    { header: "MRP", render: (r) => r.mrp > 0 ? r.mrp.toFixed(2) : "\u2014" },
    ...(mrpDiscountPct > 0 ? [{
      header: "Your Price",
      render: (r: StockRow) => r.mrp > 0
        ? <span className="font-bold text-emerald-700">{(r.mrp * discountFactor).toFixed(2)}</span>
        : "\u2014",
    }] : []),
    ...(canTopUp ? [{
      header: "Actions",
      render: (r: StockRow) => (
        <button
          type="button"
          title="Add stock to this item"
          onClick={(e) => {
            e.stopPropagation();
            setTopUp(r);
            setTopUpQty("");
            setTopUpPrice(r.purchase_price > 0 ? String(r.purchase_price) : "");
            setTopUpError(null);
          }}
          className="rounded-full p-1.5 text-neutral-500 hover:bg-emerald-50 hover:text-emerald-700"
        >
          <PackagePlus size={16} />
        </button>
      ),
    }] : []),
  ];

  // Stock top-up adds new batches (like a purchase) — always enter in base units (packs).
  const topUpPacking = 1;
  const topUpUnit = topUp?.uom_name ?? "";

  async function saveTopUp() {
    if (!topUp) return;
    const qty = Number(topUpQty);
    if (!(qty > 0)) return setTopUpError("Enter a quantity greater than 0.");
    setSaving(true);
    setTopUpError(null);
    try {
      await addStockToBatch(topUp.id, qty / topUpPacking, Number(topUpPrice) || undefined);
      setTopUp(null);
      void reload();
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setProductQuery("");
    setProductResults([]);
    setSelectedProduct(null);
    setBatchNo("");
    setQuantity("0");
    setPurchasePrice("0");
    setExpiryDate("");
    setLocation("");
  }

  const tauriReady = useIsTauri();
  const printDate = new Date().toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div>
      <PageHeader
        title="Stock Details"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                resetForm();
                setModalOpen(true);
              }}
            >
              Add
            </Button>
            <Button
              onClick={() => {
                const STOCK_CSV_HEADERS = ["Barcode","Product Name","Company","Batch No","Expiry Date","Location","UOM","Avail Qty","Sale Price","Purchase Price"];
                exportCsv(
                  `stock-${new Date().toISOString().slice(0,10)}.csv`,
                  STOCK_CSV_HEADERS,
                  filtered.map((r) => [r.barcode, r.product_name, r.company_name, r.batch_no, r.expiry_date, r.location, r.uom_name, r.avail_qty, r.sale_price, r.purchase_price])
                );
              }}
            >
              Export CSV
            </Button>
            <Button
              onClick={() => {
                const headers = ["Barcode","Product Name","Company","Batch No","Expiry Date (YYYY-MM-DD)","Location","UOM","Quantity","Purchase Price Per Unit"];
                const sample = [
                  ["5000168002658","PARACETAMOL 500MG TAB","GSK","B-001","2026-12-31","Shelf A","Tablet","100","45.00"],
                  ["5000168007553","AMOXICILLIN 250MG CAP","Pharmatec","B-002","2027-06-30","Shelf B","Capsule","50","120.00"],
                  ["","(leave blank if no barcode)","","(optional)","(optional)","(optional)","","",""],
                ];
                downloadCsv("stock-import-sample.csv", buildCsv(headers, sample));
              }}
            >
              Sample File
            </Button>
            <Button onClick={() => window.print()}>Print Report</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-4 py-2.5">
        <div className="flex shrink-0 flex-col leading-tight">
          <span className="text-xs text-neutral-400">Total Stock Value</span>
          <span className="text-sm font-semibold text-neutral-800">
            Rs {totalStockValue.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="mx-2 h-8 w-px bg-neutral-200" />
        <Input
          placeholder="Search by product or barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage stock.
        </p>
      ) : (
        <DataTable columns={columns} rows={filtered} />
      )}

      {/* -- Print-only stock report -- .print-only hides on screen; @media print shows + repositions it */}
      <div className="print-area print-only">
        <div style={{ padding: "24px", fontFamily: "sans-serif", fontSize: "12px", color: "#111" }}>
          <h1 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "2px" }}>
            {sessionTenant?.name ?? "Pharmacy"}
          </h1>
          <h2 style={{ fontSize: "14px", fontWeight: "normal", color: "#555", marginBottom: "4px" }}>
            Stock Details Report
          </h2>
          <p style={{ fontSize: "11px", color: "#777", marginBottom: "16px" }}>Printed: {printDate}</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #222", background: "#f5f5f5" }}>
                {["Barcode","Product","Company","Batch","Expiry","Location","UOM","Qty","Sale Price","Stock Value"].map((h) => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: h === "Qty" || h === "Sale Price" || h === "Stock Value" ? "right" : "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #e5e5e5" }}>
                  <td style={{ padding: "4px 8px" }}>{r.barcode ?? "\u2014"}</td>
                  <td style={{ padding: "4px 8px", fontWeight: "600" }}>{r.product_name}</td>
                  <td style={{ padding: "4px 8px" }}>{r.company_name ?? "\u2014"}</td>
                  <td style={{ padding: "4px 8px" }}>{r.batch_no ?? "\u2014"}</td>
                  <td style={{ padding: "4px 8px" }}>{r.expiry_date ?? "\u2014"}</td>
                  <td style={{ padding: "4px 8px" }}>{r.location ?? "\u2014"}</td>
                  <td style={{ padding: "4px 8px" }}>{r.uom_name ?? "\u2014"}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {r.secondary_unit_id && (r.packing || 1) > 1 && Math.abs(r.avail_qty - Math.round(r.avail_qty)) > 0.001
                      ? `${Math.round(r.avail_qty * (r.packing || 1))} ${r.secondary_unit_name ?? ""}`
                      : `${r.avail_qty} ${r.uom_name ?? ""}`}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{r.sale_price > 0 ? r.sale_price.toFixed(2) : "\u2014"}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {r.sale_price > 0 ? (r.avail_qty * r.sale_price).toFixed(2) : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #222", fontWeight: "bold", background: "#f5f5f5" }}>
                <td colSpan={7} style={{ padding: "6px 8px" }}>
                  Total - {filtered.length} item{filtered.length !== 1 ? "s" : ""}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  {filtered.reduce((s, r) => s + r.avail_qty, 0)}
                </td>
                <td />
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  Rs {totalStockValue.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {topUp && (
        <Modal title="Add Stock" onClose={() => setTopUp(null)} width="max-w-sm">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveTopUp();
            }}
          >
            <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
              <p className="font-medium text-neutral-800">{topUp.product_name}</p>
              <p className="text-xs text-neutral-500">
                In stock: {topUp.avail_qty * topUpPacking} {topUpUnit}
                {topUp.batch_no ? ` · Batch ${topUp.batch_no}` : ""}
              </p>
            </div>
            <Field label={`Quantity to add${topUpUnit ? ` (${topUpUnit})` : ""}`} required>
              <Input type="number" min="0" step="any" value={topUpQty} onChange={(e) => setTopUpQty(e.target.value)} autoFocus required />
            </Field>
            <Field label="Purchase price / item (optional)">
              <Input type="number" min="0" step="any" value={topUpPrice} onChange={(e) => setTopUpPrice(e.target.value)} />
            </Field>
            {topUpError && <p className="text-sm text-rose-600">{topUpError}</p>}
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setTopUp(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : "Add Stock"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modalOpen && (
        <Modal title="Add Stock" onClose={() => setModalOpen(false)} width="max-w-lg">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selectedProduct) return;
              setSaving(true);
              try {
                await receiveStock({
                  productId: selectedProduct.id,
                  batchNo: batchNo || null,
                  qty: Number(quantity) || 0,
                  purchasePrice: Number(purchasePrice) || 0,
                  expiryDate: expiryDate || null,
                  location: location || null,
                });
                setModalOpen(false);
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Barcode/Product Name" required>
              <Input
                value={selectedProduct ? selectedProduct.name : productQuery}
                onChange={(e) => {
                  setSelectedProduct(null);
                  setProductQuery(e.target.value);
                }}
                placeholder="Type to search..."
                required
                autoFocus
              />
              {!selectedProduct && productResults.length > 0 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-sm">
                  {productResults.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setSelectedProduct(p);
                        setProductResults([]);
                        setProductQuery(p.name);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50"
                    >
                      {p.name} {p.barcode ? `(${p.barcode})` : ""}
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Batch No">
                <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
              </Field>
              <Field label="Transfer From / Location">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pur Price / Item">
                <Input type="number" min="0" step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
              </Field>
              <Field label="Quantity" required>
                <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              </Field>
            </div>
            <Field label="Expiry Date">
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving || !selectedProduct}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

