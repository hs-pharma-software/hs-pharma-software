"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { getCategoryWiseSales } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Category Wise Sales"
      columns={[
        { header: "Category", render: (r) => r.name },
        { header: "Sales", render: (r) => r.sales.toFixed(2) },
      ]}
      query={getCategoryWiseSales}
    />
  );
}
