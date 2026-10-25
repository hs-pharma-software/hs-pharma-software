"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  staffHrStatus, listTraining, recordTraining, listCredentials, recordCredential, verifyCredential, listAppraisals, saveAppraisal, finalizeAppraisal,
  rosterRange, setRosterShift, hospitalStaffList, type StaffHrStatus,
} from "@/lib/repo/hrRecords";
import { addDays } from "@/lib/repo/facility";
import { jobDescriptionFor } from "@/lib/repo/documents";
import { TRAINING_KINDS, trainingKind, CREDENTIAL_KINDS, VERIFICATION_METHODS, APPRAISAL_CRITERIA, ROSTER_SHIFTS, type RosterShift } from "@/config/facility";
import { designation } from "@/config/hospitalStaff";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { Staff } from "@/lib/types";
import type { Appraisal, ControlledDocument, RosterEntry, StaffCredential, StaffTraining } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const pill = (label: string, cls: string) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
const good = (l: string) => pill(l, "bg-emerald-100 text-emerald-700");
const bad = (l: string) => pill(l, "bg-rose-100 text-rose-700");

/** Staff files and the duty roster (MSDS HRM). */
export default function HrRecordsPage() {
  const [tab, setTab] = useState<"files" | "roster">("files");
  return (
    <div>
      <PageHeader title="Staff Records" actions={
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {([["files", "Staff files"], ["roster", "Duty roster"]] as const).map(([t, l]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-rose-700 text-white" : "bg-white text-neutral-600"}`}>{l}</button>
          ))}
        </div>
      } />
      {tab === "files" ? <Files /> : <Roster />}
    </div>
  );
}

// ── Staff files ───────────────────────────────────────────────────────────

