"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StaffFormModal } from "@/components/staff/StaffFormModal";
import { StaffPermissionsModal } from "@/components/staff/StaffPermissionsModal";
import { staffRepo } from "@/lib/repo/staff";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Staff } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const isHospital = useAuthStore((st) => businessType(st.currentTenant?.businessType).id === "hospital");
  // Only the owner or a full-access login may change what other logins can open.
  const canSetPermissions = useAuthStore((st) => st.currentUser?.role !== "staff" || st.currentUser?.permissions === null);
  const [permsFor, setPermsFor] = useState<Staff | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setStaff(await staffRepo.list());
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = staff.filter((s) => {
    const term = search.toLowerCase();
    return !term || s.name.toLowerCase().includes(term) || (s.phone ?? "").toLowerCase().includes(term) || (s.employee_id ?? "").toLowerCase().includes(term);
  });

  const columns: Column<Staff>[] = [
    ...(isHospital ? [{ header: "Emp ID", render: (s: Staff) => <span className="font-mono text-xs">{s.employee_id ?? "\u2014"}</span> }] : []),
    { header: "Name", render: (s) => <span className="font-medium">{s.name}</span> },
    { header: "Designation", render: (s) => s.designation ?? "\u2014" },
    ...(isHospital
      ? [
          { header: "Licence", render: (s: Staff) => (s.license_no ? `${s.license_type ?? ""} ${s.license_no}` : "\u2014") },
          { header: "Department", render: (s: Staff) => s.department ?? "\u2014" },
        ]
      : []),
    { header: "Login", render: (s: Staff) => (s.user_id ? <span className="text-emerald-700">Linked</span> : <span className="text-neutral-400">Not linked</span>) },
    { header: "Phone No", render: (s) => s.phone ?? "\u2014" },
    { header: "CNIC", render: (s) => s.cnic ?? "\u2014" },
    { header: "Date Of Joining", render: (s) => s.date_of_joining ?? "\u2014" },
    { header: "Basic Pay", render: (s) => s.basic_pay.toFixed(2) },
    {
      header: "",
      render: (s: Staff) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" onClick={() => { setEditing(s); setModalOpen(true); }}>Edit</Button>
          {isHospital && canSetPermissions && (
            <Button variant="ghost" disabled={!s.user_id} title={s.user_id ? undefined : "Give this staff member a login first (Edit)"} onClick={() => setPermsFor(s)}>
              Permissions
            </Button>
          )}
        </div>
      ),
    },
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

      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-4 py-2.5">
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

      {permsFor && <StaffPermissionsModal staff={permsFor} onClose={() => setPermsFor(null)} onSaved={() => setPermsFor(null)} />}
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

