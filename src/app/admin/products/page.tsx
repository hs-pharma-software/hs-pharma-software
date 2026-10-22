"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri, useIsTauri } from "@/lib/platform";
import { productsRepo } from "@/lib/repo/products";
import { uomsRepo } from "@/lib/repo/uoms";
import { categoriesRepo } from "@/lib/repo/categories";
import type { Product, Uom, Category } from "@/lib/types";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  // Add form
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [baseUnitId, setBaseUnitId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [gstRate, setGstRate] = useState("0");

  async function reload() {
    if (!isTauri()) return;
    const [prods, uomList, catList] = await Promise.all([
      productsRepo.list(),
      uomsRepo.list(),
      categoriesRepo.list(),
    ]);
    setProducts(prods);
    setUoms(uomList);
    setCategories(catList);
  }

  useEffect(() => { void reload(); }, []);

  function resetForm() {
    setName(""); setBarcode(""); setCompanyName("");
    setBaseUnitId(""); setCategoryId(""); setGstRate("0");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !baseUnitId) return;
    setSaving(true);
    try {
      const created = await productsRepo.create({
        barcode: barcode || null,
        name: name.trim(),
        company_name: companyName || null,
        description: null,
        category_id: categoryId || null,
        sub_category_id: null,
        base_unit_id: baseUnitId,
        secondary_unit_id: null,
        packing: 1,
        gst_rate_pct: Number(gstRate) || 0,
        max_stock_qty: null,
        stock_expiry_limit_days: null,
        location: null,
      });
      void created;
      setModalOpen(false);
      resetForm();
      void reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product: Product) {
    await productsRepo.remove(product.id);
    setDeleteTarget(null);
    void reload();
  }

  const filtered = products.filter((p) => {
    const t = search.toLowerCase();
    return !t || p.name.toLowerCase().includes(t) || (p.barcode ?? "").toLowerCase().includes(t) || (p.company_name ?? "").toLowerCase().includes(t);
  });

  const uomName = (id: string | null) => uoms.find((u) => u.id === id)?.name ?? "â€”";
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "â€”";

  const columns: Column<Product>[] = [
    { header: "Barcode", render: (p) => p.barcode ?? "â€”" },
    { header: "Medicine Name", render: (p) => <span className="font-medium">{p.name}</span> },
    { header: "Company", render: (p) => p.company_name ?? "â€”" },
    { header: "Category", render: (p) => catName(p.category_id) },
    { header: "UOM", render: (p) => uomName(p.base_unit_id) },
    { header: "GST %", render: (p) => p.gst_rate_pct ?? 0 },
    {
      header: "Action",
      render: (p) => (
        <Button
          variant="danger"
          onClick={() => setDeleteTarget(p)}
        >
          Delete
        </Button>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Medicine Database"
        actions={
          <>
            <Button variant="primary" onClick={() => { resetForm(); setModalOpen(true); }}>
              Add Medicine
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-4 py-2.5">
        <Input
          placeholder="Search by name, barcode or company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <span className="ml-auto text-sm text-neutral-400">{filtered.length} medicines</span>
      </div>

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage the medicine database.
        </p>
      ) : (
        <DataTable columns={columns} rows={filtered} />
      )}

      {/* Add modal */}
      {modalOpen && (
        <Modal title="-:Add Medicine:-" onClose={() => setModalOpen(false)} width="max-w-xl">
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Medicine Name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </Field>
              <Field label="Barcode">
                <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company Name">
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </Field>
              <Field label="Base Unit (UOM)" required>
                <Select value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} required>
                  <option value="">Select...</option>
                  {uoms.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Select...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="GST Rate %">
                <Input type="number" min="0" step="any" value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <Modal title="-:Confirm Delete:-" onClose={() => setDeleteTarget(null)} width="max-w-sm">
          <p className="mb-4 text-sm text-neutral-700">
            Delete <strong>{deleteTarget.name}</strong> from the global medicine database?
            This affects all pharmacies.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleDelete(deleteTarget)}>
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

