"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { QuickAddDialog } from "@/components/ui/QuickAddDialog";
import { isTauri, useIsTauri } from "@/lib/platform";
import { dbSelect } from "@/lib/db";
import { salesmenRepo } from "@/lib/repo/salesmen";
import { useAuthStore } from "@/store/authStore";

interface SalesmanRow {
  id: string;
  name: string;
  invoice_count: number;
  sale: number;
  sale_return: number;
  net_sale: number;
}

export default function SalesmanPage() {
  const [rows, setRows] = useState<SalesmanRow[]>([]);
  const [adding, setAdding] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
    setRows(
      await dbSelect<SalesmanRow>(
        `
        SELECT
          sm.id, sm.name,
          (SELECT COUNT(*) FROM invoices i WHERE i.salesman_id = sm.id AND i.tenant_id = ? AND i.deleted_at IS NULL AND i.is_return = 0 AND i.is_quotation = 0) AS invoice_count,
          COALESCE((SELECT SUM(total) FROM invoices i WHERE i.salesman_id = sm.id AND i.tenant_id = ? AND i.deleted_at IS NULL AND i.is_return = 0 AND i.is_quotation = 0), 0) AS sale,
          COALESCE((SELECT SUM(total) FROM invoices i WHERE i.salesman_id = sm.id AND i.tenant_id = ? AND i.deleted_at IS NULL AND i.is_return = 1 AND i.is_quotation = 0), 0) AS sale_return,
          COALESCE((SELECT SUM(total) FROM invoices i WHERE i.salesman_id = sm.id AND i.tenant_id = ? AND i.deleted_at IS NULL AND i.is_return = 0 AND i.is_quotation = 0), 0)
            - COALESCE((SELECT SUM(total) FROM invoices i WHERE i.salesman_id = sm.id AND i.tenant_id = ? AND i.deleted_at IS NULL AND i.is_return = 1 AND i.is_quotation = 0), 0) AS net_sale
        FROM salesmen sm
        WHERE sm.deleted_at IS NULL AND sm.tenant_id = ?
        ORDER BY sm.name ASC
      `,
        [tenantId, tenantId, tenantId, tenantId, tenantId, tenantId]
      )
    );
  }

  useEffect(() => {
    void reload();
  }, []);

  const totalAmount = rows.reduce((s, r) => s + r.net_sale, 0);

  const columns: Column<SalesmanRow>[] = [
    { header: "Name", render: (r) => r.name },
    { header: "No. of Invoices", render: (r) => r.invoice_count },
    { header: "Sale", render: (r) => r.sale.toFixed(2) },
    { header: "Sale Return", render: (r) => r.sale_return.toFixed(2) },
    { header: "Net Sale", render: (r) => r.net_sale.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Salesman Record"
        actions={
          <>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add Salesman
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view salesman performance.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <div className="mt-3 flex justify-end rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
            <span className="font-medium text-neutral-700">Total Amount: {totalAmount.toFixed(2)}</span>
          </div>
        </>
      )}

      {adding && (
        <QuickAddDialog
          title="Add Salesman"
          onClose={() => setAdding(false)}
          onSubmit={async ({ name }) => {
            await salesmenRepo.create({ name, phone: null });
            setAdding(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

