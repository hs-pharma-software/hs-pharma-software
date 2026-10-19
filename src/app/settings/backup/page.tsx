"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useIsTauri } from "@/lib/platform";
import { createLocalBackup } from "@/lib/backup";

export default function BackupPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleBackup() {
    setBusy(true);
    setStatus(null);
    try {
      const dest = await createLocalBackup();
      setStatus(dest ? `Backup saved to ${dest}` : "Backup cancelled.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Backup Details"
        actions={
          <Button variant="primary" onClick={() => void handleBackup()} disabled={!tauriReady || busy}>
            {busy ? "Backing up..." : "Create Local Backup"}
          </Button>
        }
      />

      {!tauriReady ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to create a backup of the local database file.
        </p>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-600">
          <p>
            This copies the local SQLite file (<code>pharmacy.db</code>) to a location you choose —
            independent of Turso sync, so it works even if you&apos;ve never connected to the
            internet. A cloud backup (uploading this copy somewhere automatically) isn&apos;t wired
            up yet; for now, treat Turso sync itself as the &quot;online backup&quot;.
          </p>
          {status && <p className="mt-3 rounded-md bg-neutral-100 px-3 py-2 text-neutral-800">{status}</p>}
        </div>
      )}
    </div>
  );
}
