"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StaffFormModal } from "@/components/staff/StaffFormModal";
import { staffRepo } from "@/lib/repo/staff";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Staff } from "@/lib/types";

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setStaff(await staffRepo.list());
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = staff.filter((s) => {
    const term = search.toLowerCase();
    return !term || s.name.toLowerCase().includes(term) || (s.phone ?? "").toLowerCase().includes(term);
  });

  const columns: Column<Staff>[] = [
    { header: "Name", render: (s) => <span className="font-medium">{s.name}</span> },
    { header: "Designation", render: (s) => s.designation ?? "—" },
    { header: "Phone No", render: (s) => s.phone ?? "—" },
    { header: "CNIC", render: (s) => s.cnic ?? "—" },
    { header: "Date Of Joining", render: (s) => s.date_of_joining ?? "—" },
    { header: "Basic Pay", render: (s) => s.basic_pay.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Staff Details"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-white px-4 py-2.5 shadow-sm">
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage staff.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(s) => {
            setEditing(s);
            setModalOpen(true);
          }}
        />
      )}

      {modalOpen && (
        <StaffFormModal
          staff={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
