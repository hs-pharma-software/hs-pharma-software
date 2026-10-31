/** How the clinic's documents print: the visit invoice, lab / radiology
 * reports, and the doctor's prescription (findings with medicines). Each has
 * its paper (thermal 80 mm, A5, A4) and a few layout choices. The Super Admin
 * sets them; the clinic may change them only when its templates are not fixed
 * (Tenant > Print Templates > Allow Editing). */
import { getSetting, setSetting } from "./repo/settings";
import type { PaperSize } from "./printTemplates";

export type ClinicDoc = "invoice" | "lab" | "prescription";

export interface ClinicPrintTemplate {
  paper: PaperSize;
  headerAlign: "center" | "left";
  /** PHC registration and NTN under the address. */
  showIds: boolean;
  /** A line for the doctor's / technologist's signature at the end. */
  signature: boolean;
  /** Printed at the bottom, e.g. "Not valid for court" or opening hours. */
  footer: string;
}

export const CLINIC_DOCS: { id: ClinicDoc; label: string; hint: string }[] = [
  { id: "invoice", label: "Invoice", hint: "The visit bill: consultation, lab, radiology and services" },
  { id: "lab", label: "Lab report", hint: "Lab results and radiology reports" },
  { id: "prescription", label: "Prescription", hint: "Doctor's findings, medicines, tests advised and admission advice" },
];

export const DEFAULT_CLINIC_TEMPLATES: Record<ClinicDoc, ClinicPrintTemplate> = {
  invoice: { paper: "thermal", headerAlign: "center", showIds: true, signature: false, footer: "" },
  lab: { paper: "a4", headerAlign: "center", showIds: true, signature: true, footer: "" },
  prescription: { paper: "a5", headerAlign: "center", showIds: true, signature: true, footer: "" },
};

const KEY = (doc: ClinicDoc) => `clinic.print.${doc}`;

export async function loadClinicTemplate(doc: ClinicDoc, tenantId?: string): Promise<ClinicPrintTemplate> {
  const def = DEFAULT_CLINIC_TEMPLATES[doc];
  const raw = await getSetting(KEY(doc), tenantId).catch(() => null);
  if (!raw) return { ...def };
  try {
    const saved = JSON.parse(raw) as Partial<ClinicPrintTemplate>;
    const paper = saved.paper === "a4" || saved.paper === "a5" || saved.paper === "thermal" ? saved.paper : def.paper;
    return { ...def, ...saved, paper, footer: String(saved.footer ?? "") };
  } catch {
    return { ...def };
  }
}

export async function saveClinicTemplate(doc: ClinicDoc, t: ClinicPrintTemplate, tenantId?: string): Promise<void> {
  await setSetting(KEY(doc), JSON.stringify({ ...t, footer: t.footer.trim() }), tenantId);
}

/** Width of the printed area on screen and paper. */
export const PAPER_WIDTH: Record<PaperSize, string> = { a4: "max-w-[190mm]", a5: "max-w-[132mm]", thermal: "max-w-[74mm]" };
