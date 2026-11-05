/** What a clinic / diagnostic-lab report says, built from its orders. Used by
 * the printed report (ClinicReportModal) and the public online copy behind the
 * QR code (src/server/labVisitReport.ts), so both show the same content. No
 * browser or database dependencies. */
import { parseComponents } from "../config/labPanels";
import { APP_URL } from "../config/site";

export interface LabPart { key: string; name: string; group: string | null; value: string; unit: string | null; range: string | null; flag: string | null }
export interface LabLine { id: string; name: string; value: string | null; unit: string | null; range: string | null; flag: string | null; parts: LabPart[] }

export interface LabReportView {
  title: string;
  info: { label: string; value: string; strong?: boolean }[];
  lab: LabLine[];
  radiology: { id: string; name: string; findings: string | null; impression: string | null }[];
  comments: string[];
  /** e.g. "Verified by: Dr. Sana" (signature line, or the closing line when there is none). */
  signedBy: string;
}

/** The order fields the report reads. */
export interface ReportOrder {
  id: string; order_no: string; kind: string; name: string; result_value: string | null; unit: string | null; ref_range: string | null;
  flag: string | null; components?: string | null; findings?: string | null; impression?: string | null; reported_by?: string | null;
  reported_at?: string | null; verified_by?: string | null; pathologist_note?: string | null;
}

export function buildLabReportView(input: {
  orders: ReportOrder[];
  patient: { name: string; mrn: string | null; gender: string | null; dob: string | null } | null;
  referredBy: string | null;
  signature: boolean;
}): LabReportView {
  const { orders, patient } = input;
  const lab = orders.filter((o) => o.kind === "lab");
  const radiology = orders.filter((o) => o.kind === "radiology");
  const reportedBy = [...new Set(orders.map((o) => o.reported_by).filter(Boolean))].join(", ");
  // A diagnostic lab: the pathologist verified the results, with any comments.
  const verified = orders.some((o) => o.verified_by);
  const comments = [...new Set(orders.map((o) => o.pathologist_note).filter((n): n is string => Boolean(n) && !n!.startsWith("Recheck:")))];
  const byLabel = verified ? "Verified by" : "Reported by";
  const lastReported = orders.map((o) => o.reported_at ?? "").sort().at(-1) || "—";
  return {
    title: lab.length ? "Laboratory Report" : "Radiology Report",
    info: [
      { label: "Patient", value: patient?.name ?? "—", strong: true },
      { label: "MRN", value: patient?.mrn ?? "—" },
      { label: "Gender / DOB", value: [patient?.gender, patient?.dob].filter(Boolean).join(" / ") || "—" },
      { label: "Referred by", value: input.referredBy ?? "—" },
      { label: orders.length > 1 ? "Orders" : "Order", value: orders.map((o) => o.order_no).join(", ") },
      { label: "Reported", value: lastReported },
    ],
    lab: lab.map((o) => ({
      id: o.id, name: o.name, value: o.result_value, unit: o.unit, range: o.ref_range, flag: o.flag,
      parts: parseComponents(o.components).map((c) => ({ key: c.key, name: c.name, group: c.group, value: c.value, unit: c.unit, range: c.ref_range, flag: c.flag })),
    })),
    radiology: radiology.map((o) => ({ id: o.id, name: o.name, findings: o.findings ?? null, impression: o.impression ?? null })),
    comments,
    signedBy: reportedBy ? `${byLabel}: ${reportedBy}` : input.signature ? byLabel : `${byLabel}: —`,
  };
}

/** A made-up report to preview designs (no real patient). */
export const SAMPLE_LAB_REPORT: LabReportView = {
  title: "Laboratory Report",
  info: [
    { label: "Patient", value: "Sample Patient", strong: true },
    { label: "MRN", value: "MRN-000123" },
    { label: "Gender / DOB", value: "Male / 1990-05-14" },
    { label: "Referred by", value: "Dr. Sample Doctor" },
    { label: "Order", value: "LAB-20261105-001" },
    { label: "Reported", value: "2026-11-05 10:30" },
  ],
  lab: [
    {
      id: "cbc", name: "Complete Blood Count (CBC)", value: null, unit: null, range: null, flag: null,
      parts: [
        { key: "hb", name: "Haemoglobin (Hb)", group: "Red cells", value: "12.1", unit: "g/dL", range: "13.0-17.0", flag: "L" },
        { key: "rbc", name: "RBC count", group: "Red cells", value: "4.8", unit: "×10⁶/µL", range: "4.5-5.5", flag: "N" },
        { key: "tlc", name: "Total Leucocyte Count", group: "White cells", value: "12.6", unit: "×10³/µL", range: "4.0-11.0", flag: "H" },
        { key: "plt", name: "Platelet count", group: "Platelets", value: "250", unit: "×10³/µL", range: "150-400", flag: "N" },
      ],
    },
    { id: "fbs", name: "Blood Sugar (Fasting)", value: "96", unit: "mg/dL", range: "70-110", flag: "N", parts: [] },
  ],
  radiology: [],
  comments: ["Mild anaemia with raised TLC; correlate clinically."],
  signedBy: "Verified by: Dr. Sample Pathologist",
};

/** This web address (patients open the QR there), or the app's address from the desktop app. */
export function publicOrigin(): string {
  if (typeof window === "undefined") return APP_URL;
  const { protocol, hostname, origin } = window.location;
  return /^https?:$/.test(protocol) && !hostname.includes("tauri") && hostname !== "localhost" ? origin : APP_URL;
}

/** Address of the online report behind a lab visit's QR code. */
export const labReportUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}/lab-report/?t=${encodeURIComponent(token)}`;
