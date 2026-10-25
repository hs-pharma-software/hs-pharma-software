"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  listIncidents, reviewIncident, recordRca, closeIncident, listComplaints, acknowledgeComplaint, resolveComplaint, closeComplaint,
  listCapa, raiseCapa, markCapaDone, verifyCapa, qualityIndicators, type IncidentRow, type ComplaintRow, type CapaRow, type QualityIndicators,
} from "@/lib/repo/quality";
import {
  OUTCOME_CLASSES, HARM_LEVELS, CAPA_SOURCES, COMPLAINT_ACK_DAYS, COMPLAINT_RESOLVE_DAYS, SENTINEL_RCA_DAYS, CRITICAL_NOTIFY_MINUTES,
  type OutcomeClass, type CapaSource,
} from "@/config/quality";
import { ReportIncidentModal, ComplaintModal, err } from "@/components/hospital/quality/SafetyModals";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import type { Capa, Incident } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const pill = (label: string, cls: string) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
const CLASS_CLS: Record<OutcomeClass, string> = {
  near_miss: "bg-sky-100 text-sky-700", no_harm: "bg-neutral-100 text-neutral-600", adverse_event: "bg-amber-100 text-amber-800", sentinel: "bg-rose-600 text-white",
};
const CLASS_SHORT: Record<OutcomeClass, string> = { near_miss: "Near miss", no_harm: "No harm", adverse_event: "Adverse event", sentinel: "Sentinel event" };
const INC_STATUS: Record<Incident["status"], string> = { reported: "Awaiting review", under_review: "Under review", rca: "Root cause analysis", closed: "Closed" };
const CAPA_STATUS: Record<Capa["status"], [string, string]> = {
  open: ["Open", "bg-amber-100 text-amber-800"], done: ["Done, to verify", "bg-sky-100 text-sky-700"], verified: ["Verified effective", "bg-emerald-100 text-emerald-700"],
};
const inDays = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return localDate(x); };

type Tab = "incidents" | "complaints" | "capa" | "indicators";
const TABS: [Tab, string][] = [["incidents", "Incidents"], ["complaints", "Complaints"], ["capa", "Corrective actions"], ["indicators", "Indicators"]];

