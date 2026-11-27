"use client";

import { EpAdminFrame } from "@/components/admin/eprocurement/EpAdmin";
import { VendorList } from "@/components/admin/eprocurement/VendorList";

/** Super Admin > eProcurement > Blacklisted vendors: cannot sign in to the portal's work or be added by any hospital. */
export default function EpBlacklistPage() {
  return (
    <EpAdminFrame>
      <p className="text-sm text-neutral-600">A blacklisted vendor cannot quote, receive orders or be added by any hospital. Open one to see the reason or remove them from the blacklist.</p>
      <VendorList statuses={[{ key: "blacklisted", label: "Blacklisted" }]} empty="No blacklisted vendors." dateLabel="Since" />
    </EpAdminFrame>
  );
}
