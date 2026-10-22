"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { listProductsForGrid, productsRepo, type ProductListRow } from "@/lib/repo/products";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Product } from "@/lib/types";

export default function ProductsPage() {
  const [rows, setRows] = useState<ProductListRow[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const columns: Column<ProductListRow>[] = [
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
  ];

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  async function openEdit(id: string) {
    const product = await productsRepo.get(id);
    setEditingProduct(product);
    setEditingId(id);
    setModalOpen(true);
  }

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
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5">
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
