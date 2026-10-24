"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { patientsRepo } from "@/lib/repo/clinic";
import type { ClinicPatient } from "@/lib/types-clinic";
import PatientFormModal from "./PatientFormModal";

export default function PatientsPage() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicPatient | null>(null);
  const tauriReady = useIsTauri();

  async function reload() {
    if (!isTauri()) return;
    setPatients(await patientsRepo.list({ orderBy: "name ASC" }));
  }

  useEffect(() => { void reload(); }, [tenantId]);

  const filtered = patients.filter((p) => {
    const t = search.toLowerCase();
    return !t || p.name.toLowerCase().includes(t) || (p.phone ?? "").includes(t) || (p.mrn ?? "").toLowerCase().includes(t);
  });

  const columns: Column<ClinicPatient>[] = [
    { header: "MRN", render: (p) => <span className="font-mono text-xs text-neutral-500">{p.mrn ?? "—"}</span> },
    { header: "Name", render: (p) => <span className="font-medium">{p.name}</span> },
    { header: "DOB", render: (p) => p.dob ?? "—" },
    { header: "Gender", render: (p) => p.gender ?? "—" },
    { header: "Phone", render: (p) => p.phone ?? "—" },
    { header: "Blood Group", render: (p) => p.blood_group ?? "—" },
    { header: "Allergies", render: (p) => <span className="text-xs text-rose-600">{p.allergies ?? "—"}</span> },
    {
      header: "",
      render: (p) => (
        <Button variant="ghost" onClick={() => { setEditing(p); setModalOpen(true); }}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Patients"
        actions={
          <>
            <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>Add Patient</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />
      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input placeholder="Search by name, phone or MRN…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
      </div>
      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <DataTable columns={columns} rows={filtered} emptyMessage="No patients found." onRowClick={(p) => { setEditing(p); setModalOpen(true); }} />
      )}
      {modalOpen && (
        <PatientFormModal
          patient={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); void reload(); }}
        />
      )}
    </div>
  );
}
