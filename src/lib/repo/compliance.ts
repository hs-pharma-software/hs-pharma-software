/** MSDS self-assessment: what this hospital's own records in the software
 * show against each chapter of the PHC Minimum Service Delivery Standards.
 *
 * This is an internal readiness view built only from data entered here. It
 * is not an inspection, a licence, a score from the PHC or an accreditation,
 * and it never says so. A check with no records shows "no data", never "met". */
import { localDate } from "../localDate";
import { addDays } from "./facility";
import { erIndicators } from "./emergency";
import { listCriticalAlerts, listComplaints, listIncidents, listCapa } from "./quality";
import { hhCompliance } from "./handHygiene";
import { listCycles } from "./cssd";
import { bloodIndicators } from "./bloodBank";
import { listLicences, listEquipment, drillSchedule } from "./facility";
import { staffHrStatus, rosterRange, isClinical } from "./hrRecords";
import { requiredDocumentStatus } from "./documents";

export const MSDS_AREAS: [string, string][] = [
  ["AAC", "Access, assessment and continuity of care"],
  ["COP", "Care of patients"],
  ["MOM", "Management of medication"],
  ["PRE", "Patient rights and education"],
  ["IPC", "Infection prevention and control"],
  ["CQI", "Continuous quality improvement"],
  ["ROM", "Responsibilities of management"],
  ["FMS", "Facility management and safety"],
  ["HRM", "Human resource management"],
  ["IMS", "Information management system"],
];

/** The hospital's own targets used to colour the checks. */
export const TARGETS = { erSeenPct: 90, criticalPct: 95, complaintsPct: 90, handHygienePct: 80 };

export type CheckState = "ok" | "attention" | "no_data";
export interface ComplianceCheck { area: string; label: string; state: CheckState; detail: string; href: string }

const WINDOW_DAYS = 90;
const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));

