"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { getBankSummaries, type BankSummaryRow } from "@/lib/repo/banks";

export default function BankSummaryPage() {
  const [rows, setRows] = useState<BankSummaryRow[]>([]);

  async function reload() {
    if (!isTauri()) return;
    setRows(await getBankSummaries());
  }

  useEffect(() => {
    void reload();
  }, []);

  const totals = rows.reduce(
    (acc, r) => {
      acc.deposit += r.deposit;
      acc.withdraw += r.withdraw;
      acc.balance += r.balance;
      return acc;
    },
    { deposit: 0, withdraw: 0, balance: 0 }
  );

  const columns: Column<BankSummaryRow>[] = [
    { header: "Bank Name", render: (r) => r.name },
    { header: "Deposit", render: (r) => r.deposit.toFixed(2) },
    { header: "Withdraw", render: (r) => r.withdraw.toFixed(2) },
    { header: "Balance", render: (r) => r.balance.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Bank Summary" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view bank summaries.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <div className="mt-3 flex justify-end gap-6 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
            <span className="text-neutral-500">
              Deposit: <span className="font-medium text-neutral-800">{totals.deposit.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Withdraw: <span className="font-medium text-neutral-800">{totals.withdraw.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Balance: <span className="font-medium text-neutral-800">{totals.balance.toFixed(2)}</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

