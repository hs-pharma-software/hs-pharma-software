"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { formatReportQty } from "@/lib/uom";
import { getCategoryProfitLoss } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Category Wise Profit/Loss"
      columns={[
        { header: "Category", render: (r) => r.name },
        { header: "Qty Sold", render: (r) => formatReportQty(r.qty) },
        { header: "Sales", render: (r) => r.sales.toFixed(2) },
        { header: "COGS", render: (r) => r.cogs.toFixed(2) },
        { header: "Profit", render: (r) => r.profit.toFixed(2) },
      ]}
      query={getCategoryProfitLoss}
    />
  );
}
