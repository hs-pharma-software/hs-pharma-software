/** Safety checklists shown at a point of care. Every answer is chosen by a
 * person: nothing is ever recorded as done because a screen was opened or a
 * note saved. A self-confirmation (the clinician affirms they did it) and an
 * observation (an auditor saw it) are different kinds and never mixed. */
import type { EpisodeType } from "../../lib/types-hospital";

export type ChecklistStatus = "completed" | "not_completed" | "na" | "pending";
export type ChecklistKind = "self_confirmation" | "observation";

export const STATUS_LABEL: Record<ChecklistStatus, string> = {
  completed: "Done",
  not_completed: "Not done",
  na: "Not applicable",
  pending: "Pending",
};

export interface ChecklistContext {
  episodeType: EpisodeType;
  /** The patient is admitted (IPD) in this episode. */
  admitted: boolean;
  /** A surgery or another procedure needing consent is planned in this episode. */
  procedurePlanned: boolean;
}

export interface ChecklistItem {
  key: string;
  label: string;
  kind: ChecklistKind;
  /** Must be answered (pending is an answer) and a "not done" needs a reason. */
  mandatory: boolean;
  /** Not applicable is a normal answer here (no reason needed). */
  naExpected?: boolean;
  msds: string[];
  /** Shown only in this context; absent = always. */
  when?: (c: ChecklistContext) => boolean;
}

export interface ChecklistDef {
  key: string;
  version: number;
  title: string;
  items: ChecklistItem[];
}

export const DOCTOR_VISIT_CHECKLIST: ChecklistDef = {
  key: "doctor_visit",
  version: 1,
  title: "Visit safety checks",
  items: [
    { key: "identity_verified", label: "Patient identity checked with two identifiers (name and MR number)", kind: "self_confirmation", mandatory: true, msds: ["MOM-3 · 64", "COP-3 · 30"] },
    { key: "hand_hygiene", label: "Hand hygiene performed before touching the patient", kind: "self_confirmation", mandatory: true, msds: ["IPC-1 · 84a"] },
    { key: "ppe", label: "PPE used as this patient requires", kind: "self_confirmation", mandatory: false, naExpected: true, msds: ["IPC-1 · 84c"] },
    { key: "allergies_reviewed", label: "Allergy status reviewed with the patient / record", kind: "self_confirmation", mandatory: true, msds: [] },
    {
      key: "medicines_reviewed", label: "Current medicines, including those brought from home, reviewed", kind: "self_confirmation", mandatory: true,
      msds: ["MOM-3 · 71"], when: (c) => c.admitted,
    },
    {
      key: "consent_before_procedure", label: "Informed consent recorded before the planned procedure", kind: "self_confirmation", mandatory: true,
      msds: ["PRE-1 · 73", "COP-5 · 43"], when: (c) => c.procedurePlanned,
    },
  ],
};

export const CHECKLISTS: ChecklistDef[] = [DOCTOR_VISIT_CHECKLIST];

export function checklistDef(key: string): ChecklistDef | null {
  return CHECKLISTS.find((c) => c.key === key) ?? null;
}

/** The items that apply in this context, in order. */
export function applicableItems(def: ChecklistDef, ctx: ChecklistContext): ChecklistItem[] {
  return def.items.filter((i) => !i.when || i.when(ctx));
}

export interface ChecklistAnswer {
  item: string;
  status: ChecklistStatus | "";
  reason?: string;
}

/** Problems with a set of answers; empty = can be saved. */
export function validateChecklist(def: ChecklistDef, ctx: ChecklistContext, answers: ChecklistAnswer[]): string[] {
  const items = applicableItems(def, ctx);
  const errors: string[] = [];
  for (const a of answers) {
    if (!items.some((i) => i.key === a.item)) errors.push(`"${a.item}" is not part of this checklist here.`);
  }
  for (const item of items) {
    const a = answers.find((x) => x.item === item.key);
    const reason = a?.reason?.trim();
    if (!a || !a.status) {
      if (item.mandatory) errors.push(`Answer: ${item.label}.`);
      continue;
    }
    if (a.status === "not_completed" && !reason) errors.push(`Give the reason it was not done: ${item.label}.`);
    if (a.status === "na" && item.mandatory && !item.naExpected && !reason) errors.push(`Give the reason it does not apply: ${item.label}.`);
  }
  return errors;
}
