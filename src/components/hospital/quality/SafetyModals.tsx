"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { localDateTime } from "@/lib/localDate";
import { reportIncident, recordComplaint, notifyCritical, raiseCriticalAlert } from "@/lib/repo/quality";
import {
  INCIDENT_TYPES, OUTCOME_CLASSES, HARM_LEVELS, minimumClass, COMPLAINT_CHANNELS, COMPLAINT_CATEGORIES, COMPLAINT_SEVERITY, NOTIFY_METHODS,
  type OutcomeClass,
} from "@/config/quality";
import type { CriticalAlert, HospitalEpisode } from "@/lib/types-hospital";

export const err = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));
const nowLocal = () => localDateTime().replace(" ", "T");

function Actions({ onClose, onSave, saving, label }: { onClose: () => void; onSave: () => void; saving: boolean; label: string }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={saving} onClick={onSave}>{saving ? "Saving…" : label}</Button>
    </div>
  );
}

/** Any staff member reports an incident, near miss or sentinel event (MSDS CQI-3). */
export function ReportIncidentModal({ episode, onClose, onSaved }: { episode?: HospitalEpisode | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    occurredAt: nowLocal(), location: episode ? [episode.room_ward, episode.bed_no].filter(Boolean).join(" ") || episode.department || "" : "",
    incidentType: "", outcomeClass: "" as OutcomeClass | "", harm: "None", description: "", immediateAction: "", anonymous: false,
  });
  const [saving, setSaving] = useState(false);
  const min = v.incidentType ? minimumClass(v.incidentType, v.harm) : null;
  const save = async () => {
    setSaving(true);
    try {
      await reportIncident({ ...v, outcomeClass: v.outcomeClass as OutcomeClass, occurredAt: v.occurredAt.replace("T", " "), episodeId: episode?.id ?? null, department: episode?.department ?? null });
      onSaved();
    } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title="Report an incident" onClose={onClose}>
      <p className="mb-3 text-xs text-neutral-500">Reporting is non-punitive. Report near misses too: they show where the next harm can happen.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="When it happened" required><Input id="inc-at" type="datetime-local" value={v.occurredAt} onChange={(e) => setV({ ...v, occurredAt: e.target.value })} /></Field>
        <Field label="Where" required><Input id="inc-loc" value={v.location} placeholder="Ward 4, bed 12" onChange={(e) => setV({ ...v, location: e.target.value })} /></Field>
        <Field label="Type" required>
          <Select id="inc-type" value={v.incidentType} onChange={(e) => setV({ ...v, incidentType: e.target.value })}>
            <option value="">Choose…</option>{INCIDENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Harm to the patient" required>
          <Select id="inc-harm" value={v.harm} onChange={(e) => setV({ ...v, harm: e.target.value })}>{HARM_LEVELS.map((h) => <option key={h}>{h}</option>)}</Select>
        </Field>
        <Field label="Outcome" required>
          <Select id="inc-class" value={v.outcomeClass} onChange={(e) => setV({ ...v, outcomeClass: e.target.value as OutcomeClass })}>
            <option value="">Choose…</option>{Object.entries(OUTCOME_CLASSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-600">
          <input id="inc-anon" type="checkbox" checked={v.anonymous} onChange={(e) => setV({ ...v, anonymous: e.target.checked })} />Report without my name
        </label>
      </div>
      {min && <p className="mt-2 text-xs font-medium text-rose-700">This must be recorded as {min === "sentinel" ? "a sentinel event" : "an adverse event"} at least.</p>}
      <div className="mt-3 grid gap-3">
        <Field label="What happened" required><Textarea id="inc-desc" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="Immediate action taken"><Textarea id="inc-act" rows={2} value={v.immediateAction} onChange={(e) => setV({ ...v, immediateAction: e.target.value })} /></Field>
      </div>
      <Actions onClose={onClose} onSave={save} saving={saving} label="Report" />
    </Modal>
  );
}

/** Record a complaint as it is received (MSDS PRE-4). */
export function ComplaintModal({ episode, onClose, onSaved }: { episode?: HospitalEpisode | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ channel: "In person", complainantName: "", complainantPhone: "", relation: "", category: "", severity: "Medium", description: "", department: episode?.department ?? "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await recordComplaint({ ...v, episodeId: episode?.id ?? null }); onSaved(); } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title="Record a complaint" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Complainant" required><Input id="cmp-name" value={v.complainantName} onChange={(e) => setV({ ...v, complainantName: e.target.value })} /></Field>
        <Field label="Phone"><Input id="cmp-phone" value={v.complainantPhone} onChange={(e) => setV({ ...v, complainantPhone: e.target.value })} /></Field>
        <Field label="Relation to the patient"><Input id="cmp-rel" value={v.relation} placeholder="Self, son, husband…" onChange={(e) => setV({ ...v, relation: e.target.value })} /></Field>
        <Field label="Received" required><Select id="cmp-ch" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>{COMPLAINT_CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="About" required>
          <Select id="cmp-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}><option value="">Choose…</option>{COMPLAINT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Severity" required><Select id="cmp-sev" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}>{COMPLAINT_SEVERITY.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        {!episode && <Field label="Department"><Input id="cmp-dept" value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })} /></Field>}
      </div>
      <div className="mt-3"><Field label="The complaint, in the complainant's words" required><Textarea id="cmp-desc" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field></div>
      <Actions onClose={onClose} onSave={save} saving={saving} label="Record" />
    </Modal>
  );
}

