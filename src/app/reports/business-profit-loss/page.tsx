"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { getBusinessProfitLoss } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Business Wise Profit/Loss"
      columns={[
        { header: "Metric", render: (r) => r.metric },
        { header: "Amount", render: (r) => r.amount.toFixed(2) },
      ]}
      query={getBusinessProfitLoss}
    />
  );
}