export async function complianceSnapshot(today: string = localDate()): Promise<{ checks: ComplianceCheck[]; from: string; to: string }> {
  const from = addDays(today, -WINDOW_DAYS);
  const range = { from, to: today };
  const checks: ComplianceCheck[] = [];
  const add = (c: ComplianceCheck) => checks.push(c);
  /** Runs one check; a register that cannot be read (for example an older database) shows as no data. */
  const run = async (area: string, label: string, href: string, f: () => Promise<Omit<ComplianceCheck, "area" | "label" | "href">>) => {
    try { add({ area, label, href, ...(await f()) }); } catch { add({ area, label, href, state: "no_data", detail: "This register could not be read." }); }
  };

  // Key documents, per chapter.
  let docs: Awaited<ReturnType<typeof requiredDocumentStatus>> = [];
  try { docs = await requiredDocumentStatus(today); } catch { docs = []; }
  for (const [area] of MSDS_AREAS) {
    const mine = docs.filter((d) => d.area === area);
    if (!mine.length) continue;
    const ok = mine.filter((d) => d.state === "approved");
    const overdue = mine.filter((d) => d.state === "review_overdue").map((d) => d.title);
    const missing = mine.filter((d) => d.state === "missing" || d.state === "draft").map((d) => d.title);
    add({
      area, label: "Key policies approved and in review date", href: "/hospital/quality/documents",
      state: ok.length === mine.length ? "ok" : "attention",
      detail: `${ok.length} of ${mine.length}.${missing.length ? ` Not approved: ${list(missing)}.` : ""}${overdue.length ? ` Review overdue: ${list(overdue)}.` : ""}`,
    });
  }

  await run("AAC", "Emergency patients seen by a doctor within their triage target", "/hospital/emergency/board", async () => {
    const er = await erIndicators(range);
    if (!er.triaged) return { state: "no_data", detail: `No triaged emergency visits in the last ${WINDOW_DAYS} days.` };
    return { state: (er.seenInTargetPct ?? 0) >= TARGETS.erSeenPct ? "ok" : "attention", detail: `${er.seenInTargetPct}% of ${er.triaged} triaged patients (target ${TARGETS.erSeenPct}%). Median arrival to doctor ${er.doorToDoctorMedian ?? "—"} min.` };
  });

  await run("COP", "Critical results told to the clinician with read-back", "/hospital/lab/critical", async () => {
    const all = await listCriticalAlerts({});
    const recent = all.filter((c) => c.detected_at.slice(0, 10) >= from);
    const pending = all.filter((c) => c.status === "pending").length;
    if (!recent.length && !pending) return { state: "no_data", detail: `No critical results in the last ${WINDOW_DAYS} days.` };
    const inTime = recent.filter((c) => c.status === "notified" && (c.minutes_open ?? 0) <= 30).length;
    const pct = recent.length ? Math.round((inTime / recent.length) * 100) : 100;
    return { state: pending === 0 && pct >= TARGETS.criticalPct ? "ok" : "attention", detail: `${pct}% told within 30 minutes (target ${TARGETS.criticalPct}%).${pending ? ` ${pending} waiting now.` : ""}` };
  });

  await run("COP", "Serious transfusion reactions reported to the Authority", "/hospital/blood-bank", async () => {
    const b = await bloodIndicators(range);
    if (!b.transfused) return { state: "no_data", detail: `No transfusions in the last ${WINDOW_DAYS} days.` };
    return { state: b.seriousNotReported ? "attention" : "ok", detail: `${b.transfused} units transfused, ${b.reactions} reactions.${b.seriousNotReported ? ` ${b.seriousNotReported} serious reaction(s) not reported.` : ""}` };
  });

  await run("PRE", "Complaints acknowledged and resolved on time", "/hospital/quality", async () => {
    const all = await listComplaints({}, today);
    const recent = all.filter((c) => c.received_at.slice(0, 10) >= from);
    const late = all.filter((c) => c.ack_overdue || c.resolve_overdue).length;
    if (!recent.length && !late) return { state: "no_data", detail: `No complaints recorded in the last ${WINDOW_DAYS} days.` };
    return { state: late ? "attention" : "ok", detail: `${recent.length} received in ${WINDOW_DAYS} days.${late ? ` ${late} past their deadline.` : " None past their deadline."}` };
  });

  await run("IPC", "Hand hygiene compliance (observed audits)", "/hospital/ipc", async () => {
    const hh = await hhCompliance(range);
    if (!hh.overall.opportunities) return { state: "no_data", detail: `No hand hygiene audits in the last ${WINDOW_DAYS} days.` };
    return { state: (hh.overall.rate ?? 0) >= TARGETS.handHygienePct ? "ok" : "attention", detail: `${hh.overall.rate}% of ${hh.overall.opportunities} observed opportunities (target ${TARGETS.handHygienePct}%).` };
  });

  await run("IPC", "Failed or recalled sterilization loads followed up", "/hospital/cssd", async () => {
    const cycles = (await listCycles({ limit: 1000 })).filter((c) => c.started_at.slice(0, 10) >= from);
    if (!cycles.length) return { state: "no_data", detail: `No sterilization cycles in the last ${WINDOW_DAYS} days.` };
    const open = cycles.filter((c) => (c.status === "failed" || c.status === "recalled") && !c.reprocessed_in_cycle_id).length;
    const waiting = cycles.filter((c) => c.status === "awaiting_release").length;
    return { state: open ? "attention" : "ok", detail: `${cycles.length} cycles.${open ? ` ${open} failed or recalled load(s) not reprocessed.` : ""}${waiting ? ` ${waiting} awaiting release.` : ""}` };
  });

  await run("CQI", "Incidents are being reported", "/hospital/quality", async () => {
    const all = await listIncidents({}, today);
    const recent = all.filter((x) => x.reported_at.slice(0, 10) >= from).length;
    return recent
      ? { state: "ok", detail: `${recent} incident(s) and near misses reported in ${WINDOW_DAYS} days.` }
      : { state: "attention", detail: `No incidents reported in ${WINDOW_DAYS} days. A hospital this size reporting none usually means incidents are not being reported.` };
  });

  await run("CQI", "Root cause analyses and corrective actions on time", "/hospital/quality", async () => {
    const rca = (await listIncidents({ status: "active" }, today)).filter((x) => x.rca_overdue).length;
    const capa = (await listCapa({ status: "active" }, today)).filter((c) => c.overdue).length;
    return { state: rca || capa ? "attention" : "ok", detail: `${rca} RCA overdue, ${capa} corrective action(s) overdue.` };
  });

  await run("ROM", "Required licences and certificates held and valid", "/hospital/facility", async () => {
    const { current, missing } = await listLicences(today);
    const expired = current.filter((l) => l.state === "expired").map((l) => l.label);
    const expiring = current.filter((l) => l.state === "expiring").map((l) => l.label);
    if (!current.length) return { state: "no_data", detail: "No licences recorded yet." };
    return {
      state: expired.length || missing.length ? "attention" : "ok",
      detail: `${current.length} recorded.${missing.length ? ` Not recorded: ${list(missing)}.` : ""}${expired.length ? ` Expired: ${list(expired)}.` : ""}${expiring.length ? ` Expiring soon: ${list(expiring)}.` : ""}`,
    };
  });

  await run("FMS", "Equipment maintenance and calibration up to date", "/hospital/facility", async () => {
    const eq = (await listEquipment({ status: "active" }, today));
    if (!eq.length) return { state: "no_data", detail: "The equipment register is empty." };
    const late = (k: "ppm" | "calibration") => eq.filter((e) => e[k].state === "overdue" || e[k].state === "never").length;
    const critOut = eq.filter((e) => e.is_critical && e.status === "out_of_service").map((e) => `${e.asset_no} ${e.name}`);
    const ppm = late("ppm");
    const cal = late("calibration");
    return {
      state: ppm || cal || critOut.length ? "attention" : "ok",
      detail: `${eq.length} items. ${ppm} maintenance and ${cal} calibration overdue or never done.${critOut.length ? ` Critical equipment out of service: ${list(critOut)}.` : ""}`,
    };
  });

  await run("FMS", "Mock drills held on schedule", "/hospital/facility", async () => {
    const s = await drillSchedule(today);
    const late = s.filter((d) => d.state === "overdue" || d.state === "never").map((d) => d.label);
    return { state: late.length ? "attention" : "ok", detail: late.length ? `Due or never held: ${list(late)}.` : "Every drill held within its interval." };
  });

  await run("HRM", "Staff orientation and mandatory training", "/hospital/hr", async () => {
    const hr = await staffHrStatus(today);
    if (!hr.length) return { state: "no_data", detail: "No hospital staff recorded." };
    const gaps = hr.filter((h) => h.missingTraining.length || h.expiredTraining.length);
    const bls = hr.filter((h) => isClinical(h.staff) && [...h.missingTraining, ...h.expiredTraining].some((t) => t.includes("BLS"))).length;
    return { state: gaps.length ? "attention" : "ok", detail: `${hr.length - gaps.length} of ${hr.length} staff complete.${bls ? ` ${bls} clinical staff without current BLS.` : ""}` };
  });

  await run("HRM", "Professional registration verified at the source", "/hospital/hr", async () => {
    const hr = (await staffHrStatus(today)).filter((h) => h.registrationVerified !== null);
    if (!hr.length) return { state: "no_data", detail: "No staff whose designation needs a registration." };
    const not = hr.filter((h) => !h.registrationVerified).map((h) => h.staff.name);
    return { state: not.length ? "attention" : "ok", detail: `${hr.length - not.length} of ${hr.length} verified.${not.length ? ` Not verified: ${list(not)}.` : ""}` };
  });

  await run("HRM", "Yearly performance appraisals", "/hospital/hr", async () => {
    const hr = await staffHrStatus(today);
    if (!hr.length) return { state: "no_data", detail: "No hospital staff recorded." };
    const due = hr.filter((h) => h.appraisalDue).length;
    return { state: due ? "attention" : "ok", detail: `${due} of ${hr.length} staff due an appraisal.` };
  });

  await run("HRM", "Duty roster published for the coming week", "/hospital/hr", async () => {
    const r = await rosterRange(today, addDays(today, 6));
    const days = new Set(r.map((x) => x.duty_date)).size;
    return r.length ? { state: days === 7 ? "ok" : "attention", detail: `Roster entries on ${days} of the next 7 days.` } : { state: "no_data", detail: "No roster entered for the next 7 days." };
  });

  return { checks, from, to: today };
}
