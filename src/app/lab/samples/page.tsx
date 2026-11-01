"use client";

import { useEffect, useState } from "react";
import { PencilLine, TestTube } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ResultWorkspace } from "@/components/clinic/ClinicWorklist";
import { VisitProgress, PRIORITY_CLS, workRows } from "@/components/lab/labUi";
import { isTauri } from "@/lib/platform";
import { collectSamples, getLabVisit, listLabVisits, type LabVisitRow } from "@/lib/repo/lab";
import type { ClinicWorkRow } from "@/lib/repo/clinicServices";

/** Technologist: samples to take and results to enter, visit by visit. A
 * result then waits for the pathologist. */
export default function LabSamplesPage() {
  const [rows, setRows] = useState<LabVisitRow[]>([]);
  const [term, setTerm] = useState("");
  const [working, setWorking] = useState<{ rows: ClinicWorkRow[]; start: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setRows(await listLabVisits({ stage: "samples", term }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  async function collect(v: LabVisitRow) {
    try {
      const d = await getLabVisit(v.id);
      await collectSamples(d.orders.filter((o) => o.status === "ordered").map((o) => o.id));
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function enter(v: LabVisitRow) {
    const d = await getLabVisit(v.id);
    const pending = workRows(d).filter((o) => o.status === "ordered" || o.status === "collected");
    if (pending.length) setWorking({ rows: pending, start: pending[0].id });
  }

  const columns: Column<LabVisitRow>[] = [
    { header: "Visit", render: (v) => <span className="font-mono text-xs">{v.visit_no}</span> },
    { header: "Patient", render: (v) => <span><span className="font-medium">{v.patient_name}</span> <span className="text-xs text-neutral-500">{[v.mrn, v.gender].filter(Boolean).join(" · ")}</span></span> },
    { header: "Tests", render: (v) => <span title={v.test_names} className="inline-block max-w-[18rem] truncate align-bottom">{v.test_names}</span> },
    { header: "Registered", render: (v) => v.created_at.slice(0, 16).replace("T", " ") },
    { header: "Priority", render: (v) => <span className={`text-xs font-semibold uppercase ${PRIORITY_CLS[v.priority] ?? ""}`}>{v.priority}</span> },
    { header: "Progress", render: (v) => <VisitProgress v={v} /> },
    {
      header: "",
      render: (v) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {Number(v.ordered) > 0 && (
            <button type="button" title="Samples collected" aria-label="Samples collected" onClick={() => void collect(v)} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><TestTube size={15} /></button>
          )}
          <button type="button" title="Enter results" aria-label="Enter results" onClick={() => void enter(v)} className="rounded-full bg-neutral-900 p-1.5 text-white hover:bg-neutral-700"><PencilLine size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Samples & Results" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      <Input id="ls-search" className="mb-3 max-w-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search patient, MRN, mobile or visit…" />
      {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
      <DataTable columns={columns} rows={rows} onRowClick={(v) => void enter(v)} emptyMessage="No samples or results waiting. Visits registered at Reception appear here." />
      {working && (
        <ResultWorkspace kind="lab" rows={working.rows} startId={working.start} awaitVerification onClose={() => { setWorking(null); void reload(); }} />
      )}
    </div>
  );
}
