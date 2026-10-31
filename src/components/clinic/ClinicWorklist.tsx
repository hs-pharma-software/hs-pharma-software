"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import {
  listClinicWork, markClinicOrderStarted, enterClinicLabResult, reportClinicRadiology, cancelClinicOrder, type ClinicWorkRow,
} from "@/lib/repo/clinicServices";
import { ClinicReportModal } from "./ClinicPrints";

const STATUS: Record<string, { label: string; cls: string }> = {
  ordered: { label: "Ordered", cls: "bg-sky-100 text-sky-800" },
  collected: { label: "Sample collected", cls: "bg-amber-100 text-amber-800" },
  performed: { label: "Done, to report", cls: "bg-amber-100 text-amber-800" },
  reported: { label: "Reported", cls: "bg-emerald-100 text-emerald-700" },
};

/** The clinic's lab or radiology work: tests ordered from consultations,
 * sample / examination, result or report entry, and the printed report. */
export function ClinicWorklist({ kind }: { kind: "lab" | "radiology" }) {
  const [view, setView] = useState<"pending" | "reported">("pending");
  const [rows, setRows] = useState<ClinicWorkRow[]>([]);
  const [search, setSearch] = useState("");
  const [entering, setEntering] = useState<ClinicWorkRow | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);

  async function reload() {
    if (isTauri()) setRows(await listClinicWork(kind, view));
  }
  useEffect(() => { void reload().catch((e) => window.alert(e instanceof Error ? e.message : String(e))); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>) {
    try { await fn(); await reload(); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); }
  }

  const term = search.trim().toLowerCase();
  const shown = rows.filter((r) => !term || `${r.patient_name} ${r.mrn ?? ""} ${r.name} ${r.order_no}`.toLowerCase().includes(term));
  const lab = kind === "lab";

  const columns: Column<ClinicWorkRow>[] = [
    { header: "Order", render: (r) => <span className="font-mono text-xs">{r.order_no}</span> },
    { header: "Patient", render: (r) => <span><span className="font-medium">{r.patient_name}</span> <span className="text-xs text-neutral-500">{r.mrn ?? ""}</span></span> },
    { header: lab ? "Test" : "Study", render: (r) => r.name },
    { header: "Doctor", render: (r) => (r.doctor_name ? `Dr. ${r.doctor_name}` : "—") },
    { header: "Ordered", render: (r) => r.ordered_at },
    { header: "Priority", render: (r) => <span className={`text-xs font-semibold uppercase ${r.priority === "routine" ? "text-neutral-500" : "text-rose-700"}`}>{r.priority}</span> },
    { header: lab ? "Result" : "Impression", render: (r) => (lab ? (r.result_value ? `${r.result_value} ${r.unit ?? ""}${r.flag && r.flag !== "N" ? ` (${r.flag})` : ""}` : "—") : r.impression ?? "—") },
    { header: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span> },
    {
      header: "",
      render: (r) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === "ordered" && <Button variant="ghost" onClick={() => void run(() => markClinicOrderStarted(r.id))}>{lab ? "Sample collected" : "Done"}</Button>}
          {r.status !== "reported" && <Button variant="secondary" onClick={() => setEntering(r)}>{lab ? "Enter result" : "Report"}</Button>}
          {r.status === "reported" && <Button variant="ghost" onClick={() => setPrinting(r.id)}><FileText size={14} />Report</Button>}
          {r.status !== "reported" && !r.invoice_id && (
            <Button variant="ghost" onClick={() => { if (window.confirm(`Cancel ${r.name} for ${r.patient_name}?`)) void run(() => cancelClinicOrder(r.id)); }}>Cancel</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={lab ? "Lab" : "Radiology"} actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {(["pending", "reported"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
              {v === "pending" ? "To do" : "Reported"}
            </button>
          ))}
        </div>
        <Input id={`${kind}-search`} className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, MRN, test…" />
      </div>
      <DataTable columns={columns} rows={shown} emptyMessage={view === "pending" ? `Nothing to do. ${lab ? "Tests" : "Studies"} ordered in consultations appear here.` : "Nothing reported yet."} />
      {entering && (lab
        ? <LabResultModal row={entering} onClose={() => setEntering(null)} onSaved={() => { setEntering(null); void reload(); }} />
        : <RadiologyReportForm row={entering} onClose={() => setEntering(null)} onSaved={() => { setEntering(null); void reload(); }} />)}
      {printing && <ClinicReportModal orderId={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

function LabResultModal({ row, onClose, onSaved }: { row: ClinicWorkRow; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(row.result_value ?? "");
  const [unit, setUnit] = useState(row.unit ?? "");
  const [range, setRange] = useState(row.ref_range ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await enterClinicLabResult(row.id, { value, unit, refRange: range }); onSaved(); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Result: ${row.name}`} onClose={onClose} width="max-w-md">
      <p className="mb-3 text-sm text-neutral-600">{row.patient_name}{row.gender ? ` · ${row.gender}` : ""} · {row.order_no}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Result" required><Input id="lr-value" value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></Field></div>
        <Field label="Unit"><Input id="lr-unit" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        <Field label="Normal range"><Input id="lr-range" value={range} onChange={(e) => setRange(e.target.value)} /></Field>
      </div>
      <p className="mt-2 text-xs text-neutral-500">High / low is marked from the normal range and the patient&apos;s sex.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !value.trim()}>{saving ? "Saving…" : "Save result"}</Button>
      </div>
    </Modal>
  );
}

function RadiologyReportForm({ row, onClose, onSaved }: { row: ClinicWorkRow; onClose: () => void; onSaved: () => void }) {
  const [findings, setFindings] = useState(row.findings ?? "");
  const [impression, setImpression] = useState(row.impression ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await reportClinicRadiology(row.id, { findings, impression }); onSaved(); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Report: ${row.name}`} onClose={onClose} width="max-w-xl">
      <p className="mb-3 text-sm text-neutral-600">{row.patient_name} · {row.order_no}</p>
      <div className="flex flex-col gap-3">
        <Field label="Findings"><Textarea id="rr-findings" rows={7} value={findings} onChange={(e) => setFindings(e.target.value)} /></Field>
        <Field label="Impression" required><Textarea id="rr-impression" rows={3} value={impression} onChange={(e) => setImpression(e.target.value)} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !impression.trim()}>{saving ? "Saving…" : "Save report"}</Button>
      </div>
    </Modal>
  );
}
