"use client";

import { Fragment, useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { currentActor, roleAllowed } from "@/lib/repo/medicalRecord";
import { hospitalStaffList } from "@/lib/repo/hrRecords";
import { currentPlacement, endTraining, listTrainees, moveTrainee, saveTrainee, traineeCounts, type Trainee, type TraineeInput } from "@/lib/repo/trainees";
import { HR_ROLES, TRAINEE_ROLES, designation } from "@/config/hospitalStaff";
import { PROGRAM_FOR_DEPARTMENT, TRAINEE_PROGRAMS, TRAINEE_STATUS, TRAINING_SECTIONS, type TraineeStatus } from "@/config/trainees";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { Staff } from "@/lib/types";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const DEPARTMENTS = Object.keys(TRAINING_SECTIONS);
const STATUS_CLS: Record<TraineeStatus, string> = { active: "bg-emerald-100 text-emerald-700", completed: "bg-sky-100 text-sky-800", left: "bg-neutral-200 text-neutral-600" };
const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** HR Department > Trainees: students and interns placed in a department's
 * section (MLT students in the Lab's benches, radiography students in X-Ray,
 * Ultrasound, CT or MRI), with their supervisor and rotations. */
export default function TraineesPage() {
  const [rows, setRows] = useState<Trainee[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [status, setStatus] = useState<TraineeStatus | "">("active");
  const [dept, setDept] = useState("");
  const [search, setSearch] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "add" } | { kind: "edit" | "move" | "end"; t: Trainee } | null>(null);

  const load = async () => {
    if (!isTauri()) return;
    try { setRows(await listTrainees()); } catch (e) { err(e); }
  };
  useEffect(() => {
    void load();
    void hospitalStaffList().then(setStaff).catch(() => setStaff([]));
    void currentActor().then((a) => setCanEdit(roleAllowed([...HR_ROLES, ...TRAINEE_ROLES], a))).catch(() => setCanEdit(false));
  }, []);

  const q = search.trim().toLowerCase();
  const shown = rows.filter((t) => (!status || t.status === status) && (!dept || currentPlacement(t)?.department === dept)
    && (!q || `${t.name} ${t.institute} ${t.program} ${t.rollNo ?? ""}`.toLowerCase().includes(q)));
  const counts = traineeCounts(rows);
  const perDept = DEPARTMENTS.map((d) => ({ d, n: counts.filter((c) => c.department === d).reduce((a, c) => a + c.n, 0) })).filter((x) => x.n);
  const active = rows.filter((t) => t.status === "active").length;

  return (
    <div>
      <PageHeader title="Trainees & Interns" actions={canEdit ? <Button variant="primary" onClick={() => setModal({ kind: "add" })}><Plus size={14} />Add trainee</Button> : undefined} />

      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <div className={card}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">In training now</p>
          <p className="mt-1 text-4xl font-bold text-neutral-900">{active}</p>
          <p className="text-xs text-neutral-500">{rows.length - active} completed or left</p>
        </div>
        <div className={card}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Placed in</p>
          {counts.length === 0 ? <p className="mt-2 text-sm text-neutral-400">No trainee is placed yet.</p> : (
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {perDept.map(({ d, n }) => (
                <div key={d} className="min-w-0">
                  <button type="button" onClick={() => setDept(dept === d ? "" : d)} className={`text-sm font-semibold ${dept === d ? "text-rose-700" : "text-neutral-800"} hover:underline`}>{d} · {n}</button>
                  <p className="text-xs text-neutral-500">{counts.filter((c) => c.department === d).map((c) => `${c.section} ${c.n}`).join(" · ")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`${card} mt-4`}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="Status">
            <Select id="tr-status" value={status} onChange={(e) => setStatus(e.target.value as TraineeStatus | "")}>
              <option value="">All</option>{(Object.keys(TRAINEE_STATUS) as TraineeStatus[]).map((k) => <option key={k} value={k}>{TRAINEE_STATUS[k]}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select id="tr-dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select>
          </Field>
          <Field label="Search"><Input id="tr-q" value={search} placeholder="Name, institute, programme, roll no." onChange={(e) => setSearch(e.target.value)} /></Field>
        </div>
        {shown.length === 0 ? <p className="text-sm text-neutral-400">{rows.length ? "No trainee matches." : "No trainees yet."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className="pb-1.5 pr-2 font-medium">Trainee</th><th className="pb-1.5 pr-2 font-medium">Placed in</th><th className="pb-1.5 pr-2 font-medium">Supervisor</th>
                <th className="pb-1.5 pr-2 font-medium">Period</th><th className="pb-1.5 pr-2 font-medium">Status</th><th className="pb-1.5 font-medium" />
              </tr></thead>
              <tbody>
                {shown.map((t) => {
                  const p = currentPlacement(t);
                  return (
                    <Fragment key={t.id}>
                      <tr className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(open === t.id ? null : t.id)}>
                        <td className="py-2 pr-2">{t.name}<span className="block text-xs text-neutral-500">{t.program} · {t.institute}{t.rollNo ? ` · ${t.rollNo}` : ""}</span></td>
                        <td className="py-2 pr-2"><b className="font-medium">{p?.department}</b><span className="block text-xs text-neutral-500">{p?.section}</span></td>
                        <td className="py-2 pr-2">{p?.supervisorName ?? <span className="text-neutral-400">—</span>}</td>
                        <td className="whitespace-nowrap py-2 pr-2 text-xs">{fmt(t.startDate)}{t.endDate ? ` to ${fmt(t.endDate)}` : ""}</td>
                        <td className="py-2 pr-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[t.status]}`}>{TRAINEE_STATUS[t.status]}</span></td>
                        <td className="whitespace-nowrap py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {canEdit && t.status === "active" && (
                            <>
                              <button type="button" className="mr-2 inline-flex items-center gap-1 text-xs text-sky-700 hover:underline" onClick={() => setModal({ kind: "move", t })}><ArrowRightLeft size={13} />Move</button>
                              <button type="button" className="mr-2 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline" onClick={() => setModal({ kind: "end", t })}><CheckCircle2 size={13} />End</button>
                            </>
                          )}
                          {canEdit && <button type="button" className="inline-flex items-center gap-1 text-xs text-neutral-600 hover:underline" onClick={() => setModal({ kind: "edit", t })}><Pencil size={13} />Edit</button>}
                        </td>
                      </tr>
                      {open === t.id && (
                        <tr className="bg-neutral-50">
                          <td colSpan={6} className="px-3 py-2 text-xs">
                            <p className="mb-1 font-semibold text-neutral-700">Rotations</p>
                            <ol className="list-decimal space-y-0.5 pl-5">
                              {t.placements.map((pl, i) => <li key={i}>{pl.department} › {pl.section}{pl.supervisorName ? `, under ${pl.supervisorName}` : ""}: {fmt(pl.from)}{pl.to ? ` to ${fmt(pl.to)}` : " onward"}</li>)}
                            </ol>
                            <p className="mt-1 text-neutral-500">{[t.gender, t.cnic && `CNIC ${t.cnic}`, t.mobile && `Mobile ${t.mobile}`, t.notes].filter(Boolean).join(" · ")}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.kind === "add" && <TraineeForm staff={staff} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
      {modal?.kind === "edit" && <TraineeForm staff={staff} trainee={modal.t} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
      {modal?.kind === "move" && <MoveForm staff={staff} trainee={modal.t} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
      {modal?.kind === "end" && <EndForm trainee={modal.t} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function SupervisorSelect({ id, staff, value, onChange }: { id: string; staff: Staff[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— None —</option>
      {staff.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name} · {designation(s.staff_category)?.label ?? s.designation}</option>)}
    </Select>
  );
}

function SectionFields({ dept, section, setDept, setSection, idPrefix }: { dept: string; section: string; setDept: (v: string) => void; setSection: (v: string) => void; idPrefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Department" required>
        <Select id={`${idPrefix}-dept`} value={dept} onChange={(e) => { setDept(e.target.value); setSection(TRAINING_SECTIONS[e.target.value]?.[0] ?? ""); }}>
          {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </Select>
      </Field>
      <Field label="Section" required>
        <Select id={`${idPrefix}-section`} value={section} onChange={(e) => setSection(e.target.value)}>
          {(TRAINING_SECTIONS[dept] ?? []).map((s) => <option key={s}>{s}</option>)}
        </Select>
      </Field>
    </div>
  );
}

function TraineeForm({ staff, trainee, onClose, onSaved }: { staff: Staff[]; trainee?: Trainee; onClose: () => void; onSaved: () => void }) {
  const p = trainee ? currentPlacement(trainee) : null;
  const [f, setF] = useState<TraineeInput>(() => ({
    name: trainee?.name ?? "", gender: trainee?.gender ?? "", cnic: trainee?.cnic ?? "", mobile: trainee?.mobile ?? "",
    institute: trainee?.institute ?? "", program: trainee?.program ?? PROGRAM_FOR_DEPARTMENT.Laboratory, rollNo: trainee?.rollNo ?? "",
    startDate: trainee?.startDate ?? localDate(), endDate: trainee?.endDate ?? "", notes: trainee?.notes ?? "",
    department: p?.department ?? "Laboratory", section: p?.section ?? TRAINING_SECTIONS.Laboratory[0], supervisorId: p?.supervisorId ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const up = (k: keyof TraineeInput, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setSaving(true);
    try { await saveTrainee(trainee?.id ?? null, f); onSaved(); } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title={trainee ? `Edit trainee: ${trainee.name}` : "Add trainee or intern"} onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" required><Input id="tf-name" value={f.name} onChange={(e) => up("name", e.target.value)} autoFocus /></Field>
          <Field label="Gender"><Select id="tf-gender" value={f.gender ?? ""} onChange={(e) => up("gender", e.target.value)}><option value="">—</option><option>Female</option><option>Male</option></Select></Field>
          <Field label="CNIC"><Input id="tf-cnic" value={f.cnic ?? ""} placeholder="35202-xxxxxxx-x" onChange={(e) => up("cnic", e.target.value)} /></Field>
          <Field label="Mobile"><Input id="tf-mobile" value={f.mobile ?? ""} placeholder="03xx xxxxxxx" onChange={(e) => up("mobile", e.target.value)} /></Field>
          <Field label="Programme" required>
            <Select id="tf-program" value={f.program} onChange={(e) => up("program", e.target.value)}>{TRAINEE_PROGRAMS.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label="Institute" required><Input id="tf-inst" value={f.institute} placeholder="College or university" onChange={(e) => up("institute", e.target.value)} /></Field>
          <Field label="Roll no. / registration"><Input id="tf-roll" value={f.rollNo ?? ""} onChange={(e) => up("rollNo", e.target.value)} /></Field>
          <Field label="Supervisor"><SupervisorSelect id="tf-sup" staff={staff} value={f.supervisorId ?? ""} onChange={(v) => up("supervisorId", v)} /></Field>
        </div>
        <SectionFields idPrefix="tf" dept={f.department} section={f.section}
          setDept={(v) => setF((x) => ({ ...x, department: v, program: trainee ? x.program : PROGRAM_FOR_DEPARTMENT[v] ?? x.program }))} setSection={(v) => up("section", v)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Training starts" required><Input id="tf-start" type="date" value={f.startDate} onChange={(e) => up("startDate", e.target.value)} /></Field>
          <Field label="Training ends"><Input id="tf-end" type="date" value={f.endDate ?? ""} onChange={(e) => up("endDate", e.target.value)} /></Field>
        </div>
        <Field label="Notes"><Textarea id="tf-notes" rows={2} value={f.notes ?? ""} onChange={(e) => up("notes", e.target.value)} /></Field>
        {trainee && <p className="text-xs text-neutral-500">To place the trainee in a different section from a date, use Move: it keeps the earlier rotation on record.</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function MoveForm({ staff, trainee, onClose, onSaved }: { staff: Staff[]; trainee: Trainee; onClose: () => void; onSaved: () => void }) {
  const p = currentPlacement(trainee);
  const [dept, setDept] = useState(p?.department ?? "Laboratory");
  const [section, setSection] = useState(() => (TRAINING_SECTIONS[p?.department ?? "Laboratory"] ?? []).find((s) => s !== p?.section) ?? p?.section ?? "");
  const [sup, setSup] = useState(p?.supervisorId ?? "");
  const [from, setFrom] = useState(localDate());
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await moveTrainee(trainee.id, { department: dept, section, supervisorId: sup, from }); onSaved(); } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Move ${trainee.name}`} onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-600">Now in <b>{p?.department} › {p?.section}</b> since {fmt(p?.from ?? null)}.</p>
        <SectionFields idPrefix="mv" dept={dept} section={section} setDept={setDept} setSection={setSection} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supervisor"><SupervisorSelect id="mv-sup" staff={staff} value={sup} onChange={setSup} /></Field>
          <Field label="From" required><Input id="mv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Move"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function EndForm({ trainee, onClose, onSaved }: { trainee: Trainee; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<"completed" | "left">("completed");
  const [on, setOn] = useState(localDate());
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await endTraining(trainee.id, status, on); onSaved(); } catch (e) { err(e); } finally { setSaving(false); }
  };
  return (
    <Modal title={`End training: ${trainee.name}`} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Outcome"><Select id="en-status" value={status} onChange={(e) => setStatus(e.target.value as "completed" | "left")}><option value="completed">Completed</option><option value="left">Left early</option></Select></Field>
          <Field label="On"><Input id="en-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
