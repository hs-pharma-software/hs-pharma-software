"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { CategoryFormModal } from "@/components/products/CategoryFormModal";
import { SubCategoryFormModal } from "@/components/products/SubCategoryFormModal";
import { categoriesRepo, subCategoriesRepo } from "@/lib/repo/categories";
import { uomsRepo } from "@/lib/repo/uoms";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Category, SubCategory, Uom } from "@/lib/types";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingSubCategory, setEditingSubCategory] = useState<SubCategory | null>(null);
  const [subCategoryModalOpen, setSubCategoryModalOpen] = useState(false);

  const uomName = (id: string | null) => uoms.find((u) => u.id === id)?.name ?? "—";

  async function reload() {
    if (!isTauri()) return;
    const [cats, uomList] = await Promise.all([categoriesRepo.list(), uomsRepo.list()]);
    setCategories(cats);
    setUoms(uomList);
    if (selectedCategoryId) {
      setSubCategories(
        await subCategoriesRepo.list({ where: "category_id = ?", params: [selectedCategoryId] })
      );
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCategoryId || !isTauri()) {
      setSubCategories([]);
      return;
    }
    void subCategoriesRepo
      .list({ where: "category_id = ?", params: [selectedCategoryId] })
      .then(setSubCategories);
  }, [selectedCategoryId]);

  const categoryColumns: Column<Category>[] = [
    { header: "Category Name", render: (c) => c.name },
    { header: "Flat discount (%)", render: (c) => c.flat_discount_pct },
    { header: "Description", render: (c) => c.description ?? "—" },
  ];

  const subCategoryColumns: Column<SubCategory>[] = [
    { header: "Sub Category Name", render: (c) => c.name },
    { header: "Flat discount (%)", render: (c) => c.flat_discount_pct },
    { header: "Default Secondary Unit", render: (c) => uomName(c.default_secondary_unit_id) },
    { header: "Description", render: (c) => c.description ?? "—" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-2.5">
            <h2 className="font-serif text-lg text-neutral-800">Categories</h2>
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  setEditingCategory(null);
                  setCategoryModalOpen(true);
                }}
              >
                Add
              </Button>
              <Button onClick={() => void reload()}>Refresh</Button>
            </div>
          </div>
          {!tauriReady ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Run inside the desktop app to manage categories.
            </p>
          ) : (
            <DataTable
              columns={categoryColumns}
              rows={categories}
              onRowClick={(c) => {
                setSelectedCategoryId(c.id);
                setEditingCategory(c);
                setCategoryModalOpen(true);
              }}
            />
          )}
          <p className="mt-1.5 text-xs text-neutral-400">Click a category to edit it (including its discount).</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-2.5">
            <h2 className="font-serif text-lg text-neutral-800">Sub Categories</h2>
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  setEditingSubCategory(null);
                  setSubCategoryModalOpen(true);
                }}
                disabled={!selectedCategoryId}
              >
                Add
              </Button>
            </div>
          </div>
          {!selectedCategoryId ? (
            <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-400">
              Select a category on the left to see (and add) its sub categories.
            </p>
          ) : (
            <>
              <DataTable
                columns={subCategoryColumns}
                rows={subCategories}
                onRowClick={(sc) => {
                  setEditingSubCategory(sc);
                  setSubCategoryModalOpen(true);
                }}
              />
              <p className="mt-1.5 text-xs text-neutral-400">Click a sub category to edit it (including its discount).</p>
            </>
          )}
        </div>
      </div>

      {categoryModalOpen && (
        <CategoryFormModal
          category={editingCategory}
          onClose={() => setCategoryModalOpen(false)}
          onSaved={() => {
            setCategoryModalOpen(false);
            void reload();
          }}
        />
      )}

      {subCategoryModalOpen && selectedCategoryId && (
        <SubCategoryFormModal
          categoryId={selectedCategoryId}
          subCategory={editingSubCategory}
          onClose={() => setSubCategoryModalOpen(false)}
          onSaved={() => {
            setSubCategoryModalOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
