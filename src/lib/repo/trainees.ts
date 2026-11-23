/** Trainees and interns (HR Department > Trainees): students and house
 * officers placed in a department's section for a period, under a
 * supervisor, and moved from section to section (rotations).
 *
 * Kept in hospital_form_records as form "hr_trainee" (scope "staff"), so no
 * new table is needed; every other reader of that table filters by patient,
 * visit or form, so trainees never appear in patient records. */
import { createTenantRepo } from "./base";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { staffRepo } from "./staff";
import { stamp } from "./emergency";
import { localDate } from "../localDate";
import { HR_ROLES, TRAINEE_ROLES } from "../../config/hospitalStaff";
import { TRAINEE_STATUS, TRAINING_SECTIONS, type TraineeStatus } from "../../config/trainees";

export const TRAINEE_FORM = "hr_trainee";

interface TraineeRow {
  id: string; tenant_id: string; form_key: string; form_version: number; scope: string; department: string | null;
  status: string; data: string; summary: string | null; created_by: string | null; created_by_name: string | null;
  updated_by: string | null; updated_by_name: string | null; revision_no: number; created_at: string; updated_at: string; deleted_at: string | null;
}
const rows = createTenantRepo<TraineeRow>("hospital_form_records");

export interface Placement { department: string; section: string; supervisorId: string | null; supervisorName: string | null; from: string; to: string | null }

export interface Trainee {
  id: string;
  name: string;
  gender: string | null;
  cnic: string | null;
  mobile: string | null;
  institute: string;
  program: string;
  rollNo: string | null;
  startDate: string;
  endDate: string | null;
  status: TraineeStatus;
  notes: string | null;
  /** Every placement, oldest first; the last one is where the trainee is now. */
  placements: Placement[];
  createdBy: string | null;
}

export interface TraineeInput {
  name: string;
  gender?: string | null;
  cnic?: string | null;
  mobile?: string | null;
  institute: string;
  program: string;
  rollNo?: string | null;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  department: string;
  section: string;
  supervisorId?: string | null;
}

const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const clean = (v: string | null | undefined, max = 120) => (v ?? "").trim().slice(0, max) || null;
const dayBefore = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

async function need(): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed([...HR_ROLES, ...TRAINEE_ROLES], a)) throw new Error("Trainees are placed by HR, the Nursing Superintendent or a Head of Department.");
  return a;
}

async function supervisor(id: string | null | undefined): Promise<{ id: string | null; name: string | null }> {
  if (!id) return { id: null, name: null };
  const s = await staffRepo.get(id);
  if (!s) throw new Error("That supervisor is not on the staff list.");
  return { id: s.id, name: s.name };
}

function placementCheck(department: string, section: string) {
  if (!department.trim()) throw new Error("Choose the department.");
  if (!section.trim()) throw new Error("Choose the section.");
  const known = TRAINING_SECTIONS[department];
  if (known && !known.includes(section)) throw new Error(`${section} is not a section of ${department}.`);
}

function fromRow(r: TraineeRow): Trainee {
  let d: Partial<Trainee> = {};
  try { d = JSON.parse(r.data) as Partial<Trainee>; } catch { d = {}; }
  return {
    id: r.id,
    name: d.name ?? "",
    gender: d.gender ?? null,
    cnic: d.cnic ?? null,
    mobile: d.mobile ?? null,
    institute: d.institute ?? "",
    program: d.program ?? "",
    rollNo: d.rollNo ?? null,
    startDate: d.startDate ?? "",
    endDate: d.endDate ?? null,
    status: (r.status in TRAINEE_STATUS ? r.status : "active") as TraineeStatus,
    notes: d.notes ?? null,
    placements: Array.isArray(d.placements) ? d.placements : [],
    createdBy: r.created_by_name,
  };
}

const body = (t: Trainee) => JSON.stringify({
  name: t.name, gender: t.gender, cnic: t.cnic, mobile: t.mobile, institute: t.institute, program: t.program, rollNo: t.rollNo,
  startDate: t.startDate, endDate: t.endDate, notes: t.notes, placements: t.placements,
});

/** The section a trainee is in now (the last placement). */
export const currentPlacement = (t: Pick<Trainee, "placements">): Placement | null => t.placements.at(-1) ?? null;

