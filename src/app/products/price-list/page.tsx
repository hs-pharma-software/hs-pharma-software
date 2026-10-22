"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ProductPicker } from "@/components/products/ProductPicker";
import { isTauri, useIsTauri } from "@/lib/platform";
import { dbSelect } from "@/lib/db";
import { priceListRepo } from "@/lib/repo/products";
import { useAuthStore } from "@/store/authStore";
import type { Product } from "@/lib/types";

interface PriceListRow {
  id: string;
  barcode: string | null;
  product_name: string;
  batch_no: string | null;
  sale_price: number;
  wholesale_price: number;
  mrp: number;
  comment: string | null;
}

export default function PriceListPage() {
  const [rows, setRows] = useState<PriceListRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [batchNo, setBatchNo] = useState("");
  const [salePrice, setSalePrice] = useState("0");
  const [wholesalePrice, setWholesalePrice] = useState("0");
  const [mrp, setMrp] = useState("0");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setRows(
      await dbSelect<PriceListRow>(
        `
        SELECT pl.id, p.barcode, p.name AS product_name, pl.batch_no, pl.sale_price, pl.wholesale_price, pl.mrp, pl.comment
        FROM price_list pl
        JOIN products p ON p.id = pl.product_id
        WHERE pl.deleted_at IS NULL AND pl.tenant_id = ?
        ORDER BY pl.created_at DESC
      `,
        [useAuthStore.getState().currentTenant?.id ?? null]
      )
    );
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<PriceListRow>[] = [
    { header: "Barcode", render: (r) => r.barcode ?? "\u2014" },
    { header: "Product", render: (r) => r.product_name },
    { header: "Batch", render: (r) => r.batch_no ?? "\u2014" },
    { header: "Sales Price", render: (r) => r.sale_price.toFixed(2) },
    { header: "Wholesale Price", render: (r) => r.wholesale_price.toFixed(2) },
    { header: "MRP", render: (r) => r.mrp.toFixed(2) },
    { header: "Comment", render: (r) => r.comment ?? "\u2014" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Price List"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setProduct(null);
                setBatchNo("");
                setSalePrice("0");
                setWholesalePrice("0");
                setMrp("0");
                setComment("");
                setModalOpen(true);
              }}
            >
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage the price list.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}

      {modalOpen && (
        <Modal title="Add Price List" onClose={() => setModalOpen(false)} width="max-w-lg">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!product) return;
              setSaving(true);
              try {
                await priceListRepo.create({
                  product_id: product.id,
                  batch_no: batchNo || null,
                  sale_price: Number(salePrice) || 0,
                  wholesale_price: Number(wholesalePrice) || 0,
                  mrp: Number(mrp) || 0,
                  comment: comment || null,
                });
                setModalOpen(false);
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Barcode/Product Name" required>
              {product ? (
                <div className="flex items-center gap-2">
                  <Input value={product.name} disabled className="flex-1" />
                  <Button type="button" onClick={() => setProduct(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <ProductPicker onSelect={setProduct} autoFocus />
              )}
            </Field>
            <Field label="Batch No">
              <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Sale Price / Item">
                <Input type="number" min="0" step="any" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
              </Field>
              <Field label="Whole Sale">
                <Input type="number" min="0" step="any" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} />
              </Field>
              <Field label="MRP">
                <Input type="number" min="0" step="any" value={mrp} onChange={(e) => setMrp(e.target.value)} />
              </Field>
            </div>
            <Field label="Comment">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving || !product}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
