"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hospitalLabRepo, hospitalPatientsRepo, nextOrderNo, type HospitalLabOrder, type HospitalPatient } from "@/lib/repo/hospital";
import type { OrderPriority } from "@/lib/types-hospital";
import { localDateTime } from "@/lib/localDate";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  collected: "bg-blue-100 text-blue-700",
  reported: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-100 text-neutral-500",
};

const now = () => localDateTime();

export default function LabPage() {
  const [rows, setRows] = useState<HospitalLabOrder[]>([]);
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [filter, setFilter] = useState("pending");
  const [showNew, setShowNew] = useState(false);
  const [resulting, setResulting] = useState<HospitalLabOrder | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const all = await hospitalLabRepo.list({ orderBy: "ordered_at DESC" });
    setRows(filter ? all.filter((r) => r.status === filter) : all);
    setPatients(await hospitalPatientsRepo.list({ orderBy: "name ASC" }));
  }
  useEffect(() => { void reload(); }, [filter]);

  const patientName = (id: string) => patients.find((p) => p.id === id)?.name ?? "—";

  const columns: Column<HospitalLabOrder>[] = [
    { header: "Order No", render: (r) => <span className="font-mono text-xs">{r.order_no}</span> },
    { header: "Patient", render: (r) => <span className="font-medium">{patientName(r.patient_id)}</span> },
    { header: "Test", render: (r) => r.test_name },
    { header: "Priority", render: (r) => r.priority },
    { header: "Status", render: (r) => <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</span> },
    { header: "Result", render: (r) => (r.result_value ? `${r.result_value} ${r.unit ?? ""} ${r.flag && r.flag !== "N" ? `(${r.flag})` : ""}` : "—") },
    {
      header: "",
      render: (r) => (r.status !== "reported" && r.status !== "cancelled"
        ? <Button variant="ghost" onClick={() => setResulting(r)}>Enter Result</Button>
        : null),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Laboratory"
        actions={
          <>
            <div className="flex rounded-lg overflow-hidden border border-neutral-200 text-sm">
              {["pending", "reported", ""].map((s) => (
                <button key={s} type="button" onClick={() => setFilter(s)} className={`px-3 py-1.5 ${filter === s ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                  {s === "pending" ? "Pending" : s === "reported" ? "Reported" : "All"}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setShowNew(true)}><Plus size={14} className="mr-1" />New Lab Order</Button>
          </>
        }
      />
      <DataTable columns={columns} rows={rows} />
      {showNew && <NewLabOrder patients={patients} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); void reload(); }} />}
      {resulting && <ResultModal order={resulting} onClose={() => setResulting(null)} onSaved={() => { setResulting(null); void reload(); }} />}
    </div>
  );
}

function NewLabOrder({ patients, onClose, onSaved }: { patients: HospitalPatient[]; onClose: () => void; onSaved: () => void }) {
  const [patientId, setPatientId] = useState("");
  const [tests, setTests] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("routine");
  const [orderedBy, setOrderedBy] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const names = tests.split("\n").map((t) => t.trim()).filter(Boolean);
    if (!patientId || names.length === 0) return;
    setSaving(true);
    try {
      for (const t of names) {
        await hospitalLabRepo.create({
          order_no: await nextOrderNo("hospital_lab_orders"),
          episode_id: null,
          patient_id: patientId,
          test_name: t,
          priority,
          status: "pending",
          result_value: null,
          unit: null,
          ref_range: null,
          flag: null,
          ordered_by: orderedBy.trim() || null,
          ordered_at: now(),
          reported_at: null,
          notes: null,
        });
      }
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Lab Order" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 mb-4">
        <Field label="Patient *">
          <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">— Select —</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.mr_no})</option>)}
          </Select>
        </Field>
        <Field label="Tests * (one per line)">
          <textarea value={tests} onChange={(e) => setTests(e.target.value)} rows={4} placeholder={"CBC\nBlood Sugar Random\nLFT"} className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as OrderPriority)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT</option>
          </Select>
        </Field>
        <Field label="Ordered by"><Input value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} placeholder="Doctor name" /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !patientId || !tests.trim()}>{saving ? "Saving…" : "Place Order"}</Button>
      </div>
    </Modal>
  );
}

function ResultModal({ order, onClose, onSaved }: { order: HospitalLabOrder; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(order.result_value ?? "");
  const [unit, setUnit] = useState(order.unit ?? "");
  const [range, setRange] = useState(order.ref_range ?? "");
  const [flag, setFlag] = useState<"N" | "H" | "L">(order.flag ?? "N");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await hospitalLabRepo.update(order.id, {
        result_value: value.trim(),
        unit: unit.trim() || null,
        ref_range: range.trim() || null,
        flag,
        status: "reported",
        reported_at: now(),
      });
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Result: ${order.test_name}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="Result *"><Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></Field>
        <Field label="Unit"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="mg/dL" /></Field>
        <Field label="Reference Range"><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="70-140" /></Field>
        <Field label="Flag">
          <Select value={flag} onChange={(e) => setFlag(e.target.value as "N" | "H" | "L")}>
            <option value="N">Normal</option>
            <option value="H">High</option>
            <option value="L">Low</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !value.trim()}>{saving ? "Saving…" : "Save Result"}</Button>
      </div>
    </Modal>
  );
}
