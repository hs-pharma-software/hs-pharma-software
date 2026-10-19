"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { getCustomerProfitLoss } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Customer Wise Profit/Loss"
      columns={[
        { header: "Customer", render: (r) => r.name },
        { header: "Qty", render: (r) => r.qty },
        { header: "Sales", render: (r) => r.sales.toFixed(2) },
        { header: "COGS", render: (r) => r.cogs.toFixed(2) },
        { header: "Profit", render: (r) => r.profit.toFixed(2) },
      ]}
      query={getCustomerProfitLoss}
    />
  );
}
