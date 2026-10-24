"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { doctorsRepo } from "@/lib/repo/clinic";
import type { ClinicDoctor } from "@/lib/types-clinic";
import DoctorFormModal from "./DoctorFormModal";

export default function DoctorsPage() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicDoctor | null>(null);
  const tauriReady = useIsTauri();

  async function reload() {
    if (!isTauri()) return;
    setDoctors(await doctorsRepo.list({ orderBy: "name ASC" }));
  }

  useEffect(() => { void reload(); }, [tenantId]);

  // Soft delete: the doctor leaves the lists, past appointments and consultations keep their name.
  async function deactivate(d: ClinicDoctor) {
    if (!window.confirm(`Deactivate Dr. ${d.name}? Past appointments and consultations are kept.`)) return;
    try {
      await doctorsRepo.remove(d.id);
      await reload();
    } catch (e) {
      window.alert(`Could not deactivate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const filtered = doctors.filter((d) => {
    const t = search.toLowerCase();
    return !t || d.name.toLowerCase().includes(t) || (d.specialization ?? "").toLowerCase().includes(t);
  });

  const columns: Column<ClinicDoctor>[] = [
    { header: "Name", render: (d) => <span className="font-medium">Dr. {d.name}</span> },
    { header: "Specialization", render: (d) => d.specialization ?? "—" },
    { header: "Qualification", render: (d) => d.qualification ?? "—" },
    { header: "Phone", render: (d) => d.phone ?? "—" },
    { header: "Consult Fee", render: (d) => <span className="tabular-nums">Rs {d.consultation_fee.toFixed(0)}</span> },
    { header: "Follow-up Fee", render: (d) => <span className="tabular-nums">Rs {d.follow_up_fee.toFixed(0)}</span> },
    { header: "Slot (min)", render: (d) => d.slot_minutes },
    {
      header: "",
      render: (d) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" onClick={() => { setEditing(d); setModalOpen(true); }}>Edit</Button>
          <Button variant="ghost" onClick={() => void deactivate(d)}>Deactivate</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Doctors"
        actions={
          <>
            <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>Add Doctor</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />
      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input placeholder="Search by name or specialization…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
      </div>
      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <DataTable columns={columns} rows={filtered} emptyMessage="No doctors found." onRowClick={(d) => { setEditing(d); setModalOpen(true); }} />
      )}
      {modalOpen && (
        <DoctorFormModal
          doctor={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); void reload(); }}
        />
      )}
    </div>
  );
}
