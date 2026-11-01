"use client";

import type { ClinicWorkRow } from "@/lib/repo/clinicServices";
import type { LabVisitDetail, LabVisitRow } from "@/lib/repo/lab";

/** A visit's tests as worklist rows (for the result workspace). */
export function workRows(d: LabVisitDetail): ClinicWorkRow[] {
  return d.orders.map((o) => ({
    ...o, patient_name: d.patient?.name ?? "", mrn: d.patient?.mrn ?? null, gender: d.patient?.gender ?? null, dob: d.patient?.dob ?? null,
    doctor_name: d.visit.referred_by,
  }));
}

/** Where a visit's tests stand, as small chips. */
export function VisitProgress({ v }: { v: Pick<LabVisitRow, "ordered" | "collected" | "performed" | "reported" | "tests"> }) {
  const chip = (n: number, label: string, cls: string) => n > 0 && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{n} {label}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {chip(Number(v.ordered), "sample due", "bg-sky-100 text-sky-800")}
      {chip(Number(v.collected), "result due", "bg-amber-100 text-amber-800")}
      {chip(Number(v.performed), "to verify", "bg-violet-100 text-violet-800")}
      {chip(Number(v.reported), "released", "bg-emerald-100 text-emerald-800")}
    </span>
  );
}

export const PRIORITY_CLS: Record<string, string> = { routine: "text-neutral-500", urgent: "text-amber-700", stat: "text-rose-700" };

export const money = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
