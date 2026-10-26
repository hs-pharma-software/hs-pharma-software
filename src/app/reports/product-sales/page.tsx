"use client";

import { ReportTablePage } from "@/components/reports/ReportTablePage";
import { formatReportQty } from "@/lib/uom";
import { getProductWiseSales } from "@/lib/repo/reports";

export default function Page() {
  return (
    <ReportTablePage
      title="Product Wise Sales Report"
      columns={[
        { header: "Product", render: (r) => r.name },
        { header: "Qty Sold", render: (r) => formatReportQty(r.qty, r.packing, r.base_unit, r.secondary_unit) },
        { header: "Sales", render: (r) => r.sales.toFixed(2) },
      ]}
      query={getProductWiseSales}
      footer={(rows) => (
        <span className="font-medium text-neutral-700">
          Total Sales: {rows.reduce((s, r) => s + r.sales, 0).toFixed(2)}
        </span>
      )}
    />
  );
}
