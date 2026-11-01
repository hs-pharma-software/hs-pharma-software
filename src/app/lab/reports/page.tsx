"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ClinicReportModal } from "@/components/clinic/ClinicPrints";
import { VisitProgress } from "@/components/lab/labUi";
import { isTauri } from "@/lib/platform";
import { getLabVisit, listLabVisits, type LabVisitRow } from "@/lib/repo/lab";

/** Released reports (verified by the pathologist), one per visit. */
export default function LabReportsPage() {
  const [rows, setRows] = useState<LabVisitRow[]>([]);
  const [term, setTerm] = useState("");
  const [printing, setPrinting] = useState<string[] | null>(null);

  async function reload() {
    if (isTauri()) setRows(await listLabVisits({ stage: "released", term }).catch(() => []));
  }
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(v: LabVisitRow) {
    const d = await getLabVisit(v.id);
    const ids = d.orders.filter((o) => o.status === "reported").map((o) => o.id);
    if (ids.length) setPrinting(ids);
  }

  const columns: Column<LabVisitRow>[] = [
    { header: "Visit", render: (v) => <span className="font-mono text-xs">{v.visit_no}</span> },
    { header: "Date", render: (v) => v.created_at.slice(0, 10) },
    { header: "Patient", render: (v) => <span><span className="font-medium">{v.patient_name}</span> <span className="text-xs text-neutral-500">{[v.mrn, v.phone].filter(Boolean).join(" · ")}</span></span> },
    { header: "Tests", render: (v) => <span title={v.test_names} className="inline-block max-w-[18rem] truncate align-bottom">{v.test_names}</span> },
    { header: "Progress", render: (v) => <VisitProgress v={v} /> },
    {
      header: "",
      render: (v) => (
        <button type="button" title="View / print report" aria-label="View / print report" onClick={(e) => { e.stopPropagation(); void open(v); }} className="rounded-full bg-neutral-900 p-1.5 text-white hover:bg-neutral-700"><FileText size={15} /></button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Reports" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      <Input id="lrep-search" className="mb-3 max-w-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search patient, MRN, mobile or visit…" />
      <DataTable columns={columns} rows={rows} onRowClick={(v) => void open(v)} emptyMessage="No released reports yet. A report is released once the pathologist verifies it." />
      {printing && <ClinicReportModal orderIds={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
