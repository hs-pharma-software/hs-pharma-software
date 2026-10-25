"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { REQUIRED_SCHEMA_VERSION, sharedSchemaStatus, type SchemaStatus } from "@/lib/schemaVersion";

/** Tells the Super Admin when the shared database is older than this code,
 * before a save fails on a missing column. Running the migration is the
 * Super Admin's job, so businesses (hospital, clinic, pharmacy logins) never
 * see it. Checked once per session; other pages keep working. */
export function SchemaBanner() {
  const user = useAuthStore((s) => s.currentUser);
  const [status, setStatus] = useState<SchemaStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const superAdmin = user?.role === "super_admin";

  useEffect(() => {
    if (!superAdmin) return;
    void sharedSchemaStatus().then(setStatus).catch(() => setStatus(null));
  }, [superAdmin]);

  if (!superAdmin || hidden || !status || status.state === "ok") return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <span className="font-semibold">Database update needed.</span>
      <span>
        {status.state === "behind"
          ? `The shared database is at version ${status.version}; this version of the app needs ${REQUIRED_SCHEMA_VERSION}.`
          : `The shared database has no migration history, so it may be older than this app (needs version ${REQUIRED_SCHEMA_VERSION}).`}
        {" "}Features that need the newer version will show an error until it is updated. On the computer with the project:
        {" "}<code className="rounded bg-amber-100 px-1">node scripts/backup-turso-snapshot.cjs</code>, then
        {" "}<code className="rounded bg-amber-100 px-1">node scripts/migrate-turso.cjs --check</code>.
      </span>
      <button type="button" onClick={() => setHidden(true)} className="ml-auto rounded px-2 py-0.5 font-medium hover:bg-amber-100">Dismiss</button>
    </div>
  );
}
