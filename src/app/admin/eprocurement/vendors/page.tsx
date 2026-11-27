"use client";

import { EpAdminFrame } from "@/components/admin/eprocurement/EpAdmin";
import { VendorList } from "@/components/admin/eprocurement/VendorList";

/** Super Admin > eProcurement > Approved vendors: the directory hospitals add vendors from (and suspended vendors). */
export default function EpVendorsPage() {
  return (
    <EpAdminFrame>
      <VendorList statuses={[{ key: "approved", label: "Approved" }, { key: "suspended", label: "Suspended" }]} empty="No vendors here yet." dateLabel="Approved" />
    </EpAdminFrame>
  );
}
