"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import {
  admissionConfirmScope, listAdmissionRequests, confirmAdmission, declineAdmission, type AdmissionRequestRow, type ConfirmScope,
} from "@/lib/repo/hospitalCare";
import type { AdmissionStatus } from "@/lib/types-hospital";

const TABS: { key: AdmissionStatus; label: string }[] = [
  { key: "pending", label: "Waiting" },
  { key: "confirmed", label: "Confirmed" },
  { key: "declined", label: "Not accepted" },
];
const when = (s: string | null) => (s ? s.replace("T", " ").slice(0, 16) : "—");
/** The reason the doctor wrote: the first line of the admission notes. */
const reasonOf = (notes: string | null) => notes?.split("\n")[0]?.replace(/^Admitted( for surgery)?: /, "") ?? "—";

/** Admissions made by a consultant or referred from Emergency wait here for
 * the department's Head Nurse (or the Nursing Superintendent) to confirm. */
export default function AdmissionRequestsPage() {
  const [scope, setScope] = useState<ConfirmScope | null>(null);
  const [tab, setTab] = useState<AdmissionStatus>("pending");
  const [rows, setRows] = useState<AdmissionRequestRow[]>([]);
  const [confirming, setConfirming] = useState<AdmissionRequestRow | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setScope(await admissionConfirmScope());
      setRows(await listAdmissionRequests(tab));
    } catch (e) {
      window.alert(`Could not load admissions: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [tab]);

  async function decline(r: AdmissionRequestRow) {
    const reason = window.prompt(`Not accept ${r.patient_name} into ${r.department}? The doctor can then admit to another department.\nReason (e.g. no bed free):`);
    if (!reason?.trim()) return;
    try {
      await declineAdmission(r.id, reason);
      await reload();
    } catch (e) {
      window.alert(`Could not record it: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const columns: Column<AdmissionRequestRow>[] = [
    { header: "Requested", render: (r) => <span className="tabular-nums">{when(r.created_at)}</span> },
    { header: "Patient", render: (r) => <span><span className="font-medium">{r.patient_name}</span> <span className="text-xs text-neutral-400">{r.mr_no}{r.gender ? ` · ${r.gender}` : ""}</span></span> },
    { header: "From", render: (r) => r.from_episode_no ? <span><span className={`mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.from_type === "emergency" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{r.from_type === "emergency" ? "Emergency" : "OPD"}</span><span className="font-mono text-xs">{r.from_episode_no}</span></span> : "—" },
    { header: "Admitted by", render: (r) => r.doctor_name ?? "—" },
    { header: "Department", render: (r) => r.department ?? "—" },
    { header: "Reason", render: (r) => <span className="whitespace-normal">{reasonOf(r.notes)}{r.surgery_name ? <span className="ml-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Surgery: {r.surgery_name}</span> : null}</span> },
    { header: "Admission", render: (r) => <span className="font-mono text-xs">{r.episode_no}</span> },
    ...(tab === "pending" ? [{
      header: "",
      render: (r: AdmissionRequestRow) => (
        <div className="flex gap-1">
          <Button variant="primary" onClick={() => setConfirming(r)}><CheckCircle2 size={13} className="mr-1" />Confirm</Button>
          <Button variant="ghost" onClick={() => void decline(r)}><XCircle size={13} className="mr-1" />Not accept</Button>
        </div>
      ),
    }] : [{
      header: tab === "confirmed" ? "Ward / bed · confirmed by" : "Decided by",
      render: (r: AdmissionRequestRow) => (
        <span className="text-xs">{tab === "confirmed" ? `${r.room_ward ?? "—"} / ${r.bed_no ?? "—"} · ` : ""}{r.confirmed_by_name ?? "—"} · {when(r.admission_confirmed_at)}</span>
      ),
    }]),
  ];

  const noScope = scope && !scope.all && !scope.department;
  return (
    <div>
      <PageHeader
        title="Admission Requests"
        actions={
          <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`px-3 py-1.5 ${tab === t.key ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>{t.label}</button>
            ))}
          </div>
        }
      />
      {scope && !noScope && (
        <p className="mb-3 text-xs text-neutral-500">
          {scope.all ? "All departments (Nursing Superintendent / administrator)." : `Admissions to ${scope.department}: confirm the ones the department can take and allot the bed.`}
        </p>
      )}
      {noScope ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Admissions are confirmed by the Head Nurse of the department or the Nursing Superintendent. In HR, give your staff record the designation Head Nurse with your department.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}
      {confirming && <ConfirmModal row={confirming} onClose={() => setConfirming(null)} onDone={() => { setConfirming(null); void reload(); }} />}
    </div>
  );
}

function ConfirmModal({ row, onClose, onDone }: { row: AdmissionRequestRow; onClose: () => void; onDone: () => void }) {
  const [wardRoom, setWardRoom] = useState(row.room_ward ?? "");
  const [bedNo, setBedNo] = useState(row.bed_no ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await confirmAdmission(row.id, { wardRoom, bedNo });
      onDone();
    } catch (e) {
      window.alert(`Could not confirm: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Confirm admission · ${row.patient_name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-600">
          {row.episode_no} to <b>{row.department}</b>{row.doctor_name ? `, admitted by ${row.doctor_name}` : ""}. Reason: {reasonOf(row.notes)}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Ward / room *"><Input id="confirm-ward" value={wardRoom} onChange={(e) => setWardRoom(e.target.value)} placeholder="e.g. Surgical ward" autoFocus /></Field>
          <Field label="Bed no *"><Input id="confirm-bed" value={bedNo} onChange={(e) => setBedNo(e.target.value)} placeholder="e.g. 12" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !wardRoom.trim() || !bedNo.trim()}>{saving ? "Confirming…" : "Confirm admission"}</Button>
        </div>
      </div>
    </Modal>
  );
}
