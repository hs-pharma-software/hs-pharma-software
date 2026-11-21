"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { RadiologyReportModal } from "@/components/hospital/RadiologyReportModal";
import { isTauri } from "@/lib/platform";
import { getRadiologyReport, type RadiologyReport } from "@/lib/repo/radiology";
import {
  listForReporting, listRadiologists, getPortalOrder, dicomIncluded, templatesFor, reportStudy, getPacs, imagesUrl, type PortalOrderRow, type RadiologyTemplate, type RadiologyPacs,
} from "@/lib/repo/radiologyPortal";
import { parseExam, SAFETY_CHECKS } from "@/config/radiologyPortal";
import { Panel, Tabs, PriorityPill, StatusPill, ageGender, errMsg, openImages, imagesMissingReason, useAutoRefresh } from "@/components/hospital/radiology/common";
import { UltrasoundReportForm } from "@/components/hospital/radiology/UltrasoundReportForm";
import { ULTRASOUND_TEMPLATES, isUltrasoundStudy, templateForStudy, ultrasoundTemplate, type UsValues } from "@/config/ultrasoundReports";
import { localDate } from "@/lib/localDate";

type View = "to_report" | "unexamined" | "reported";

interface ReportDraft { patternId: string; values: UsValues; findings: string; impression: string; recommendation: string; note: string }

/** What the doctor has typed, kept in this browser tab until the report is signed. */
const draftKey = (orderId: string) => `radiology-report-draft:${orderId}`;
function readDraft(orderId: string): ReportDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(orderId));
    return raw ? (JSON.parse(raw) as ReportDraft) : null;
  } catch {
    return null;
  }
}
function writeDraft(orderId: string, draft: ReportDraft | null) {
  try {
    if (draft) sessionStorage.setItem(draftKey(orderId), JSON.stringify(draft));
    else sessionStorage.removeItem(draftKey(orderId));
  } catch { /* the report still saves without a draft */ }
}

