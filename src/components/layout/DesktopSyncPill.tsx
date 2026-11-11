"use client";

import { useState } from "react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { desktopCall, type DesktopStatus } from "@/lib/desktopBridge";
import { useAuthStore } from "@/store/authStore";

const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "not yet");

/** MAVIN desktop app: connection, sales waiting to sync and the offline copy,
 * in the header's sync spot. "Online" does not mean everything is sent: the
 * pending count says that. */
export function DesktopSyncPill({ status }: { status: DesktopStatus }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const user = useAuthStore((s) => s.currentUser);
  const pending = status.pending ?? 0;
  const problems = (status.conflicts ?? 0) + (status.held ?? 0) + (status.rejected ?? 0);
  const off = status.online === false;

  const syncNow = async () => {
    setBusy(true);
    setMsg(null);
    try { await desktopCall((b) => b.syncNow()); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={off ? "Offline: sales are saved on this computer" : "Online"}
        className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 sm:px-3"
      >
        {off ? <WifiOff size={14} className="text-amber-600" /> : <Wifi size={14} className="text-emerald-600" />}
        <span className={off ? "text-amber-700" : "text-emerald-700"}>{off ? "Offline" : "Online"}</span>
        {pending > 0 && <span className="rounded-full bg-amber-100 px-1.5 font-semibold text-amber-800" title={`${pending} waiting to sync`}>{pending}</span>}
        {problems > 0 && <span className="rounded-full bg-rose-100 px-1.5 font-semibold text-rose-700" title="Need attention">{problems}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-72 space-y-1.5 rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-xl ring-1 ring-black/5">
            <p className="font-medium text-neutral-800">{off ? "Offline" : "Online"} · {pending ? `${pending} sale${pending === 1 ? "" : "s"} saved on this device, waiting to sync` : "nothing waiting to sync"}</p>
            {problems > 0 && <p className="text-rose-700">{problems} need attention (see Settings &gt; Offline Desktop online).</p>}
            {status.provisioned ? (
              <>
                <p className="text-neutral-500">Last synced: {when(status.lastSyncOk)}</p>
                {status.lastError && !off && <p className="text-rose-700">Last sync failed: {status.lastError}</p>}
                <p className="text-neutral-500">Stock and prices on this computer: as of {when(status.copyRefreshedAt)}</p>
                {status.allowanceEndsAt && <p className="text-neutral-500">Offline selling allowed until {when(status.allowanceEndsAt)}</p>}
                {status.sellBlock && <p className="text-amber-700">{status.sellBlock}</p>}
                <p className="text-neutral-400">Device {status.deviceCode} · {status.tenantName} · {status.branchName}</p>
                <button type="button" disabled={busy || off} onClick={() => void syncNow()} className="mt-1 inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2.5 py-1 font-medium hover:bg-neutral-50 disabled:opacity-50">
                  <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Sync now
                </button>
              </>
            ) : user?.role === "owner" && !off ? (
              <form className="space-y-1.5" onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setMsg(null);
                try {
                  const r = await desktopCall((b) => b.provision({ username: user.username, password }));
                  setMsg(`Set up as device ${r.deviceCode} for ${r.branchName}. Stock and prices are downloading.`);
                  setPassword("");
                } catch (err) { setMsg(err instanceof Error ? err.message : String(err)); }
                setBusy(false);
              }}>
                <p className="text-neutral-600">This computer can keep making cash sales when the internet drops. Set it up once (one offline computer per branch):</p>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" className="w-full rounded-lg border border-neutral-300 px-2 py-1.5" />
                <button type="submit" disabled={busy} className="rounded-full bg-neutral-900 px-3 py-1 font-medium text-white disabled:opacity-50">{busy ? "Setting up…" : "Set up offline sales"}</button>
              </form>
            ) : (
              <p className="text-neutral-500">Offline sales are not set up on this computer. The business owner sets it up while online.</p>
            )}
            {msg && <p className="text-neutral-700">{msg}</p>}
          </div>
        </>
      )}
    </div>
  );
}
