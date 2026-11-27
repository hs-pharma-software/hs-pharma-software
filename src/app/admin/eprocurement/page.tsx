"use client";

import { EpAdminFrame } from "@/components/admin/eprocurement/EpAdmin";
import { VendorList } from "@/components/admin/eprocurement/VendorList";

/** Super Admin > eProcurement > Vendor registrations: sign-ups waiting for review, sent back, rejected or not yet submitted. */
export default function EpRegistrationsPage() {
  return (
    <EpAdminFrame>
      <VendorList
        statuses={[{ key: "pending", label: "Waiting for review" }, { key: "changes", label: "Changes requested" }, { key: "rejected", label: "Rejected" }, { key: "draft", label: "Not submitted yet" }]}
        empty="No registrations here."
      />
    </EpAdminFrame>
  );
}
