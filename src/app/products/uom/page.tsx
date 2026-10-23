"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { seedStarterUoms, uomsRepo } from "@/lib/repo/uoms";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Uom } from "@/lib/types";

export default function UomPage() {
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Uom | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setUoms(await uomsRepo.list({ orderBy: "name ASC" }));
  }

  useEffect(() => {
    void reload();
  }, []);

  function startEdit(u: Uom) {
    setEditing(u);
    setEditName(u.name);
    setEditDesc(u.description ?? "");
  }

  async function saveEdit() {
    if (!editing || !editName.trim()) return;
    setEditSaving(true);
    try {
      await uomsRepo.update(editing.id, { name: editName.trim(), description: editDesc.trim() || null });
      setEditing(null);
      void reload();
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteUom(u: Uom) {
    if (!confirm(`Delete unit "${u.name}"? Products using this unit may lose their unit name.`)) return;
    await uomsRepo.remove(u.id);
    void reload();
  }

  const columns: Column<Uom>[] = [
    { header: "Unit Name", render: (u) => <span className="font-medium">{u.name}</span> },
    { header: "Description", render: (u) => u.description ?? "\u2014" },
    {
      header: "Actions",
      render: (u) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); startEdit(u); }}
            className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void deleteUom(u); }}
            className="rounded px-2 py-0.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="UOM Details"
        actions={
          <>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add
            </Button>
            {uoms.length === 0 && (
              <Button onClick={() => void seedStarterUoms().then(reload)}>Add common units</Button>
            )}
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage units of measure.
        </p>
      ) : (
        <DataTable columns={columns} rows={uoms} />
      )}

      {adding && (
        <QuickAddDialog
          title="Add Unit"
          onClose={() => setAdding(false)}
          onSubmit={async ({ name, description }) => {
            await uomsRepo.create({ name, description: description || null });
            setAdding(false);
            void reload();
          }}
        />
      )}

      {editing && (
        <Modal title="Edit Unit" onClose={() => setEditing(null)} width="max-w-sm">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
          >
            <Field label="Name" required>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus required />
            </Field>
            <Field label="Description">
              <Textarea rows={2} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={editSaving}>
                {editSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}