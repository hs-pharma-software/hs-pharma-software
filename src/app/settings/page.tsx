"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { isTauri, useIsTauri } from "@/lib/platform";
import { isTursoConfigured } from "@/lib/sync/engine";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { getSetting, setSetting } from "@/lib/repo/settings";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-600" : "bg-rose-600"}`} />
      {label}: {ok ? "Configured" : "Not configured"}
    </span>
  );
}

export default function GeneralSettingsPage() {
  const [gstRate, setGstRate] = useState("0");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void getSetting("gst_rate_pct").then((v) => v && setGstRate(v));
  }, []);

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="mb-4 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3">
        <StatusPill ok={isTursoConfigured()} label="Turso sync" />
        <StatusPill ok={isCloudinaryConfigured()} label="Cloudinary images" />
        <StatusPill ok={tauriReady} label="Desktop shell" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 font-serif text-lg text-neutral-800">Tax Rate Info</h2>
          <div className="flex items-end gap-2">
            <div className="w-40">
              <Field label="GST Rate %">
                <Input type="number" min="0" step="any" value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={!tauriReady}
              onClick={async () => {
                await setSetting("gst_rate_pct", gstRate);
                setSaved(true);
                setTimeout(() => setSaved(false), 1500);
              }}
            >
              Save Changes
            </Button>
            {saved && <span className="text-xs text-emerald-600">Saved</span>}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-600">
          <h2 className="mb-2 font-serif text-lg text-neutral-800">Connecting Turso &amp; Cloudinary</h2>
          <p>
            Set <code>NEXT_PUBLIC_TURSO_DATABASE_URL</code>, <code>NEXT_PUBLIC_TURSO_AUTH_TOKEN</code>,{" "}
            <code>NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME</code> and{" "}
            <code>NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET</code> in <code>.env.local</code>, then restart{" "}
            <code>npm run tauri dev</code>. See the README for step-by-step setup.
          </p>
        </div>
      </div>
    </div>
  );
}