/** The radiologist's worklist. Opening a study gives the report the whole page. */
export default function ReportingPage() {
  const [view, setView] = useState<View>("to_report");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PortalOrderRow[]>([]);
  const [sel, setSel] = useState<PortalOrderRow | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [pacs, setPacs] = useState<RadiologyPacs | null>(null);
  const [printing, setPrinting] = useState<RadiologyReport | null>(null);

  async function load() {
    if (!isTauri()) return;
    setRows(await listForReporting(view, search));
  }
  const { bar, refresh } = useAutoRefresh(load, 60, { initial: false, paused: Boolean(sel) });
  // One load on opening; typing in the search waits for a pause.
  const firstLoad = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => void refresh(), firstLoad.current ? 0 : 250);
    firstLoad.current = false;
    return () => clearTimeout(t);
  }, [view, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isTauri()) void getPacs().then(setPacs).catch(() => setPacs(null)); }, []);
  // Viewing images from the PACS is part of the plan's DICOM connection.
  const [dicom, setDicom] = useState(false);
  useEffect(() => { if (isTauri()) void dicomIncluded().then(setDicom).catch(() => setDicom(false)); }, []);

  async function print(id: string) {
    try { setPrinting(await getRadiologyReport(id)); } catch (e) { window.alert(errMsg(e)); }
  }

  /** The list carries only what it shows; the full study loads when it is opened. */
  async function open(id: string) {
    if (opening) return;
    setOpening(id);
    try {
      const full = await getPortalOrder(id);
      if (!full) throw new Error("This study is no longer available.");
      setSel(full);
    } catch (e) {
      window.alert(errMsg(e));
    } finally {
      setOpening(null);
    }
  }

  if (sel) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setSel(null)}><ArrowLeft size={14} />Back to list</Button>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">{sel.patient_name}</h1>
          <PriorityPill priority={sel.priority} />
        </div>
        <ReportPanel key={sel.id} order={sel} pacs={pacs} showImages={dicom} onPrint={() => void print(sel.id)}
          onSaved={() => { setSel(null); void refresh(); }} />
        {printing && <RadiologyReportModal report={printing} onClose={() => setPrinting(null)} />}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Reporting</h1>
          <p className="text-sm text-neutral-500">Choose a patient to write the report.</p>
        </div>
        {bar}
      </div>
      <Tabs<View> value={view} onChange={setView} tabs={[
        { key: "to_report", label: "To report" }, { key: "unexamined", label: "Not examined yet" }, { key: "reported", label: "Reported" },
      ]} />
      <Panel>
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input id="rep-search" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, MR number, order or study" aria-label="Search studies" />
        </div>
        {view === "unexamined" && <p className="mb-2 text-xs text-neutral-500">Paid studies the technologist has not completed. Report one directly only where your hospital does not use the technologist step.</p>}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.length === 0 && <p className="py-6 text-center text-sm text-neutral-500 md:col-span-2 xl:col-span-3">{view === "to_report" ? "No studies are waiting for a report." : "Nothing here."}</p>}
          {rows.map((o) => (
            <button key={o.id} type="button" disabled={Boolean(opening)} onClick={() => void open(o.id)}
              className={`rounded-xl px-3 py-2.5 text-left ring-1 transition disabled:cursor-wait ${opening === o.id ? "bg-violet-50 ring-violet-400" : "ring-neutral-200 hover:bg-neutral-50"}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{o.patient_name}</span><PriorityPill priority={o.priority} /></div>
              <div className="text-sm">{o.modality}{o.body_part ? ` · ${o.body_part}` : ""}</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span>{opening === o.id ? "Opening…" : `${o.order_no} · ${(o.performed_at ?? o.ordered_at).slice(0, 16)}`}</span>
                {o.images_received_at ? <span className="text-emerald-700">{o.images_count ?? "?"} images</span> : <StatusPill status={o.status} />}
              </div>
            </button>
          ))}
        </div>
      </Panel>
      {printing && <RadiologyReportModal report={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

function ReportPanel({ order, pacs, showImages, onSaved, onPrint }: { order: PortalOrderRow; pacs: RadiologyPacs | null; showImages: boolean; onSaved: () => void; onPrint: () => void }) {
  const exam = parseExam(order.exam_data, order.clinical_history);
  const reported = order.status === "reported";
  // Anything typed earlier in this tab comes back if the page was left or reloaded.
  const [draft] = useState(() => (reported ? null : readDraft(order.id)));
  const [templates, setTemplates] = useState<RadiologyTemplate[]>([]);
  const [findings, setFindings] = useState(draft?.findings ?? order.findings ?? "");
  const [impression, setImpression] = useState(draft?.impression ?? order.impression ?? "");
  const [radiologist, setRadiologist] = useState(order.radiologist ?? "");
  // The report is signed by the radiologist chosen (blank = the signed-in login).
  const [radiologists, setRadiologists] = useState<string[]>([]);
  useEffect(() => { if (!reported) void listRadiologists().then(setRadiologists).catch(() => setRadiologists([])); }, [reported]);
  const [saving, setSaving] = useState(false);
  // Ultrasound: the doctor fills in the scan's values instead of writing the findings.
  const ultrasound = isUltrasoundStudy(order);
  const [patternId, setPatternId] = useState(draft?.patternId ?? templateForStudy(order)?.id ?? "");
  const [values, setValues] = useState<UsValues>(draft?.values ?? {});
  const [recommendation, setRecommendation] = useState(draft?.recommendation ?? "");
  const [note, setNote] = useState(draft?.note ?? "");
  const pattern = reported ? null : ultrasoundTemplate(patternId);
  const usCtx = { gender: order.gender, reportDate: localDate() };

  const signedRef = useRef(false);
  useEffect(() => {
    if (reported) return;
    const t = setTimeout(() => { if (!signedRef.current) writeDraft(order.id, { patternId, values, findings, impression, recommendation, note }); }, 400);
    return () => clearTimeout(t);
  }, [reported, order.id, patternId, values, findings, impression, recommendation, note]);

  function changePattern(id: string) {
    if (Object.keys(values).length && !window.confirm("Change the report pattern? The values entered so far will be cleared.")) return;
    setValues({});
    setPatternId(id);
  }

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
      await reportStudy(order.id, {
        findings: findings.trim() || null, impression, radiologist,
        structured: pattern ? { template: pattern.id, values, recommendation, note } : null,
      });
      signedRef.current = true;
      writeDraft(order.id, null);
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
        actions={showImages ? <Button variant="secondary" onClick={() => openImages(imagesUrl(order, pacs, order.mr_no), imagesMissingReason(order, Boolean(pacs)))}><ExternalLink size={14} />View images</Button> : undefined}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-neutral-500">Patient</dt><dd className="font-medium">{order.patient_name}</dd></div>
          <div><dt className="text-neutral-500">MR number</dt><dd>{order.mr_no}</dd></div>
          <div><dt className="text-neutral-500">Age / gender</dt><dd>{ageGender(order)}</dd></div>
          <div><dt className="text-neutral-500">Order</dt><dd>{order.order_no}</dd></div>
          <div><dt className="text-neutral-500">Referred by</dt><dd>{order.ordered_by ?? "—"}</dd></div>
          <div><dt className="text-neutral-500">Examined</dt><dd>{order.performed_at ? `${order.performed_at} by ${order.performed_by_name ?? "—"}` : ultrasound ? "By the reporting doctor" : "Not yet"}</dd></div>
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
          {!reported && ultrasound && (
            <Field label="Report pattern">
              <Select id="rep-pattern" value={patternId} onChange={(e) => changePattern(e.target.value)}>
                {ULTRASOUND_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value="">Write the findings as text</option>
              </Select>
            </Field>
          )}
          {!reported && !pattern && (
            <Field label="Template">
              <Select id="rep-template" value="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">{templates.length ? "— Fill from a template —" : "No templates for this study (Radiology › Templates)"}</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          {pattern
            ? <UltrasoundReportForm template={pattern} values={values} onChange={setValues} ctx={usCtx} />
            : <Field label="Findings"><Textarea id="rep-findings" rows={8} value={findings} readOnly={reported} onChange={(e) => setFindings(e.target.value)} /></Field>}
          <Field label={pattern ? "Conclusion" : "Impression"} required><Textarea id="rep-impression" rows={3} value={impression} readOnly={reported} onChange={(e) => setImpression(e.target.value)} /></Field>
          {pattern && <Field label="Recommendation"><Textarea id="rep-recommendation" rows={2} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} /></Field>}
          {pattern && <Field label="Note"><Textarea id="rep-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
          <Field label="Radiologist">
            {!reported && radiologists.length > 0 ? (
              <Select id="rep-radiologist" value={radiologist} onChange={(e) => setRadiologist(e.target.value)}>
                <option value="">— Me (signed-in login) —</option>
                {radiologists.map((r) => <option key={r} value={r}>{r}</option>)}
                {radiologist && !radiologists.includes(radiologist) && <option value={radiologist}>{radiologist}</option>}
              </Select>
            ) : (
              <Input id="rep-radiologist" value={radiologist} readOnly={reported} onChange={(e) => setRadiologist(e.target.value)} placeholder="Blank = your name and designation" />
            )}
          </Field>
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
