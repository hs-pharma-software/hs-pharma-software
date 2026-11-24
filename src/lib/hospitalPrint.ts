/** Hospital Profile > Print templates: the paper of lab reports (A4 or A5),
 * radiology reports (A4) and prescriptions (A4), and what the prescription
 * shows. Kept with the business's settings. */
import { getSetting, setSetting } from "./repo/settings";

export type LabPaper = "a4" | "a5";

export interface HospitalPrintSettings {
  labPaper: LabPaper;
  /** The owner allows the doctor's qualification / designation on prescriptions. */
  rxShowQualification: boolean;
  rxShowDesignation: boolean;
  /** Printed in the prescription footer (e.g. "Bring this prescription on your next visit"). */
  rxFooterNote: string;
  /** Other registration numbers for the header (e.g. "PMDC Institution No. 1234 · Drug Licence 567"). */
  otherRegistrations: string;
}

export const DEFAULT_PRINT: HospitalPrintSettings = { labPaper: "a4", rxShowQualification: true, rxShowDesignation: true, rxFooterNote: "", otherRegistrations: "" };
const KEY = "hospital.print";

export async function loadHospitalPrint(): Promise<HospitalPrintSettings> {
  try {
    const raw = await getSetting(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<HospitalPrintSettings>) : {};
    return { ...DEFAULT_PRINT, ...v, labPaper: v.labPaper === "a5" ? "a5" : "a4" };
  } catch {
    return { ...DEFAULT_PRINT };
  }
}

export async function saveHospitalPrint(s: HospitalPrintSettings): Promise<void> {
  await setSetting(KEY, JSON.stringify({ ...s, rxFooterNote: s.rxFooterNote.trim(), otherRegistrations: s.otherRegistrations.trim() }));
}

export interface HospitalProfileInfo { name: string; registration_no: string; ntn: string; phone: string; email: string; address: string; city: string }

/** The Hospital Profile's details for printed headers. */
export async function loadHospitalProfile(fallbackName: string): Promise<HospitalProfileInfo> {
  let p: Partial<HospitalProfileInfo> = {};
  try { p = JSON.parse((await getSetting("hospital.profile")) ?? "{}"); } catch { p = {}; }
  return { name: p.name || fallbackName, registration_no: p.registration_no ?? "", ntn: p.ntn ?? "", phone: p.phone ?? "", email: p.email ?? "", address: p.address ?? "", city: p.city ?? "" };
}

/** "Monday, 24 November 2026". */
export const dateWithDay = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** What the prescription's QR code says: enough to check it against the hospital's record. */
export function prescriptionQrText(d: {
  ep: { episode_no: string; date: string }; patient: { name: string; mr_no: string | null } | null; doctor: { name: string } | null; profile: { name: string };
}): string {
  return [`Rx ${d.ep.episode_no}`, d.profile.name, `${d.patient?.name ?? ""} ${d.patient?.mr_no ?? ""}`.trim(), d.ep.date, d.doctor ? `Dr ${d.doctor.name.replace(/^Dr\.?\s*/i, "")}` : null]
    .filter(Boolean).join(" | ");
}
