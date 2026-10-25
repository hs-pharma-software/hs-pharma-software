"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { localDateTime } from "@/lib/localDate";
import { reportAdr } from "@/lib/repo/medicines";
import { ADR_SERIOUSNESS, ADR_ACTIONS, ADR_OUTCOMES, ADR_CHALLENGE } from "@/config/medicines";
import type { HospitalEpisode } from "@/lib/types-hospital";

const err = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));

/** Report a suspected adverse drug reaction from the patient's visit (pharmacovigilance). */
export function AdrModal({ episode, drug, onClose, onSaved }: { episode: HospitalEpisode; drug?: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    suspectedDrug: drug ?? "", otherDrugs: "", startedOn: "", onsetAt: localDateTime().replace(" ", "T"), reaction: "", serious: false, seriousness: "",
    actionTaken: "", outcome: "", dechallenge: "", rechallenge: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    setSaving(true);
    try {
      await reportAdr({ ...v, episodeId: episode.id, onsetAt: v.onsetAt.replace("T", " "), startedOn: v.startedOn || null });
      onSaved();
    } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title="Report a suspected adverse drug reaction" onClose={onClose}>
      <p className="mb-3 text-xs text-neutral-500">Report even when you are not sure the medicine caused it. The pharmacist assesses it and sends serious reactions to DRAP.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Suspected medicine (name, dose, route)" required><Input id="adr-drug" value={v.suspectedDrug} onChange={set("suspectedDrug")} /></Field>
        <Field label="Started on"><Input id="adr-start" type="date" value={v.startedOn} onChange={set("startedOn")} /></Field>
        <Field label="Reaction started" required><Input id="adr-onset" type="datetime-local" value={v.onsetAt} onChange={set("onsetAt")} /></Field>
        <Field label="Other medicines at the time"><Input id="adr-other" value={v.otherDrugs} onChange={set("otherDrugs")} /></Field>
      </div>
      <div className="mt-3"><Field label="Reaction (signs, symptoms, tests)" required><Textarea id="adr-reaction" rows={3} value={v.reaction} onChange={set("reaction")} /></Field></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input id="adr-serious" type="checkbox" checked={v.serious} onChange={(e) => setV({ ...v, serious: e.target.checked })} />Serious reaction</label>
        {v.serious && <Field label="Why serious" required><Select id="adr-why" value={v.seriousness} onChange={set("seriousness")}><option value="">Choose…</option>{ADR_SERIOUSNESS.map((x) => <option key={x}>{x}</option>)}</Select></Field>}
        <Field label="Action taken"><Select id="adr-action" value={v.actionTaken} onChange={set("actionTaken")}><option value="">—</option>{ADR_ACTIONS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Outcome so far"><Select id="adr-outcome" value={v.outcome} onChange={set("outcome")}><option value="">—</option>{ADR_OUTCOMES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Stopped the medicine: did it improve?"><Select id="adr-de" value={v.dechallenge} onChange={set("dechallenge")}><option value="">—</option>{ADR_CHALLENGE.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Given again: did it come back?"><Select id="adr-re" value={v.rechallenge} onChange={set("rechallenge")}><option value="">—</option>{ADR_CHALLENGE.map((x) => <option key={x}>{x}</option>)}</Select></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving} onClick={save}>Report</Button></div>
    </Modal>
  );
}
