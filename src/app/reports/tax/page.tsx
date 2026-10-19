"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { getTaxReport } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Tax Reports"
      columns={[
        { header: "Month", render: (r) => r.month },
        { header: "Sales Tax Collected", render: (r) => r.sales_tax.toFixed(2) },
        { header: "WHT Withheld (Purchases)", render: (r) => r.wht_collected.toFixed(2) },
      ]}
      query={getTaxReport}
    />
  );
}
