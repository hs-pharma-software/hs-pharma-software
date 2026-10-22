"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useIsTauri } from "@/lib/platform";
import { restoreLocalBackup } from "@/lib/backup";

export default function RestorePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRestore() {
    if (!confirm("This will overwrite the local database with the selected backup. Continue?")) return;
    setBusy(true);
    setStatus(null);
    try {
      const picked = await restoreLocalBackup();
      setStatus(
        picked
          ? `Restored from ${picked}. Restart the app for it to take effect.`
          : "Restore cancelled."
      );
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
        title="Restore Backup Data"
        actions={
          <Button variant="danger" onClick={() => void handleRestore()} disabled={!tauriReady || busy}>
            {busy ? "Restoring..." : "Restore From File"}
          </Button>
        }
      />
      {!tauriReady ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to restore from a backup file.
        </p>
      ) : (
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] text-sm text-neutral-600">
          <p>Opens a file picker (matching the reference app&apos;s Windows &quot;This PC&quot; browser) to select a previously-saved <code>.db</code> backup and overwrite the local database.</p>
          {status && <p className="mt-3 rounded-md bg-neutral-100 px-3 py-2 text-neutral-800">{status}</p>}
        </div>
      )}
    </div>
  );
}

