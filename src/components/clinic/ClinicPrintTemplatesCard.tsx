"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { PAPERS, type PaperSize } from "@/lib/printTemplates";
import {
  CLINIC_DOCS, DEFAULT_CLINIC_TEMPLATES, loadClinicTemplate, saveClinicTemplate, type ClinicDoc, type ClinicPrintTemplate,
} from "@/lib/clinicPrintTemplates";

/** Paper and layout of the clinic's invoice, lab report and prescription.
 * The Super Admin passes the clinic's tenantId; the clinic sees it read-only
 * when its templates are fixed. */
export function ClinicPrintTemplatesCard({ tenantId, editable, embedded = false, docs }: { tenantId?: string; editable: boolean; embedded?: boolean; docs?: ClinicDoc[] }) {
  const shownDocs = docs ? CLINIC_DOCS.filter((d) => docs.includes(d.id)) : CLINIC_DOCS;
  const [t, setT] = useState<Record<ClinicDoc, ClinicPrintTemplate>>(DEFAULT_CLINIC_TEMPLATES);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void Promise.all(CLINIC_DOCS.map((d) => loadClinicTemplate(d.id, tenantId))).then(([invoice, lab, prescription]) =>
      setT({ invoice, lab, prescription }));
  }, [tenantId]);

  const set = (doc: ClinicDoc, patch: Partial<ClinicPrintTemplate>) => {
    setT((prev) => ({ ...prev, [doc]: { ...prev[doc], ...patch } }));
    setSavedAt(null);
  };

  async function save() {
    setSaving(true);
    try {
      for (const d of shownDocs) await saveClinicTemplate(d.id, t[d.id], tenantId);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={embedded ? "" : "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]"}>
      {!embedded && (
        <>
          <h2 className="mb-1 text-base font-semibold text-neutral-900">Print Templates</h2>
          <p className="mb-4 text-sm text-neutral-500">
            {editable ? "Paper and layout of each document the clinic prints." : "Set by the administrator. Ask them to change a template."}
          </p>
        </>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {shownDocs.map((d) => {
          const x = t[d.id];
          return (
            <fieldset key={d.id} disabled={!editable} className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-3">
              <legend className="px-1 text-sm font-semibold text-neutral-800">{d.label}</legend>
              <p className="-mt-1 text-xs text-neutral-500">{d.hint}</p>
              <div className="inline-flex w-fit overflow-hidden rounded-lg border border-neutral-200 text-xs">
                {PAPERS.map((p) => (
                  <button key={p.id} type="button" onClick={() => set(d.id, { paper: p.id as PaperSize })}
                    className={`px-3 py-1.5 font-medium ${x.paper === p.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"} disabled:cursor-not-allowed`}>
                    {p.id === "thermal" ? "Thermal" : p.id.toUpperCase()}
                  </button>
                ))}
              </div>
              <Field label="Header">
                <Select id={`cpt-${d.id}-align`} value={x.headerAlign} onChange={(e) => set(d.id, { headerAlign: e.target.value as ClinicPrintTemplate["headerAlign"] })}>
                  <option value="center">Centred</option>
                  <option value="left">Left</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input type="checkbox" checked={x.showIds} onChange={(e) => set(d.id, { showIds: e.target.checked })} /> PHC Reg No and NTN
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input type="checkbox" checked={x.signature} onChange={(e) => set(d.id, { signature: e.target.checked })} /> Signature line
              </label>
              <Field label="Footer">
                <Input id={`cpt-${d.id}-footer`} value={x.footer} onChange={(e) => set(d.id, { footer: e.target.value })} placeholder="e.g. Timings: 9 am to 9 pm" />
              </Field>
            </fieldset>
          );
        })}
      </div>
      {editable && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {savedAt && <span className="text-sm text-emerald-700">Saved {savedAt}</span>}
          <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save templates"}</Button>
        </div>
      )}
    </section>
  );
}
