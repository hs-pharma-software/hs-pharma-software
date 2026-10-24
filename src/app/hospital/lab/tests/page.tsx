"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { listLabTests, saveLabTest } from "@/lib/repo/hospitalOpd";
import type { HospitalService } from "@/lib/types-hospital";

const SAMPLE_TYPES = ["Blood", "Serum", "Plasma", "Whole blood (EDTA)", "Urine", "Stool", "Sputum", "Swab", "CSF", "Body fluid", "Tissue"];

/** Performing Tests: the tests this lab carries out, with sample, unit, normal
 * range, turnaround time and fee. Doctors order from this list, the lab's New
 * Order uses it, and results start pre-filled from it. */
export default function PerformingTestsPage() {
  const [rows, setRows] = useState<HospitalService[]>([]);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<HospitalService | null | "new">(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listLabTests({ includeInactive: true }));
  }
  useEffect(() => { void reload(); }, []);

  const term = search.trim().toLowerCase();
  const shown = rows.filter((r) => (showInactive || r.is_active) && (!term || r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term) || (r.sample_type ?? "").toLowerCase().includes(term)));
  const active = rows.filter((r) => r.is_active).length;

  const columns: Column<HospitalService>[] = [
    { header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Test", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Sample", render: (r) => r.sample_type ?? "—" },
    { header: "Unit", render: (r) => r.unit ?? "—" },
    { header: "Normal range", render: (r) => r.ref_range ?? "—" },
    { header: "Turnaround", render: (r) => (r.turnaround_hours != null ? `${r.turnaround_hours} h` : "—") },
    { header: "Fee", render: (r) => <span className="tabular-nums">Rs {Number(r.rate).toFixed(0)}</span> },
    {
      header: "Status",
      render: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
          {r.is_active ? "Performing" : "Not performing"}
        </span>
      ),
    },
    {
      header: "",
      render: (r) => (
        <button type="button" aria-label={`Edit ${r.name}`} onClick={(e) => { e.stopPropagation(); setEditing(r); }} className="text-neutral-400 hover:text-amber-700">
          <Pencil size={15} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Performing Tests"
        actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} className="mr-1" />Add Test</Button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search test, code or sample…" className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show tests not performed
        </label>
        <span className="ml-auto text-xs text-neutral-500">{active} test{active === 1 ? "" : "s"} performed</span>
      </div>
      <DataTable columns={columns} rows={shown} emptyMessage="No tests yet. Add the tests this lab performs." onRowClick={(r) => setEditing(r)} />
      {editing !== null && (
        <LabTestModal test={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
      )}
    </div>
  );
}

function LabTestModal({ test, onClose, onSaved }: { test: HospitalService | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(test?.name ?? "");
  const [code, setCode] = useState(test?.code ?? "");
  const [sample, setSample] = useState(test?.sample_type ?? "");
  const [unit, setUnit] = useState(test?.unit ?? "");
  const [range, setRange] = useState(test?.ref_range ?? "");
  const [tat, setTat] = useState(test?.turnaround_hours != null ? String(test.turnaround_hours) : "");
  const [fee, setFee] = useState(String(test?.rate ?? ""));
  const [active, setActive] = useState(test ? Boolean(test.is_active) : true);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveLabTest(test?.id ?? null, {
        name, code, sample_type: sample, unit, ref_range: range,
        turnaround_hours: tat === "" ? null : Number(tat), rate: Number(fee) || 0, is_active: active ? 1 : 0,
      });
      onSaved();
    } catch (err) {
      window.alert(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={test ? "Edit Test" : "Add Test"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Test name" required><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. CBC, Blood Sugar Random, LFT" /></Field>
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Automatic (LAB-001…) if left blank" /></Field>
          <Field label="Sample">
            <Select value={sample} onChange={(e) => setSample(e.target.value)}>
              <option value="">—</option>
              {SAMPLE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              {sample && !SAMPLE_TYPES.includes(sample) && <option value={sample}>{sample}</option>}
            </Select>
          </Field>
          <Field label="Result unit"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. g/dL, mg/dL, mmol/L" /></Field>
          <Field label="Normal range"><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="e.g. 13-17 (M), 12-15 (F)" /></Field>
          <Field label="Turnaround (hours)"><Input type="number" min="0" step="any" value={tat} onChange={(e) => setTat(e.target.value)} placeholder="e.g. 4" /></Field>
          <Field label="Fee (Rs)" required><Input type="number" min="0" step="any" value={fee} onChange={(e) => setFee(e.target.value)} required /></Field>
          <Field label="Status">
            <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Performing</option>
              <option value="0">Not performing (hidden from orders)</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