/** Quality and patient safety (MSDS PRE-4, CQI-3, CQI-4). */
export default function QualityPage() {
  const [tab, setTab] = useState<Tab>("incidents");
  return (
    <div>
      <PageHeader title="Quality & Safety" actions={
        <div className="flex flex-wrap overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {TABS.map(([t, l]) => <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-rose-700 text-white" : "bg-white text-neutral-600"}`}>{l}</button>)}
        </div>
      } />
      {tab === "incidents" && <Incidents />}
      {tab === "complaints" && <Complaints />}
      {tab === "capa" && <CapaList />}
      {tab === "indicators" && <Indicators />}
    </div>
  );
}

// ── Incidents ─────────────────────────────────────────────────────────────

function Incidents() {
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [status, setStatus] = useState<"active" | "" | Incident["status"]>("active");
  const [cls, setCls] = useState<OutcomeClass | "">("");
  const [reporting, setReporting] = useState(false);
  const [open, setOpen] = useState<IncidentRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try {
      const list = await listIncidents({ status, outcomeClass: cls });
      setRows(list);
      setOpen((o) => (o ? list.find((x) => x.id === o.id) ?? null : null));
    } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status, cls]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Status">
          <Select id="inc-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Not closed</option><option value="">All</option>{Object.entries(INC_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Class">
          <Select id="inc-cl" value={cls} onChange={(e) => setCls(e.target.value as OutcomeClass | "")}>
            <option value="">All</option>{Object.entries(CLASS_SHORT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <div className="ml-auto"><Button variant="primary" onClick={() => setReporting(true)}><Plus size={14} />Report incident</Button></div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No incidents.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>No</th><th className={th}>When / where</th><th className={th}>Type</th><th className={th}>Class</th><th className={th}>Status</th><th className={th}>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                  <td className={`${td} font-mono text-xs`}>{r.incident_no}</td>
                  <td className={td}>{fmtWhen(r.occurred_at)}<span className="block text-xs text-neutral-500">{r.location}</span></td>
                  <td className={td}>{r.incident_type}<span className="block text-xs text-neutral-500">Harm: {r.harm}</span></td>
                  <td className={td}>{pill(CLASS_SHORT[r.outcome_class], CLASS_CLS[r.outcome_class])}</td>
                  <td className={td}>{INC_STATUS[r.status]}{r.rca_overdue ? <span className="block text-xs font-medium text-rose-700">RCA overdue (due {r.rca_due_on})</span> : r.status === "rca" && !r.rca_completed_at ? <span className="block text-xs text-neutral-500">RCA due {r.rca_due_on}</span> : null}</td>
                  <td className={`${td} tabular-nums`}>{r.capa_count ? `${r.capa_count} (${r.capa_open} open)` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reporting && <ReportIncidentModal onClose={() => setReporting(false)} onSaved={() => { setReporting(false); void reload(); }} />}
      {open && <IncidentModal incident={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function IncidentModal({ incident: x, onClose, onChanged }: { incident: IncidentRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const [rv, setRv] = useState({ outcomeClass: x.outcome_class as OutcomeClass, harm: x.harm, notes: x.review_notes ?? "", requireRca: x.status === "rca" });
  const [rca, setRca] = useState({ team: x.rca_team ?? "", rootCauses: x.root_causes ?? "", summary: x.rca_summary ?? "" });
  const [capa, setCapa] = useState(false);
  const [actions, setActions] = useState<CapaRow[]>([]);
  const loadCapa = () => listCapa({ source: "incident", sourceId: x.id }).then(setActions).catch(() => undefined);
  useEffect(() => { void loadCapa(); }, [x.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: () => Promise<unknown>) => { try { await f(); await onChanged(); } catch (e) { err(e); } };
  const closed = x.status === "closed";
  return (
    <Modal title={`Incident ${x.incident_no}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <section className="rounded-xl bg-neutral-50 p-3">
          <p className="flex flex-wrap items-center gap-2">{pill(CLASS_SHORT[x.outcome_class], CLASS_CLS[x.outcome_class])}<b>{x.incident_type}</b> · harm {x.harm}</p>
          <p className="mt-1 text-xs text-neutral-500">{fmtWhen(x.occurred_at)} · {x.location}{x.department ? ` · ${x.department}` : ""} · reported {fmtWhen(x.reported_at)} by {x.reporter_name ?? "anonymous"}</p>
          <p className="mt-2 whitespace-pre-wrap">{x.description}</p>
          {x.immediate_action && <p className="mt-1 text-xs text-neutral-600">Immediate action: {x.immediate_action}</p>}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Review</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Class"><Select id="rv-cl" disabled={closed} value={rv.outcomeClass} onChange={(e) => setRv({ ...rv, outcomeClass: e.target.value as OutcomeClass })}>{Object.entries(OUTCOME_CLASSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Harm"><Select id="rv-h" disabled={closed} value={rv.harm} onChange={(e) => setRv({ ...rv, harm: e.target.value })}>{HARM_LEVELS.map((h) => <option key={h}>{h}</option>)}</Select></Field>
          </div>
          <div className="mt-2"><Field label="Review findings"><Textarea id="rv-n" rows={2} disabled={closed} value={rv.notes} onChange={(e) => setRv({ ...rv, notes: e.target.value })} /></Field></div>
          {x.reviewed_at && <p className="mt-1 text-xs text-neutral-500">Reviewed by {x.reviewed_by_name}, {fmtWhen(x.reviewed_at)}</p>}
          {!closed && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {rv.outcomeClass !== "sentinel" && x.status !== "rca" && <label className="flex items-center gap-2 text-xs"><input id="rv-rca" type="checkbox" checked={rv.requireRca} onChange={(e) => setRv({ ...rv, requireRca: e.target.checked })} />Needs a root cause analysis</label>}
              <Button onClick={() => run(() => reviewIncident(x.id, rv))}>Save review</Button>
            </div>
          )}
        </section>
        {x.status === "rca" || x.rca_completed_at ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Root cause analysis {x.rca_due_on ? `· due ${x.rca_due_on}` : ""}</h3>
            <div className="grid gap-2">
              <Field label="RCA team"><Input id="rca-t" disabled={closed} value={rca.team} onChange={(e) => setRca({ ...rca, team: e.target.value })} /></Field>
              <Field label="Root causes"><Textarea id="rca-c" rows={3} disabled={closed} value={rca.rootCauses} onChange={(e) => setRca({ ...rca, rootCauses: e.target.value })} /></Field>
              <Field label="Summary and lessons"><Textarea id="rca-s" rows={2} disabled={closed} value={rca.summary} onChange={(e) => setRca({ ...rca, summary: e.target.value })} /></Field>
            </div>
            {x.rca_completed_at && <p className="mt-1 text-xs text-neutral-500">RCA recorded {fmtWhen(x.rca_completed_at)}</p>}
            {!closed && <div className="mt-2"><Button onClick={() => run(() => recordRca(x.id, rca))}>Save RCA</Button></div>}
          </section>
        ) : null}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Corrective and preventive actions</h3>
            {!closed && <Button variant="ghost" onClick={() => setCapa(true)}>Add action</Button>}
          </div>
          {actions.length === 0 ? <p className="text-xs text-neutral-400">None yet.</p> : actions.map((c) => (
            <p key={c.id} className="flex flex-wrap items-center gap-2 text-xs">{pill(CAPA_STATUS[c.status][0], CAPA_STATUS[c.status][1])}<span className="font-mono">{c.capa_no}</span>{c.action} · {c.owner_name} · due {c.due_on}</p>
          ))}
        </section>
        {closed ? <p className="text-xs text-neutral-500">Closed by {x.closed_by_name}, {fmtWhen(x.closed_at)}</p> : (
          <div className="flex justify-end"><Button variant="primary" onClick={() => run(async () => { await closeIncident(x.id); onClose(); })}>Close incident</Button></div>
        )}
      </div>
      {capa && <CapaModal source="incident" sourceId={x.id} problem={x.root_causes || x.description} onClose={() => setCapa(false)} onSaved={() => { setCapa(false); void loadCapa(); void onChanged(); }} />}
    </Modal>
  );
}

