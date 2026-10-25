"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  startHhSession, addHhObservation, voidHhObservation, closeHhSession, listHhSessions, listHhObservations, hhCompliance, clinicianConfirmations,
  MOMENTS, PROFESSIONS, HH_ACTIONS, type HhSessionRow, type Compliance,
} from "@/lib/repo/handHygiene";
import { hospitalDepartmentsRepo } from "@/lib/repo/hospital";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import type { HhObservation, HhSession } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const monthStart = () => `${localDate().slice(0, 8)}01`;
const pct = (c: Compliance) => (c.rate == null ? "—" : `${c.rate}%`);

/** Hand-hygiene observation audits (MSDS IPC-1 Ind. 84, 86). */
export default function HandHygienePage() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDate());
  const [sessions, setSessions] = useState<HhSessionRow[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof hhCompliance>> | null>(null);
  const [self, setSelf] = useState<{ completed: number; notCompleted: number; other: number } | null>(null);
  const [newSession, setNewSession] = useState(false);
  const [open, setOpen] = useState<HhSession | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      const range = { from, to };
      const [s, c, sc] = await Promise.all([listHhSessions(range), hhCompliance(range), clinicianConfirmations(range)]);
      setSessions(s);
      setSummary(c);
      setSelf(sc);
    } catch (e) {
      window.alert(`Could not load the audits: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [from, to]);

  return (
    <div>
      <PageHeader title="Hand Hygiene" actions={<Button variant="primary" onClick={() => setNewSession(true)}><Plus size={14} className="mr-1" />New audit session</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40"><Field label="From"><Input id="hh-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
        <div className="w-40"><Field label="To"><Input id="hh-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      </div>

      {summary && (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className={`${card} lg:col-span-2`}>
            <h2 className="mb-1 text-sm font-semibold text-neutral-700">Observed compliance</h2>
            <p className="mb-3 text-[11px] text-neutral-400">From IPC auditors&apos; observations only: opportunities where hand-rub or hand-wash was done, out of all opportunities observed.</p>
            <p className="mb-3 text-3xl font-semibold tabular-nums">{pct(summary.overall)} <span className="text-sm font-normal text-neutral-500">{summary.overall.performed} of {summary.overall.opportunities} opportunities</span></p>
            <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
              {([["By area", summary.byArea.map((x) => [x.area, x])], ["By profession", summary.byProfession.map((x) => [x.profession, x])], ["By moment", summary.byMoment.map((x) => [`${x.moment}. ${MOMENTS[x.moment]}`, x])]] as const).map(([title, rows]) => (
                <div key={title}>
                  <p className="mb-1 font-semibold text-neutral-600">{title}</p>
                  {(rows as [string, Compliance][]).length === 0 && <p className="text-neutral-400">No observations.</p>}
                  {(rows as [string, Compliance][]).map(([label, c]) => (
                    <p key={label} className="flex justify-between gap-2 tabular-nums"><span className="text-neutral-600">{label}</span><span>{pct(c)} <span className="text-neutral-400">({c.opportunities})</span></span></p>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className={`${card} border border-dashed border-neutral-200`}>
            <h2 className="mb-1 text-sm font-semibold text-neutral-700">Clinicians&apos; own confirmations</h2>
            <p className="mb-3 text-[11px] text-neutral-400">What doctors and nurses affirmed on the visit checklist. A self-confirmation, not an observation: it is not counted in the audit above.</p>
            {self && (
              <div className="text-sm tabular-nums">
                <p className="flex justify-between"><span>Confirmed done</span><span>{self.completed}</span></p>
                <p className="flex justify-between"><span>Recorded as not done</span><span>{self.notCompleted}</span></p>
                <p className="flex justify-between text-neutral-500"><span>Not applicable / pending</span><span>{self.other}</span></p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={card}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Audit sessions</h2>
        {sessions.length === 0 ? <p className="text-sm text-neutral-400">No audit sessions in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500"><th className="pb-1.5 pr-2 font-medium">Date</th><th className="pb-1.5 pr-2 font-medium">Area</th><th className="pb-1.5 pr-2 font-medium">Observer</th><th className="pb-1.5 pr-2 font-medium">Opportunities</th><th className="pb-1.5 pr-2 font-medium">Compliance</th><th className="pb-1.5 font-medium">Status</th><th /></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-neutral-50">
                    <td className="py-1.5 pr-2 tabular-nums">{s.session_date}</td>
                    <td className="py-1.5 pr-2">{s.area}{s.department ? <span className="text-xs text-neutral-400"> · {s.department}</span> : null}</td>
                    <td className="py-1.5 pr-2 text-neutral-600">{s.observer_name}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{s.opportunities}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{s.opportunities ? `${Math.round((s.performed / s.opportunities) * 1000) / 10}%` : "—"}</td>
                    <td className="py-1.5 pr-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.status === "open" ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"}`}>{s.status}</span></td>
                    <td className="py-1.5"><Button variant="ghost" onClick={() => setOpen(s)}>{s.status === "open" ? "Record" : "View"}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {newSession && <NewSession onClose={() => setNewSession(false)} onStarted={(s) => { setNewSession(false); setOpen(s); void reload(); }} />}
      {open && <SessionRecorder session={open} onClose={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function NewSession({ onClose, onStarted }: { onClose: () => void; onStarted: (s: HhSession) => void }) {
  const [area, setArea] = useState("");
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  useEffect(() => { void hospitalDepartmentsRepo.list({ orderBy: "name ASC" }).then((d) => setDepartments(d.filter((x) => x.is_active).map((x) => x.name))).catch(() => setDepartments([])); }, []);
  async function start() {
    try {
      onStarted(await startHhSession({ area, department }));
    } catch (e) {
      window.alert(`Could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return (
    <Modal title="New hand-hygiene audit session" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Ward / area observed" required><Input id="hh-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Surgical ward, ICU" autoFocus /></Field>
        <Field label="Department">
          <Select id="hh-dept" value={department} onChange={(e) => setDepartment(e.target.value)}><option value="">—</option>{departments.map((d) => <option key={d}>{d}</option>)}</Select>
        </Field>
        <p className="text-xs text-neutral-500">You record each opportunity you observe, as you see it. The session is yours: only you add to it.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void start()} disabled={!area.trim()}>Start observing</Button></div>
      </div>
    </Modal>
  );
}

function SessionRecorder({ session, onClose }: { session: HhSession; onClose: () => void }) {
  const [obs, setObs] = useState<HhObservation[]>([]);
  const [profession, setProfession] = useState(PROFESSIONS[0]);
  const [moment, setMoment] = useState(1);
  const [gloves, setGloves] = useState(false);
  const [status, setStatus] = useState(session.status);
  const load = () => listHhObservations(session.id).then(setObs).catch(() => setObs([]));
  useEffect(() => { void load(); }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };
  const live = obs.filter((o) => !o.voided_at);
  const performed = live.filter((o) => o.action !== "missed").length;
  return (
    <Modal title={`Audit · ${session.area} · ${session.session_date}`} onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm tabular-nums">{live.length} opportunities · {performed} performed · {live.length ? `${Math.round((performed / live.length) * 1000) / 10}%` : "—"}</p>
        {status === "open" && (
          <div className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-3">
            <div className="flex flex-wrap gap-1">{PROFESSIONS.map((p) => <button key={p} type="button" onClick={() => setProfession(p)} className={`rounded-full border px-3 py-1 text-xs ${profession === p ? "border-amber-500 bg-amber-50 text-amber-800" : "border-neutral-200 text-neutral-600"}`}>{p}</button>)}</div>
            <div className="flex flex-wrap gap-1">{Object.entries(MOMENTS).map(([k, v]) => <button key={k} type="button" onClick={() => setMoment(Number(k))} className={`rounded-full border px-3 py-1 text-xs ${moment === Number(k) ? "border-amber-500 bg-amber-50 text-amber-800" : "border-neutral-200 text-neutral-600"}`}>{k}. {v}</button>)}</div>
            <label className="flex items-center gap-2 text-xs"><input id="hh-gloves" type="checkbox" checked={gloves} onChange={(e) => setGloves(e.target.checked)} />Gloves worn instead of hand hygiene</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(HH_ACTIONS) as HhObservation["action"][]).map((a) => (
                <Button key={a} variant={a === "missed" ? "secondary" : "primary"} onClick={() => void act(async () => { await addHhObservation(session.id, { profession, moment, action: a, glovesMisuse: gloves }); setGloves(false); })}>{HH_ACTIONS[a]}</Button>
              ))}
            </div>
          </div>
        )}
        <div className="max-h-72 overflow-y-auto text-xs">
          {obs.length === 0 && <p className="text-neutral-400">No opportunities recorded yet.</p>}
          {obs.slice().reverse().map((o) => (
            <div key={o.id} className={`flex items-center justify-between gap-2 border-b border-neutral-50 py-1 ${o.voided_at ? "text-neutral-400 line-through" : ""}`} title={o.voided_at ? `Void: ${o.void_reason}` : undefined}>
              <span className="tabular-nums text-neutral-500">{fmtWhen(o.observed_at)}</span>
              <span className="flex-1">{o.profession} · moment {o.moment} · <b>{HH_ACTIONS[o.action]}</b>{o.gloves_misuse ? " · gloves instead" : ""}</span>
              {!o.voided_at && status === "open" && <button type="button" className="text-neutral-400 hover:text-rose-600" onClick={() => { const r = window.prompt("Void this observation? Reason:"); if (r?.trim()) void act(() => voidHhObservation(o.id, r)); }}>Void</button>}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          {status === "open" && <Button onClick={() => void act(async () => { await closeHhSession(session.id); setStatus("closed"); })}>Close session</Button>}
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
