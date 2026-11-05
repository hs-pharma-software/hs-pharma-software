"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { isTauri } from "@/lib/platform";
import { EMPTY_CLINIC_PROFILE, loadClinicProfile, type ClinicProfile } from "@/lib/clinicProfile";
import { loadClinicTemplate, saveClinicTemplate, type ClinicPrintTemplate } from "@/lib/clinicPrintTemplates";
import { DESIGN_FAMILIES, LAB_REPORT_DESIGNS, labDesign, type DesignFamily, type LabReportDesign } from "@/lib/labReportDesigns";
import { LabReportDocument, SAMPLE_LAB_REPORT } from "./LabReportDocument";

/** Settings > Lab Report Templates: pick how printed lab reports look. Each
 * tile is the real report layout with made-up results, so what you choose is
 * what prints. Paper, header alignment, signature and footer stay in the lab's
 * Print Templates. */
export function LabReportTemplatesCard({ editable }: { editable: boolean }) {
  const [t, setT] = useState<ClinicPrintTemplate | null>(null);
  const [profile, setProfile] = useState<ClinicProfile>(EMPTY_CLINIC_PROFILE);
  const [family, setFamily] = useState<DesignFamily | "All">("All");
  const [preview, setPreview] = useState<LabReportDesign | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void loadClinicTemplate("lab").then(setT);
    void loadClinicProfile().then((p) => setProfile({ ...p, name: p.name || "Your Laboratory" }));
  }, []);

  async function choose(design: LabReportDesign) {
    if (!t || !editable) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = { ...t, design: design.id };
      await saveClinicTemplate("lab", next);
      setT(next);
      setMessage(`${design.name} is now used for lab reports.`);
    } catch (e) {
      setMessage(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const current = labDesign(t?.design);
  const shown = LAB_REPORT_DESIGNS.filter((x) => family === "All" || x.family === family);
  // Previews always on A4 width so the tiles are comparable.
  const previewT: ClinicPrintTemplate | null = t ? { ...t, paper: "a4" } : null;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-neutral-800">Lab Report Templates</h2>
          <p className="text-sm text-neutral-500">
            {LAB_REPORT_DESIGNS.length} designs for printed lab reports. In use: <b>{current.name}</b>.
            {!editable && " Set by the administrator."}
          </p>
        </div>
        {message && <span className="text-sm text-emerald-700" role="status">{message}</span>}
      </div>

      <div role="group" aria-label="Filter by style" className="mb-4 flex flex-wrap gap-1.5">
        {(["All", ...DESIGN_FAMILIES] as const).map((f) => (
          <button key={f} type="button" aria-pressed={family === f} onClick={() => setFamily(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${family === f ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-600 ring-neutral-200 hover:ring-neutral-400"}`}>
            {f}{f !== "All" && <span className="ml-1 opacity-60">{LAB_REPORT_DESIGNS.filter((x) => x.family === f).length}</span>}
          </button>
        ))}
      </div>

      {!previewT ? <p className="py-8 text-center text-sm text-neutral-400">Loading…</p> : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((x) => {
            const active = x.id === current.id;
            return (
              <li key={x.id} className={`flex flex-col overflow-hidden rounded-xl ring-2 transition ${active ? "ring-[var(--accent)]" : "ring-neutral-200 hover:ring-neutral-400"}`}>
                {/* A scaled-down live report (A4 width 190 mm ≈ 718 px at 0.3). */}
                <button type="button" onClick={() => setPreview(x)} aria-label={`Preview ${x.name}`} className="relative h-56 overflow-hidden bg-neutral-50 text-left">
                  <div className="pointer-events-none absolute left-1/2 top-3 w-[718px] origin-top -translate-x-1/2 scale-[0.3] bg-white p-4 shadow-sm">
                    <LabReportDocument view={SAMPLE_LAB_REPORT} design={x} t={previewT} profile={profile} />
                  </div>
                </button>
                <div className="flex items-center justify-between gap-2 border-t border-neutral-100 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-800">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: x.accent }} aria-hidden />
                      {x.name}
                    </p>
                    <p className="text-[11px] text-neutral-500">{x.family}</p>
                  </div>
                  {active ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">In use</span>
                  ) : (
                    <Button className="shrink-0 !px-3 !py-1 text-xs" disabled={!editable || saving} onClick={() => void choose(x)}>Use</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && previewT && (
        <Modal title={`${preview.name} (${preview.family})`} onClose={() => setPreview(null)} width="max-w-4xl">
          <div className="max-h-[70vh] overflow-auto rounded-lg bg-neutral-100 p-4">
            <div className="mx-auto bg-white p-6 shadow">
              <LabReportDocument view={SAMPLE_LAB_REPORT} design={preview} t={{ ...previewT, paper: t?.paper ?? "a4" }} profile={profile} />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-neutral-500">Sample results for preview only. Paper: {(t?.paper ?? "a4").toUpperCase()} (change it in the lab&apos;s Print Templates).</p>
            <div className="flex gap-2">
              <Button onClick={() => setPreview(null)}>Close</Button>
              {preview.id !== current.id && (
                <Button variant="primary" disabled={!editable || saving} onClick={() => void choose(preview).then(() => setPreview(null))}>Use this design</Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
