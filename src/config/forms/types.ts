/** Definitions of the hospital's medical-record forms and registers (PHC
 * MSDS, Category I). A definition is versioned: a saved record keeps the
 * version it was filled with, so changing a form never rewrites old records. */
import type { EpisodeType } from "../../lib/types-hospital";

export type FieldType = "text" | "textarea" | "number" | "date" | "datetime" | "select" | "yesno" | "heading";

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  help?: string;
  unit?: string;
  min?: number;
  max?: number;
  /** Shown (and required) only when another field has this value. */
  showIf?: { field: string; equals: string };
}

/** Who may do what, by HR designation key (src/config/hospitalStaff.ts) or a
 * group. Owners and full-access users may always. */
export type RoleRef = "doctor" | "senior_doctor" | "nurse" | "any_clinical" | string;

export interface FormDef {
  key: string;
  version: number;
  title: string;
  department: string;
  /** MSDS references, e.g. "IMS-2 · 152". */
  msds: string[];
  classification: "Required" | "Conditional" | "Recommended" | "Confirm";
  scope: "patient" | "register";
  /** Visit / admission types the form belongs to; empty = any. */
  episodeTypes?: EpisodeType[];
  /** One per visit/admission (opening it again continues the same record);
   * with a subject, one per subject (e.g. one operative note per surgery). */
  onePerEpisode?: boolean;
  /** The record belongs to one surgery of the admission (theatre and anaesthesia forms). */
  subject?: "surgery";
  /** Forms that must be signed (for the same surgery / admission) before this one can be signed. */
  requiresFinal?: string[];
  createRoles: RoleRef[];
  /** Who finalizes (signs). A countersignature form names the senior role here. */
  finalizeRoles: RoleRef[];
  /** Saved entries are final at once (progress notes); changes are amendments. */
  finalOnSave?: boolean;
  /** Signature blocks printed at the foot (the author's digital stamp is always printed). */
  printSignatures?: string[];
  fields: FormField[];
  /** One line shown in lists. */
  summaryField?: string;
}

export type FormData = Record<string, string>;

export const visible = (f: FormField, data: FormData) => !f.showIf || (data[f.showIf.field] ?? "") === f.showIf.equals;

/** Problems that stop a record from being finalized (also checked before saving a final-on-save entry). */
export function validateForm(def: FormDef, data: FormData): string[] {
  const errors: string[] = [];
  for (const f of def.fields) {
    if (f.type === "heading" || !visible(f, data)) continue;
    const v = (data[f.key] ?? "").trim();
    if (f.required && !v) {
      errors.push(`${f.label} is required.`);
      continue;
    }
    if (!v) continue;
    if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) errors.push(`${f.label} must be a number.`);
      else if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) errors.push(`${f.label} must be between ${f.min} and ${f.max}.`);
    }
    if ((f.type === "select") && f.options && !f.options.includes(v)) errors.push(`${f.label}: choose one of the listed options.`);
    if (f.type === "yesno" && v !== "Yes" && v !== "No") errors.push(`${f.label}: answer Yes or No.`);
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${f.label} must be a date.`);
    if (f.type === "datetime" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) errors.push(`${f.label} must be a date and time.`);
  }
  return errors;
}

/** Drops values of fields that are hidden or unknown, so a record stores only what its form shows. */
export function cleanData(def: FormDef, data: FormData): FormData {
  const out: FormData = {};
  for (const f of def.fields) {
    if (f.type === "heading" || !visible(f, data)) continue;
    const v = (data[f.key] ?? "").trim();
    if (v) out[f.key] = v;
  }
  return out;
}