/** Adds a trainee, or edits one (the current placement's section and supervisor can be corrected; a move is `moveTrainee`). */
export async function saveTrainee(id: string | null, x: TraineeInput): Promise<Trainee> {
  const a = await need();
  const name = clean(x.name, 80);
  if (!name) throw new Error("Enter the trainee's name.");
  const institute = clean(x.institute, 120);
  if (!institute) throw new Error("Enter the institute (college or university).");
  const program = clean(x.program, 80);
  if (!program) throw new Error("Choose the programme.");
  if (!isDate(x.startDate)) throw new Error("Enter the start date.");
  if (x.endDate && !isDate(x.endDate)) throw new Error("Check the end date.");
  if (x.endDate && x.endDate < x.startDate) throw new Error("The end date is before the start date.");
  placementCheck(x.department, x.section);
  const sup = await supervisor(x.supervisorId);
  const now = { department: x.department.trim(), section: x.section.trim(), supervisorId: sup.id, supervisorName: sup.name };

  if (id) {
    const r = await rows.get(id);
    if (!r || r.form_key !== TRAINEE_FORM) throw new Error("Trainee not found.");
    const t = fromRow(r);
    const placements = t.placements.length ? [...t.placements] : [{ ...now, from: x.startDate, to: null }];
    placements[placements.length - 1] = { ...placements[placements.length - 1], ...now };
    const next: Trainee = { ...t, name, gender: clean(x.gender, 10), cnic: clean(x.cnic, 20), mobile: clean(x.mobile, 20), institute, program, rollNo: clean(x.rollNo, 40), startDate: x.startDate, endDate: x.endDate || null, notes: clean(x.notes, 500), placements };
    const saved = await rows.update(id, { data: body(next), summary: `${name} · ${program}`, department: now.department, updated_by: a.userId, updated_by_name: stamp(a), revision_no: r.revision_no + 1 });
    if (!saved) throw new Error("Trainee not found.");
    return fromRow(saved);
  }
  const t: Trainee = {
    id: "", name, gender: clean(x.gender, 10), cnic: clean(x.cnic, 20), mobile: clean(x.mobile, 20), institute, program, rollNo: clean(x.rollNo, 40),
    startDate: x.startDate, endDate: x.endDate || null, status: "active", notes: clean(x.notes, 500), placements: [{ ...now, from: x.startDate, to: null }], createdBy: null,
  };
  const created = await rows.create({
    form_key: TRAINEE_FORM, form_version: 1, scope: "staff", department: now.department, status: "active",
    data: body(t), summary: `${name} · ${program}`, created_by: a.userId, created_by_name: stamp(a), revision_no: 0,
  } as Partial<TraineeRow>);
  return fromRow(created);
}

/** Moves a trainee to the next section (a rotation): the current placement ends the day before. */
export async function moveTrainee(id: string, to: { department: string; section: string; supervisorId?: string | null; from: string }): Promise<Trainee> {
  const a = await need();
  const r = await rows.get(id);
  if (!r || r.form_key !== TRAINEE_FORM) throw new Error("Trainee not found.");
  const t = fromRow(r);
  if (t.status !== "active") throw new Error(`${t.name}'s training has ended.`);
  if (!isDate(to.from)) throw new Error("Enter the date the new placement starts.");
  placementCheck(to.department, to.section);
  const cur = currentPlacement(t);
  if (cur && to.from <= cur.from) throw new Error(`The new placement must start after ${cur.from}.`);
  if (cur && cur.department === to.department.trim() && cur.section === to.section.trim()) throw new Error(`${t.name} is already in ${to.section}.`);
  const sup = await supervisor(to.supervisorId);
  const placements = t.placements.map((p, i) => (i === t.placements.length - 1 ? { ...p, to: dayBefore(to.from) } : p));
  placements.push({ department: to.department.trim(), section: to.section.trim(), supervisorId: sup.id, supervisorName: sup.name, from: to.from, to: null });
  const saved = await rows.update(id, { data: body({ ...t, placements }), department: to.department.trim(), updated_by: a.userId, updated_by_name: stamp(a), revision_no: r.revision_no + 1 });
  return fromRow(saved!);
}

/** Ends a trainee's placement: completed, or left early. */
export async function endTraining(id: string, status: Exclude<TraineeStatus, "active">, on: string = localDate()): Promise<Trainee> {
  const a = await need();
  const r = await rows.get(id);
  if (!r || r.form_key !== TRAINEE_FORM) throw new Error("Trainee not found.");
  if (!(status in TRAINEE_STATUS) || status === ("active" as string)) throw new Error("Choose completed or left early.");
  if (!isDate(on)) throw new Error("Check the date.");
  const t = fromRow(r);
  const placements = t.placements.map((p, i) => (i === t.placements.length - 1 && !p.to ? { ...p, to: on } : p));
  const saved = await rows.update(id, { status, data: body({ ...t, endDate: on, placements }), updated_by: a.userId, updated_by_name: stamp(a), revision_no: r.revision_no + 1 });
  return fromRow(saved!);
}

/** Trainees, newest first; by status and department when asked. */
export async function listTrainees(filter: { status?: TraineeStatus | ""; department?: string } = {}): Promise<Trainee[]> {
  const where = ["form_key = ?"];
  const params: unknown[] = [TRAINEE_FORM];
  if (filter.status) { where.push("status = ?"); params.push(filter.status); }
  if (filter.department) { where.push("department = ?"); params.push(filter.department); }
  return (await rows.list({ where: where.join(" AND "), params, orderBy: "created_at DESC" })).map(fromRow);
}

/** Active trainees per department and section, for the page's summary. */
export function traineeCounts(list: Trainee[]): { department: string; section: string; n: number }[] {
  const m = new Map<string, number>();
  for (const t of list) {
    if (t.status !== "active") continue;
    const p = currentPlacement(t);
    if (!p) continue;
    const k = `${p.department}\u0000${p.section}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => { const [department, section] = k.split("\u0000"); return { department, section, n }; })
    .sort((a, b) => a.department.localeCompare(b.department) || a.section.localeCompare(b.section));
}
