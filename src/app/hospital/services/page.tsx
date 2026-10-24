"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hospitalServicesRepo, type HospitalService } from "@/lib/repo/hospital";
import ServiceFormModal from "./ServiceFormModal";

export default function HospitalServicesPage() {
  const [rows, setRows] = useState<HospitalService[]>([]);
  const [editing, setEditing] = useState<HospitalService | null | "new">(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await hospitalServicesRepo.list({ orderBy: "department ASC, name ASC" }));
  }

  useEffect(() => { void reload(); }, []);

  const CATEGORY_LABELS: Record<string, string> = {
    consultation: "Consultation", procedure: "Procedure", lab: "Lab",
    imaging: "Imaging", bed: "Bed/Room", nursing: "Nursing", ot: "OT",
    pharmacy: "Pharmacy", misc: "Misc",
  };

  const columns: Column<HospitalService>[] = [
    { header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Department", render: (r) => r.department },
    { header: "Category", render: (r) => CATEGORY_LABELS[r.category] ?? r.category },
    { header: "Billing Unit", render: (r) => r.billing_unit },
    { header: "Rate", render: (r) => <span className="font-mono">Rs {r.rate.toFixed(0)}</span> },
    {
      header: "Status",
      render: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
          {r.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
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
        title="Service Master"
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={14} className="mr-1" />
            Add Service
          </Button>
        }
      />
      <DataTable columns={columns} rows={rows} />
      {editing !== null && (
        <ServiceFormModal
          service={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}
