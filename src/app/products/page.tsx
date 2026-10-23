"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
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
