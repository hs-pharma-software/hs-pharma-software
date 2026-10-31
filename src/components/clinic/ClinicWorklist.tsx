"use client";

import { useEffect, useState } from "react";
import { Check, FileText, PencilLine, X } from "lucide-react";
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
import { LabPanelForm } from "@/components/lab/LabPanelForm";
import { panelFor, parseComponents } from "@/config/labPanels";
import type { LabComponent } from "@/lib/types-hospital";

const STATUS: Record<string, { label: string; cls: string }> = {
  ordered: { label: "Ordered", cls: "bg-sky-100 text-sky-800" },
  collected: { label: "Sample collected", cls: "bg-amber-100 text-amber-800" },
  performed: { label: "Done, to report", cls: "bg-amber-100 text-amber-800" },
  reported: { label: "Reported", cls: "bg-emerald-100 text-emerald-700" },
};

/** A small round icon button with its name as a tooltip. */
function IconButton({ title, onClick, tone = "neutral", children }: { title: string; onClick: () => void; tone?: "neutral" | "primary" | "danger"; children: React.ReactNode }) {
  const cls = tone === "primary" ? "bg-neutral-900 text-white hover:bg-neutral-700" : tone === "danger" ? "text-rose-600 hover:bg-rose-50" : "text-neutral-600 hover:bg-neutral-100";
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={`rounded-full p-1.5 transition-colors ${cls}`}>
      {children}
    </button>
  );
}

/** One patient's reported tests of one visit: printed together on one report. */
interface ReportGroup {
  id: string;
  rows: ClinicWorkRow[];
}

function groupReported(rows: ClinicWorkRow[]): ReportGroup[] {
  const groups = new Map<string, ClinicWorkRow[]>();
  for (const r of rows) {
    const key = r.consultation_id || `${r.patient_id}|${r.ordered_at.slice(0, 10)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([id, rs]) => ({ id, rows: rs }));
}

const lastReported = (g: ReportGroup) => g.rows.map((r) => r.reported_at ?? "").sort().at(-1) || "—";

/** The clinic's lab or radiology work: tests ordered from consultations,
 * sample / examination, result or report entry, and the printed report (a
 * visit's tests on one report). */
export function ClinicWorklist({ kind }: { kind: "lab" | "radiology" }) {
  const [view, setView] = useState<"pending" | "reported">("pending");
  const [rows, setRows] = useState<ClinicWorkRow[]>([]);
  const [search, setSearch] = useState("");
  const [entering, setEntering] = useState<ClinicWorkRow | null>(null);
  const [printing, setPrinting] = useState<string[] | null>(null);

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
    { header: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span> },
    {
      header: "",
      render: (r) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {r.status === "ordered" && (
            <IconButton title={lab ? "Sample collected" : "Examination done"} onClick={() => void run(() => markClinicOrderStarted(r.id))}><Check size={15} /></IconButton>
          )}
          <IconButton title={lab ? "Enter result" : "Write report"} tone="primary" onClick={() => setEntering(r)}><PencilLine size={15} /></IconButton>
          {!r.invoice_id && (
            <IconButton title="Cancel" tone="danger" onClick={() => { if (window.confirm(`Cancel ${r.name} for ${r.patient_name}?`)) void run(() => cancelClinicOrder(r.id)); }}><X size={15} /></IconButton>
          )}
        </div>
      ),
    },
  ];

  const reportColumns: Column<ReportGroup>[] = [
    { header: "Patient", render: (g) => <span><span className="font-medium">{g.rows[0].patient_name}</span> <span className="text-xs text-neutral-500">{g.rows[0].mrn ?? ""}</span></span> },
    {
      header: lab ? "Tests" : "Studies",
      render: (g) => (
        <span title={g.rows.map((r) => r.name).join(", ")} className="inline-block max-w-[22rem] truncate align-bottom">
          {g.rows.length > 1 && <span className="mr-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600">{g.rows.length}</span>}
          {g.rows.map((r) => r.name).join(", ")}
        </span>
      ),
    },
    { header: "Doctor", render: (g) => (g.rows[0].doctor_name ? `Dr. ${g.rows[0].doctor_name}` : "—") },
    { header: "Reported", render: (g) => lastReported(g) },
    {
      header: "",
      render: (g) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton title="View / print report" tone="primary" onClick={() => setPrinting(g.rows.map((r) => r.id))}><FileText size={15} /></IconButton>
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
      {view === "pending"
        ? <DataTable columns={columns} rows={shown} emptyMessage={`Nothing to do. ${lab ? "Tests" : "Studies"} ordered in consultations appear here.`} />
        : <DataTable columns={reportColumns} rows={groupReported(shown)} emptyMessage="Nothing reported yet." />}
      {entering && (lab
        ? <LabResultModal row={entering} onClose={() => setEntering(null)} onSaved={() => { setEntering(null); void reload(); }} />
        : <RadiologyReportForm row={entering} onClose={() => setEntering(null)} onSaved={() => { setEntering(null); void reload(); }} />)}
      {printing && <ClinicReportModal orderIds={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

function LabResultModal({ row, onClose, onSaved }: { row: ClinicWorkRow; onClose: () => void; onSaved: () => void }) {
  const panel = panelFor(row.name);
  if (panel) return <PanelResultModal row={row} onClose={onClose} onSaved={onSaved} />;
  return <SingleResultModal row={row} onClose={onClose} onSaved={onSaved} />;
}

/** CBC, LFT, RFT, lipid profile, electrolytes, urine R/E: every parameter. */
function PanelResultModal({ row, onClose, onSaved }: { row: ClinicWorkRow; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  async function save(components: LabComponent[]) {
    setSaving(true);
    try { await enterClinicLabResult(row.id, { value: "", components }); onSaved(); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Result: ${row.name}`} onClose={onClose} width="max-w-3xl">
      <p className="mb-2 text-sm text-neutral-600">{row.patient_name}{row.gender ? ` · ${row.gender}` : ""} · {row.order_no}</p>
      <LabPanelForm panel={panelFor(row.name)!} gender={row.gender} saved={parseComponents(row.components)} saving={saving} onSave={(c) => void save(c)} onCancel={onClose} />
    </Modal>
  );
}

function SingleResultModal({ row, onClose, onSaved }: { row: ClinicWorkRow; onClose: () => void; onSaved: () => void }) {
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
