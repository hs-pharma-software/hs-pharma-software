"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { flagFor, rangeForSex, type PanelParam } from "@/config/labPanels";
import type { LabComponent } from "@/lib/types-hospital";

type Row = { key: string; name: string; group: string | null; value: string; unit: string; range: string; flag: "N" | "H" | "L" | ""; auto: boolean };

/** Result entry for a panel test (CBC, LFT, RFT, lipid profile, electrolytes,
 * urine R/E): one line per parameter with its default unit and range; the
 * flag follows the value and the patient's sex unless changed. Empty lines
 * are left off the report. */
export function LabPanelForm({ panel, gender, saved, saving, onSave, onCancel }: {
  panel: PanelParam[];
  gender: string | null;
  saved: LabComponent[];
  saving: boolean;
  onSave: (components: LabComponent[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => {
    const before = new Map(saved.map((c) => [c.key, c]));
    return panel.map((p) => {
      const c = before.get(p.key);
      return { key: p.key, name: p.name, group: p.group, value: c?.value ?? "", unit: c?.unit ?? p.unit, range: c?.ref_range ?? p.range, flag: c?.flag ?? "", auto: !c?.flag };
    });
  });
  const flagOf = (r: Row) => (r.auto ? flagFor(r.value, r.range, gender) ?? "" : r.flag);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.value.trim());

  function save() {
    onSave(filled.map((r) => {
      const flag = flagOf(r);
      return { key: r.key, name: r.name, group: r.group, value: r.value.trim(), unit: r.unit.trim() || null, ref_range: r.range.trim() || null, flag: flag || null };
    }));
  }

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">
        Enter each value. High / low is set from the normal range{gender ? ` for ${gender.toLowerCase()} patients` : ""}; choose a flag to override it. Empty lines are left off the report.
      </p>
      <div className="mb-3 max-h-[55vh] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
              <th className="pb-1 pr-2 font-medium">Parameter</th><th className="pb-1 pr-2 font-medium">Result</th><th className="pb-1 pr-2 font-medium">Unit</th>
              <th className="pb-1 pr-2 font-medium">Normal range</th><th className="pb-1 font-medium">Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const flag = flagOf(r);
              const forSex = gender ? rangeForSex(r.range, gender) : null;
              return [
                r.group && r.group !== rows[i - 1]?.group
                  ? <tr key={`g-${r.key}`}><td colSpan={5} className="pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{r.group}</td></tr>
                  : null,
                <tr key={r.key} className="border-b border-neutral-50">
                  <td className="py-1 pr-2">{r.name}</td>
                  <td className="py-1 pr-2">
                    <Input id={`panel-${r.key}`} value={r.value} onChange={(e) => set(i, { value: e.target.value })} autoFocus={i === 0}
                      className={`w-24 tabular-nums ${flag === "H" || flag === "L" ? "font-semibold text-rose-600" : ""}`} />
                  </td>
                  <td className="py-1 pr-2"><Input aria-label={`${r.name} unit`} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className="w-24" /></td>
                  <td className="py-1 pr-2">
                    <Input aria-label={`${r.name} normal range`} value={r.range} onChange={(e) => set(i, { range: e.target.value })} className="w-40" />
                    {forSex && forSex !== r.range.trim() && <span className="block text-[11px] text-neutral-400">Used: {forSex}</span>}
                  </td>
                  <td className="py-1">
                    <Select aria-label={`${r.name} flag`} value={r.auto ? "auto" : r.flag} className="w-28"
                      onChange={(e) => set(i, e.target.value === "auto" ? { auto: true } : { auto: false, flag: e.target.value as Row["flag"] })}>
                      <option value="auto">{r.auto && flag ? `Auto (${flag})` : "Auto"}</option>
                      <option value="N">Normal</option>
                      <option value="H">High</option>
                      <option value="L">Low</option>
                    </Select>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">{filled.length} of {rows.length} entered</span>
        <div className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !filled.length}>{saving ? "Saving…" : "Save result"}</Button>
        </div>
      </div>
    </div>
  );
}
