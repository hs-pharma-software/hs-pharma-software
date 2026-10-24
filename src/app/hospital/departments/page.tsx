"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hospitalDepartmentsRepo, type HospitalDepartment } from "@/lib/repo/hospital";

export default function DepartmentsPage() {
  const [rows, setRows] = useState<HospitalDepartment[]>([]);
  const [editing, setEditing] = useState<HospitalDepartment | null | "new">(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await hospitalDepartmentsRepo.list({ orderBy: "name ASC" }));
  }
  useEffect(() => { void reload(); }, []);

  const columns: Column<HospitalDepartment>[] = [
    { header: "Department", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Type", render: (r) => r.type },
    { header: "Head", render: (r) => r.head ?? "—" },
    { header: "Phone", render: (r) => r.phone ?? "—" },
    { header: "Status", render: (r) => (r.is_active ? "Active" : "Inactive") },
    {
      header: "",
      render: (r) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(r); }} className="text-neutral-400 hover:text-amber-700">
          <Pencil size={15} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Departments"
        actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} className="mr-1" />Add Department</Button>}
      />
      <DataTable columns={columns} rows={rows} />
      {editing !== null && (
        <DepartmentModal
          dept={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}

function DepartmentModal({ dept, onClose, onSaved }: { dept: HospitalDepartment | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(dept?.name ?? "");
  const [type, setType] = useState<HospitalDepartment["type"]>(dept?.type ?? "clinical");
  const [head, setHead] = useState(dept?.head ?? "");
  const [phone, setPhone] = useState(dept?.phone ?? "");
  const [notes, setNotes] = useState(dept?.notes ?? "");
  const [active, setActive] = useState(dept ? Boolean(dept.is_active) : true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), type, head: head.trim() || null, phone: phone.trim() || null, notes: notes.trim() || null, is_active: active ? 1 : 0 };
      if (dept) await hospitalDepartmentsRepo.update(dept.id, payload);
      else await hospitalDepartmentsRepo.create(payload);
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={dept ? "Edit Department" : "Add Department"} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label="Name *"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as HospitalDepartment["type"])}>
            <option value="clinical">Clinical</option>
            <option value="diagnostic">Diagnostic</option>
            <option value="support">Support</option>
            <option value="admin">Administration</option>
          </Select>
        </Field>
        <Field label="Head of Department"><Input value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Status">
          <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
