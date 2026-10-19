"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { getProductProfitLoss } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Product Wise Profit/Loss"
      columns={[
        { header: "Product", render: (r) => r.name },
        { header: "Qty Sold", render: (r) => r.qty },
        { header: "Sales", render: (r) => r.sales.toFixed(2) },
        { header: "COGS", render: (r) => r.cogs.toFixed(2) },
        { header: "Profit", render: (r) => r.profit.toFixed(2) },
      ]}
      query={getProductProfitLoss}
      footer={(rows) => (
        <span className="font-medium text-neutral-700">
          Total Profit: {rows.reduce((s, r) => s + r.profit, 0).toFixed(2)}
        </span>
      )}
    />
  );
}
