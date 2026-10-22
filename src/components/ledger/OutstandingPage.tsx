"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { dbSelect } from "@/lib/db";
import { useAuthStore } from "@/store/authStore";
import type { PartyType } from "@/lib/types2";

interface OutstandingRow {
  id: string;
  name: string;
  phone: string | null;
  opening_balance: number;
  total_paid: number;
  balance: number;
}

export function OutstandingPage({ title, partyType, table }: { title: string; partyType: PartyType; table: string }) {
  const [rows, setRows] = useState<OutstandingRow[]>([]);

  // Customers owe against their invoices, suppliers are owed against
  // purchases â€” staff have neither, so their trade balance is always 0.
  const tradeClause =
    partyType === "customer"
      ? `COALESCE((SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) FROM invoices WHERE customer_id = p.id AND tenant_id = ? AND deleted_at IS NULL AND is_quotation = 0), 0)`
      : partyType === "supplier"
        ? `COALESCE((SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) FROM purchases WHERE supplier_id = p.id AND tenant_id = ? AND deleted_at IS NULL), 0)`
        : `0`;

  async function reload() {
    if (!isTauri()) return;
    const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
    const tradeParams = partyType === "staff" ? [] : [tenantId];
    const data = await dbSelect<OutstandingRow>(
      `
      SELECT p.id, p.name, p.phone, p.opening_balance,
             COALESCE((SELECT SUM(paid_amount) FROM ledger_adjustments WHERE tenant_id = ? AND party_type = ? AND party_id = p.id AND deleted_at IS NULL), 0) AS total_paid,
             p.opening_balance + ${tradeClause} - COALESCE((SELECT SUM(paid_amount) FROM ledger_adjustments WHERE tenant_id = ? AND party_type = ? AND party_id = p.id AND deleted_at IS NULL), 0) AS balance
      FROM ${table} p
      WHERE p.deleted_at IS NULL AND p.tenant_id = ?
      ORDER BY p.name ASC
    `,
      [tenantId, partyType, ...tradeParams, tenantId, partyType, tenantId]
    );
    setRows(data);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = rows.reduce(
    (acc, r) => {
      acc.opening += r.opening_balance;
      if (r.balance > 0) acc.payable += r.balance;
      else acc.receivable += -r.balance;
      return acc;
    },
    { opening: 0, payable: 0, receivable: 0 }
  );

  const columns: Column<OutstandingRow>[] = [
    { header: "Name", render: (r) => r.name },
    { header: "Phone No", render: (r) => r.phone ?? "â€”" },
    { header: "Opening Balance", render: (r) => r.opening_balance.toFixed(2) },
    { header: "Total Adjusted", render: (r) => r.total_paid.toFixed(2) },
    { header: "Current Balance", render: (r) => r.balance.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title={title} actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view outstanding balances.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <div className="mt-3 flex justify-end gap-6 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
            <span className="text-neutral-500">
              Opening: <span className="font-medium text-neutral-800">{totals.opening.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Total Payable: <span className="font-medium text-neutral-800">{totals.payable.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Total Receivable: <span className="font-medium text-neutral-800">{totals.receivable.toFixed(2)}</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

