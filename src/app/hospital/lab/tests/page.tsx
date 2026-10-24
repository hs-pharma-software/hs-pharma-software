"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, ListPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { listLabTests, saveLabTest, importStandardLabTests, setLabTestFee, setLabTestActive } from "@/lib/repo/hospitalOpd";
import { SAMPLE_TYPES, LAB_SECTIONS, STANDARD_LAB_TESTS } from "@/config/labTestCatalog";
import type { HospitalService } from "@/lib/types-hospital";

/** Performing Tests: the tests this lab carries out, with section, sample,
 * unit, normal range, turnaround and fee. Doctors order from this list, the
 * lab's New Order uses it, and results start pre-filled from it. */
export default function PerformingTestsPage() {
  const [rows, setRows] = useState<HospitalService[]>([]);
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("");
  const [show, setShow] = useState<"all" | "performing" | "no_fee">("all");
  const [editing, setEditing] = useState<HospitalService | null | "new">(null);
  const [importing, setImporting] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const list = await listLabTests({ includeInactive: true });
    setRows(list);
    return list;
  }

  // First visit with an empty list: load the standard tests straight away.
  useEffect(() => {
    void (async () => {
      const list = await reload();
      if (list && list.length === 0) await loadStandard(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStandard(fromButton: boolean) {
    if (importing) return;
    setImporting("Loading standard tests…");
    try {
      const r = await importStandardLabTests((done, total) => setImporting(`Adding ${done} of ${total}…`));
      await reload();
      if (r.added) setShow("no_fee");
      if (fromButton) window.alert(r.added ? `${r.added} tests added${r.skipped ? ` (${r.skipped} were already in the list)` : ""}. Enter the fee of each test you perform.` : "All standard tests are already in your list.");
    } catch (e) {
      window.alert(`Could not add the standard tests: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(null);
    }
  }

  async function addStandard() {
    if (!window.confirm(`Add any of the ${STANDARD_LAB_TESTS.length} standard lab tests that are missing from your list? Tests already in your list are kept as they are.`)) return;
    await loadStandard(true);
  }

  async function saveFee(t: HospitalService, value: string) {
    const fee = Number(value);
    if (value.trim() === "" || fee === Number(t.rate)) return;
    try {
      const updated = await setLabTestFee(t.id, fee);
      setRows((rs) => rs.map((r) => (r.id === t.id ? updated : r)));
    } catch (e) {
      window.alert(`Could not save the fee: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function toggle(t: HospitalService) {
    if (!t.is_active && !(Number(t.rate) > 0) && !window.confirm(`${t.name} has no fee. Perform it free of charge?`)) return;
    try {
      const updated = await setLabTestActive(t.id, !t.is_active);
      setRows((rs) => rs.map((r) => (r.id === t.id ? updated : r)));
    } catch (e) {
      window.alert(`Could not change the status: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const term = search.trim().toLowerCase();
  const sections = [...new Set([...LAB_SECTIONS, ...rows.map((r) => r.department).filter(Boolean)])] as string[];
  const shown = rows.filter((r) =>
    (!section || r.department === section) &&
    (show === "all" || (show === "performing" ? r.is_active : !(Number(r.rate) > 0))) &&
    (!term || r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term) || (r.sample_type ?? "").toLowerCase().includes(term)));
  const performing = rows.filter((r) => r.is_active).length;
  const noFee = rows.filter((r) => !(Number(r.rate) > 0)).length;

  return (
    <div>
      <PageHeader
        title="Performing Tests"
        actions={
          <>
            <Button onClick={() => void addStandard()} disabled={Boolean(importing)}><ListPlus size={14} className="mr-1" />{importing ?? "Add standard tests"}</Button>
            <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} className="mr-1" />Add Test</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search test, code or sample…" className="max-w-xs" />
        <Select value={section} onChange={(e) => setSection(e.target.value)} className="!w-56" aria-label="Section">
          <option value="">All sections</option>
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {([["all", "All"], ["performing", "Performing"], ["no_fee", "Fee not set"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setShow(k)} className={`px-3 py-1.5 ${show === k ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-neutral-500">{performing} performed · {noFee} without a fee · {rows.length} in the list</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <p className="mb-3 text-sm text-neutral-500">No tests yet.</p>
          <Button variant="primary" onClick={() => void addStandard()} disabled={Boolean(importing)}><ListPlus size={14} className="mr-1" />{importing ?? `Add the ${STANDARD_LAB_TESTS.length} standard lab tests`}</Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                <th className="px-3 py-2.5">Code</th><th className="px-3 py-2.5">Test</th><th className="px-3 py-2.5">Section</th><th className="px-3 py-2.5">Sample</th>
                <th className="px-3 py-2.5">Unit</th><th className="px-3 py-2.5">Normal range</th><th className="px-3 py-2.5">TAT</th><th className="px-3 py-2.5">Fee (Rs)</th>
                <th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-neutral-50 align-top hover:bg-neutral-50/60">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{r.code}</td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{r.department}</td>
                  <td className="px-3 py-2 text-neutral-600">{r.sample_type ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-600">{r.unit ?? "—"}</td>
                  <td className="max-w-[18rem] whitespace-normal px-3 py-2 text-xs text-neutral-600">{r.ref_range ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-600">{r.turnaround_hours != null ? `${r.turnaround_hours} h` : "—"}</td>
                  <td className="px-3 py-2">
                    <input
                      key={`${r.id}-${r.rate}`}
                      type="number" min="0" step="any" defaultValue={Number(r.rate) > 0 ? String(r.rate) : ""} placeholder="Set fee"
                      aria-label={`Fee for ${r.name}`}
                      onBlur={(e) => void saveFee(r, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className={`w-24 rounded-lg border px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-black/[0.06] ${Number(r.rate) > 0 ? "border-neutral-200" : "border-amber-300 bg-amber-50"}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => void toggle(r)} title={r.is_active ? "Stop performing" : "Start performing"}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
                      {r.is_active ? "Performing" : "Not performing"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} className="text-neutral-400 hover:text-amber-700"><Pencil size={15} /></button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-neutral-400">No test matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-400">Normal ranges are typical adult values. Check them against your analyser and kit inserts and edit any test as needed. Entering a fee starts performing the test.</p>

      {editing !== null && (
        <LabTestModal test={editing === "new" ? null : editing} sections={sections} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
      )}
    </div>
  );
}

function LabTestModal({ test, sections, onClose, onSaved }: { test: HospitalService | null; sections: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(test?.name ?? "");
  const [code, setCode] = useState(test?.code ?? "");
  const [section, setSection] = useState(test?.department ?? "");
  const [sample, setSample] = useState(test?.sample_type ?? "");
  const [unit, setUnit] = useState(test?.unit ?? "");
  const [range, setRange] = useState(test?.ref_range ?? "");
  const [tat, setTat] = useState(test?.turnaround_hours != null ? String(test.turnaround_hours) : "");
  const [fee, setFee] = useState(test && Number(test.rate) > 0 ? String(test.rate) : "");
  const [active, setActive] = useState(test ? Boolean(test.is_active) : true);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveLabTest(test?.id ?? null, {
        name, code, department: section || null, sample_type: sample, unit, ref_range: range,
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
    <Modal title={test ? `Edit ${test.name}` : "Add Test"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Test name" required><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. CBC, Blood Sugar Random, LFT" /></Field>
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Automatic (LAB-001…) if left blank" /></Field>
          <Field label="Section">
            <Select value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">Laboratory</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Sample">
            <Select value={sample} onChange={(e) => setSample(e.target.value)}>
              <option value="">—</option>
              {SAMPLE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              {sample && !SAMPLE_TYPES.includes(sample) && <option value={sample}>{sample}</option>}
            </Select>
          </Field>
          <Field label="Result unit"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. g/dL, mg/dL, mmol/L" /></Field>
          <Field label="Turnaround (hours)"><Input type="number" min="0" step="any" value={tat} onChange={(e) => setTat(e.target.value)} placeholder="e.g. 4" /></Field>
          <div className="md:col-span-2">
            <Field label="Normal range"><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="e.g. M 13.0-17.0; F 12.0-15.0" /></Field>
          </div>
          <Field label="Fee (Rs)"><Input type="number" min="0" step="any" value={fee} onChange={(e) => { setFee(e.target.value); if (Number(e.target.value) > 0) setActive(true); }} placeholder="Not set" /></Field>
          <Field label="Status">
            <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Performing</option>
              <option value="0">Not performing (hidden from orders)</option>
            </Select>
          </Field>
        </div>
        {active && !(Number(fee) > 0) && <p className="text-xs text-amber-700">No fee: this test will be ordered free of charge.</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
