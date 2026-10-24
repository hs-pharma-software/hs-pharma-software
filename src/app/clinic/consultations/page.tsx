"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { listConsultations, type ConsultationWithNames } from "@/lib/repo/clinic";

export default function ConsultationsPage() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const [consultations, setConsultations] = useState<ConsultationWithNames[]>([]);
  const [search, setSearch] = useState("");
  const tauriReady = useIsTauri();

  async function reload() {
    if (!isTauri()) return;
    setConsultations(await listConsultations(100));
  }

  useEffect(() => { void reload(); }, [tenantId]);

  const filtered = consultations.filter((c) => {
    const t = search.toLowerCase();
    return !t || c.patient_name.toLowerCase().includes(t) || (c.doctor_name ?? "").toLowerCase().includes(t) || (c.diagnosis ?? "").toLowerCase().includes(t);
  });

  const columns: Column<ConsultationWithNames>[] = [
    { header: "Date", render: (c) => c.date },
    { header: "Patient", render: (c) => <span className="font-medium">{c.patient_name}</span> },
    { header: "Doctor", render: (c) => c.doctor_name ? `Dr. ${c.doctor_name}` : "—" },
    { header: "Complaint", render: (c) => <span className="text-xs text-neutral-600 max-w-xs truncate block">{c.complaint ?? "—"}</span> },
    { header: "Diagnosis", render: (c) => <span className="text-xs text-neutral-700 max-w-xs truncate block">{c.diagnosis ?? "—"}</span> },
    {
      header: "",
      render: (c) => (
        <Link href={`/clinic/consultations/${c.id}`}>
          <Button variant="ghost">Open</Button>
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Consultations"
        actions={
          <>
            <Link href="/clinic/consultations/new">
              <Button variant="primary">New Consultation</Button>
            </Link>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />
      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input placeholder="Search by patient, doctor or diagnosis…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
      </div>
      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <DataTable columns={columns} rows={filtered} emptyMessage="No consultations found." />
      )}
    </div>
  );
}
