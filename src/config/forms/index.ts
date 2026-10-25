/** All form definitions, looked up by key. */
import type { FormDef } from "./types";
import { MEDICAL_RECORD_FORMS } from "./medicalRecord";

export * from "./types";
export const FORMS: FormDef[] = [...MEDICAL_RECORD_FORMS];

export function formDef(key: string): FormDef | null {
  return FORMS.find((f) => f.key === key) ?? null;
}
