"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { RadiologyReportModal } from "@/components/hospital/RadiologyReportModal";
import { isTauri } from "@/lib/platform";
import { getRadiologyReport, type RadiologyReport } from "@/lib/repo/radiology";
import {
  listForReporting, templatesFor, reportStudy, getPacs, imagesUrl, type PortalOrderRow, type RadiologyTemplate, type RadiologyPacs,
} from "@/lib/repo/radiologyPortal";
import { parseExam, SAFETY_CHECKS } from "@/config/radiologyPortal";
import { Panel, Tabs, PriorityPill, StatusPill, ageGender, errMsg, openImages, imagesMissingReason, useAutoRefresh } from "@/components/hospital/radiology/common";

type View = "to_report" | "unexamined" | "reported";

/** The radiologist's worklist: examined studies waiting for a report, the
 * technologist's record beside the report form, and report templates. */
export default function ReportingPage() {
  const [view, setView] = useState<View>("to_report");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PortalOrderRow[]>([]);
  const [sel, setSel] = useState<PortalOrderRow | null>(null);
  const [pacs, setPacs] = useState<RadiologyPacs | null>(null);
  const [printing, setPrinting] = useState<RadiologyReport | null>(null);

  async function load() {
    if (!isTauri()) return;
    setRows(await listForReporting(view, search));
  }
  const { bar, refresh } = useAutoRefresh(load, 60);
  useEffect(() => { const t = setTimeout(() => void refresh(), 250); return () => clearTimeout(t); }, [view, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isTauri()) void getPacs().then(setPacs).catch(() => setPacs(null)); }, []);

  async function print(id: string) {
    try { setPrinting(await getRadiologyReport(id)); } catch (e) { window.alert(errMsg(e)); }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Reporting</h1>
          <p className="text-sm text-neutral-500">Report examined studies. Templates fill the findings and impression for you to edit.</p>
        </div>
        {bar}
      </div>
      <Tabs<View> value={view} onChange={(v) => { setView(v); setSel(null); }} tabs={[
        { key: "to_report", label: "To report" }, { key: "unexamined", label: "Not examined yet" }, { key: "reported", label: "Reported" },
      ]} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(360px,1.6fr)]">
        <Panel>
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <Input id="rep-search" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, MR number, order or study" />
          </div>
          {view === "unexamined" && <p className="mb-2 text-xs text-neutral-500">Paid studies the technologist has not completed. Report one directly only where your hospital does not use the technologist step.</p>}
          <div className="flex max-h-[640px] flex-col gap-2 overflow-y-auto">
            {rows.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">{view === "to_report" ? "No examined studies are waiting for a report." : "Nothing here."}</p>}
            {rows.map((o) => (
              <button key={o.id} type="button" onClick={() => setSel(o)}
                className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${sel?.id === o.id ? "bg-violet-50 ring-violet-400" : "ring-neutral-200 hover:bg-neutral-50"}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{o.patient_name}</span><PriorityPill priority={o.priority} /></div>
                <div className="text-sm">{o.modality}{o.body_part ? ` · ${o.body_part}` : ""}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
                  <span>{o.order_no} · {(o.performed_at ?? o.ordered_at).slice(0, 16)}</span>
                  {o.images_received_at ? <span className="text-emerald-700">{o.images_count ?? "?"} images</span> : <StatusPill status={o.status} />}
                </div>
              </button>
            ))}
          </div>
        </Panel>
        {!sel ? (
          <Panel className="flex min-h-[320px] flex-col items-center justify-center text-center text-neutral-500"><FileText size={44} className="mb-3 text-neutral-300" />Select a study to report</Panel>
        ) : (
          <ReportPanel key={sel.id} order={sel} pacs={pacs} onPrint={() => void print(sel.id)}
            onSaved={() => { setSel(null); void refresh(); }} />
        )}
      </div>
      {printing && <RadiologyReportModal report={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

function ReportPanel({ order, pacs, onSaved, onPrint }: { order: PortalOrderRow; pacs: RadiologyPacs | null; onSaved: () => void; onPrint: () => void }) {
  const exam = parseExam(order.exam_data, order.clinical_history);
  const [templates, setTemplates] = useState<RadiologyTemplate[]>([]);
  const [findings, setFindings] = useState(order.findings ?? "");
  const [impression, setImpression] = useState(order.impression ?? "");
  const [radiologist, setRadiologist] = useState(order.radiologist ?? "");
  const [saving, setSaving] = useState(false);
  const reported = order.status === "reported";

  useEffect(() => { void templatesFor(order).then(setTemplates).catch(() => setTemplates([])); }, [order]);

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if ((findings.trim() || impression.trim()) && !window.confirm(`Replace the current text with the template "${t.name}"?`)) return;
    setFindings(t.findings ?? "");
    setImpression(t.impression ?? "");
  }

  async function save() {
    setSaving(true);
    try {
      await reportStudy(order.id, { findings: findings.trim() || null, impression, radiologist });
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const present = SAFETY_CHECKS.filter((c) => exam.safety.checks[c.key]).map((c) => c.label);
  return (
    <div className="flex flex-col gap-4">
      <Panel title={`${order.modality}${order.body_part ? ` · ${order.body_part}` : ""}`}
        actions={<Button variant="secondary" onClick={() => openImages(imagesUrl(order, pacs, order.mr_no), imagesMissingReason(order, Boolean(pacs)))}><ExternalLink size={14} />View images</Button>}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-neutral-500">Patient</dt><dd className="font-medium">{order.patient_name}</dd></div>
          <div><dt className="text-neutral-500">MR number</dt><dd>{order.mr_no}</dd></div>
          <div><dt className="text-neutral-500">Age / gender</dt><dd>{ageGender(order)}</dd></div>
          <div><dt className="text-neutral-500">Order</dt><dd>{order.order_no}</dd></div>
          <div><dt className="text-neutral-500">Referred by</dt><dd>{order.ordered_by ?? "—"}</dd></div>
          <div><dt className="text-neutral-500">Examined</dt><dd>{order.performed_at ? `${order.performed_at} by ${order.performed_by_name ?? "—"}` : "Not yet"}</dd></div>
        </dl>
        {(exam.clinical.history || exam.clinical.indication) && <p className="mt-3 text-sm"><span className="text-neutral-500">Clinical history: </span>{[exam.clinical.history, exam.clinical.indication].filter(Boolean).join(" · ")}</p>}
        {order.performed_at && (
          <div className="mt-3 grid grid-cols-1 gap-1 rounded-xl bg-neutral-50 p-3 text-sm sm:grid-cols-2">
            <div><span className="text-neutral-500">Protocol: </span>{exam.protocol.name || "—"}</div>
            <div><span className="text-neutral-500">Contrast: </span>{exam.protocol.contrast ? `${exam.protocol.contrastAgent || "yes"} ${exam.protocol.contrastVolume ? `${exam.protocol.contrastVolume} ml` : ""}` : "No"}</div>
            <div><span className="text-neutral-500">Position / quality: </span>{[exam.acquisition.position, exam.acquisition.quality].filter(Boolean).join(" · ") || "—"}</div>
            <div><span className="text-neutral-500">Dose: </span>{exam.protocol.dose || "—"}</div>
            {present.length > 0 && <div className="text-rose-700 sm:col-span-2">Safety: {present.join(", ")}</div>}
            {exam.acquisition.techNotes && <div className="sm:col-span-2"><span className="text-neutral-500">Technologist: </span>{exam.acquisition.techNotes}</div>}
            {exam.acquisition.qualityComments && <div className="sm:col-span-2"><span className="text-neutral-500">Quality: </span>{exam.acquisition.qualityComments}</div>}
          </div>
        )}
      </Panel>
      <Panel title="Report" actions={reported ? <Button variant="secondary" onClick={onPrint}><Printer size={14} />Print</Button> : undefined}>
        <div className="flex flex-col gap-3">
          {!reported && (
            <Field label="Template">
              <Select id="rep-template" value="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">{templates.length ? "— Fill from a template —" : "No templates for this study (Radiology › Templates)"}</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Findings"><Textarea id="rep-findings" rows={8} value={findings} readOnly={reported} onChange={(e) => setFindings(e.target.value)} /></Field>
          <Field label="Impression" required><Textarea id="rep-impression" rows={3} value={impression} readOnly={reported} onChange={(e) => setImpression(e.target.value)} /></Field>
          <Field label="Radiologist"><Input id="rep-radiologist" value={radiologist} readOnly={reported} onChange={(e) => setRadiologist(e.target.value)} placeholder="Blank = your name and designation" /></Field>
          {!reported && (
            <div className="flex justify-end">
              <Button variant="primary" disabled={saving || !impression.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Sign and release report"}</Button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
