"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { subCategoriesRepo } from "@/lib/repo/categories";
import { uomsRepo } from "@/lib/repo/uoms";
import type { SubCategory, Uom } from "@/lib/types";

export function SubCategoryFormModal({
  categoryId,
  subCategory,
  onClose,
  onSaved,
}: {
  categoryId: string;
  subCategory: SubCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(subCategory);
  const [name, setName] = useState(subCategory?.name ?? "");
  const [discountPct, setDiscountPct] = useState(String(subCategory?.flat_discount_pct ?? 0));
  const [defaultSecondaryUnitId, setDefaultSecondaryUnitId] = useState(
    subCategory?.default_secondary_unit_id ?? ""
  );
  const [description, setDescription] = useState(subCategory?.description ?? "");
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void uomsRepo.list().then(setUoms);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        flat_discount_pct: Number(discountPct) || 0,
        default_secondary_unit_id: defaultSecondaryUnitId || null,
        description: description.trim() || null,
      };
      if (isEdit && subCategory) {
        await subCategoriesRepo.update(subCategory.id, payload);
      } else {
        await subCategoriesRepo.create({ ...payload, category_id: categoryId, image_url: null });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "-:Edit SubCategory:-" : "-:Add SubCategories:-"} onClose={onClose} width="max-w-sm">
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        <Field label="Flat discount (%)">
          <Input
            type="number"
            min="0"
            max="100"
            step="any"
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
          />
        </Field>
        <Field label="Default Secondary Unit">
          <Select value={defaultSecondaryUnitId} onChange={(e) => setDefaultSecondaryUnitId(e.target.value)}>
            <option value="">None</option>
            {uoms.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
