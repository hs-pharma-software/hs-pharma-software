"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, ListPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { listImagingStudies, saveImagingStudy, importStandardImagingStudies, setImagingFee, setImagingActive } from "@/lib/repo/radiology";
import { MODALITIES, STANDARD_IMAGING_STUDIES } from "@/config/radiologyCatalog";
import type { HospitalService } from "@/lib/types-hospital";

/** Performing Images: the radiology studies this hospital performs, with
 * modality, reporting time and fee. Doctors and the radiology counter order
 * from this list, and each order's fee comes from it. */
export default function PerformingImagesPage() {
  const [rows, setRows] = useState<HospitalService[]>([]);
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState("");
  const [show, setShow] = useState<"all" | "performing" | "no_fee">("all");
  const [editing, setEditing] = useState<HospitalService | null | "new">(null);
  const [importing, setImporting] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const list = await listImagingStudies({ includeInactive: true });
    setRows(list);
    return list;
  }

  // First visit with an empty list: load the standard studies straight away.
  useEffect(() => {
    void (async () => {
      const list = await reload();
      if (list && list.length === 0) await loadStandard(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStandard(fromButton: boolean) {
    if (importing) return;
    setImporting("Loading standard studies…");
    try {
      const r = await importStandardImagingStudies((done, total) => setImporting(`Adding ${done} of ${total}…`));
      await reload();
      if (r.added) setShow("no_fee");
      if (fromButton) window.alert(r.added ? `${r.added} studies added${r.skipped ? ` (${r.skipped} were already in the list)` : ""}. Enter the fee of each study you perform.` : "All standard studies are already in your list.");
    } catch (e) {
      window.alert(`Could not add the standard studies: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(null);
    }
  }

  async function addStandard() {
    if (!window.confirm(`Add any of the ${STANDARD_IMAGING_STUDIES.length} standard radiology studies that are missing from your list? Studies already in your list are kept as they are.`)) return;
    await loadStandard(true);
  }

  async function saveFee(s: HospitalService, value: string) {
    const fee = Number(value);
    if (value.trim() === "" || fee === Number(s.rate)) return;
    try {
      const updated = await setImagingFee(s.id, fee);
      setRows((rs) => rs.map((r) => (r.id === s.id ? updated : r)));
    } catch (e) {
      window.alert(`Could not save the fee: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function toggle(s: HospitalService) {
    if (!s.is_active && !(Number(s.rate) > 0) && !window.confirm(`${s.name} has no fee. Perform it free of charge?`)) return;
    try {
      const updated = await setImagingActive(s.id, !s.is_active);
      setRows((rs) => rs.map((r) => (r.id === s.id ? updated : r)));
    } catch (e) {
      window.alert(`Could not change the status: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const term = search.trim().toLowerCase();
  const modalities = [...new Set([...MODALITIES, ...rows.map((r) => r.modality).filter(Boolean)])] as string[];
  const shown = rows.filter((r) =>
    (!modality || r.modality === modality) &&
    (show === "all" || (show === "performing" ? r.is_active : !(Number(r.rate) > 0))) &&
    (!term || r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term)));
  const performing = rows.filter((r) => r.is_active).length;
  const noFee = rows.filter((r) => !(Number(r.rate) > 0)).length;

  return (
    <div>
      <PageHeader
        title="Performing Images"
        actions={
          <>
            <Button onClick={() => void addStandard()} disabled={Boolean(importing)}><ListPlus size={14} className="mr-1" />{importing ?? "Add standard studies"}</Button>
            <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} className="mr-1" />Add Study</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search study or code…" className="max-w-xs" />
        <Select value={modality} onChange={(e) => setModality(e.target.value)} className="!w-48" aria-label="Modality">
          <option value="">All modalities</option>
          {modalities.map((m) => <option key={m} value={m}>{m}</option>)}
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
          <p className="mb-3 text-sm text-neutral-500">No studies yet.</p>
          <Button variant="primary" onClick={() => void addStandard()} disabled={Boolean(importing)}><ListPlus size={14} className="mr-1" />{importing ?? `Add the ${STANDARD_IMAGING_STUDIES.length} standard studies`}</Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                <th className="px-3 py-2.5">Code</th><th className="px-3 py-2.5">Study</th><th className="px-3 py-2.5">Modality</th>
                <th className="px-3 py-2.5">Reporting time</th><th className="px-3 py-2.5">Fee (Rs)</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-neutral-50 align-top hover:bg-neutral-50/60">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{r.code}</td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{r.modality ?? "—"}</td>
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
              {shown.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-neutral-400">No study matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-400">Entering a fee starts performing the study. Doctors and the radiology counter can only order studies that are performed.</p>

      {editing !== null && (
        <StudyModal study={editing === "new" ? null : editing} modalities={modalities} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
      )}
    </div>
  );
}

function StudyModal({ study, modalities, onClose, onSaved }: { study: HospitalService | null; modalities: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(study?.name ?? "");
  const [code, setCode] = useState(study?.code ?? "");
  const [modality, setModality] = useState(study?.modality ?? "");
  const [tat, setTat] = useState(study?.turnaround_hours != null ? String(study.turnaround_hours) : "");
  const [fee, setFee] = useState(study && Number(study.rate) > 0 ? String(study.rate) : "");
  const [notes, setNotes] = useState(study?.notes ?? "");
  const [active, setActive] = useState(study ? Boolean(study.is_active) : true);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveImagingStudy(study?.id ?? null, {
        name, code, modality: modality || null, turnaround_hours: tat === "" ? null : Number(tat), rate: Number(fee) || 0, notes, is_active: active ? 1 : 0,
      });
      onSaved();
    } catch (err) {
      window.alert(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={study ? `Edit ${study.name}` : "Add Study"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Study name" required><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. X-Ray Chest PA, Ultrasound Abdomen" /></Field>
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Automatic (IMG-001…) if left blank" /></Field>
          <Field label="Modality">
            <Select value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="">—</option>
              {modalities.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Reporting time (hours)"><Input type="number" min="0" step="any" value={tat} onChange={(e) => setTat(e.target.value)} placeholder="e.g. 2" /></Field>
          <Field label="Fee (Rs)"><Input type="number" min="0" step="any" value={fee} onChange={(e) => { setFee(e.target.value); if (Number(e.target.value) > 0) setActive(true); }} placeholder="Not set" /></Field>
          <Field label="Status">
            <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Performing</option>
              <option value="0">Not performing (hidden from orders)</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. with contrast, fasting needed" /></Field>
          </div>
        </div>
        {active && !(Number(fee) > 0) && <p className="text-xs text-amber-700">No fee: this study will be ordered free of charge.</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
