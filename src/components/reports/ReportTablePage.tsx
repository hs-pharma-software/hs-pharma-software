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
 * button that runs the query and renders a table - matches the reference
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
  const [error, setError] = useState<string | null>(null);

  async function runReport() {
    setLoading(true);
    setError(null);
    try {
      setRows(await query(fromDate, toDate));
      setRan(true);
    } catch (e) {
      // Show why instead of leaving an empty page.
      setError(e instanceof Error ? e.message : String(e));
      setRan(false);
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

          {error && (
            <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Could not run the report: {error}</p>
          )}
          {ran && rows.length === 0 && (
            <p className="mb-3 rounded-xl bg-white px-4 py-3 text-sm text-neutral-500 ring-1 ring-black/[0.04]">No sales in this period.</p>
          )}
          {ran && rows.length > 0 && (
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

