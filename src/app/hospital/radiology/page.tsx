"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hospitalImagingRepo, hospitalPatientsRepo, nextOrderNo, type HospitalImagingOrder, type HospitalPatient } from "@/lib/repo/hospital";
import { canProcess, reportImaging } from "@/lib/repo/hospitalOpd";
import type { OrderPriority } from "@/lib/types-hospital";
import { localDateTime } from "@/lib/localDate";

const MODALITIES = ["X-Ray", "Ultrasound", "CT Scan", "MRI", "Echo", "ECG", "Mammography", "Fluoroscopy"];
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  performed: "bg-blue-100 text-blue-700",
  reported: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-100 text-neutral-500",
};

const now = () => localDateTime();

export default function RadiologyPage() {
  const [rows, setRows] = useState<HospitalImagingOrder[]>([]);
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [filter, setFilter] = useState("pending");
  const [showNew, setShowNew] = useState(false);
  const [reporting, setReporting] = useState<HospitalImagingOrder | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const all = await hospitalImagingRepo.list({ orderBy: "ordered_at DESC" });
    setRows(filter ? all.filter((r) => r.status === filter) : all);
    setPatients(await hospitalPatientsRepo.list({ orderBy: "name ASC" }));
  }
  useEffect(() => { void reload(); }, [filter]);

  const patientName = (id: string) => patients.find((p) => p.id === id)?.name ?? "—";

  const columns: Column<HospitalImagingOrder>[] = [
    { header: "Order No", render: (r) => <span className="font-mono text-xs">{r.order_no}</span> },
    { header: "Patient", render: (r) => <span className="font-medium">{patientName(r.patient_id)}</span> },
    { header: "Modality", render: (r) => r.modality },
    { header: "Body Part", render: (r) => r.body_part ?? "—" },
    { header: "Priority", render: (r) => r.priority },
    { header: "Status", render: (r) => <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</span> },
    { header: "Impression", render: (r) => r.impression ?? "—" },
    {
      header: "",
      render: (r) => (r.status === "reported" || r.status === "cancelled"
        ? null
        : canProcess(r)
          ? <Button variant="ghost" onClick={() => setReporting(r)}>Report</Button>
          : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Awaiting fee Rs {Number(r.fee).toFixed(0)}</span>),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Radiology"
        actions={
          <>
            <div className="flex rounded-lg overflow-hidden border border-neutral-200 text-sm">
              {["pending", "reported", ""].map((s) => (
                <button key={s} type="button" onClick={() => setFilter(s)} className={`px-3 py-1.5 ${filter === s ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                  {s === "pending" ? "Pending" : s === "reported" ? "Reported" : "All"}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setShowNew(true)}><Plus size={14} className="mr-1" />New Imaging Order</Button>
          </>
        }
      />
      <DataTable columns={columns} rows={rows} />
      {showNew && <NewOrder patients={patients} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); void reload(); }} />}
      {reporting && <ReportModal order={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); void reload(); }} />}
    </div>
  );
}

function NewOrder({ patients, onClose, onSaved }: { patients: HospitalPatient[]; onClose: () => void; onSaved: () => void }) {
  const [patientId, setPatientId] = useState("");
  const [modality, setModality] = useState(MODALITIES[0]);
  const [bodyPart, setBodyPart] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("routine");
  const [orderedBy, setOrderedBy] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!patientId) return;
    setSaving(true);
    try {
      await hospitalImagingRepo.create({
        order_no: await nextOrderNo("hospital_imaging_orders"),
        episode_id: null,
        patient_id: patientId,
        modality,
        body_part: bodyPart.trim() || null,
        priority,
        status: "pending",
        findings: null,
        impression: null,
        radiologist: null,
        ordered_by: orderedBy.trim() || null,
        ordered_at: now(),
        reported_at: null,
        notes: null,
      });
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Imaging Order" onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="md:col-span-2">
          <Field label="Patient *">
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">— Select —</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.mr_no})</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Modality">
          <Select value={modality} onChange={(e) => setModality(e.target.value)}>
            {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Body Part / Study"><Input value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} placeholder="Chest PA, Abdomen…" /></Field>
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
        <Button variant="primary" onClick={() => void save()} disabled={saving || !patientId}>{saving ? "Saving…" : "Place Order"}</Button>
      </div>
    </Modal>
  );
}

function ReportModal({ order, onClose, onSaved }: { order: HospitalImagingOrder; onClose: () => void; onSaved: () => void }) {
  const [findings, setFindings] = useState(order.findings ?? "");
  const [impression, setImpression] = useState(order.impression ?? "");
  const [radiologist, setRadiologist] = useState(order.radiologist ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!impression.trim()) return;
    setSaving(true);
    try {
      await reportImaging(order.id, { findings: findings.trim() || null, impression, radiologist: radiologist.trim() || null });
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Report: ${order.modality}${order.body_part ? ` - ${order.body_part}` : ""}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 mb-4">
        <Field label="Findings">
          <textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={4} className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Impression *"><Input value={impression} onChange={(e) => setImpression(e.target.value)} /></Field>
        <Field label="Radiologist"><Input value={radiologist} onChange={(e) => setRadiologist(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !impression.trim()}>{saving ? "Saving…" : "Save Report"}</Button>
      </div>
    </Modal>
  );
}
