"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { rosterRange, setRosterShift, hospitalStaffList } from "@/lib/repo/hrRecords";
import { currentActor, roleAllowed } from "@/lib/repo/medicalRecord";
import { addDays } from "@/lib/repo/facility";
import { ROSTER_SHIFTS, ON_DUTY_SHIFTS, type RosterShift } from "@/config/facility";
import { designation, ROSTER_ROLES, STAFF_GROUPS, staffGroup, type StaffGroup } from "@/config/hospitalStaff";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { Staff } from "@/lib/types";
import type { RosterEntry } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const SHIFT_CLS: Record<RosterShift, string> = {
  M: "bg-sky-100 text-sky-800", E: "bg-amber-100 text-amber-800", N: "bg-indigo-600 text-white", L: "bg-teal-100 text-teal-800",
  C: "bg-violet-100 text-violet-800", O: "bg-neutral-100 text-neutral-500", LV: "bg-rose-100 text-rose-700",
};
const GROUP_ORDER: StaffGroup[] = ["doctors", "nurses", "paramedical", "technical", "support"];
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
/** Monday of the week a day falls in. */
const mondayOf = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  const back = (x.getUTCDay() + 6) % 7;
  return addDays(d, -back);
};

/** HR Department > Duty Roster: who is on which shift, day by day, for doctors,
 * nurses, paramedical, technical and support staff. Made by HR, the Nursing
 * Superintendent, a Head Nurse or a Head of Department; everyone else with the
 * page can read it. */
