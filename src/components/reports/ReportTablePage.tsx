"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useIsTauri } from "@/lib/platform";

interface RowBase {
  id: string;
}

/** Shared shape for every report screen: a From/To date range + a "Report"
 * button that runs the query and renders a table â€” matches the reference
 * app's Duration-filter-then-Report pattern, simplified to an explicit date
 * range instead of the Daily/Monthly/... preset dropdown. */
export function ReportTablePage<T extends RowBase>({
  title,
  columns,
  query,
  footer,
}: {
  title: string;
  columns: Column<T>[];
  query: (fromDate: string, toDate: string) => Promise<T[]>;
  footer?: (rows: T[]) => React.ReactNode;
}) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rows, setRows] = useState<T[]>([]);
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);

  async function runReport() {
    setLoading(true);
    try {
      setRows(await query(fromDate, toDate));
      setRan(true);
    } finally {
      setLoading(false);
    }
  }

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title={title} />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to generate this report.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-4 py-3">
            <Field label="From">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={() => void runReport()} disabled={loading}>
              {loading ? "Running..." : "Report"}
            </Button>
            <span className="text-xs text-neutral-400">Leave both blank for all-time.</span>
          </div>

          {ran && (
            <>
              <DataTable columns={columns} rows={rows} />
              {footer && (
                <div className="mt-3 flex justify-end gap-6 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
                  {footer(rows)}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

