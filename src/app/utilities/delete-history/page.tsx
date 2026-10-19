"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { dbSelect } from "@/lib/db";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";

interface DeleteHistoryRow {
  id: string;
  date: string;
  delete_from: string;
  delete_by: string | null;
  reason: string | null;
}

export default function DeleteHistoryPage() {
  const [rows, setRows] = useState<DeleteHistoryRow[]>([]);

  async function reload() {
    if (!isTauri()) return;
    setRows(
      await dbSelect<DeleteHistoryRow>(
        `SELECT * FROM delete_history WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
        [useAuthStore.getState().currentTenant?.id ?? null]
      )
    );
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<DeleteHistoryRow>[] = [
    { header: "Date", render: (r) => r.date },
    { header: "Delete From", render: (r) => r.delete_from },
    { header: "Delete By", render: (r) => r.delete_by ?? "—" },
    { header: "Reason", render: (r) => r.reason ?? "—" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Delete History" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      {!tauriReady ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view the delete audit log.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}
    </div>
  );
}
