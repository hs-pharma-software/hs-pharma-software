"use client";

import { useEffect, useMemo, useState } from "react";
import { Siren } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { localDateTime } from "@/lib/localDate";
import {
  episodeTriage, recordTriage, markSeenByDoctor, recordDisposition, mlcForEpisode, registerMlc, recordPoliceIntimation, recordMlcExamination, issueMlcReport, closeMlc,
} from "@/lib/repo/emergency";
import { suggestTriage, triageLevel, TRIAGE_LEVELS, DISPOSITIONS, MLC_NATURES, type Disposition } from "@/config/quality";
import { fmtWhen } from "./FormEditor";
import { err } from "../quality/SafetyModals";
import type { ErTriage, HospitalEpisode, MlcCase } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
export const levelPill = (n: number | null | undefined) => {
  const l = triageLevel(n);
  return l ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${l.cls}`}>{l.label}</span> : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">Not triaged</span>;
};

/** Emergency visit: triage, door-to-doctor, disposition and the MLC (MSDS COP-1, ROM-5). */
export function EmergencyPanel({ episode }: { episode: HospitalEpisode }) {
  const [triage, setTriage] = useState<ErTriage[]>([]);
  const [mlc, setMlc] = useState<MlcCase | null>(null);
  const [modal, setModal] = useState<"triage" | "dispo" | "mlc" | null>(null);
  const load = async () => {
    try { setTriage(await episodeTriage(episode.id)); setMlc(await mlcForEpisode(episode.id)); } catch { /* the panel stays empty */ }
  };
  useEffect(() => { void load(); }, [episode.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => { setModal(null); void load(); };
  const latest = triage[triage.length - 1] ?? null;
  const seen = triage.find((t) => t.seen_at) ?? null;
  const dispo = triage.find((t) => t.disposition) ?? null;
  const open = episode.status === "open";
  const seeNow = async () => { try { await markSeenByDoctor(episode.id); void load(); } catch (e) { err(e); } };

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700"><Siren size={14} className="text-rose-600" />Emergency</h2>
        <div className="flex flex-wrap gap-1">
          {open && !dispo && <Button variant="ghost" onClick={() => setModal("triage")}>{latest ? "Re-triage" : "Triage"}</Button>}
          {open && latest && !seen && !dispo && <Button variant="ghost" onClick={seeNow}>Seen by me (doctor)</Button>}
          {open && latest && !dispo && <Button variant="ghost" onClick={() => setModal("dispo")}>Disposition</Button>}
          <Button variant="ghost" onClick={() => setModal("mlc")}>{mlc ? `MLC ${mlc.mlc_no}` : "Register MLC"}</Button>
        </div>
      </div>
      {!latest ? <p className="text-sm text-neutral-400">Not triaged yet.</p> : (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {levelPill(latest.level)}
            <span className="text-neutral-700">{latest.chief_complaint}</span>
          </div>
          {triage.map((t) => (
            <p key={t.id} className="text-xs text-neutral-500">
              {fmtWhen(t.triaged_at)} · {t.triaged_by_name} · P {t.pulse} · BP {t.sbp}{t.dbp ? `/${t.dbp}` : ""} · RR {t.rr} · SpO₂ {t.spo2}% · GCS {t.gcs}
              {t.temp_c != null ? ` · ${t.temp_c} °C` : ""}{t.pain != null ? ` · pain ${t.pain}/10` : ""} · level {t.level}
              {t.override_reason ? <span className="text-amber-700"> (suggested {t.suggested_level}: {t.override_reason})</span> : null}
            </p>
          ))}
          <p className="text-xs text-neutral-600">{seen ? <>Seen by {seen.seen_by_name} at {fmtWhen(seen.seen_at)}</> : <span className="text-amber-700">Waiting for a doctor</span>}</p>
          {dispo && <p className="text-xs font-medium text-neutral-700">{DISPOSITIONS[dispo.disposition as Disposition] ?? dispo.disposition} · {fmtWhen(dispo.disposition_at)} · {dispo.disposition_by_name}</p>}
        </div>
      )}
      {mlc && <p className="mt-2 text-xs text-neutral-600">Medico-legal case <b className="font-mono">{mlc.mlc_no}</b> · {mlc.nature} · {mlc.status === "open" ? (mlc.police_informed_at ? "police informed" : <span className="text-rose-700">police not yet informed</span>) : mlc.status === "report_issued" ? "report issued" : "closed"}</p>}
      {modal === "triage" && <TriageModal episode={episode} onClose={() => setModal(null)} onSaved={done} />}
      {modal === "dispo" && <DispositionModal episode={episode} onClose={() => setModal(null)} onSaved={done} />}
      {modal === "mlc" && <MlcModal episode={episode} mlc={mlc} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

function TriageModal({ episode, onClose, onSaved }: { episode: HospitalEpisode; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ chiefComplaint: episode.complaint ?? "", pulse: "", sbp: "", dbp: "", rr: "", spo2: "", gcs: "15", tempC: "", pain: "", level: "", overrideReason: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const ready = ["pulse", "sbp", "rr", "spo2", "gcs"].every((k) => v[k as keyof typeof v].trim() !== "");
  const suggested = useMemo(() => (ready ? suggestTriage({ pulse: Number(v.pulse), sbp: Number(v.sbp), rr: Number(v.rr), spo2: Number(v.spo2), gcs: Number(v.gcs), temp_c: num(v.tempC), pain: num(v.pain) }) : null), [v, ready]);
  const chosen = v.level ? Number(v.level) : suggested?.level ?? null;
  const under = suggested && chosen && chosen > suggested.level && suggested.level <= 3;
  const save = async () => {
    setSaving(true);
    try {
      await recordTriage(episode.id, {
        chiefComplaint: v.chiefComplaint, pulse: Number(v.pulse), sbp: Number(v.sbp), dbp: num(v.dbp), rr: Number(v.rr), spo2: Number(v.spo2), gcs: Number(v.gcs),
        tempC: num(v.tempC), pain: num(v.pain), level: v.level ? Number(v.level) : null, overrideReason: v.overrideReason, notes: v.notes,
      });
      onSaved();
    } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title="Triage" onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Presenting complaint" required><Input id="tr-cc" value={v.chiefComplaint} onChange={set("chiefComplaint")} /></Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Pulse /min" required><Input id="tr-p" inputMode="numeric" value={v.pulse} onChange={set("pulse")} /></Field>
          <Field label="Systolic BP" required><Input id="tr-sbp" inputMode="numeric" value={v.sbp} onChange={set("sbp")} /></Field>
          <Field label="Diastolic BP"><Input id="tr-dbp" inputMode="numeric" value={v.dbp} onChange={set("dbp")} /></Field>
          <Field label="Resp. rate /min" required><Input id="tr-rr" inputMode="numeric" value={v.rr} onChange={set("rr")} /></Field>
          <Field label="SpO₂ %" required><Input id="tr-spo2" inputMode="numeric" value={v.spo2} onChange={set("spo2")} /></Field>
          <Field label="GCS (3-15)" required><Input id="tr-gcs" inputMode="numeric" value={v.gcs} onChange={set("gcs")} /></Field>
          <Field label="Temp °C"><Input id="tr-t" inputMode="decimal" value={v.tempC} onChange={set("tempC")} /></Field>
          <Field label="Pain 0-10"><Input id="tr-pain" inputMode="numeric" value={v.pain} onChange={set("pain")} /></Field>
        </div>
        {suggested && (
          <p className="rounded-xl bg-neutral-50 px-3 py-2 text-sm">
            Vital signs suggest {levelPill(suggested.level)} {suggested.reasons.length ? <span className="text-xs text-neutral-500">({suggested.reasons.join(", ")})</span> : null}
          </p>
        )}
        <Field label="Triage level (your decision)">
          <Select id="tr-level" value={v.level} onChange={set("level")}>
            <option value="">{suggested ? `As suggested (level ${suggested.level})` : "Enter the vital signs first"}</option>
            {TRIAGE_LEVELS.map((l) => <option key={l.level} value={l.level}>{l.label} (doctor within {l.targetMin ? `${l.targetMin} min` : "immediately"})</option>)}
          </Select>
        </Field>
        {under && <Field label="Reason for a less urgent level" required><Textarea id="tr-why" rows={2} value={v.overrideReason} onChange={set("overrideReason")} /></Field>}
        <Field label="Notes"><Textarea id="tr-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving} onClick={save}>Save triage</Button></div>
    </Modal>
  );
}

function DispositionModal({ episode, onClose, onSaved }: { episode: HospitalEpisode; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Disposition | "">("");
  const [notes, setNotes] = useState("");
  const save = async () => {
    if (!d) return window.alert("Choose the disposition.");
    try { await recordDisposition(episode.id, d, notes); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title="Disposition from emergency" onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        <Field label="Outcome" required>
          <Select id="dp-d" value={d} onChange={(e) => setD(e.target.value as Disposition)}><option value="">Choose…</option>{Object.entries(DISPOSITIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        <Field label="Notes"><Textarea id="dp-n" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={d === "lama" ? "Risks explained, who signed the LAMA form" : d === "referred" ? "Hospital referred to and the reason" : d === "died" ? "Time and cause of death" : ""} /></Field>
        {d === "admitted" && <p className="text-xs text-neutral-500">Use Admit on this visit to send the admission request to the department.</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record</Button></div>
    </Modal>
  );
}

export function MlcModal({ episode, mlc, onClose, onSaved }: { episode: HospitalEpisode | null; mlc: MlcCase | null; onClose: () => void; onSaved: () => void }) {
  const [reg, setReg] = useState({ nature: "", broughtBy: "", history: "" });
  const [pol, setPol] = useState({ station: mlc?.police_station ?? "", informedAt: (mlc?.police_informed_at ?? localDateTime()).replace(" ", "T").slice(0, 16), officer: mlc?.police_officer ?? "", ref: mlc?.police_ref ?? "" });
  const [ex, setEx] = useState({ injuries: mlc?.injuries ?? "", opinion: mlc?.opinion ?? "", samples: mlc?.samples ?? "", samplesHandedTo: mlc?.samples_handed_to ?? "" });
  const [issuedTo, setIssuedTo] = useState("");
  const run = async (f: () => Promise<unknown>) => { try { await f(); onSaved(); } catch (e) { err(e); } };

  if (!mlc) {
    return (
      <Modal title="Register a medico-legal case" onClose={onClose}>
        <div className="grid gap-3">
          <Field label="Nature of the case" required><Select id="mlc-n" value={reg.nature} onChange={(e) => setReg({ ...reg, nature: e.target.value })}><option value="">Choose…</option>{MLC_NATURES.map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label="Brought by"><Input id="mlc-b" value={reg.broughtBy} placeholder="Rescue 1122, relative, police" onChange={(e) => setReg({ ...reg, broughtBy: e.target.value })} /></Field>
          <Field label="History as given"><Textarea id="mlc-h" rows={3} value={reg.history} onChange={(e) => setReg({ ...reg, history: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => episode && run(() => registerMlc(episode.id, reg))}>Register</Button></div>
      </Modal>
    );
  }
  const locked = mlc.status !== "open";
  return (
    <Modal title={`Medico-legal case ${mlc.mlc_no}`} onClose={onClose}>
      <p className="mb-3 text-sm text-neutral-600">{mlc.nature} · arrived {fmtWhen(mlc.arrived_at)}{mlc.brought_by ? ` · brought by ${mlc.brought_by}` : ""} · registered by {mlc.registered_by_name}</p>
      <div className="flex flex-col gap-4">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">1. Police informed</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Police station" required><Input id="mlc-ps" disabled={locked} value={pol.station} onChange={(e) => setPol({ ...pol, station: e.target.value })} /></Field>
            <Field label="Informed at" required><Input id="mlc-pt" type="datetime-local" disabled={locked} value={pol.informedAt} onChange={(e) => setPol({ ...pol, informedAt: e.target.value })} /></Field>
            <Field label="Officer"><Input id="mlc-po" disabled={locked} value={pol.officer} onChange={(e) => setPol({ ...pol, officer: e.target.value })} /></Field>
            <Field label="Rapat / DD number"><Input id="mlc-pr" disabled={locked} value={pol.ref} onChange={(e) => setPol({ ...pol, ref: e.target.value })} /></Field>
          </div>
          {mlc.police_informed_at && <p className="mt-1 text-xs text-neutral-500">Recorded by {mlc.police_informed_by_name}</p>}
          {!locked && <div className="mt-2"><Button onClick={() => run(() => recordPoliceIntimation(mlc.id, { ...pol, informedAt: pol.informedAt.replace("T", " ") }))}>Save police intimation</Button></div>}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">2. Examination (doctor)</h3>
          <div className="grid gap-2">
            <Field label="Injuries / findings" required><Textarea id="mlc-inj" rows={3} disabled={locked} value={ex.injuries} onChange={(e) => setEx({ ...ex, injuries: e.target.value })} /></Field>
            <Field label="Opinion (nature of injury, weapon)"><Textarea id="mlc-op" rows={2} disabled={locked} value={ex.opinion} onChange={(e) => setEx({ ...ex, opinion: e.target.value })} /></Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Samples / evidence preserved"><Input id="mlc-s" disabled={locked} value={ex.samples} onChange={(e) => setEx({ ...ex, samples: e.target.value })} /></Field>
              <Field label="Handed to (chain of custody)"><Input id="mlc-sh" disabled={locked} value={ex.samplesHandedTo} onChange={(e) => setEx({ ...ex, samplesHandedTo: e.target.value })} /></Field>
            </div>
          </div>
          {mlc.examined_at && <p className="mt-1 text-xs text-neutral-500">Examined by {mlc.examined_by_name}, {fmtWhen(mlc.examined_at)}</p>}
          {!locked && <div className="mt-2"><Button onClick={() => run(() => recordMlcExamination(mlc.id, ex))}>Save examination</Button></div>}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">3. Report</h3>
          {mlc.status === "open" ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-60 flex-1"><Field label="Issued to (officer, rank, police station)"><Input id="mlc-to" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} /></Field></div>
              <Button variant="primary" onClick={() => run(() => issueMlcReport(mlc.id, issuedTo))}>Issue report</Button>
            </div>
          ) : (
            <p className="text-sm text-neutral-700">Issued to {mlc.report_issued_to} by {mlc.report_issued_by_name}, {fmtWhen(mlc.report_issued_at)}{mlc.status === "closed" ? " · case closed" : ""}</p>
          )}
          {mlc.status === "report_issued" && <div className="mt-2"><Button onClick={() => run(() => closeMlc(mlc.id))}>Close case</Button></div>}
        </section>
      </div>
    </Modal>
  );
}
