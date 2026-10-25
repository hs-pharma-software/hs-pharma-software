"use client";

import { useEffect, useState } from "react";
import { FilePlus2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  episodeForms, listVitals, recordVitals, checklistContext, saveChecklist, listChecklistEntries, type VitalsInput,
} from "@/lib/repo/medicalRecord";
import { applicableItems, checklistDef, STATUS_LABEL, type ChecklistAnswer, type ChecklistContext, type ChecklistStatus } from "@/config/forms/checklists";
import { FormEditor, FormStatusPill, fmtWhen } from "./FormEditor";
import type { ChecklistEntry, FormRecord, HospitalEpisode, HospitalPatient, VitalSigns } from "@/lib/types-hospital";
import type { FormDef } from "@/config/forms";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

type FormRow = { def: FormDef; records: FormRecord[]; canCreate: boolean; canFinalize: boolean };

/** The medical-record forms of one visit / admission: which apply, which are
 * written, signed or still missing. */
export function EpisodeRecord({ patient, episode }: { patient: HospitalPatient; episode: HospitalEpisode }) {
  const [rows, setRows] = useState<FormRow[]>([]);
  const [open, setOpen] = useState<{ key: string; record: FormRecord | null; canFinalize: boolean } | null>(null);
  const load = () => episodeForms(episode.id).then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, [episode.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const single = rows.filter((r) => r.def.onePerEpisode);
  const multi = rows.filter((r) => !r.def.onePerEpisode);
  return (
    <div className={card}>
      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Medical record</h2>
      <div className="flex flex-col divide-y divide-neutral-100 text-sm">
        {single.map((r) => {
          const rec = r.records[0] ?? null;
          return (
            <div key={r.def.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium">{r.def.title}</p>
                <p className="text-[11px] text-neutral-400">MSDS {r.def.msds.join(", ")}{rec?.summary ? ` · ${rec.summary}` : ""}</p>
              </div>
              {rec ? (
                <div className="flex items-center gap-2">
                  <FormStatusPill status={rec.status} />
                  <Button variant="ghost" onClick={() => setOpen({ key: r.def.key, record: rec, canFinalize: r.canFinalize })}>Open</Button>
                </div>
              ) : r.canCreate ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">Not written</span>
                  <Button variant="ghost" onClick={() => setOpen({ key: r.def.key, record: null, canFinalize: r.canFinalize })}><FilePlus2 size={13} className="mr-1" />Write</Button>
                </div>
              ) : <span className="text-[11px] text-neutral-400">Not written</span>}
            </div>
          );
        })}
        {multi.map((r) => (
          <div key={r.def.key} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{r.def.title} <span className="text-xs font-normal text-neutral-400">({r.records.length})</span></p>
                <p className="text-[11px] text-neutral-400">MSDS {r.def.msds.join(", ")}</p>
              </div>
              {r.canCreate && <Button variant="ghost" onClick={() => setOpen({ key: r.def.key, record: null, canFinalize: r.canFinalize })}><FilePlus2 size={13} className="mr-1" />New</Button>}
            </div>
            {r.records.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1">
                {r.records.slice().reverse().map((rec) => (
                  <li key={rec.id}>
                    <button type="button" onClick={() => setOpen({ key: r.def.key, record: rec, canFinalize: r.canFinalize })}
                      className="flex w-full flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-neutral-50">
                      <span className="tabular-nums text-neutral-500">{fmtWhen(rec.created_at)}</span>
                      <span className="text-neutral-500">{rec.created_by_name}</span>
                      <span className="min-w-0 flex-1 truncate text-neutral-800">{rec.summary}</span>
                      {rec.status !== "final" && <FormStatusPill status={rec.status} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {open && (
        <FormEditor formKey={open.key} patient={patient} episode={episode} record={open.record} canFinalize={open.canFinalize}
          onClose={() => setOpen(null)} onSaved={() => void load()} />
      )}
    </div>
  );
}

const VITAL_FIELDS: { key: keyof VitalsInput; label: string; unit?: string; step?: string }[] = [
  { key: "bp_systolic", label: "BP sys", unit: "mmHg" }, { key: "bp_diastolic", label: "BP dia", unit: "mmHg" },
  { key: "pulse", label: "Pulse", unit: "/min" }, { key: "resp_rate", label: "Resp", unit: "/min" },
  { key: "temperature_c", label: "Temp", unit: "°C", step: "0.1" }, { key: "spo2", label: "SpO2", unit: "%" },
  { key: "pain_score", label: "Pain", unit: "0–10" }, { key: "blood_sugar", label: "Sugar", unit: "mg/dL" },
];

/** Vital signs chart of a visit / admission (CQI-2 Ind. 105). */
export function VitalsPanel({ episode }: { episode: HospitalEpisode }) {
  const [rows, setRows] = useState<VitalSigns[]>([]);
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = () => listVitals(episode.id).then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, [episode.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    setBusy(true);
    try {
      const input: VitalsInput = { consciousness: v.consciousness, notes: v.notes, recorded_at: v.recorded_at };
      for (const f of VITAL_FIELDS) if (v[f.key]) (input as Record<string, unknown>)[f.key] = Number(v[f.key]);
      await recordVitals(episode.id, input);
      setV({});
      await load();
    } catch (e) {
      window.alert(`Could not record: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const flag = (r: VitalSigns) => [
    r.spo2 != null && r.spo2 < 92 && "SpO2 low", r.pulse != null && (r.pulse > 120 || r.pulse < 50) && "pulse",
    r.bp_systolic != null && (r.bp_systolic < 90 || r.bp_systolic > 180) && "BP", r.temperature_c != null && r.temperature_c >= 38.5 && "fever",
  ].filter(Boolean).join(", ");

  return (
    <div className={card}>
      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Vital signs</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead><tr className="border-b border-neutral-100 text-left text-neutral-500">
            <th className="pb-1.5 pr-2 font-medium">Time</th>
            {VITAL_FIELDS.map((f) => <th key={f.key} className="pb-1.5 pr-2 font-medium">{f.label}</th>)}
            <th className="pb-1.5 pr-2 font-medium">By</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={VITAL_FIELDS.length + 2} className="py-2 text-neutral-400">No readings yet.</td></tr>}
            {rows.map((r) => {
              const f = flag(r);
              return (
                <tr key={r.id} className={`border-b border-neutral-50 tabular-nums ${f ? "bg-rose-50" : ""}`} title={f ? `Check: ${f}` : undefined}>
                  <td className="py-1 pr-2 text-neutral-500">{fmtWhen(r.recorded_at)}</td>
                  {VITAL_FIELDS.map((x) => <td key={x.key} className="py-1 pr-2">{(r as unknown as Record<string, number | null>)[x.key] ?? "—"}</td>)}
                  <td className="py-1 pr-2 text-neutral-500">{r.recorded_by_name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {VITAL_FIELDS.map((f) => (
          <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}>
            <Input id={`v-${f.key}`} type="number" step={f.step ?? "1"} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-52"><Field label="Time taken"><Input id="v-at" type="datetime-local" value={v.recorded_at ?? ""} onChange={(e) => setV({ ...v, recorded_at: e.target.value })} /></Field></div>
        <div className="w-44">
          <Field label="Consciousness">
            <Select id="v-avpu" value={v.consciousness ?? ""} onChange={(e) => setV({ ...v, consciousness: e.target.value })}>
              <option value="">—</option>{["Alert", "Voice", "Pain", "Unresponsive"].map((o) => <option key={o}>{o}</option>)}
            </Select>
          </Field>
        </div>
        <div className="min-w-40 flex-1"><Field label="Notes"><Input id="v-notes" value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field></div>
        <Button variant="primary" onClick={() => void add()} disabled={busy}>Record</Button>
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">Leave the time empty for now. Out-of-range readings are refused; worrying ones are shaded.</p>
    </div>
  );
}

const CHOICES: ChecklistStatus[] = ["completed", "not_completed", "na", "pending"];

/** The visit's safety checks. Every answer is chosen by the clinician; nothing is pre-ticked. */
export function VisitChecklist({ episodeId, checklistKey = "doctor_visit" }: { episodeId: string; checklistKey?: string }) {
  const def = checklistDef(checklistKey)!;
  const [ctx, setCtx] = useState<ChecklistContext | null>(null);
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>({});
  const [entries, setEntries] = useState<ChecklistEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setCtx(await checklistContext(episodeId));
    setEntries(await listChecklistEntries(episodeId));
  };
  useEffect(() => { void load().catch(() => undefined); }, [episodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx) return null;
  const items = applicableItems(def, ctx);
  const set = (item: string, patch: Partial<ChecklistAnswer>) => setAnswers((a) => ({ ...a, [item]: { ...(a[item] ?? { item, status: "" }), ...patch } }));

  async function save() {
    setBusy(true);
    try {
      await saveChecklist(def.key, episodeId, Object.values(answers).filter((a) => a.status));
      setAnswers({});
      await load();
    } catch (e) {
      window.alert(`Could not save the checks: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const sessions = new Map<string, ChecklistEntry[]>();
  for (const e of entries) if (!e.superseded_by) sessions.set(e.session_id, [...(sessions.get(e.session_id) ?? []), e]);
  return (
    <div className={card}>
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-neutral-700"><ShieldCheck size={15} />{def.title}</h2>
      <p className="mb-3 text-[11px] text-neutral-400">Choose what you actually did. A step not done needs the reason. These are your own confirmations, not an audit.</p>
      <div className="flex flex-col gap-2">
        {items.map((i) => {
          const a = answers[i.key];
          const needsReason = a?.status === "not_completed" || (a?.status === "na" && i.mandatory && !i.naExpected);
          return (
            <div key={i.key} className="rounded-lg border border-neutral-100 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">{i.label}{i.mandatory && <span className="text-rose-600"> *</span>}</p>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={i.label}>
                  {CHOICES.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={a?.status === c} onClick={() => set(i.key, { status: c })}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${a?.status === c ? (c === "completed" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : c === "not_completed" ? "border-rose-500 bg-rose-50 text-rose-700" : "border-neutral-500 bg-neutral-100 text-neutral-700") : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"}`}>
                      {STATUS_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
              {needsReason && <Input id={`c-${i.key}`} className="mt-1" value={a?.reason ?? ""} onChange={(e) => set(i.key, { reason: e.target.value })} placeholder="Reason" />}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end"><Button variant="primary" onClick={() => void save()} disabled={busy || Object.keys(answers).length === 0}>Save checks</Button></div>
      {sessions.size > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-2 text-xs">
          <p className="mb-1 font-semibold text-neutral-600">Recorded</p>
          {[...sessions.values()].map((s) => (
            <p key={s[0].session_id} className="text-neutral-600">
              {fmtWhen(s[0].recorded_at)} · {s[0].user_name}: {s.map((e) => `${def.items.find((i) => i.key === e.item_key)?.label.split(" (")[0] ?? e.item_key} ${STATUS_LABEL[e.status].toLowerCase()}${e.reason ? ` (${e.reason})` : ""}`).join("; ")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
