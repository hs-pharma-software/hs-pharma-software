"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { fieldShown, rangeFlag, sectionShown, type UsColumn, type UsContext, type UsField, type UsRow, type UsTemplate, type UsValues } from "@/config/ultrasoundReports";

const rangeText = (f: { min?: number; max?: number; unit?: string }) =>
  f.min != null && f.max != null ? `Normal ${f.min} to ${f.max}${f.unit ? ` ${f.unit}` : ""}`
    : f.max != null ? `Normal up to ${f.max}${f.unit ? ` ${f.unit}` : ""}`
      : f.min != null ? `Normal ${f.min}${f.unit ? ` ${f.unit}` : ""} or more` : null;

function Flag({ flag }: { flag: "High" | "Low" | null }) {
  if (!flag) return null;
  return <span className="text-[11px] font-semibold text-amber-800">{flag}</span>;
}

function YesNo({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-neutral-600">{label}</legend>
      <div className="mt-1 flex gap-1">
        {["No", "Yes"].map((o) => (
          // relative: keeps the hidden radio inside the scrolling page, so choosing it can never scroll the app's frame.
          <label key={o} className={`relative flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg px-3 text-sm ring-1 focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-violet-500 ${value === o ? "bg-violet-700 font-semibold text-white ring-violet-700" : "bg-white text-neutral-700 ring-neutral-200"}`}>
            <input type="radio" className="sr-only" name={id} checked={value === o} disabled={disabled} onChange={() => onChange(o)} />{o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ColumnInput({ c, value, onChange, disabled, label }: { c: UsColumn; value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
  if (c.type === "select") {
    return (
      <Select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select</option>
        {c.options?.map((o) => <option key={o}>{o}</option>)}
      </Select>
    );
  }
  // Text with a number keypad: a number box can change its value when the page is scrolled over it.
  return <Input aria-label={label} type="text" inputMode={c.type === "number" ? "decimal" : undefined} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

function ListField({ f, values, onChange, disabled }: { f: UsField; values: UsValues; onChange: (rows: UsRow[]) => void; disabled: boolean }) {
  const rows = Array.isArray(values[f.key]) ? (values[f.key] as UsRow[]) : [];
  const item = f.itemName ?? "item";
  const single = f.countKey ? values[f.countKey] === "One" : false;
  const canAdd = !disabled && !(single && rows.length >= 1);
  const set = (i: number, key: string, v: string) => onChange(rows.map((r, x) => (x === i ? { ...r, [key]: v } : r)));
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <p className="mb-1 text-xs font-medium text-neutral-600">{f.label}</p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg bg-neutral-50 p-2 ring-1 ring-neutral-200">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold capitalize">{item} {i + 1}</span>
              {!disabled && <button type="button" aria-label={`Remove ${item} ${i + 1}`} onClick={() => onChange(rows.filter((_, x) => x !== i))} className="flex h-8 w-8 items-center justify-center rounded text-rose-700 hover:bg-rose-50"><Trash2 size={14} /></button>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(f.columns ?? []).map((c) => (
                <Field key={c.key} label={c.unit ? `${c.label} (${c.unit})` : c.label} required={c.required}>
                  <ColumnInput c={c} label={`${item} ${i + 1} ${c.label}`} value={r[c.key] ?? ""} disabled={disabled} onChange={(v) => set(i, c.key, v)} />
                  <Flag flag={rangeFlag(r[c.key], c)} />
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>
      {canAdd && <Button type="button" variant="secondary" className="mt-2" onClick={() => onChange([...rows, {}])}><Plus size={14} />Add {item}</Button>}
    </div>
  );
}

/** The doctor fills in the scan's values; only what applies to this patient and these answers is shown. */
export function UltrasoundReportForm({ template, values, onChange, ctx, disabled = false }: {
  template: UsTemplate; values: UsValues; onChange: (v: UsValues) => void; ctx: UsContext; disabled?: boolean;
}) {
  const set = (key: string, v: UsValues[string]) => onChange({ ...values, [key]: v });
  return (
    <div className="flex flex-col gap-4">
      {template.sections.filter((s) => sectionShown(s, values, ctx.gender)).map((s) => (
        <section key={s.title} className="rounded-xl p-3 ring-1 ring-neutral-200">
          <h3 className="mb-2 text-sm font-semibold">{s.title}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.fields.filter((f) => fieldShown(f, values, ctx.gender)).map((f) => {
              const value = typeof values[f.key] === "string" ? (values[f.key] as string) : "";
              if (f.type === "list") return <ListField key={f.key} f={f} values={values} disabled={disabled} onChange={(rows) => set(f.key, rows)} />;
              if (f.type === "yesno") return <YesNo key={f.key} id={`us-${template.id}-${f.key}`} label={f.label} value={value} disabled={disabled} onChange={(v) => set(f.key, v)} />;
              if (f.type === "computed") {
                return <Field key={f.key} label={f.label}><div className="min-h-9 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm">{f.compute?.(values, ctx) ?? "—"}</div></Field>;
              }
              if (f.type === "select") {
                return (
                  <Field key={f.key} label={f.label}>
                    <Select value={value} disabled={disabled} onChange={(e) => set(f.key, e.target.value)}>
                      <option value="">Select</option>
                      {f.options?.map((o) => <option key={o}>{o}</option>)}
                    </Select>
                  </Field>
                );
              }
              const hint = f.type === "number" ? rangeText(f) : null;
              return (
                <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                  <Input type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} value={value} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />
                  {(hint || rangeFlag(value, f)) && <span className="flex justify-between gap-2 text-[11px] text-neutral-500"><span>{hint}</span><Flag flag={f.type === "number" ? rangeFlag(value, f) : null} /></span>}
                </Field>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
