"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useIsTauri } from "@/lib/platform";
import { getTrialBalance, type TrialBalanceRow } from "@/lib/repo/reports";

export default function TrialBalanceReportPage() {
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [ran, setRan] = useState(false);

  async function run() {
    setRows(await getTrialBalance());
    setRan(true);
  }

  const columns: Column<TrialBalanceRow>[] = [
    { header: "Account", render: (r) => r.account },
    { header: "Debit", render: (r) => (r.debit ? r.debit.toFixed(2) : "—") },
    { header: "Credit", render: (r) => (r.credit ? r.credit.toFixed(2) : "—") },
  ];

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Trial Balance Report" actions={<Button variant="primary" onClick={() => void run()}>Report</Button>} />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to generate this report.
        </p>
      ) : (
        ran && (
          <>
            <DataTable columns={columns} rows={rows} />
            <div className="mt-3 flex justify-end gap-6 rounded-xl border border-neutral-200/70 bg-white px-5 py-2.5 text-sm shadow-sm">
              <span className="text-neutral-500">
                Total Debit: <span className="font-medium text-neutral-800">{totalDebit.toFixed(2)}</span>
              </span>
              <span className="text-neutral-500">
                Total Credit: <span className="font-medium text-neutral-800">{totalCredit.toFixed(2)}</span>
              </span>
            </div>
          </>
        )
      )}
    </div>
  );
}
