"use client";

import { useEffect, useState } from "react";
import { Droplets } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  episodeTransfusions, requestBlood, startTransfusion, finishTransfusion, recordReaction, bedsideCheckers, groupOf, type EpisodeTransfusion,
} from "@/lib/repo/bloodBank";
import { COMPONENTS, REACTION_TYPES, SEVERITIES } from "@/config/bloodBank";
import { fmtWhen } from "./FormEditor";
import type { BbReaction, BbRequest, HospitalEpisode } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const err = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));

/** Blood requests and transfusions of one admission (MSDS COP-2 Ind. 21-25):
 * the doctor requests, the blood bank issues, and the ward records the
 * two-person bedside check, the observations and any reaction. */
export function TransfusionPanel({ episode }: { episode: HospitalEpisode }) {
  const [data, setData] = useState<{ requests: BbRequest[]; issues: EpisodeTransfusion[]; reactions: BbReaction[] }>({ requests: [], issues: [], reactions: [] });
  const [requesting, setRequesting] = useState(false);
  const [starting, setStarting] = useState<EpisodeTransfusion | null>(null);
  const [finishing, setFinishing] = useState<EpisodeTransfusion | null>(null);
  const [reacting, setReacting] = useState<EpisodeTransfusion | null>(null);
  const load = () => episodeTransfusions(episode.id).then(setData).catch(() => undefined);
  useEffect(() => { void load(); }, [episode.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => { setRequesting(false); setStarting(null); setFinishing(null); setReacting(null); void load(); };

  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700"><Droplets size={14} className="text-rose-600" />Blood transfusion</h2>
        {episode.status === "open" && <Button variant="ghost" onClick={() => setRequesting(true)}>Request blood</Button>}
      </div>
      {data.requests.length === 0 && data.issues.length === 0 ? <p className="text-sm text-neutral-400">No blood requested.</p> : (
        <div className="flex flex-col gap-3 text-sm">
          {data.requests.map((r) => (
            <p key={r.id} className="text-xs text-neutral-600">
              {fmtWhen(r.requested_at)} · {r.component} × {r.units_requested} · {r.urgency} · {r.requested_by_name} · <span className={r.status === "open" ? "text-amber-700" : ""}>{r.status === "open" ? "with the blood bank" : r.status}</span>
            </p>
          ))}
          {data.issues.map((i) => {
            const reactions = data.reactions.filter((x) => x.issue_id === i.id);
            return (
              <div key={i.id} className="rounded-xl bg-neutral-50 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b className="font-mono">{i.unit_no}</b> {i.component} {groupOf(i.abo, i.rh)} · expires {i.expires_on} · issued {fmtWhen(i.issued_at)}{i.emergency_release ? <span className="ml-1 font-medium text-rose-700">emergency release ({i.authorized_by})</span> : null}</span>
                  <span className="flex gap-1">
                    {!i.started_at && !i.returned_at && <Button variant="primary" onClick={() => setStarting(i)}>Start</Button>}
                    {i.started_at && !i.ended_at && <Button onClick={() => setFinishing(i)}>Finish</Button>}
                    {i.started_at && <Button variant="danger" onClick={() => setReacting(i)}>Report reaction</Button>}
                  </span>
                </div>
                {i.returned_at && <p className="mt-1 text-neutral-500">Returned to the blood bank {fmtWhen(i.returned_at)}: {i.return_reason}</p>}
                {i.started_at && <p className="mt-1">Started {fmtWhen(i.started_at)} · checked by {i.check_by_1} and {i.check_by_2} · before: {i.vitals_pre}</p>}
                {i.ended_at && <p>15 min: {i.vitals_15min} · end: {i.vitals_end} · {i.volume_ml} mL · {i.outcome} · {fmtWhen(i.ended_at)}</p>}
                {reactions.map((x) => <p key={x.id} className="font-medium text-rose-700">Reaction {fmtWhen(x.onset_at)}: {x.reaction_type} ({x.severity}). {x.actions}</p>)}
              </div>
            );
          })}
        </div>
      )}
      {requesting && <RequestModal episode={episode} onClose={() => setRequesting(false)} onDone={done} />}
      {starting && <StartModal issue={starting} onClose={() => setStarting(null)} onDone={done} />}
      {finishing && <FinishModal issue={finishing} onClose={() => setFinishing(null)} onDone={done} />}
      {reacting && <ReactionModal issue={reacting} onClose={() => setReacting(null)} onDone={done} />}
    </div>
  );
}

function RequestModal({ episode, onClose, onDone }: { episode: HospitalEpisode; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ component: "Packed red cells", units: "1", urgency: "Routine", indication: "" });
  async function save() {
    try {
      await requestBlood(episode.id, { component: v.component, units: Number(v.units), urgency: v.urgency as BbRequest["urgency"], indication: v.indication });
      onDone();
    } catch (e) { err(e); }
  }
  return (
    <Modal title="Request blood" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Component" required><Select id="br-comp" value={v.component} onChange={(e) => setV({ ...v, component: e.target.value })}>{COMPONENTS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Units" required><Input id="br-units" type="number" min="1" max="20" value={v.units} onChange={(e) => setV({ ...v, units: e.target.value })} /></Field>
        <Field label="Urgency" required><Select id="br-urg" value={v.urgency} onChange={(e) => setV({ ...v, urgency: e.target.value })}><option>Routine</option><option>Urgent</option><option>Emergency</option></Select></Field>
      </div>
      <div className="mt-3"><Field label="Indication (Hb, bleeding, platelet count…)" required><Input id="br-ind" value={v.indication} onChange={(e) => setV({ ...v, indication: e.target.value })} /></Field></div>
      <p className="mt-2 text-[11px] text-neutral-400">Send the patient&apos;s labelled sample to the blood bank. Before transfusing, sign the Consent for Blood Transfusion in the medical record.</p>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Send request</Button></div>
    </Modal>
  );
}

