"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ProductPicker } from "@/components/products/ProductPicker";
import { getLatestPrice } from "@/lib/repo/products";
import type { Product } from "@/lib/types";

interface LabelLine {
  product: Product;
  noOfLabel: number;
  salePrice: number;
}

export default function GenerateBarcodePage() {
  const [lines, setLines] = useState<LabelLine[]>([]);
  const [paperSize, setPaperSize] = useState("2 x 1 in");

  async function addProduct(p: Product) {
    if (lines.some((l) => l.product.id === p.id)) return;
    const price = await getLatestPrice(p.id);
    setLines((prev) => [...prev, { product: p, noOfLabel: 1, salePrice: price?.salePrice ?? 0 }]);
  }

  function updateLine(idx: number, noOfLabel: number) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, noOfLabel } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const columns: Column<LabelLine & { id: string }>[] = [
    { header: "Barcode", render: (l) => l.product.barcode ?? "â€”" },
    { header: "Product Name", render: (l) => l.product.name },
    {
      header: "No Of Label",
      render: (l) => {
        const idx = lines.findIndex((x) => x.product.id === l.product.id);
        return (
          <input
            type="number"
            min="1"
            value={l.noOfLabel}
            onChange={(e) => updateLine(idx, Number(e.target.value))}
            className="w-20 rounded border border-neutral-300 px-1.5 py-1"
          />
        );
      },
    },
    { header: "Sale Price", render: (l) => l.salePrice.toFixed(2) },
    {
      header: "Action",
      render: (l) => (
        <button
          type="button"
          className="text-rose-600 hover:underline"
          onClick={() => removeLine(lines.findIndex((x) => x.product.id === l.product.id))}
        >
          Remove
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Generate Barcode"
        actions={
          <>
            <Field label="Paper Size">
              <Select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
                <option value="2 x 1 in">2 x 1 in</option>
                <option value="3 x 1 in">3 x 1 in</option>
                <option value="4 x 2 in">4 x 2 in</option>
              </Select>
            </Field>
            <Button onClick={() => window.print()} disabled={lines.length === 0}>Preview Barcode</Button>
            <Button variant="primary" onClick={() => window.print()} disabled={lines.length === 0}>
              Generate Barcode
            </Button>
          </>
        }
      />

      <div className="mb-3 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-4 py-2.5">
        <ProductPicker onSelect={(p) => void addProduct(p)} />
      </div>

      <DataTable columns={columns} rows={lines.map((l) => ({ ...l, id: l.product.id }))} />

      {lines.length > 0 && (
        <div className="print-area mt-4 flex flex-wrap gap-2 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-4">
          {lines.flatMap((l) =>
            Array.from({ length: l.noOfLabel }).map((_, i) => (
              <div
                key={`${l.product.id}-${i}`}
                className="flex w-32 flex-col items-center border border-neutral-300 p-2 text-center text-[10px]"
              >
                <span className="truncate font-medium">{l.product.name}</span>
                <span className="my-1 font-mono tracking-widest">{l.product.barcode ?? "N/A"}</span>
                <span>Rs {l.salePrice.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