/** Record telling the clinician about a critical result, with the read-back (MSDS COP-6). */
export function NotifyCriticalModal({ alert, onClose, onSaved }: { alert: CriticalAlert; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ notifiedTo: "", method: "Phone", readBack: false, actionTaken: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await notifyCritical(alert.id, v); onSaved(); } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title="Record critical result notification" onClose={onClose} width="max-w-lg">
      <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800"><b>{alert.test_name}</b>: {alert.value}</p>
      <div className="grid gap-3">
        <Field label="Told to (name and designation)" required><Input id="crit-to" value={v.notifiedTo} placeholder="Dr Hamid, MO Emergency" onChange={(e) => setV({ ...v, notifiedTo: e.target.value })} /></Field>
        <Field label="How" required><Select id="crit-how" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{NOTIFY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input id="crit-rb" type="checkbox" className="mt-1" checked={v.readBack} onChange={(e) => setV({ ...v, readBack: e.target.checked })} />
          They read the patient&apos;s name, MR number and the result back to me, and it was correct.
        </label>
        <Field label="Action the clinician took"><Textarea id="crit-act" rows={2} value={v.actionTaken} onChange={(e) => setV({ ...v, actionTaken: e.target.value })} /></Field>
      </div>
      <Actions onClose={onClose} onSave={save} saving={saving} label="Record notification" />
    </Modal>
  );
}

/** A critical finding outside the lab's automatic check (radiology, bedside). */
export function RaiseCriticalModal({ episode, onClose, onSaved }: { episode: HospitalEpisode; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ source: "radiology" as "radiology" | "lab" | "other", testName: "", value: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await raiseCriticalAlert({ ...v, episodeId: episode.id }); onSaved(); } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title="Raise a critical result" onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        <Field label="From" required>
          <Select id="rc-src" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as typeof v.source })}>
            <option value="radiology">Radiology</option><option value="lab">Laboratory</option><option value="other">Other (ECG, bedside test)</option>
          </Select>
        </Field>
        <Field label="Test or study" required><Input id="rc-test" value={v.testName} placeholder="CT brain" onChange={(e) => setV({ ...v, testName: e.target.value })} /></Field>
        <Field label="Critical finding" required><Textarea id="rc-val" rows={2} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></Field>
      </div>
      <Actions onClose={onClose} onSave={save} saving={saving} label="Raise" />
    </Modal>
  );
}
