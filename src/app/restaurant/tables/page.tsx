"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { restaurant } from "@/lib/restaurant";
import type { TableRow } from "@/lib/restaurant/store";
import { Badge, Note, RestGuard, useAction, useLoad } from "@/components/restaurant/ui";

export default function TablesPage() {
  return (
    <RestGuard>
      <Tables />
    </RestGuard>
  );
}

function Tables() {
  const { data, error, reload } = useLoad(() => restaurant.listTables(true));
  const [editing, setEditing] = useState<Partial<TableRow> | null>(null);
  const act = useAction();
  return (
    <div>
      <PageHeader
        title="Table Setup"
        actions={
          <>
            <Button variant="primary" onClick={() => setEditing({ capacity: 4, is_active: 1 })}>Add Table</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />
      {(error || act.error) && <div className="mb-3"><Note tone="rose">{error ?? act.error}</Note></div>}
      <DataTable
        rows={data ?? []}
        onRowClick={(t) => setEditing(t)}
        columns={[
          { header: "Table", render: (t) => <span className="font-medium">{t.name}</span> },
          { header: "Area / Floor", render: (t) => t.area ?? "-" },
          { header: "Seats", render: (t) => t.capacity },
          { header: "Status", render: (t) => <Badge>{t.current_order_id ? `occupied (#${t.order_no})` : t.status}</Badge> },
          { header: "Active", render: (t) => (t.is_active ? "Yes" : "No") },
          {
            header: "Actions",
            render: (t) => (
              <div className="flex gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
                {!t.current_order_id && (
                  <button type="button" className="text-violet-700 hover:underline" onClick={async () => { await act.run(() => restaurant.setTableReserved(t.id, t.status !== "reserved")); void reload(); }}>
                    {t.status === "reserved" ? "Unreserve" : "Reserve"}
                  </button>
                )}
                <button type="button" className="text-rose-600 hover:underline" onClick={async () => { if (window.confirm(`Delete table ${t.name}?`)) { await act.run(() => restaurant.deleteTable(t.id)); void reload(); } }}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : "Add Table"} onClose={() => setEditing(null)} width="max-w-md">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Table name / number" required>
                <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
              </Field>
              <Field label="Seats">
                <Input type="number" min="1" value={editing.capacity ?? 4} onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Area / floor (e.g. Ground Floor, Rooftop, Family Hall)">
              <Input value={editing.area ?? ""} onChange={(e) => setEditing({ ...editing, area: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Display order">
                <Input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
              </Field>
              <label className="mt-6 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active !== 0} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} /> In use
              </label>
            </div>
            {act.error && <Note tone="rose">{act.error}</Note>}
            <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" disabled={act.busy} onClick={async () => { const r = await act.run(() => restaurant.saveTable(editing)); if (r) { setEditing(null); void reload(); } }}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
