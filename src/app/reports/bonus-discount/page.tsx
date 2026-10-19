"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { getBonusAndDiscountReport } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Bonus Claim And Discount Report"
      columns={[
        { header: "Product", render: (r) => r.name },
        { header: "Bonus Qty", render: (r) => r.bonus_qty },
        { header: "Bonus Value", render: (r) => r.bonus_value.toFixed(2) },
        { header: "Discount Rs", render: (r) => r.discount_rs.toFixed(2) },
      ]}
      query={getBonusAndDiscountReport}
    />
  );
}