function StartModal({ issue, onClose, onDone }: { issue: EpisodeTransfusion; onClose: () => void; onDone: () => void }) {
  const [staff, setStaff] = useState<{ id: string; label: string }[]>([]);
  const [v, setV] = useState({ checkBy1: "", checkBy2: "", vitalsPre: "" });
  const [checked, setChecked] = useState({ identity: false, unit: false, expiry: false });
  useEffect(() => { void bedsideCheckers().then(setStaff).catch(err); }, []);
  async function save() {
    try { await startTransfusion(issue.id, v); onDone(); } catch (e) { err(e); }
  }
  const pick = (k: "checkBy1" | "checkBy2", id: string) => (
    <Select id={id} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })}><option value="">— Choose —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
  );
  return (
    <Modal title={`Start transfusion · ${issue.unit_no}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-neutral-600">{issue.component} {groupOf(issue.abo, issue.rh)} · expires {issue.expires_on}</p>
        <div className="flex flex-col gap-1 rounded-xl bg-neutral-50 p-3 text-xs">
          <p className="font-semibold text-neutral-600">At the bedside, both checkers confirm:</p>
          <label className="flex items-center gap-2"><input id="ts-id" type="checkbox" checked={checked.identity} onChange={(e) => setChecked({ ...checked, identity: e.target.checked })} />Patient asked their name; wristband matches the unit label and the issue form</label>
          <label className="flex items-center gap-2"><input id="ts-unit" type="checkbox" checked={checked.unit} onChange={(e) => setChecked({ ...checked, unit: e.target.checked })} />Unit number and blood group match the compatibility label</label>
          <label className="flex items-center gap-2"><input id="ts-exp" type="checkbox" checked={checked.expiry} onChange={(e) => setChecked({ ...checked, expiry: e.target.checked })} />Unit is within expiry, bag intact, no clots or discolouration</label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First checker" required>{pick("checkBy1", "ts-c1")}</Field>
          <Field label="Second checker" required>{pick("checkBy2", "ts-c2")}</Field>
        </div>
        <Field label="Vital signs before starting (BP, pulse, temperature, respiration)" required><Input id="ts-pre" value={v.vitalsPre} onChange={(e) => setV({ ...v, vitalsPre: e.target.value })} placeholder="BP 110/70, P 92, T 37.0, R 18" /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={!checked.identity || !checked.unit || !checked.expiry}>Start transfusion</Button></div>
      </div>
    </Modal>
  );
}

function FinishModal({ issue, onClose, onDone }: { issue: EpisodeTransfusion; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ vitals15: "", vitalsEnd: "", volumeMl: "", outcome: "Completed" });
  async function save() {
    try {
      await finishTransfusion(issue.id, { vitals15: v.vitals15, vitalsEnd: v.vitalsEnd, volumeMl: Number(v.volumeMl), outcome: v.outcome as "Completed" });
      onDone();
    } catch (e) { err(e); }
  }
  return (
    <Modal title={`Finish transfusion · ${issue.unit_no}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Vital signs at 15 minutes" required><Input id="tf-15" value={v.vitals15} onChange={(e) => setV({ ...v, vitals15: e.target.value })} /></Field>
        <Field label="Vital signs at the end" required><Input id="tf-end" value={v.vitalsEnd} onChange={(e) => setV({ ...v, vitalsEnd: e.target.value })} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Volume transfused (mL)" required><Input id="tf-vol" type="number" value={v.volumeMl} onChange={(e) => setV({ ...v, volumeMl: e.target.value })} /></Field>
          <Field label="Outcome" required><Select id="tf-out" value={v.outcome} onChange={(e) => setV({ ...v, outcome: e.target.value })}><option>Completed</option><option>Stopped (reaction)</option><option>Stopped (other)</option></Select></Field>
        </div>
        {v.outcome === "Stopped (reaction)" && <p className="text-xs text-rose-700">Also report the reaction, and send the bag and a fresh sample back to the blood bank.</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  );
}

function ReactionModal({ issue, onClose, onDone }: { issue: EpisodeTransfusion; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ reactionType: "", severity: "", symptoms: "", actions: "" });
  async function save() {
    try { await recordReaction(issue.id, v); onDone(); } catch (e) { err(e); }
  }
  return (
    <Modal title={`Transfusion reaction · ${issue.unit_no}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-rose-700">Stop the transfusion, keep the line open with saline, call the doctor and inform the blood bank.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type of reaction" required><Select id="rx-type" value={v.reactionType} onChange={(e) => setV({ ...v, reactionType: e.target.value })}><option value="">—</option>{REACTION_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Severity" required><Select id="rx-sev" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}><option value="">—</option>{SEVERITIES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        </div>
        <Field label="Signs and symptoms" required><Input id="rx-sym" value={v.symptoms} onChange={(e) => setV({ ...v, symptoms: e.target.value })} /></Field>
        <Field label="Actions taken" required><Input id="rx-act" value={v.actions} onChange={(e) => setV({ ...v, actions: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => void save()}>Report reaction</Button></div>
      </div>
    </Modal>
  );
}
