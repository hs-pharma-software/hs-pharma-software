"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SERVER_DB } from "@/lib/serverMode";
import { useAuthStore } from "@/store/authStore";
import { OfflineDevicesManager } from "@/components/offline/OfflineDevicesManager";

declare global {
  interface Window {
    mavinDesktop?: {
      hasSavedPin?: () => Promise<boolean>;
      setPin?: (arg: { userId: string; pin: string }) => Promise<{ ok: boolean; error?: string }>;
      clearPin?: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

function DesktopPinCard() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentUser || !window.mavinDesktop?.hasSavedPin) return;
    // The desktop answers { ok, value } (every call does).
    void window.mavinDesktop.hasSavedPin().then((v) => setHasPin(typeof v === "boolean" ? v : Boolean((v as { ok?: boolean; value?: unknown })?.ok && (v as { value?: unknown }).value === true))).catch(() => setHasPin(false));
  }, [currentUser]);

  const savePin = async () => {
    if (!currentUser?.id) {
      setMsg("Sign in before saving a PIN.");
      return;
    }
    if (!window.mavinDesktop?.setPin) {
      setMsg("This feature is only available in the desktop app.");
      return;
    }
    if (!/^\d{4}$/.test(pin) || !/^\d{4}$/.test(confirm) || pin !== confirm) {
      setMsg("Use the same 4-digit PIN in both fields.");
      return;
    }
    setLoading(true);
    try {
      const r = await window.mavinDesktop.setPin({ userId: currentUser.id, pin });
      setMsg(r?.ok ? (hasPin ? "PIN updated." : "PIN saved. You can unlock with it on the next app start.") : (r?.error ?? "Unable to save PIN."));
      setHasPin(true);
      setPin("");
      setConfirm("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Unable to save PIN.");
    } finally {
      setLoading(false);
    }
  };

  const clearPin = async () => {
    if (!window.mavinDesktop?.clearPin) {
      setMsg("This feature is only available in the desktop app.");
      return;
    }
    setLoading(true);
    try {
      const r = await window.mavinDesktop.clearPin();
      setMsg(r?.ok ? "Saved PIN removed." : (r?.error ?? "Unable to clear PIN."));
      setHasPin(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Unable to clear PIN.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">Desktop PIN Login</h3>
          <p className="text-sm text-neutral-600">Save a 4-digit PIN so the desktop app can reopen without full login.</p>
        </div>
        {hasPin && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">PIN enabled</span>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium text-neutral-700">
            New 4-digit PIN
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-neutral-500"
              placeholder="1234"
            />
          </label>
          <label className="block text-sm font-medium text-neutral-700">
            Confirm PIN
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-neutral-500"
              placeholder="1234"
            />
          </label>
        </div>

        {msg && <p className="text-sm text-neutral-700">{msg}</p>}

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={loading} onClick={savePin} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {loading ? "Saving…" : hasPin ? "Update PIN" : "Save PIN"}
          </button>
          {hasPin && (
            <button type="button" disabled={loading} onClick={clearPin} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-60">
              Remove PIN
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings > Offline Desktop: the business owner's offline checkout devices. */
export default function OfflineDesktopPage() {
  const role = useAuthStore((s) => s.currentUser?.role);
  return (
    <div className="space-y-4">
      <PageHeader title="Offline Desktop" />
      {!SERVER_DB ? <p className="text-sm text-neutral-600">Managed in the web version of MAVIN.pk.</p>
        : role !== "owner" ? <p className="text-sm text-neutral-600">Only the business owner manages offline devices.</p>
        : (
          <>
            <DesktopPinCard />
            <OfflineDevicesManager />
          </>
        )}
    </div>
  );
}
