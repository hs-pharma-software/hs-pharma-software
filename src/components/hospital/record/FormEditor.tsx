"use client";

import { useEffect, useRef, useState } from "react";
import { History, Pencil, Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { printDirect } from "@/lib/print";
import { formDef, visible, type FormData, type FormDef } from "@/config/forms";
import { saveForm, finalizeForm, amendForm, voidForm, listRevisions } from "@/lib/repo/medicalRecord";
import { hospitalHeader } from "@/lib/repo/hospitalCare";
import type { FormRecord, FormRevision, HospitalEpisode, HospitalPatient } from "@/lib/types-hospital";

/** A UTC timestamp as the local value of a date-time box, and back. */
const pad = (n: number) => String(n).padStart(2, "0");
export function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS: Record<FormRecord["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-amber-100 text-amber-800" },
  final: { label: "Signed", cls: "bg-emerald-100 text-emerald-700" },
  amended: { label: "Signed · corrected", cls: "bg-sky-100 text-sky-800" },
  voided: { label: "Void", cls: "bg-neutral-200 text-neutral-500" },
};
export function FormStatusPill({ status }: { status: FormRecord["status"] }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[status].cls}`}>{STATUS[status].label}</span>;
}

/** Form values as stored (datetimes in UTC) from the local values shown. */
function toStored(def: FormDef, values: FormData): FormData {
  const out: FormData = { ...values };
  for (const f of def.fields) {
    if (f.type === "datetime" && out[f.key]) {
      const d = new Date(out[f.key]);
      if (!Number.isNaN(d.getTime())) out[f.key] = d.toISOString();
    }
  }
  return out;
}
function toShown(def: FormDef, values: FormData): FormData {
  const out: FormData = { ...values };
  for (const f of def.fields) if (f.type === "datetime" && out[f.key]) out[f.key] = toLocalInput(out[f.key]);
  return out;
}

export interface FormEditorProps {
  formKey: string;
  patient: HospitalPatient;
  episode: HospitalEpisode | null;
  /** An existing record; absent = a new one. */
  record?: FormRecord | null;
  canFinalize: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Fill in, sign, correct, void and print one medical-record form. */
export function FormEditor({ formKey, patient, episode, record, canFinalize, onClose, onSaved }: FormEditorProps) {
  const def = formDef(formKey)!;
  const [rec, setRec] = useState<FormRecord | null>(record ?? null);
  const [values, setValues] = useState<FormData>(() => toShown(def, record ? JSON.parse(record.data) : {}));
  const [mode, setMode] = useState<"edit" | "view" | "amend" | "void">(record && record.status !== "draft" ? "view" : "edit");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<FormRevision[] | null>(null);
  const [hospital, setHospital] = useState<{ name: string; address: string | null; phone: string | null } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void hospitalHeader().then(setHospital).catch(() => setHospital(null)); }, []);

  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));
  const readOnly = mode === "view" || mode === "void";

  async function act(what: string, fn: () => Promise<FormRecord | void>, close = false) {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await fn();
      if (saved) {
        setRec(saved);
        setValues(toShown(def, JSON.parse(saved.data)));
        setMode(saved.status === "draft" ? "edit" : "view");
        setReason("");
        setHistory(null);
      }
      onSaved();
      if (close) onClose();
    } catch (e) {
      window.alert(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const save = () => act("save", () => saveForm({ formKey, patientId: patient.id, episodeId: episode?.id ?? null, data: toStored(def, values), recordId: rec?.id ?? null }), def.finalOnSave);
  const finalize = () => act("sign", async () => {
    const saved = await saveForm({ formKey, patientId: patient.id, episodeId: episode?.id ?? null, data: toStored(def, values), recordId: rec?.id ?? null });
    return finalizeForm(saved.id);
  });
  const amend = () => act("save the correction", () => amendForm(rec!.id, toStored(def, values), reason));
  const doVoid = () => act("void", () => voidForm(rec!.id, reason), true);

  async function print() {
    try {
      await printDirect("a4", printRef.current);
    } catch (e) {
      window.alert(`Could not print: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const shown = def.fields.filter((f) => visible(f, values));
  return (
    <Modal title={def.title} onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          <span><b className="text-neutral-800">{patient.name}</b> · {patient.mr_no}</span>
          {episode && <span className="font-mono">{episode.episode_no}</span>}
          <span>MSDS {def.msds.join(", ")}</span>
          {rec && <FormStatusPill status={rec.status} />}
          {rec?.finalized_by_name && <span>Signed by {rec.finalized_by_name}, {fmtWhen(rec.finalized_at)}</span>}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((f) => f.type === "heading" ? (
            <p key={f.key} className="border-b border-neutral-200 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 md:col-span-2">{f.label}</p>
          ) : (
            <div key={f.key} className={f.type === "textarea" ? "md:col-span-2" : ""}>
              <Field label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} required={f.required && !readOnly}>
                {readOnly ? (
                  <p className="min-h-[1.5rem] whitespace-pre-line text-sm text-neutral-800">{f.type === "datetime" ? fmtWhen(toStored(def, values)[f.key]) : values[f.key] || "—"}</p>
                ) : f.type === "textarea" ? (
                  <Textarea id={`f-${f.key}`} rows={3} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.type === "select" || f.type === "yesno" ? (
                  <Select id={`f-${f.key}`} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">—</option>
                    {(f.type === "yesno" ? ["Yes", "No"] : f.options!).map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                ) : (
                  <Input id={`f-${f.key}`} type={f.type === "datetime" ? "datetime-local" : f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                    min={f.min} max={f.max} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </Field>
              {f.help && !readOnly && <p className="mt-0.5 text-[11px] text-neutral-400">{f.help}</p>}
            </div>
          ))}
        </div>

        {(mode === "amend" || mode === "void") && (
          <Field label={mode === "amend" ? "Reason for the correction" : "Reason for voiding"} required>
            <Input id="f-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "amend" ? "e.g. Diagnosis confirmed by CT" : "e.g. Written on the wrong patient"} />
          </Field>
        )}

        {history && (
          <div className="rounded-xl border border-neutral-200 p-3 text-xs">
            <p className="mb-1 font-semibold text-neutral-700">History</p>
            <p className="text-neutral-500">Created by {rec?.created_by_name ?? "—"}, {fmtWhen(rec?.created_at)}</p>
            {history.map((h) => (
              <p key={h.id} className="text-neutral-600">
                {fmtWhen(h.created_at)} · {h.action === "finalize" ? "Signed" : h.action === "amend" ? "Corrected" : "Voided"} by {h.user_name}{h.reason ? ` · ${h.reason}` : ""}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 pt-3">
          {rec && <Button variant="ghost" onClick={() => void listRevisions(rec.id).then(setHistory)}><History size={13} className="mr-1" />History</Button>}
          {rec && rec.status !== "draft" && <Button variant="ghost" onClick={() => void print()}><Printer size={13} className="mr-1" />Print</Button>}
          <span className="flex-1" />
          {mode === "edit" && (
            <>
              {!def.finalOnSave && <Button onClick={() => void save()} disabled={busy}>Save draft</Button>}
              {def.finalOnSave
                ? <Button variant="primary" onClick={() => void save()} disabled={busy}>Save entry</Button>
                : <Button variant="primary" onClick={() => void finalize()} disabled={busy || !canFinalize} title={canFinalize ? undefined : "Another designation signs this form"}>Sign</Button>}
              {rec && <Button variant="ghost" onClick={() => setMode("void")}>Discard draft</Button>}
            </>
          )}
          {mode === "view" && rec && rec.status !== "voided" && (
            <>
              <Button onClick={() => setMode("amend")}><Pencil size={13} className="mr-1" />Correct</Button>
              <Button variant="ghost" onClick={() => setMode("void")}>Void</Button>
            </>
          )}
          {mode === "amend" && <><Button variant="ghost" onClick={() => { setMode("view"); setValues(toShown(def, JSON.parse(rec!.data))); }}>Cancel</Button><Button variant="primary" onClick={() => void amend()} disabled={busy || !reason.trim()}>Save correction</Button></>}
          {mode === "void" && <><Button variant="ghost" onClick={() => setMode(rec?.status === "draft" ? "edit" : "view")}>Cancel</Button><Button variant="danger" onClick={() => void doVoid()} disabled={busy || !reason.trim()}>Void</Button></>}
        </div>

        {rec && rec.status !== "draft" && (
          <div className="print-only">
            <div ref={printRef} className="print-area mx-auto w-full max-w-[190mm] bg-white text-[12.5px] text-neutral-900">
              <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-2">
                <div>
                  <p className="text-lg font-bold leading-tight">{hospital?.name ?? "Hospital"}</p>
                  {(hospital?.address || hospital?.phone) && <p className="text-[11px] text-neutral-600">{[hospital?.address, hospital?.phone].filter(Boolean).join(" · ")}</p>}
                </div>
                <div className="text-right">
                  <p className="text-base font-bold">{def.title}</p>
                  <p className="text-[10px] text-neutral-500">Form {def.key} v{rec.form_version} · MSDS {def.msds.join(", ")}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-neutral-300 py-2 text-[11.5px]">
                <p><span className="text-neutral-500">Patient:</span> <b>{patient.name}</b></p>
                <p><span className="text-neutral-500">MR No:</span> <span className="font-mono">{patient.mr_no}</span></p>
                <p><span className="text-neutral-500">Age / Sex:</span> {[patient.age_years != null ? `${patient.age_years} y` : null, patient.gender].filter(Boolean).join(" / ") || "—"}</p>
                {episode && <p><span className="text-neutral-500">{episode.type === "ipd" ? "Admission" : "Visit"}:</span> <span className="font-mono">{episode.episode_no}</span>{episode.department ? ` · ${episode.department}` : ""}</p>}
              </div>
              <table className="mt-2 w-full">
                <tbody>
                  {shown.map((f) => f.type === "heading" ? (
                    <tr key={f.key}><td colSpan={2} className="pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-600">{f.label}</td></tr>
                  ) : (
                    <tr key={f.key} className="border-b border-neutral-100 align-top">
                      <td className="w-[38%] py-1 pr-3 text-neutral-600">{f.label}</td>
                      <td className="whitespace-pre-line py-1">{f.type === "datetime" ? fmtWhen(JSON.parse(rec.data)[f.key]) : (JSON.parse(rec.data)[f.key] ?? "—")}{f.unit && JSON.parse(rec.data)[f.key] ? ` ${f.unit}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-6 grid grid-cols-2 gap-6 text-[11px]">
                <div>
                  <p className="text-neutral-500">Entered by</p>
                  <p><b>{rec.created_by_name}</b> · {fmtWhen(rec.created_at)}</p>
                  <p className="mt-1 text-neutral-500">Signed electronically by</p>
                  <p><b>{rec.finalized_by_name}</b> · {fmtWhen(rec.finalized_at)}</p>
                  {rec.status === "amended" && <p className="mt-1 text-neutral-500">Corrected {rec.revision_no - 1} time(s); last by {rec.updated_by_name}. History kept in the HMS.</p>}
                </div>
                {(def.printSignatures ?? []).map((s) => (
                  <div key={s} className="flex flex-col justify-end">
                    <div className="h-10 border-b border-neutral-500" />
                    <p className="mt-1 text-neutral-600">{s} · date / time</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
