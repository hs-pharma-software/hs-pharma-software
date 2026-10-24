"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { listEpisodes, type EpisodeListRow } from "@/lib/repo/hospital";
import NewEpisodeModal from "./NewEpisodeModal";

const TYPE_COLOR: Record<string, string> = {
  opd: "bg-blue-100 text-blue-700",
  ipd: "bg-purple-100 text-purple-700",
  emergency: "bg-red-100 text-red-700",
};
const STATUS_COLOR: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-700",
  discharged: "bg-neutral-100 text-neutral-600",
  cancelled: "bg-red-100 text-red-500",
};

/** The episodes table. `type` is "" (all), "opd", "ipd" or "emergency". */
export default function EpisodesList({ type }: { type: string }) {
  const router = useRouter();
  const typeFilter = type;

  const [rows, setRows] = useState<EpisodeListRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [showNew, setShowNew] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listEpisodes({ type: typeFilter || undefined, status: statusFilter || undefined }));
  }

  useEffect(() => { void reload(); }, [typeFilter, statusFilter]);

  const TYPE_LABEL: Record<string, string> = { opd: "OPD", ipd: "IPD", emergency: "Emergency" };

  const columns: Column<EpisodeListRow>[] = [
    { header: "Episode No", render: (r) => <span className="font-mono text-xs">{r.episode_no}</span> },
    {
      header: "Type",
      render: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLOR[r.type] ?? ""}`}>
          {TYPE_LABEL[r.type] ?? r.type}
        </span>
      ),
    },
    { header: "Patient", render: (r) => <span className="font-medium">{r.patient_name}</span> },
    { header: "MR No", render: (r) => <span className="font-mono text-xs text-neutral-400">{r.mr_no}</span> },
    { header: "Department", render: (r) => r.department ?? "—" },
    { header: "Date", render: (r) => r.date },
    {
      header: "Status",
      render: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[r.status] ?? ""}`}>
          {r.status}
        </span>
      ),
    },
    { header: "Charges", render: (r) => <span className="font-mono text-xs">{r.total_charges.toFixed(0)}</span> },
    { header: "Paid", render: (r) => <span className="font-mono text-xs text-emerald-600">{r.total_paid.toFixed(0)}</span> },
    {
      header: "Balance",
      render: (r) => {
        const bal = r.total_charges - r.total_paid;
        return <span className={`font-mono text-xs font-medium ${bal > 0 ? "text-red-600" : "text-emerald-600"}`}>{bal.toFixed(0)}</span>;
      },
    },
  ];

  const title = typeFilter === "opd" ? "OPD Queue" : typeFilter === "ipd" ? "Inpatients (IPD)" : typeFilter === "emergency" ? "Emergency" : "All Episodes";

  return (
    <div>
      <PageHeader
        title={title}
        actions={
          <>
            {/* Status filter */}
            <div className="flex rounded-lg overflow-hidden border border-neutral-200 text-sm">
              {["open", "discharged", ""].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 ${statusFilter === s ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
                >
                  {s === "open" ? "Open" : s === "discharged" ? "Discharged" : "All"}
                </button>
              ))}
            </div>
            <Button onClick={() => void reload()}>Refresh</Button>
            <Button variant="primary" onClick={() => setShowNew(true)}>
              <Plus size={14} className="mr-1" />
              New Episode
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        onRowClick={(r) => router.push(`/hospital/episodes/view?id=${r.id}`)}
      />

      {showNew && (
        <NewEpisodeModal
          defaultType={(typeFilter as "opd" | "ipd" | "emergency") || "opd"}
          onClose={() => setShowNew(false)}
          onSaved={(id) => { setShowNew(false); router.push(`/hospital/episodes/view?id=${id}`); }}
        />
      )}
    </div>
  );
}
