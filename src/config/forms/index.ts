/** All form definitions, looked up by key. */
import type { FormDef } from "./types";
import { MEDICAL_RECORD_FORMS } from "./medicalRecord";
import { THEATRE_FORMS } from "./theatre";

export * from "./types";
export const FORMS: FormDef[] = [...MEDICAL_RECORD_FORMS, ...THEATRE_FORMS];

export function formDef(key: string): FormDef | null {
  return FORMS.find((f) => f.key === key) ?? null;
}
