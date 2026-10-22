"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useIsTauri } from "@/lib/platform";
import { getBalanceSheet, type BalanceSheetRow } from "@/lib/repo/reports";

export default function BalanceSheetReportPage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<BalanceSheetRow[]>([]);
  const [ran, setRan] = useState(false);

  async function run() {
    setRows(await getBalanceSheet(asOfDate));
    setRan(true);
  }

  const columns: Column<BalanceSheetRow>[] = [
    { header: "Section", render: (r) => r.section },
    { header: "Account", render: (r) => r.account },
    { header: "Amount", render: (r) => r.amount.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Balance Sheet" />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to generate this report.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-end gap-3 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-4 py-3">
            <Field label="As Date Of">
              <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={() => void run()}>
              Report
            </Button>
          </div>
          {ran && <DataTable columns={columns} rows={rows} />}
        </>
      )}
    </div>
  );
}

