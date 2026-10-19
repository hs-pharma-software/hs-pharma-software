"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { categoriesRepo } from "@/lib/repo/categories";
import type { Category } from "@/lib/types";

/** Unlike the generic "+" QuickAddDialog (name + description only), this is
 * the full Add/Edit form for Categories Details — the only place
 * flat_discount_pct can actually be set, since QuickAddDialog always wrote
 * it as 0 and there was previously no way to edit a category afterwards. */
export function CategoryFormModal({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(category);
  const [name, setName] = useState(category?.name ?? "");
  const [discountPct, setDiscountPct] = useState(String(category?.flat_discount_pct ?? 0));
  const [description, setDescription] = useState(category?.description ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        flat_discount_pct: Number(discountPct) || 0,
        description: description.trim() || null,
      };
      if (isEdit && category) {
        await categoriesRepo.update(category.id, payload);
      } else {
        await categoriesRepo.create({ ...payload, image_url: null });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "-:Edit Category:-" : "-:Add Categories:-"} onClose={onClose} width="max-w-sm">
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
