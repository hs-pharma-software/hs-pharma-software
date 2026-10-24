"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { listCollectionCenters, saveCollectionCenter } from "@/lib/repo/labReports";
import type { CollectionCenter } from "@/lib/types-hospital";

/** The hospital's sample collection centers. Their receptionists log in as
 * hospital staff with "Works at" set to the center; orders they register are
 * marked with the center, and every center searches the same reports. */
export default function CollectionCentersPage() {
  const [rows, setRows] = useState<CollectionCenter[]>([]);
  const [editing, setEditing] = useState<CollectionCenter | null | "new">(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listCollectionCenters({ includeInactive: true }));
  }
  useEffect(() => { void reload(); }, []);

  const columns: Column<CollectionCenter>[] = [
    { header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Collection center", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Address", render: (r) => r.address ?? "—" },
    { header: "Phone", render: (r) => r.phone ?? "—" },
    { header: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{r.is_active ? "Active" : "Closed"}</span> },
    { header: "", render: (r) => <button type="button" aria-label={`Edit ${r.name}`} onClick={(e) => { e.stopPropagation(); setEditing(r); }} className="text-neutral-400 hover:text-amber-700"><Pencil size={15} /></button> },
  ];

  return (
    <div>
      <PageHeader title="Collection Centers" actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} className="mr-1" />Add Center</Button>} />
      <p className="mb-3 text-sm text-neutral-500">
        Staff of a center: add them in HR Department &rsaquo; Staff as &ldquo;Collection Center Receptionist&rdquo; with <b>Works at</b> set to the center, and give them a login.
      </p>
      <DataTable columns={columns} rows={rows} emptyMessage="No collection centers yet." onRowClick={(r) => setEditing(r)} />
      {editing !== null && <CenterModal center={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function CenterModal({ center, onClose, onSaved }: { center: CollectionCenter | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(center?.code ?? "");
  const [name, setName] = useState(center?.name ?? "");
  const [address, setAddress] = useState(center?.address ?? "");
  const [phone, setPhone] = useState(center?.phone ?? "");
  const [active, setActive] = useState(center ? Boolean(center.is_active) : true);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveCollectionCenter(center?.id ?? null, { code, name, address, phone, is_active: active ? 1 : 0 });
      onSaved();
    } catch (err) {
      window.alert(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={center ? "Edit Collection Center" : "Add Collection Center"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code" required><Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="e.g. CC-A" /></Field>
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Satellite Town Collection Center" /></Field>
          <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Status">
            <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Active</option>
              <option value="0">Closed (no new orders; its reports stay searchable)</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