export default function DutyRosterPage() {
  const [start, setStart] = useState(() => mondayOf(localDate()));
  const [group, setGroup] = useState<StaffGroup | "">("");
  const [dept, setDept] = useState("");
  const [search, setSearch] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const today = localDate();

  const load = async () => {
    if (!isTauri()) return;
    try {
      setStaff(await hospitalStaffList());
      setEntries(await rosterRange(days[0], days[6]));
    } catch (e) { err(e); }
  };
  useEffect(() => { void load(); }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void currentActor().then((a) => setCanEdit(roleAllowed(ROSTER_ROLES, a))).catch(() => setCanEdit(false)); }, []);

  const departments = [...new Set(staff.map((s) => s.department).filter(Boolean) as string[])].sort();
  const q = search.trim().toLowerCase();
  const shown = staff.filter((s) => (!group || staffGroup(s.staff_category) === group) && (!dept || s.department === dept)
    && (!q || `${s.name} ${s.employee_id ?? ""} ${s.designation ?? ""}`.toLowerCase().includes(q)));
  const byGroup = GROUP_ORDER.map((g) => ({ g, list: shown.filter((s) => staffGroup(s.staff_category) === g).sort((a, b) => a.name.localeCompare(b.name)) })).filter((x) => x.list.length);
  const at = (s: Staff, d: string) => entries.find((x) => x.staff_id === s.id && x.duty_date === d);

  const set = async (s: Staff, day: string, shift: RosterShift | "") => {
    try {
      await setRosterShift(s.id, day, shift);
      setEntries(await rosterRange(days[0], days[6]));
    } catch (e) { err(e); }
  };

  /** Last week's shifts for the staff on screen, day for day (cells already filled stay). */
  const copyLastWeek = async () => {
    setBusy("Copying last week…");
    try {
      const prev = await rosterRange(addDays(start, -7), addDays(start, -1));
      let copied = 0, skipped = 0;
      for (const s of shown) {
        for (let i = 0; i < 7; i++) {
          const from = prev.find((x) => x.staff_id === s.id && x.duty_date === addDays(start, i - 7));
          if (!from || at(s, days[i])) continue;
          try { await setRosterShift(s.id, days[i], from.shift as RosterShift, { department: from.department }); copied++; } catch { skipped++; }
        }
      }
      setEntries(await rosterRange(days[0], days[6]));
      window.alert(`${copied} shift${copied === 1 ? "" : "s"} copied${skipped ? `, ${skipped} left out (rest rule after a night duty)` : ""}.`);
    } catch (e) { err(e); } finally { setBusy(null); }
  };

  // On duty today (or the week's first day when today is outside it), per shift.
  const focus = days.includes(today) ? today : days[0];
  const onDuty = ON_DUTY_SHIFTS.map((k) => ({ k, n: entries.filter((x) => x.duty_date === focus && x.shift === k && shown.some((s) => s.id === x.staff_id)).length }));

  return (
    <div>
      <PageHeader title="Duty Roster" actions={
        <div className="flex gap-2 print:hidden">
          {canEdit && <Button variant="secondary" onClick={() => void copyLastWeek()} disabled={!!busy}><Copy size={14} />Copy last week</Button>}
          <Button variant="secondary" onClick={() => window.print()}><Printer size={14} />Print</Button>
        </div>
      } />
      <div className={`${card} print:hidden`}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-end gap-1">
            <Button variant="secondary" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={16} /></Button>
            <Field label="Week of"><Input id="dr-start" type="date" value={start} onChange={(e) => e.target.value && setStart(mondayOf(e.target.value))} /></Field>
            <Button variant="secondary" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={16} /></Button>
            <Button variant="secondary" onClick={() => setStart(mondayOf(localDate()))}>This week</Button>
          </div>
          <Field label="Staff">
            <Select id="dr-group" value={group} onChange={(e) => setGroup(e.target.value as StaffGroup | "")}>
              <option value="">Everyone</option>{GROUP_ORDER.map((g) => <option key={g} value={g}>{STAFF_GROUPS[g]}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select id="dr-dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{departments.map((d) => <option key={d}>{d}</option>)}</Select>
          </Field>
          <Field label="Search"><Input id="dr-q" value={search} placeholder="Name or employee id" onChange={(e) => setSearch(e.target.value)} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-neutral-600">On duty {focus === today ? "today" : weekday(focus)}:</span>
          {onDuty.map(({ k, n }) => <span key={k} className={`rounded-full px-2 py-0.5 font-semibold ${SHIFT_CLS[k]}`}>{ROSTER_SHIFTS[k].split(" ")[0]} {n}</span>)}
          {!canEdit && <span className="ml-auto text-neutral-500">View only: the roster is made by HR, the Nursing Superintendent, a Head Nurse or a Head of Department.</span>}
          {busy && <span className="ml-auto text-neutral-500">{busy}</span>}
        </div>
      </div>

      <div className={`${card} print-area mt-4`}>
        <div className="mb-2 hidden print:block">
          <p className="text-lg font-bold">Duty Roster · week of {weekday(days[0])} to {weekday(days[6])}</p>
          {(group || dept) && <p className="text-xs">{[group && STAFF_GROUPS[group], dept].filter(Boolean).join(" · ")}</p>}
        </div>
        {byGroup.length === 0 ? <p className="text-sm text-neutral-400">No staff match. Add staff under HR Department &gt; Staff.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="pb-1.5 pr-2 font-medium">Staff</th>
                  {days.map((d) => <th key={d} className={`pb-1.5 text-center font-medium ${d === today ? "text-rose-700" : ""}`}>{weekday(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {byGroup.map(({ g, list }) => (
                  <GroupRows key={g} title={`${STAFF_GROUPS[g]} (${list.length})`}>
                    {list.map((s) => (
                      <tr key={s.id} className="border-t border-neutral-100">
                        <td className="whitespace-nowrap py-1.5 pr-2">{s.name}<span className="block text-[11px] text-neutral-500">{[designation(s.staff_category)?.label ?? s.designation, s.department].filter(Boolean).join(" · ")}</span></td>
                        {days.map((d) => {
                          const shift = (at(s, d)?.shift ?? "") as RosterShift | "";
                          return (
                            <td key={d} className="px-0.5 py-1 text-center">
                              {canEdit ? (
                                <select id={`dr-${s.id}-${d}`} aria-label={`${s.name}, ${weekday(d)}`} value={shift} onChange={(ev) => void set(s, d, ev.target.value as RosterShift | "")}
                                  className={`w-14 rounded-md border-0 px-1 py-1 text-center text-xs font-semibold print:appearance-none ${shift ? SHIFT_CLS[shift] : "bg-white text-neutral-300 ring-1 ring-neutral-200"}`}>
                                  <option value="">—</option>{Object.keys(ROSTER_SHIFTS).map((k) => <option key={k} value={k}>{k}</option>)}
                                </select>
                              ) : (
                                <span className={`inline-block w-12 rounded-md py-1 text-xs font-semibold ${shift ? SHIFT_CLS[shift] : "text-neutral-300"}`}>{shift || "—"}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-neutral-500">{Object.entries(ROSTER_SHIFTS).map(([k, l]) => `${k}: ${l}`).join(" · ")}</p>
      </div>
    </div>
  );
}

function GroupRows({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr><td colSpan={8} className="pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-rose-700">{title}</td></tr>
      {children}
    </>
  );
}
