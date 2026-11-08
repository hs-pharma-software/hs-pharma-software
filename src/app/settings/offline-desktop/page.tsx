"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { SERVER_DB } from "@/lib/serverMode";
import { useAuthStore } from "@/store/authStore";
import { OfflineDevicesManager } from "@/components/offline/OfflineDevicesManager";

/** Settings > Offline Desktop: the business owner's offline checkout devices. */
export default function OfflineDesktopPage() {
  const role = useAuthStore((s) => s.currentUser?.role);
  return (
    <div className="space-y-4">
      <PageHeader title="Offline Desktop" />
      {!SERVER_DB ? <p className="text-sm text-neutral-600">Managed in the web version of MAVIN.pk.</p>
        : role !== "owner" ? <p className="text-sm text-neutral-600">Only the business owner manages offline devices.</p>
        : <OfflineDevicesManager />}
    </div>
  );
}
