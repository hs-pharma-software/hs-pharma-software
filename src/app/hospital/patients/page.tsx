"use client";

import { useEffect, useState } from "react";
import { Search, Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import PatientFormModal from "./PatientFormModal";

export default function HospitalPatientsPage() {
  const [rows, setRows] = useState<HospitalPatient[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<HospitalPatient | null | "new">(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await hospitalPatientsRepo.list({ orderBy: "name ASC" }));
  }

  useEffect(() => { void reload(); }, []);

  const filtered = search.trim()
    ? rows.filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.mr_no.toLowerCase().includes(search.toLowerCase()) ||
        (r.phone ?? "").includes(search) ||
        (r.cnic ?? "").includes(search)
      )
    : rows;

  const columns: Column<HospitalPatient>[] = [
    { header: "MR No", render: (r) => <span className="font-mono text-xs">{r.mr_no}</span> },
    { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Gender", render: (r) => r.gender },
    { header: "Age", render: (r) => r.age_years != null ? `${r.age_years}y${r.age_months ? ` ${r.age_months}m` : ""}` : (r.dob ?? "—") },
    { header: "Phone", render: (r) => r.phone ?? "—" },
    { header: "Blood Grp", render: (r) => r.blood_group ?? "—" },
    { header: "City", render: (r) => r.city ?? "—" },
    {
      header: "",
      render: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing(r); }}
          className="text-neutral-400 hover:text-amber-700"
        >
          <Pencil size={15} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Patients"
        actions={
          <>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, MR, phone, CNIC…"
                className="pl-8 !w-64"
              />
            </div>
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus size={14} className="mr-1" />
              Register Patient
            </Button>
          </>
        }
      />

      <DataTable columns={columns} rows={filtered} />

      {editing !== null && (
        <PatientFormModal
          patient={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}
