"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ProductPicker } from "@/components/products/ProductPicker";
import { isTauri, useIsTauri } from "@/lib/platform";
import { suppliersRepo } from "@/lib/repo/suppliers";
import { listAssignedProducts, assignProductToSupplier, unassignProduct, type AssignedProductRow } from "@/lib/repo/productSuppliers";
import type { Supplier, Product } from "@/lib/types";

export default function AssignToSupplierPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [assigned, setAssigned] = useState<AssignedProductRow[]>([]);

  async function reloadSuppliers() {
    if (!isTauri()) return;
    setSuppliers(await suppliersRepo.list());
  }

  useEffect(() => {
    void reloadSuppliers();
  }, []);

  async function selectSupplier(s: Supplier) {
    setSelected(s);
    setAssigned(await listAssignedProducts(s.id));
  }

  async function handleAssign(p: Product) {
    if (!selected) return;
    await assignProductToSupplier(p.id, selected.id);
    setAssigned(await listAssignedProducts(selected.id));
  }

  const supplierColumns: Column<Supplier>[] = [
    { header: "Name", render: (s) => s.name },
    { header: "Phone No", render: (s) => s.phone ?? "\u2014" },
  ];

  const productColumns: Column<AssignedProductRow>[] = [
    { header: "Product Name", render: (r) => r.product_name },
    { header: "Barcode", render: (r) => r.barcode ?? "\u2014" },
    { header: "Company Name", render: (r) => r.company_name ?? "\u2014" },
    {
      header: "",
      render: (r) => (
        <button
          type="button"
          className="text-rose-600 hover:underline"
          onClick={async (e) => {
            e.stopPropagation();
            await unassignProduct(r.id);
            if (selected) setAssigned(await listAssignedProducts(selected.id));
          }}
        >
          Remove
        </button>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Assign To Supplier" actions={<Button onClick={() => void reloadSuppliers()}>Refresh</Button>} />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to assign products to suppliers.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-500">Select a supplier</p>
            <DataTable columns={supplierColumns} rows={suppliers} onRowClick={(s) => void selectSupplier(s)} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-500">
              {selected ? `Products assigned to ${selected.name}` : "Select a supplier on the left"}
            </p>
            {selected && (
              <div className="mb-2">
                <ProductPicker onSelect={(p) => void handleAssign(p)} placeholder="Search a product to assign..." />
              </div>
            )}
            <DataTable columns={productColumns} rows={assigned} />
          </div>
        </div>
      )}

      <div className="mt-3 flex justify-end rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
        <span className="font-medium text-neutral-700">Total Number Of Assigned Products: {assigned.length}</span>
      </div>
    </div>
  );
}

