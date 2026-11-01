"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hallsRepo, saveHall, type BanquetHall } from "@/lib/repo/banquet";

/** The halls / lawns booked for events: capacity and rent. */
export default function HallsPage() {
  const [rows, setRows] = useState<BanquetHall[]>([]);
  const [editing, setEditing] = useState<BanquetHall | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setRows(await hallsRepo.list({ orderBy: "name ASC" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void reload(); }, []);

  const columns: Column<BanquetHall>[] = [
    { header: "Hall", render: (h) => <span className="font-medium">{h.name}</span> },
    { header: "Capacity", render: (h) => (h.capacity ? `${h.capacity} guests` : "—") },
    { header: "Rent (Rs)", render: (h) => <span className="tabular-nums">{Number(h.rent).toLocaleString()}</span> },
    { header: "Status", render: (h) => (h.is_active ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Bookable</span> : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">Closed</span>) },
    { header: "", render: (h) => <button type="button" title="Edit" aria-label={`Edit ${h.name}`} onClick={(e) => { e.stopPropagation(); setEditing(h); }} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><Pencil size={15} /></button> },
  ];

  return (
    <div>
      <PageHeader title="Halls" actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />Add hall</Button>} />
      {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
      <DataTable columns={columns} rows={rows} onRowClick={(h) => setEditing(h)} emptyMessage="No halls yet. Add each hall or lawn you book, with its capacity and rent." />
      {editing && <HallForm hall={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function HallForm({ hall, onClose, onSaved }: { hall: BanquetHall | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(hall?.name ?? "");
  const [capacity, setCapacity] = useState(hall?.capacity ? String(hall.capacity) : "");
  const [rent, setRent] = useState(hall ? String(hall.rent) : "");
  const [active, setActive] = useState(hall ? Boolean(hall.is_active) : true);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await saveHall(hall?.id ?? null, { name, capacity: Number(capacity) || null, rent: Number(rent) || 0, is_active: active });
      onSaved();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={hall ? `Edit ${hall.name}` : "Add hall"} onClose={onClose} width="max-w-md">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name" required><Input id="hl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Crystal Hall" autoFocus /></Field></div>
        <Field label="Capacity (guests)"><Input id="hl-cap" type="number" min="0" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
        <Field label="Rent (Rs)"><Input id="hl-rent" type="number" min="0" step="any" value={rent} onChange={(e) => setRent(e.target.value)} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Bookable</label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
