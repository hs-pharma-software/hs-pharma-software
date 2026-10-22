"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { Button } from "./Button";
import { DataTable, type Column } from "./DataTable";
import { QuickAddDialog } from "./QuickAddDialog";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { BaseRow } from "@/lib/repo/base";

interface CategoryRow extends BaseRow {
  name: string;
  description: string | null;
}

export function SimpleCategoryPage({
  title,
  repo,
}: {
  title: string;
  repo: {
    list: () => Promise<CategoryRow[]>;
    create: (data: { name: string; description: string | null }) => Promise<CategoryRow>;
  };
}) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [adding, setAdding] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setRows(await repo.list());
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: Column<CategoryRow>[] = [
    { header: "Category Name", render: (r) => r.name },
    { header: "Description", render: (r) => r.description ?? "\u2014" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title={title}
        actions={
          <>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage categories.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}

      {adding && (
        <QuickAddDialog
          title={`-:Add ${title.replace(" Details", "")}:-`}
          onClose={() => setAdding(false)}
          onSubmit={async ({ name, description }) => {
            await repo.create({ name, description: description || null });
            setAdding(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
