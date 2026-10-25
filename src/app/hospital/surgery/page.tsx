"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hospitalDepartmentsRepo, type HospitalService } from "@/lib/repo/hospital";
import { listSurgeryTypes, saveSurgeryType, listSurgeryBookings, markSurgeryDone, cancelSurgery, type SurgeryRow } from "@/lib/repo/hospitalCare";

const STATUS_COLOR: Record<string, string> = {
  planned: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-100 text-neutral-500",
};

export default function SurgeryPage() {
  const [tab, setTab] = useState<"types" | "planned">("types");
  const [types, setTypes] = useState<HospitalService[]>([]);
  const [bookings, setBookings] = useState<SurgeryRow[]>([]);
  const [filter, setFilter] = useState<"" | "planned" | "done" | "cancelled">("planned");
  const [editing, setEditing] = useState<HospitalService | "new" | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setTypes(await listSurgeryTypes({ includeInactive: true }));
      setBookings(await listSurgeryBookings(filter || undefined));
    } catch (e) {
      window.alert(`Could not load surgeries: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [filter]);

  const act = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
    } catch (e) {
      window.alert(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const typeColumns: Column<HospitalService>[] = [
    { header: "Code", render: (s) => <span className="font-mono text-xs">{s.code}</span> },
    { header: "Surgery", render: (s) => <span className="font-medium">{s.name}</span> },
    { header: "Department", render: (s) => s.department || "—" },
    { header: "Fee (Rs)", render: (s) => <span className="tabular-nums">{Number(s.rate).toLocaleString()}</span> },
    { header: "Notes", render: (s) => s.notes ?? "—" },
    { header: "Status", render: (s) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{s.is_active ? "Performed" : "Not performed"}</span> },
    { header: "", render: (s) => <Button variant="ghost" onClick={() => setEditing(s)}>Edit</Button> },
  ];

  const bookingColumns: Column<SurgeryRow>[] = [
    { header: "Planned", render: (b) => b.planned_date ?? "—" },
    { header: "Patient", render: (b) => <span><span className="font-medium">{b.patient_name}</span> <span className="text-xs text-neutral-400">{b.mr_no}</span></span> },
    { header: "Admission", render: (b) => <span className="font-mono text-xs">{b.episode_no}</span> },
    { header: "Surgery", render: (b) => b.surgery_name },
    { header: "Surgeon", render: (b) => b.surgeon_name ?? "—" },
    { header: "Fee (Rs)", render: (b) => <span className="tabular-nums">{Number(b.fee).toLocaleString()}</span> },
    { header: "Status", render: (b) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[b.status] ?? ""}`}>{b.status}</span> },
    {
      header: "",
      render: (b) => b.status !== "planned" ? null : (
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => void act("mark the surgery done", () => markSurgeryDone(b.id))}>Mark done</Button>
          <Button variant="ghost" onClick={() => {
            const reason = window.prompt(`Cancel ${b.surgery_name} for ${b.patient_name}? The fee is taken off the bill.\nReason:`);
            if (reason?.trim()) void act("cancel the surgery", () => cancelSurgery(b.id, reason));
          }}>Cancel</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Surgery"
        actions={
          <>
            <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
              {(["types", "planned"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                  {t === "types" ? "Surgery types & fees" : "Surgeries"}
                </button>
              ))}
            </div>
            {tab === "types" && <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} className="mr-1" />Add Surgery</Button>}
          </>
        }
      />
      {tab === "types" ? (
        <>
          <p className="mb-3 text-xs text-neutral-500">Surgeries performed in this hospital. Doctors choose from this list when admitting a patient for surgery, and the fee goes on the admission bill.</p>
          <DataTable columns={typeColumns} rows={types} />
        </>
      ) : (
        <>
          <div className="mb-3 flex gap-2 text-sm">
            {(["planned", "done", "cancelled", ""] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFilter(s)}
                className={`rounded-full px-3 py-1 ${filter === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
                {s === "planned" ? "Planned" : s === "done" ? "Done" : s === "cancelled" ? "Cancelled" : "All"}
              </button>
            ))}
          </div>
          <DataTable columns={bookingColumns} rows={bookings} />
        </>
      )}
      {editing && <SurgeryTypeModal surgery={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function SurgeryTypeModal({ surgery, onClose, onSaved }: { surgery: HospitalService | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(surgery?.name ?? "");
  const [code, setCode] = useState(surgery?.code ?? "");
  const [department, setDepartment] = useState(surgery?.department ?? "");
  const [rate, setRate] = useState(surgery ? String(surgery.rate) : "");
  const [notes, setNotes] = useState(surgery?.notes ?? "");
  const [active, setActive] = useState(surgery ? Boolean(surgery.is_active) : true);
  const [departments, setDepartments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void hospitalDepartmentsRepo.list({ orderBy: "name ASC" }).then((ds) => setDepartments(ds.filter((d) => d.is_active).map((d) => d.name))).catch(() => setDepartments([]));
  }, []);
  const deptOptions = department && !departments.includes(department) ? [department, ...departments] : departments;

  async function save() {
    setSaving(true);
    try {
      await saveSurgeryType(surgery?.id ?? null, { name, code, department, rate: Number(rate) || 0, notes, is_active: active ? 1 : 0 });
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={surgery ? "Edit Surgery" : "Add Surgery"} onClose={onClose}>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Surgery name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Appendectomy (laparoscopic)" autoFocus />
        </Field>
        <Field label="Code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Blank = next SURG number" />
        </Field>
        <Field label="Department">
          <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">{departments.length ? "— Choose a department —" : "Surgery (add departments in Departments)"}</option>
            {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Fee (Rs) *">
          <Input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Includes OT, anaesthesia…" />
        </Field>
        <Field label="Status">
          <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Performed here</option>
            <option value="0">Not performed</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : surgery ? "Update" : "Add Surgery"}</Button>
      </div>
    </Modal>
  );
}
