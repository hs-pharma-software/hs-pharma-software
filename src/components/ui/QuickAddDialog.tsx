"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { Field, Input, Textarea } from "./Field";
import { Button } from "./Button";

/** Small "+" quick-add popup used next to dependent-entity dropdowns
 * (Category, Sub Category, UOM, ...) so a screen never has to be left to
 * create a missing lookup value \u2014 mirrors the reference app's inline "+"
 * buttons on Product/Order/Purchase forms. */
export function QuickAddDialog({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Modal title={title} onClose={onClose} width="max-w-sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          try {
            await onSubmit({ name: name.trim(), description: description.trim() });
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
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
