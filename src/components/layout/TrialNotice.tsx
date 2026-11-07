"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { serverJson, SERVER_DB } from "@/lib/serverMode";
import { refreshSessionAccess } from "@/lib/auth";
import { TRIAL_DAYS, type TrialState } from "@/lib/subscription";

/** Free trial notice: days left and "Confirm subscription" (owner) during the
 * trial; the same button on the paused screen once it has ended. Confirming
 * starts the plan's full term at once. */
export function TrialNotice({ state, planLabel }: { state: Extract<TrialState, { trial: true }>; planLabel?: string }) {
  const isOwner = useAuthStore((s) => s.currentUser?.role === "owner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await serverJson("/api/auth/trial/", { action: "confirm" });
      await refreshSessionAccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setAsked(false);
    }
  }

  const button = isOwner && SERVER_DB ? (
    asked ? (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-xs">Start {planLabel ?? "your plan"} now?</span>
        <button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "Confirming…" : "Yes, confirm"}</button>
        <button type="button" onClick={() => setAsked(false)} className="text-xs underline">Not now</button>
      </span>
    ) : (
      <button type="button" onClick={() => setAsked(true)} className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90">Confirm subscription</button>
    )
  ) : null;

  if (state.ended) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center">
        <p className="font-serif text-lg text-amber-900">Your {TRIAL_DAYS}-day trial has ended</p>
        <p className="mt-2 text-sm text-amber-800">
          Your records are kept. {isOwner ? "Confirm the subscription to continue with full access on your plan." : "Ask the business owner to confirm the subscription."} Questions? Call MAVIN.pk on 0316-0585858.
        </p>
        {button && <div className="mt-4 flex justify-center">{button}</div>}
        {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      </div>
    );
  }
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
      <span>
        <b>Free trial:</b> {state.daysLeft} day{state.daysLeft === 1 ? "" : "s"} left (until {state.endsOn}).{" "}
        {isOwner ? "Confirm to keep full access on your plan." : "The business owner can confirm the subscription."}
      </span>
      {button}
      {error && <span className="w-full text-xs text-rose-700">{error}</span>}
    </div>
  );
}
