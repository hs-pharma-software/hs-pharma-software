"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { PackagePlus } from "lucide-react";
import { addProductStock } from "@/lib/repo/stock";
import { businessType } from "@/config/businessTypes";
import { useAuthStore } from "@/store/authStore";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { listProductsForGrid, productsRepo, type ProductListRow } from "@/lib/repo/products";
import { isTauri, useIsTauri } from "@/lib/platform";
import { exportCsv, downloadCsv, buildCsv } from "@/lib/csv";
import type { Product } from "@/lib/types";

export default function ProductsPage() {
  const [rows, setRows] = useState<ProductListRow[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Contractors top up stock by hand per item, here as on the Stock page.
  const sessionTenant = useAuthStore((s) => s.currentTenant);
  const canTopUp = businessType(sessionTenant?.businessType).id === "contractor" && !sessionTenant?.sourceTenantId;
  const [topUp, setTopUp] = useState<ProductListRow | null>(null);
  const [topUpQty, setTopUpQty] = useState("");
  const [topUpPrice, setTopUpPrice] = useState("");
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [topUpSaving, setTopUpSaving] = useState(false);

  async function saveTopUp() {
    if (!topUp) return;
    const qty = Number(topUpQty);
    if (!(qty > 0)) return setTopUpError("Enter a quantity greater than 0.");
    setTopUpSaving(true);
    setTopUpError(null);
    try {
      await addProductStock(topUp.id, qty, Number(topUpPrice) || undefined);
      setTopUp(null);
      void reload();
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : String(e));
    } finally {
      setTopUpSaving(false);
    }
  }

  async function reload() {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await listProductsForGrid());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = rows.filter((r) => {
    const term = search.toLowerCase();
    return (
      !term ||
      r.name.toLowerCase().includes(term) ||
      (r.barcode ?? "").toLowerCase().includes(term) ||
      (r.company_name ?? "").toLowerCase().includes(term)
    );
  });

  async function openEdit(id: string) {
    const product = await productsRepo.get(id);
    setEditingProduct(product);
    setEditingId(id);
    setModalOpen(true);
  }

  const columns: Column<ProductListRow>[] = [
    {
      header: "FBR",
      render: (r) => {
        const hasFbr = !!(r.hs_code && r.fbr_sale_type && r.fbr_uom);
        return (
          <div className="flex items-center justify-center">
            <div
              title={hasFbr ? `HS: ${r.hs_code} | ${r.fbr_sale_type}` : "FBR data incomplete — click to edit"}
              className={`h-2.5 w-2.5 rounded-full ${hasFbr ? "bg-emerald-500" : "bg-rose-500"}`}
            />
          </div>
        );
      },
    },
    { header: "Barcode", render: (r) => r.barcode ?? "—" },
    { header: "Product Name", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Company", render: (r) => r.company_name ?? "—" },
    { header: "Category", render: (r) => r.category_name ?? "—" },
    { header: "Sub Category", render: (r) => r.sub_category_name ?? "—" },
    { header: "UOM", render: (r) => r.base_unit_name ?? "—" },
    {
      header: "Avail Qty",
      render: (r) => {
        const packing = r.packing || 1;
        if (r.secondary_unit_id && packing > 1) {
          return `${r.avail_qty * packing} ${r.secondary_unit_name ?? ""}`.trim();
        }
        return `${r.avail_qty} ${r.base_unit_name ?? ""}`.trim();
      },
    },
    { header: "Sale Price", render: (r) => (r.sale_price != null ? r.sale_price.toFixed(2) : "—") },
    { header: "HS Code", render: (r) => r.hs_code ?? "—" },
    ...(canTopUp ? [{
      header: "Stock",
      render: (r: ProductListRow) => (
        <button
          type="button"
          title="Add stock to this item"
          onClick={(e) => {
            e.stopPropagation();
            setTopUp(r);
            setTopUpQty("");
            setTopUpPrice("");
            setTopUpError(null);
          }}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
        >
          <PackagePlus size={15} /> Add
        </button>
      ),
    }] : []),
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Product Details"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditingId(null);
                setEditingProduct(null);
                setModalOpen(true);
              }}
            >
              Add
            </Button>
            <Button
              onClick={() => {
                const PROD_HEADERS = ["Barcode","Product Name","Company","Category","Sub Category","UOM","Avail Qty","Sale Price","HS Code"];
                exportCsv(
                  `products-${new Date().toISOString().slice(0,10)}.csv`,
                  PROD_HEADERS,
                  filtered.map((r) => [r.barcode, r.name, r.company_name, r.category_name, r.sub_category_name, r.base_unit_name, r.avail_qty, r.sale_price, r.hs_code])
                );
              }}
            >
              Export CSV
            </Button>
            <Button
              onClick={() => {
                const headers = ["Name*","Barcode","Company","Category","Sub Category","UOM*","Sale Price","Wholesale Price","MRP","HS Code","Generic Name","Packing (units per box)"];
                const sample = [
                  ["PARACETAMOL 500MG TAB","5000168002658","GSK","Analgesics","Tablets","Tablet","5.00","4.50","5.50","3004.9090","Paracetamol","10"],
                  ["AMOXICILLIN 250MG CAP","5000168007553","Pharmatec","Antibiotics","Capsules","Capsule","15.00","13.50","16.00","3004.2090","Amoxicillin","14"],
                  ["(* = required)","","","","","","","","","","",""],
                ];
                downloadCsv("products-import-sample.csv", buildCsv(headers, sample));
              }}
            >
              Sample File
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input
          placeholder="Search by product, barcode or company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {!tauriReady ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app (<code>npm run tauri dev</code>) to see live product data.
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(r) => void openEdit(r.id)}
        />
      )}

      {loading && tauriReady && <p className="mt-2 text-xs text-neutral-400">Loading...</p>}

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
              <p className="font-medium text-neutral-800">{topUp.name}</p>
              <p className="text-xs text-neutral-500">
                In stock: {topUp.avail_qty} {topUp.base_unit_name ?? ""}
              </p>
            </div>
            <Field label={`Quantity to add${topUp.base_unit_name ? ` (${topUp.base_unit_name})` : ""}`} required>
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
              <Button type="submit" variant="primary" disabled={topUpSaving}>
                {topUpSaving ? "Saving..." : "Add Stock"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modalOpen && (
        <ProductFormModal
          product={editingId ? editingProduct : null}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
