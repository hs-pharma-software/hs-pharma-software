"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { DEFAULT_PRINT, loadHospitalPrint, saveHospitalPrint, type HospitalPrintSettings, type LabPaper } from "@/lib/hospitalPrint";

/** Hospital Profile > Print templates: lab report A4 / A5, radiology A4,
 * and the A4 prescription's options. */
export function PrintTemplatesCard() {
  const [s, setS] = useState<HospitalPrintSettings>(DEFAULT_PRINT);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (isTauri()) void loadHospitalPrint().then(setS); }, []);
  async function save() {
    try { await saveHospitalPrint(s); setMsg("Saved."); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <div className="mt-4 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-800">Print templates</h2>
        <Button variant="primary" onClick={() => void save()}>Save templates</Button>
      </div>
      <p className="mb-3 text-xs text-neutral-500">All templates print the logo (Settings › Print), the hospital&apos;s name, address, registration / PHC and NTN numbers and contact from this page.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Lab reports">
          <Select value={s.labPaper} onChange={(e) => setS({ ...s, labPaper: e.target.value as LabPaper })}>
            <option value="a4">A4</option><option value="a5">A5 (half page)</option>
          </Select>
        </Field>
        <Field label="Radiology reports"><p className="py-1.5 text-sm text-neutral-700">A4</p></Field>
        <Field label="Prescriptions"><p className="py-1.5 text-sm text-neutral-700">A4</p></Field>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="Other registration numbers (header)"><Input value={s.otherRegistrations} onChange={(e) => setS({ ...s, otherRegistrations: e.target.value })} placeholder="e.g. PMDC Inst. 1234 · Drug Licence 567" /></Field>
        <Field label="Prescription footer note"><Input value={s.rxFooterNote} onChange={(e) => setS({ ...s, rxFooterNote: e.target.value })} placeholder="e.g. Bring this prescription on your next visit" /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.rxShowQualification} onChange={(e) => setS({ ...s, rxShowQualification: e.target.checked })} />Show the doctor&apos;s qualification on prescriptions</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.rxShowDesignation} onChange={(e) => setS({ ...s, rxShowDesignation: e.target.checked })} />Show the doctor&apos;s designation on prescriptions</label>
      </div>
      {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
    </div>
  );
}