function Files() {
  const [rows, setRows] = useState<StaffHrStatus[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Staff | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await staffHrStatus()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  const shown = rows.filter((r) => !search.trim() || `${r.staff.name} ${r.staff.employee_id ?? ""} ${r.staff.department ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const complete = rows.filter((r) => !r.missingTraining.length && !r.expiredTraining.length && r.registrationVerified !== false && !r.appraisalDue).length;
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Search"><Input id="hr-q" value={search} placeholder="Name, employee id, department" onChange={(e) => setSearch(e.target.value)} /></Field>
        <p className="pb-2 text-sm text-neutral-600">{complete} of {rows.length} staff files complete.</p>
      </div>
      {shown.length === 0 ? <p className="text-sm text-neutral-400">No hospital staff.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Staff</th><th className={th}>Training</th><th className={th}>Registration</th><th className={th}>Appraisal</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.staff.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r.staff)}>
                  <td className={td}>{r.staff.name}<span className="block text-xs text-neutral-500">{[r.staff.employee_id, designation(r.staff.staff_category)?.label, r.staff.department].filter(Boolean).join(" · ")}</span></td>
                  <td className={td}>
                    {!r.missingTraining.length && !r.expiredTraining.length ? good("Complete") : <>
                      {r.missingTraining.length > 0 && <span className="block text-xs text-rose-700">Missing: {r.missingTraining.join(", ")}</span>}
                      {r.expiredTraining.length > 0 && <span className="block text-xs text-amber-700">Expired: {r.expiredTraining.join(", ")}</span>}
                    </>}
                  </td>
                  <td className={td}>{r.registrationVerified === null ? <span className="text-xs text-neutral-400">Not needed</span> : r.registrationVerified ? good("Verified") : bad("Not verified")}</td>
                  <td className={td}>{r.appraisalDue ? bad(r.lastAppraisal ? `Due (last ${r.lastAppraisal})` : "Due") : good(`Done ${r.lastAppraisal ?? ""}`.trim())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <StaffFile staff={open} onClose={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function StaffFile({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const [training, setTraining] = useState<StaffTraining[]>([]);
  const [creds, setCreds] = useState<StaffCredential[]>([]);
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [jd, setJd] = useState<ControlledDocument | null>(null);
  const [modal, setModal] = useState<"training" | "credential" | Appraisal | "appraisal" | null>(null);
  const load = async () => {
    try {
      setTraining(await listTraining(staff.id));
      setCreds(await listCredentials(staff.id));
      setAppraisals(await listAppraisals(staff.id));
      setJd(staff.staff_category ? await jobDescriptionFor(staff.staff_category) : null);
    } catch (e) { err(e); }
  };
  useEffect(() => { void load(); }, [staff.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => { setModal(null); void load(); };
  const today = localDate();
  const verify = async (c: StaffCredential) => {
    const method = window.prompt(`How was it verified?\n${VERIFICATION_METHODS.map((m, i) => `${i + 1}. ${m}`).join("\n")}\nEnter 1, 2 or 3`);
    const m = VERIFICATION_METHODS[Number(method) - 1];
    if (!m) return;
    try { await verifyCredential(c.id, { method: m }); void load(); } catch (e) { err(e); }
  };
  return (
    <Modal title={`${staff.name}${staff.employee_id ? ` · ${staff.employee_id}` : ""}`} onClose={onClose}>
      <div className="flex flex-col gap-5 text-sm">
        <p className="text-xs text-neutral-500">
          {designation(staff.staff_category)?.label}{staff.department ? ` · ${staff.department}` : ""}{staff.date_of_joining ? ` · joined ${staff.date_of_joining}` : ""}
          {" · "}{jd ? <>job description {jd.doc_no} v{jd.version}</> : <span className="text-amber-700">no approved job description for this designation</span>}
        </p>
        <section>
          <div className="mb-1 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Training and orientation</h3><Button variant="ghost" onClick={() => setModal("training")}>Add</Button></div>
          {training.length === 0 ? <p className="text-xs text-neutral-400">None recorded.</p> : training.map((t) => (
            <p key={t.id} className="border-t border-neutral-100 py-1 text-xs">
              <b>{t.held_on}</b> · {trainingKind(t.kind)?.label ?? t.kind}{t.title ? `: ${t.title}` : ""}{t.provider ? ` · ${t.provider}` : ""}{t.hours ? ` · ${t.hours} h` : ""}
              {t.valid_until ? <span className={t.valid_until < today ? " text-rose-700" : " text-neutral-500"}> · valid until {t.valid_until}</span> : null}
            </p>
          ))}
        </section>
        <section>
          <div className="mb-1 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Credentials</h3><Button variant="ghost" onClick={() => setModal("credential")}>Add</Button></div>
          {creds.length === 0 ? <p className="text-xs text-neutral-400">None recorded.</p> : creds.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 py-1 text-xs">
              <span>{c.kind}{c.number ? ` · ${c.number}` : ""}{c.issued_by ? ` · ${c.issued_by}` : ""}{c.valid_until ? ` · valid until ${c.valid_until}` : ""}</span>
              {c.verified_on ? <span className="text-emerald-700">Verified {c.verified_on}: {c.verification_method} ({c.verified_by_name})</span> : <Button onClick={() => verify(c)}>Verify</Button>}
            </div>
          ))}
        </section>
        <section>
          <div className="mb-1 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Appraisals</h3><Button variant="ghost" onClick={() => setModal("appraisal")}>New appraisal</Button></div>
          {appraisals.length === 0 ? <p className="text-xs text-neutral-400">None recorded.</p> : appraisals.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 py-1 text-xs">
              <span>{x.period_from} to {x.period_to} · {x.appraiser_name}{x.overall ? ` · overall ${x.overall}/5` : ""} · {x.status === "draft" ? "draft" : x.status === "final" ? "waiting for the staff member to acknowledge" : `acknowledged ${x.acknowledged_at?.slice(0, 10)}`}</span>
              {x.status === "draft" && <Button onClick={() => setModal(x)}>Continue</Button>}
            </div>
          ))}
        </section>
      </div>
      {modal === "training" && <TrainingModal staff={staff} onClose={() => setModal(null)} onSaved={done} />}
      {modal === "credential" && <CredentialModal staff={staff} onClose={() => setModal(null)} onSaved={done} />}
      {(modal === "appraisal" || (modal && typeof modal === "object")) && <AppraisalModal staff={staff} appraisal={typeof modal === "object" ? modal : null} onClose={() => setModal(null)} onSaved={done} />}
    </Modal>
  );
}

function TrainingModal({ staff, onClose, onSaved }: { staff: Staff; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ kind: "", title: "", heldOn: localDate(), validUntil: "", hours: "", provider: "", certificateRef: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const kind = trainingKind(v.kind);
  const save = async () => {
    try { await recordTraining(staff.id, { ...v, validUntil: v.validUntil || null, hours: v.hours ? Number(v.hours) : null }); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title={`Training: ${staff.name}`} onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        <Field label="Training" required><Select id="tr-kind" value={v.kind} onChange={set("kind")}><option value="">Choose…</option>{TRAINING_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></Field>
        {(v.kind === "other" || v.kind === "cme") && <Field label="Title" required><Input id="tr-title" value={v.title} onChange={set("title")} /></Field>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Completed on" required><Input id="tr-on" type="date" value={v.heldOn} onChange={set("heldOn")} /></Field>
          <Field label={`Valid until${kind?.validMonths ? ` (default ${kind.validMonths} months)` : ""}`}><Input id="tr-valid" type="date" value={v.validUntil} onChange={set("validUntil")} /></Field>
          <Field label="Hours"><Input id="tr-h" inputMode="decimal" value={v.hours} onChange={set("hours")} /></Field>
          <Field label="Provider / trainer"><Input id="tr-p" value={v.provider} onChange={set("provider")} /></Field>
        </div>
        <Field label="Certificate number"><Input id="tr-c" value={v.certificateRef} onChange={set("certificateRef")} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
    </Modal>
  );
}

function CredentialModal({ staff, onClose, onSaved }: { staff: Staff; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ kind: "", number: staff.license_no ?? "", issuedBy: "", validUntil: "", documentRef: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    try { await recordCredential(staff.id, { ...v, validUntil: v.validUntil || null }); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title={`Credential: ${staff.name}`} onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        <Field label="Credential" required><Select id="cr-kind" value={v.kind} onChange={set("kind")}><option value="">Choose…</option>{CREDENTIAL_KINDS.map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Number"><Input id="cr-no" value={v.number} onChange={set("number")} /></Field>
          <Field label="Issued by"><Input id="cr-by" value={v.issuedBy} onChange={set("issuedBy")} /></Field>
          <Field label="Valid until"><Input id="cr-valid" type="date" value={v.validUntil} onChange={set("validUntil")} /></Field>
          <Field label="Copy kept at"><Input id="cr-doc" value={v.documentRef} onChange={set("documentRef")} /></Field>
        </div>
        <p className="text-xs text-neutral-500">Save it, then use Verify once it has been checked with the council or the issuing body.</p>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
    </Modal>
  );
}

function AppraisalModal({ staff, appraisal, onClose, onSaved }: { staff: Staff; appraisal: Appraisal | null; onClose: () => void; onSaved: () => void }) {
  const today = localDate();
  const [v, setV] = useState({
    periodFrom: appraisal?.period_from ?? addDays(today, -365), periodTo: appraisal?.period_to ?? today,
    ratings: (appraisal?.ratings ? JSON.parse(appraisal.ratings) : {}) as Record<string, number>,
    strengths: appraisal?.strengths ?? "", improvements: appraisal?.improvements ?? "", goals: appraisal?.goals ?? "",
  });
  const save = async (finalize: boolean) => {
    try {
      const saved = await saveAppraisal(appraisal?.id ?? null, staff.id, v);
      if (finalize) await finalizeAppraisal(saved.id);
      onSaved();
    } catch (e) { err(e); }
  };
  return (
    <Modal title={`Appraisal: ${staff.name}`} onClose={onClose}>
      <div className="grid gap-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><Input id="ap-from" type="date" value={v.periodFrom} onChange={(e) => setV({ ...v, periodFrom: e.target.value })} /></Field>
          <Field label="To"><Input id="ap-to" type="date" value={v.periodTo} onChange={(e) => setV({ ...v, periodTo: e.target.value })} /></Field>
        </div>
        <div className="flex flex-col gap-1.5">
          {APPRAISAL_CRITERIA.map(([k, l]) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-2">
              <span>{l}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setV({ ...v, ratings: { ...v.ratings, [k]: n } })}
                    className={`h-7 w-7 rounded-full text-xs font-semibold ${v.ratings[k] === n ? "bg-rose-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>{n}</button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-neutral-500">1 well below expectations · 3 meets expectations · 5 well above.</p>
        </div>
        <Field label="Strengths"><Textarea id="ap-s" rows={2} value={v.strengths} onChange={(e) => setV({ ...v, strengths: e.target.value })} /></Field>
        <Field label="Areas to improve"><Textarea id="ap-i" rows={2} value={v.improvements} onChange={(e) => setV({ ...v, improvements: e.target.value })} /></Field>
        <Field label="Goals agreed for the next period" required><Textarea id="ap-g" rows={2} value={v.goals} onChange={(e) => setV({ ...v, goals: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={() => save(false)}>Save draft</Button>
        <Button variant="primary" onClick={() => save(true)}>Finalize</Button>
      </div>
    </Modal>
  );
}

// ── Duty roster ───────────────────────────────────────────────────────────

const SHIFT_CLS: Record<RosterShift, string> = {
  M: "bg-sky-100 text-sky-800", E: "bg-amber-100 text-amber-800", N: "bg-indigo-600 text-white", L: "bg-teal-100 text-teal-800",
  C: "bg-violet-100 text-violet-800", O: "bg-neutral-100 text-neutral-500", LV: "bg-rose-100 text-rose-700",
};
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

function Roster() {
  const [start, setStart] = useState(localDate());
  const [dept, setDept] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const reload = async () => {
    if (!isTauri()) return;
    try {
      setStaff(await hospitalStaffList());
      setEntries(await rosterRange(days[0], days[6]));
    } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  const departments = [...new Set(staff.map((s) => s.department).filter(Boolean) as string[])].sort();
  const shown = staff.filter((s) => !dept || s.department === dept);
  const set = async (s: Staff, day: string, shift: RosterShift | "") => {
    try { await setRosterShift(s.id, day, shift); setEntries(await rosterRange(days[0], days[6])); } catch (e) { err(e); }
  };
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Week from"><Input id="ro-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Department">
          <Select id="ro-dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{departments.map((d) => <option key={d}>{d}</option>)}</Select>
        </Field>
        <p className="pb-2 text-[11px] text-neutral-500">{Object.entries(ROSTER_SHIFTS).map(([k, l]) => `${k} ${l}`).join(" · ")}</p>
      </div>
      {shown.length === 0 ? <p className="text-sm text-neutral-400">No staff.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Staff</th>{days.map((d) => <th key={d} className={`${th} text-center`}>{weekday(d)}</th>)}</tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className="border-t border-neutral-100">
                  <td className={`${td} whitespace-nowrap`}>{s.name}<span className="block text-[11px] text-neutral-500">{s.department ?? designation(s.staff_category)?.label}</span></td>
                  {days.map((d) => {
                    const e = entries.find((x) => x.staff_id === s.id && x.duty_date === d);
                    const shift = (e?.shift ?? "") as RosterShift | "";
                    return (
                      <td key={d} className="px-0.5 py-1 text-center">
                        <select id={`ro-${s.id}-${d}`} aria-label={`${s.name} ${d}`} value={shift} onChange={(ev) => set(s, d, ev.target.value as RosterShift | "")}
                          className={`w-14 rounded-md border-0 px-1 py-1 text-center text-xs font-semibold ${shift ? SHIFT_CLS[shift] : "bg-white text-neutral-300 ring-1 ring-neutral-200"}`}>
                          <option value="">—</option>{Object.keys(ROSTER_SHIFTS).map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
