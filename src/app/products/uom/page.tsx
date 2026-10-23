"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { seedStarterUoms, uomsRepo } from "@/lib/repo/uoms";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Uom } from "@/lib/types";

export default function UomPage() {
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [adding, setAdding] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setUoms(await uomsRepo.list({ orderBy: "name ASC" }));
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<Uom>[] = [
    { header: "Unit Name", render: (u) => u.name },
    { header: "Description", render: (u) => u.description ?? "\u2014" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="UOM Details"
        actions={
          <>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add
            </Button>
            {uoms.length === 0 && (
              <Button onClick={() => void seedStarterUoms().then(reload)}>Add common units</Button>
            )}
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage units of measure.
        </p>
      ) : (
        <DataTable columns={columns} rows={uoms} />
      )}

      {adding && (
        <QuickAddDialog
          title="Add Unit"
          onClose={() => setAdding(false)}
          onSubmit={async ({ name, description }) => {
            await uomsRepo.create({ name, description: description || null });
            setAdding(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