// ── Complaints ────────────────────────────────────────────────────────────

const CMP_STATUS: Record<ComplaintRow["status"], [string, string]> = {
  open: ["New", "bg-rose-100 text-rose-700"], acknowledged: ["Acknowledged", "bg-amber-100 text-amber-800"], resolved: ["Resolved", "bg-sky-100 text-sky-700"], closed: ["Closed", "bg-neutral-200 text-neutral-700"],
};

function Complaints() {
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [status, setStatus] = useState<"active" | "" | ComplaintRow["status"]>("active");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<ComplaintRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try {
      const list = await listComplaints({ status });
      setRows(list);
      setOpen((o) => (o ? list.find((x) => x.id === o.id) ?? null : null));
    } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Status">
          <Select id="cmp-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Not closed</option><option value="">All</option>{Object.entries(CMP_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <p className="pb-2 text-[11px] text-neutral-400">Acknowledge within {COMPLAINT_ACK_DAYS} days, resolve within {COMPLAINT_RESOLVE_DAYS} days.</p>
        <div className="ml-auto"><Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} />Record complaint</Button></div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No complaints.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>No</th><th className={th}>Received</th><th className={th}>Complainant</th><th className={th}>About</th><th className={th}>Severity</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                  <td className={`${td} font-mono text-xs`}>{r.complaint_no}</td>
                  <td className={`${td} tabular-nums`}>{fmtWhen(r.received_at)}<span className="block text-xs text-neutral-500">{r.channel}</span></td>
                  <td className={td}>{r.complainant_name}{r.relation ? <span className="block text-xs text-neutral-500">{r.relation}</span> : null}</td>
                  <td className={td}>{r.category}{r.department ? <span className="block text-xs text-neutral-500">{r.department}</span> : null}</td>
                  <td className={td}>{r.severity}</td>
                  <td className={td}>{pill(CMP_STATUS[r.status][0], CMP_STATUS[r.status][1])}{r.ack_overdue ? <span className="block text-xs font-medium text-rose-700">Not acknowledged in {COMPLAINT_ACK_DAYS} days</span> : r.resolve_overdue ? <span className="block text-xs font-medium text-rose-700">Past {COMPLAINT_RESOLVE_DAYS} days</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <ComplaintModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
      {open && <ComplaintDetail c={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function ComplaintDetail({ c, onClose, onChanged }: { c: ComplaintRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const [assignedTo, setAssignedTo] = useState(c.assigned_to ?? "");
  const [res, setRes] = useState({ investigation: c.investigation ?? "", resolution: c.resolution ?? "" });
  const [informed, setInformed] = useState(false);
  const [capa, setCapa] = useState(false);
  const run = async (f: () => Promise<unknown>) => { try { await f(); await onChanged(); } catch (e) { err(e); } };
  return (
    <Modal title={`Complaint ${c.complaint_no}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <section className="rounded-xl bg-neutral-50 p-3">
          <p><b>{c.complainant_name}</b>{c.relation ? ` (${c.relation})` : ""}{c.complainant_phone ? ` · ${c.complainant_phone}` : ""} · {c.category} · {c.severity}</p>
          <p className="mt-1 text-xs text-neutral-500">{fmtWhen(c.received_at)} · {c.channel} · recorded by {c.received_by_name}</p>
          <p className="mt-2 whitespace-pre-wrap">{c.description}</p>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">1. Acknowledge</h3>
          {c.status === "open" ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-60 flex-1"><Field label="Investigated by"><Input id="cd-as" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} /></Field></div>
              <Button onClick={() => run(() => acknowledgeComplaint(c.id, assignedTo))}>Acknowledge</Button>
            </div>
          ) : <p className="text-xs text-neutral-600">Acknowledged by {c.acknowledged_by_name}, {fmtWhen(c.acknowledged_at)} · investigated by {c.assigned_to}</p>}
        </section>
        {c.status !== "open" && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">2. Investigate and resolve</h3>
            <div className="grid gap-2">
              <Field label="Findings"><Textarea id="cd-inv" rows={3} disabled={c.status === "closed"} value={res.investigation} onChange={(e) => setRes({ ...res, investigation: e.target.value })} /></Field>
              <Field label="Resolution"><Textarea id="cd-res" rows={2} disabled={c.status === "closed"} value={res.resolution} onChange={(e) => setRes({ ...res, resolution: e.target.value })} /></Field>
            </div>
            {c.resolved_at && <p className="mt-1 text-xs text-neutral-500">Resolved by {c.resolved_by_name}, {fmtWhen(c.resolved_at)}</p>}
            {c.status === "acknowledged" && <div className="mt-2"><Button onClick={() => run(() => resolveComplaint(c.id, res))}>Save resolution</Button></div>}
          </section>
        )}
        {c.status === "resolved" && (
          <section className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input id="cd-inf" type="checkbox" checked={informed} onChange={(e) => setInformed(e.target.checked)} />The complainant was told the outcome</label>
            <Button variant="primary" onClick={() => run(async () => { await closeComplaint(c.id, informed); onClose(); })}>Close complaint</Button>
          </section>
        )}
        {c.status === "closed" && <p className="text-xs text-neutral-500">Closed by {c.closed_by_name}, {fmtWhen(c.closed_at)}</p>}
        <div><Button variant="ghost" onClick={() => setCapa(true)}>Raise a corrective action</Button></div>
      </div>
      {capa && <CapaModal source="complaint" sourceId={c.id} problem={c.description} onClose={() => setCapa(false)} onSaved={() => setCapa(false)} />}
    </Modal>
  );
}

// ── CAPA ──────────────────────────────────────────────────────────────────

function CapaModal({ source, sourceId, problem, onClose, onSaved }: { source?: CapaSource; sourceId?: string; problem?: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ source: (source ?? "audit") as CapaSource, problem: problem ?? "", actionType: "corrective" as Capa["action_type"], action: "", ownerName: "", dueOn: inDays(30) });
  const save = async () => {
    try { await raiseCapa({ ...v, sourceId: sourceId ?? null }); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title="Corrective or preventive action" onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        {!source && (
          <Field label="From" required>
            <Select id="capa-src" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as CapaSource })}>
              {Object.entries(CAPA_SOURCES).filter(([k]) => k !== "incident" && k !== "complaint").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Problem" required><Textarea id="capa-p" rows={2} value={v.problem} onChange={(e) => setV({ ...v, problem: e.target.value })} /></Field>
        <Field label="Type" required>
          <Select id="capa-t" value={v.actionType} onChange={(e) => setV({ ...v, actionType: e.target.value as Capa["action_type"] })}>
            <option value="corrective">Corrective (fix the cause)</option><option value="preventive">Preventive (stop it happening elsewhere)</option>
          </Select>
        </Field>
        <Field label="Action" required><Textarea id="capa-a" rows={2} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner" required><Input id="capa-o" value={v.ownerName} onChange={(e) => setV({ ...v, ownerName: e.target.value })} /></Field>
          <Field label="Due" required><Input id="capa-d" type="date" value={v.dueOn} onChange={(e) => setV({ ...v, dueOn: e.target.value })} /></Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Raise action</Button></div>
    </Modal>
  );
}

function CapaList() {
  const [rows, setRows] = useState<CapaRow[]>([]);
  const [status, setStatus] = useState<"active" | "" | Capa["status"]>("active");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<CapaRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listCapa({ status })); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Status">
          <Select id="capa-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Not verified</option><option value="">All</option>{Object.entries(CAPA_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <div className="ml-auto"><Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} />New action</Button></div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No actions.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>No</th><th className={th}>From</th><th className={th}>Action</th><th className={th}>Owner</th><th className={th}>Due</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                  <td className={`${td} font-mono text-xs`}>{r.capa_no}</td>
                  <td className={td}>{CAPA_SOURCES[r.source]}{r.source_ref ? <span className="block font-mono text-xs text-neutral-500">{r.source_ref}</span> : null}</td>
                  <td className={td}>{r.action}<span className="block text-xs text-neutral-500">{r.action_type === "corrective" ? "Corrective" : "Preventive"} · {r.problem}</span></td>
                  <td className={td}>{r.owner_name}</td>
                  <td className={`${td} tabular-nums ${r.overdue ? "font-medium text-rose-700" : ""}`}>{r.due_on}{r.overdue ? " · overdue" : ""}</td>
                  <td className={td}>{pill(CAPA_STATUS[r.status][0], CAPA_STATUS[r.status][1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <CapaModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
      {open && <CapaDetail c={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function CapaDetail({ c, onClose, onChanged }: { c: CapaRow; onClose: () => void; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const run = async (f: () => Promise<unknown>) => { try { await f(); onChanged(); } catch (e) { err(e); } };
  return (
    <Modal title={`Action ${c.capa_no}`} onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-3 text-sm">
        <p>{pill(CAPA_STATUS[c.status][0], CAPA_STATUS[c.status][1])} <b>{c.action}</b></p>
        <p className="text-xs text-neutral-600">Problem: {c.problem}</p>
        <p className="text-xs text-neutral-600">Owner {c.owner_name} · due {c.due_on} · raised by {c.raised_by_name}</p>
        {c.done_at && <p className="text-xs text-neutral-600">Done {fmtWhen(c.done_at)} by {c.done_by_name}: {c.done_note}</p>}
        {c.effectiveness && <p className="whitespace-pre-wrap text-xs text-neutral-600">{c.effectiveness}</p>}
        {c.status !== "verified" && (
          <Field label={c.status === "open" ? "What was done (evidence)" : "How effectiveness was checked"}><Textarea id="capa-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {c.status === "open" && <Button variant="primary" onClick={() => run(() => markCapaDone(c.id, note))}>Record as done</Button>}
          {c.status === "done" && <>
            <Button onClick={() => run(() => verifyCapa(c.id, { effective: false, note }))}>Not effective, reopen</Button>
            <Button variant="primary" onClick={() => run(() => verifyCapa(c.id, { effective: true, note }))}>Verified effective</Button>
          </>}
        </div>
      </div>
    </Modal>
  );
}

// ── Indicators ────────────────────────────────────────────────────────────

function Indicators() {
  const [from, setFrom] = useState(() => localDate().slice(0, 8) + "01");
  const [to, setTo] = useState(localDate());
  const [ind, setInd] = useState<QualityIndicators | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void qualityIndicators({ from, to }).then(setInd).catch(err);
  }, [from, to]);
  const pc = (x: number | null) => (x === null ? "—" : `${x}%`);
  const groups: [string, [string, string, string][]][] = ind ? [
    ["Incidents", [
      ["Reported", String(ind.incidents), `${ind.byClass.near_miss} near misses`],
      ["Adverse events", String(ind.byClass.adverse_event), ""],
      ["Sentinel events", String(ind.sentinel), ""],
      ["RCA finished on time", pc(ind.rcaOnTimePct), `within ${SENTINEL_RCA_DAYS} days`],
      ["RCA overdue", String(ind.rcaOverdue), ""],
    ]],
    ["Complaints", [
      ["Received", String(ind.complaints), `${ind.complaintsOpen} not closed`],
      ["Acknowledged on time", pc(ind.complaintsAckInTargetPct), `within ${COMPLAINT_ACK_DAYS} days`],
      ["Resolved on time", pc(ind.complaintsResolvedInTargetPct), `within ${COMPLAINT_RESOLVE_DAYS} days`],
    ]],
    ["Critical results", [
      ["Critical results", String(ind.critical), `${ind.criticalPending} waiting`],
      ["Told within target", pc(ind.criticalInTargetPct), `within ${CRITICAL_NOTIFY_MINUTES} min`],
      ["Time to tell (median)", ind.criticalMedianMin === null ? "—" : `${ind.criticalMedianMin} min`, ""],
    ]],
    ["Corrective actions (all)", [
      ["Not yet verified", String(ind.capaOpen), ""],
      ["Overdue", String(ind.capaOverdue), ""],
      ["Effective first time", pc(ind.capaEffectivePct), "of those checked"],
    ]],
  ] : [];
  return (
    <div className={card}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From"><Input id="q-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input id="q-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <p className="pb-2 text-[11px] text-neutral-400">Emergency department indicators are on the ER Board.</p>
      </div>
      {ind && (
        <div className="flex flex-col gap-5">
          {ind.rcaOverdue > 0 && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{ind.rcaOverdue} root cause analysis overdue.</p>}
          {groups.map(([g, tiles]) => (
            <div key={g}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{g}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {tiles.map(([l, n, sub]) => (
                  <div key={l} className="rounded-xl bg-neutral-50 p-3">
                    <p className="text-xs text-neutral-500">{l}</p>
                    <p className="text-xl font-semibold tabular-nums">{n}</p>
                    {sub && <p className="text-[11px] text-neutral-500">{sub}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {ind.byCategory.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-neutral-600">Complaints by subject</p>
              {ind.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-2 text-xs">
                  <span className="w-40">{c.category}</span>
                  <div className="h-2 flex-1 rounded-full bg-neutral-100"><div className="h-2 rounded-full bg-rose-600" style={{ width: `${(c.n / ind.complaints) * 100}%` }} /></div>
                  <span className="w-10 text-right tabular-nums">{c.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
