"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MEASUREMENT_GARMENTS, MEASUREMENT_POINTS, parseMeasurements, saveMeasurement, type ClothMeasurement } from "@/lib/cloth";

/** A customer's custom size: name, mobile, garment and its measurement
 * points (inches), saved in the measurements book for next time. */
export function MeasurementForm({ initial, defaults, onSaved, onCancel }: {
  initial: ClothMeasurement | null;
  /** Prefill for a new one (e.g. the customer on the bill). */
  defaults?: { customer_name?: string; mobile?: string };
  onSaved: (m: ClothMeasurement) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.customer_name ?? defaults?.customer_name ?? "");
  const [mobile, setMobile] = useState(initial?.mobile ?? defaults?.mobile ?? "");
  const [garment, setGarment] = useState(initial?.garment ?? MEASUREMENT_GARMENTS[0]);
  const [values, setValues] = useState<Record<string, string>>(parseMeasurements(initial?.measurements));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const points = MEASUREMENT_POINTS[garment] ?? MEASUREMENT_POINTS.Other;
  // Points saved earlier that the chosen garment does not list stay visible.
  const extra = Object.keys(values).filter((k) => !points.includes(k) && values[k]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveMeasurement(initial?.id ?? null, { customer_name: name, mobile, garment, values, notes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Customer name" required><Input id="ms-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Mobile"><Input id="ms-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="03001234567" inputMode="tel" /></Field>
        <Field label="Garment" required>
          <Select id="ms-garment" value={garment} onChange={(e) => setGarment(e.target.value)}>
            {MEASUREMENT_GARMENTS.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-neutral-600">Measurements (inches)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[...points, ...extra].map((p) => (
            <label key={p} className="flex flex-col gap-0.5 text-xs text-neutral-600">
              {p}
              <Input aria-label={p} value={values[p] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))} inputMode="decimal" className="tabular-nums" />
            </label>
          ))}
        </div>
      </div>
      <Field label="Notes"><Textarea id="ms-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. loose fitting, two side pockets" /></Field>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save measurements"}</Button>
      </div>
    </div>
  );
}
